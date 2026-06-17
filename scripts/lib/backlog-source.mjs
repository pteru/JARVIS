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

const ORCHESTRATOR_HOME = process.env.ORCHESTRATOR_HOME || path.join(process.env.HOME, 'JARVIS');
const CACHE_DIR = path.join(ORCHESTRATOR_HOME, 'data', 'backlog-cache');
const CONFIG_DIR = path.join(ORCHESTRATOR_HOME, 'config', 'orchestrator');
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
    const cfg = JSON.parse(await fs.readFile(path.join(CONFIG_DIR, 'workspaces.json'), 'utf-8'));
    return parseRemote(cfg.workspaces?.[workspace]?.remotes?.origin);
  } catch {
    return null;
  }
}

export async function configuredRepos() {
  const cfg = JSON.parse(await fs.readFile(path.join(CONFIG_DIR, 'issue-repos.json'), 'utf-8'));
  return cfg.repos || [];
}

/** Find the workspace key whose remotes.origin matches a given owner/repo slug. */
export async function resolveWorkspaceByRepo(slug) {
  if (slug === 'pteru/JARVIS') return 'orchestrator';
  const cfg = JSON.parse(await fs.readFile(path.join(CONFIG_DIR, 'workspaces.json'), 'utf-8'));
  const matches = Object.entries(cfg.workspaces || {})
    .filter(([, w]) => parseRemote(w.remotes?.origin)?.slug === slug)
    .map(([k]) => k);
  return matches[0] || null;
}
