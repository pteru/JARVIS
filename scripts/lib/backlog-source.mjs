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
