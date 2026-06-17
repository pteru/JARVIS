#!/usr/bin/env node
/**
 * backlog-source — single source of GitHub-Issues logic for the JARVIS orchestrator.
 * Used both as an importable API (by the backlog-manager MCP) and as a CLI (by shell).
 * Wraps the `gh` CLI + a per-repo JSON cache + workspace→repo resolution.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);

function getHome() { return process.env.ORCHESTRATOR_HOME || path.join(process.env.HOME, 'JARVIS'); }
function getCacheDir() { return path.join(getHome(), 'data', 'backlog-cache'); }
function getConfigDir() { return path.join(getHome(), 'config', 'orchestrator'); }
const TTL_MS = 6 * 60 * 60 * 1000; // 6h
const DEFAULT_LABEL = 'backlog';

export function parseRemote(remoteUrl) {
  if (!remoteUrl) return null;
  const m = remoteUrl.match(/github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/);
  if (!m) return null;
  return { owner: m[1], repo: m[2], slug: `${m[1]}/${m[2]}` };
}

export async function resolveRepo(workspace) {
  if (workspace === 'orchestrator') return { owner: 'pteru', repo: 'JARVIS', slug: 'pteru/JARVIS' };
  if (/^[^/\s]+\/[^/\s]+$/.test(workspace)) {
    const [owner, repo] = workspace.split('/');
    return { owner, repo, slug: `${owner}/${repo}` };
  }
  try {
    const cfg = JSON.parse(await fs.readFile(path.join(getConfigDir(), 'workspaces.json'), 'utf-8'));
    return parseRemote(cfg.workspaces?.[workspace]?.remotes?.origin);
  } catch {
    return null;
  }
}

export async function configuredRepos() {
  const cfg = JSON.parse(await fs.readFile(path.join(getConfigDir(), 'issue-repos.json'), 'utf-8'));
  return cfg.repos || [];
}

/** Find the workspace key whose remotes.origin matches a given owner/repo slug. */
export async function resolveWorkspaceByRepo(slug) {
  if (slug === 'pteru/JARVIS') return 'orchestrator';
  const cfg = JSON.parse(await fs.readFile(path.join(getConfigDir(), 'workspaces.json'), 'utf-8'));
  const matches = Object.entries(cfg.workspaces || {})
    .filter(([, w]) => parseRemote(w.remotes?.origin)?.slug === slug)
    .map(([k]) => k);
  return matches[0] || null;
}

function cacheFile(slug) {
  return path.join(getCacheDir(), slug.replace('/', '__') + '.json');
}

function normalizeIssue(i) {
  return {
    number: i.number,
    title: i.title,
    body: i.body ?? '',
    labels: (i.labels || []).map((l) => (typeof l === 'string' ? l : l.name)),
    state: (i.state || 'open').toLowerCase(),
    url: i.url,
    updatedAt: i.updatedAt,
  };
}

async function readCache(slug) {
  try {
    return JSON.parse(await fs.readFile(cacheFile(slug), 'utf-8'));
  } catch {
    return null;
  }
}

/** Pull open backlog issues for each repo into the cache. Never throws; per-repo errors are reported. */
export async function refreshCache(repos, { label = DEFAULT_LABEL } = {}) {
  const list = repos && repos.length ? repos : await configuredRepos();
  const out = [];
  await fs.mkdir(getCacheDir(), { recursive: true });
  for (const slug of list) {
    try {
      const { stdout } = await execFileAsync('gh', [
        'issue', 'list', '--repo', slug, '--label', label, '--state', 'open',
        '--limit', '200', '--json', 'number,title,body,labels,state,url,updatedAt',
      ]);
      const issues = JSON.parse(stdout).map(normalizeIssue);
      await fs.writeFile(cacheFile(slug),
        JSON.stringify({ fetchedAt: new Date().toISOString(), repo: slug, issues }, null, 2));
      out.push({ repo: slug, count: issues.length });
    } catch (e) {
      out.push({ repo: slug, count: null, error: e.message.split('\n')[0] });
    }
  }
  return out;
}

/** Best-effort: ensure a label exists without resetting its color (ignore "already exists"). */
async function ensureLabel(slug, label) {
  try {
    await execFileAsync('gh', ['label', 'create', label, '--repo', slug]);
  } catch {
    /* already exists or insufficient perms — non-fatal */
  }
}

export async function createIssue(workspace, { title, body = '', labels = [] }) {
  const r = await resolveRepo(workspace);
  if (!r) throw new Error(`Cannot resolve repo for workspace "${workspace}"`);
  for (const lbl of labels) await ensureLabel(r.slug, lbl);
  const args = ['issue', 'create', '--repo', r.slug, '--title', title, '--body', body];
  for (const lbl of labels) args.push('--label', lbl);
  const { stdout } = await execFileAsync('gh', args);
  const url = stdout.trim().split('\n').filter(Boolean).pop();
  const number = Number(url.match(/\/(\d+)$/)?.[1]) || null;
  await refreshCache([r.slug]);
  return { number, url };
}

export async function closeIssue(workspace, { number, comment } = {}) {
  const r = await resolveRepo(workspace);
  if (!r) throw new Error(`Cannot resolve repo for workspace "${workspace}"`);
  const args = ['issue', 'close', String(number), '--repo', r.slug];
  if (comment) args.push('--comment', comment);
  await execFileAsync('gh', args);
  await refreshCache([r.slug]);
  return { number: Number(number), url: `https://github.com/${r.slug}/issues/${number}` };
}

/**
 * List cached issues for a workspace/repo.
 * refresh: 'if-stale' (default) refreshes when cache older than TTL and gh is reachable;
 *          'never' is cache-only (used by the dashboard session hook — never blocks on network).
 */
export async function listIssues(workspace, { label = DEFAULT_LABEL, state = 'open', refresh = 'if-stale' } = {}) {
  const r = await resolveRepo(workspace);
  if (!r) return [];
  let cached = await readCache(r.slug);
  const age = cached ? Date.now() - new Date(cached.fetchedAt).getTime() : Infinity;
  const stale = !cached || Number.isNaN(age) || age > TTL_MS;
  if (refresh === 'if-stale' && stale) {
    const res = await refreshCache([r.slug], { label });
    if (!res[0]?.error) cached = await readCache(r.slug);
  }
  let issues = cached?.issues || [];
  if (label) issues = issues.filter((i) => i.labels.includes(label));
  if (state && state !== 'all') issues = issues.filter((i) => i.state === state.toLowerCase());
  return issues;
}

// ---------------------------------------------------------------------------
// CLI surface (used by shell callers). Importers never reach this.
// ---------------------------------------------------------------------------
function parseFlags(argv) {
  const flags = {}; const positional = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) { flags[key] = argv[++i]; }
      else flags[key] = true;
    } else positional.push(argv[i]);
  }
  return { flags, positional };
}

async function cli(argv) {
  const [cmd, ...rest] = argv;
  const { flags, positional } = parseFlags(rest);
  switch (cmd) {
    case 'resolve-repo': {
      const r = await resolveRepo(positional[0]);
      if (!r) { console.error(`No GitHub repo for "${positional[0]}"`); process.exit(2); }
      console.log(r.slug); break;
    }
    case 'refresh': {
      const res = await refreshCache(positional.length ? positional : undefined);
      for (const r of res) console.log(`${r.repo}: ${r.error ? 'ERROR ' + r.error : r.count + ' open'}`);
      break;
    }
    case 'list': {
      const issues = await listIssues(positional[0], {
        label: flags.label ?? 'backlog',
        state: flags.state ?? 'open',
        refresh: 'never',
      });
      if (flags.json) console.log(JSON.stringify(issues, null, 2));
      else for (const i of issues) console.log(`#${i.number}\t${i.title}\t[${i.labels.join(',')}]\t${i.url}`);
      break;
    }
    case 'create': {
      const res = await createIssue(positional[0], {
        title: flags.title, body: flags.body ?? '',
        labels: (flags.labels ? String(flags.labels).split(',') : []).filter(Boolean),
      });
      console.log(res.url); break;
    }
    case 'close': {
      const res = await closeIssue(positional[0], { number: positional[1], comment: flags.comment });
      console.log(res.url); break;
    }
    default:
      console.error(`Usage: backlog-source <resolve-repo|refresh|list|create|close> ...`);
      process.exit(1);
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  cli(process.argv.slice(2)).catch((e) => { console.error(e.message); process.exit(1); });
}
