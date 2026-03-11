import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import { ORCHESTRATOR_HOME } from '../../../mcp-servers/lib/config-loader.js';

const execFileAsync = promisify(execFile);
const WORKSPACES_PATH = path.join(ORCHESTRATOR_HOME, 'config', 'orchestrator', 'workspaces.json');

// In-memory cache
const cache = new Map();

function cached(key, ttlMs, fn) {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.time < ttlMs) return entry.data;
  const promise = fn().then(data => {
    cache.set(key, { data, time: Date.now() });
    return data;
  }).catch(err => {
    cache.delete(key);
    throw err;
  });
  cache.set(key, { data: promise, time: Date.now() });
  return promise;
}

async function git(wsPath, args, timeoutMs = 10000) {
  try {
    const { stdout } = await execFileAsync('git', ['-C', wsPath, ...args], {
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
    });
    return stdout.trim();
  } catch (err) {
    if (err.killed) return null; // timeout
    if (err.code === 'ENOENT') return null;
    return null;
  }
}

async function loadWorkspaces() {
  const raw = await fs.readFile(WORKSPACES_PATH, 'utf-8');
  const config = JSON.parse(raw);
  return Object.entries(config.workspaces || {}).map(([name, ws]) => ({
    name,
    path: ws.path,
    product: ws.product || 'unknown',
    category: ws.category || 'unknown',
    priority: ws.priority || 'low',
  }));
}

// Promise pool — run fn across items with max concurrency
async function pool(items, concurrency, fn) {
  const results = [];
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

async function scanWorkspace(ws) {
  const gitDir = path.join(ws.path, '.git');
  let exists = false;
  try {
    const stat = await fs.stat(gitDir);
    exists = stat.isDirectory() || stat.isFile(); // .git can be a file for submodules
  } catch { /* missing */ }

  if (!exists) {
    return { ...ws, available: false, branch: null, dirty: false, sync: null, lastCommit: null, branches: [], hasMaster: false, hasDevelop: false };
  }

  const [branch, porcelain, lastLog, masterCheck, mainCheck, developCheck, branchList] = await Promise.all([
    git(ws.path, ['branch', '--show-current']),
    git(ws.path, ['status', '--porcelain', '-uno']),  // -uno = skip untracked for speed
    git(ws.path, ['log', '-1', '--format=%H|%aI|%an|%s']),
    git(ws.path, ['rev-parse', '--verify', 'master']),
    git(ws.path, ['rev-parse', '--verify', 'main']),
    git(ws.path, ['rev-parse', '--verify', 'develop']),
    git(ws.path, ['branch', '-a', '--format=%(refname:short)']),
  ]);

  // Sync status
  let sync = null;
  const tracking = await git(ws.path, ['rev-parse', '--abbrev-ref', '@{upstream}']);
  if (tracking) {
    const ab = await git(ws.path, ['rev-list', '--left-right', '--count', `${tracking}...HEAD`]);
    if (ab) {
      const [behind, ahead] = ab.split(/\s+/).map(Number);
      sync = { ahead, behind, inSync: ahead === 0 && behind === 0 };
    }
  }

  // Parse last commit
  let lastCommit = null;
  if (lastLog) {
    const [sha, date, author, ...msgParts] = lastLog.split('|');
    lastCommit = { sha, date, author, message: msgParts.join('|') };
  }

  // Parse branch list
  const branches = branchList ? branchList.split('\n').filter(b => b && !b.includes('HEAD')) : [];

  return {
    ...ws,
    available: true,
    branch: branch || 'detached',
    dirty: porcelain !== null && porcelain.length > 0,
    sync,
    lastCommit,
    branches,
    hasMaster: masterCheck !== null || mainCheck !== null,
    hasDevelop: developCheck !== null,
  };
}

export async function parseGitOverview() {
  return cached('git-overview', 60000, async () => {
    const workspaces = await loadWorkspaces();
    const results = await pool(workspaces, 10, scanWorkspace);

    const summary = {
      total: results.length,
      available: results.filter(r => r.available).length,
      dirty: results.filter(r => r.dirty).length,
      featureBranches: results.filter(r => r.available && r.branch !== 'master' && r.branch !== 'main' && r.branch !== 'develop' && r.branch !== 'detached').length,
      syncIssues: results.filter(r => r.sync && !r.sync.inSync).length,
    };

    // Group by product
    const byProduct = {};
    for (const r of results) {
      const p = r.product;
      if (!byProduct[p]) byProduct[p] = [];
      byProduct[p].push(r);
    }

    return { summary, byProduct, workspaces: results, scannedAt: new Date().toISOString() };
  });
}

export async function parseWorkspaceDetail(workspaceName) {
  return cached(`git-detail-${workspaceName}`, 30000, async () => {
    const workspaces = await loadWorkspaces();
    const ws = workspaces.find(w => w.name === workspaceName);
    if (!ws) return null;

    const [logOutput, branchOutput, tagOutput] = await Promise.all([
      git(ws.path, ['log', '--all', '--format=%H|%P|%an|%aI|%D|%s', '--topo-order', '-n', '200'], 15000),
      git(ws.path, ['branch', '-a', '--format=%(refname:short)|%(objectname:short)|%(upstream:short)|%(upstream:track,nobracket)']),
      git(ws.path, ['tag', '--list', '--format=%(refname:short)|%(objectname:short)']),
    ]);

    // Parse commit nodes
    const nodes = [];
    if (logOutput) {
      for (const line of logOutput.split('\n')) {
        if (!line) continue;
        const [sha, parentsStr, author, date, refsStr, ...msgParts] = line.split('|');
        nodes.push({
          sha,
          parents: parentsStr ? parentsStr.split(' ').filter(Boolean) : [],
          author,
          date,
          refs: refsStr ? refsStr.split(', ').filter(Boolean) : [],
          message: msgParts.join('|'),
        });
      }
    }

    // Parse branches
    const branches = [];
    if (branchOutput) {
      for (const line of branchOutput.split('\n')) {
        if (!line) continue;
        const parts = line.split('|');
        const name = parts[0];
        if (name.includes('HEAD')) continue;
        const sha = parts[1] || '';
        const tracking = parts[2] || '';
        const trackInfo = parts[3] || '';
        let ahead = 0, behind = 0;
        const aheadMatch = trackInfo.match(/ahead (\d+)/);
        const behindMatch = trackInfo.match(/behind (\d+)/);
        if (aheadMatch) ahead = parseInt(aheadMatch[1]);
        if (behindMatch) behind = parseInt(behindMatch[1]);
        branches.push({
          name,
          sha,
          isRemote: name.includes('/'),
          tracking,
          ahead,
          behind,
        });
      }
    }

    // Parse tags
    const tags = [];
    if (tagOutput) {
      for (const line of tagOutput.split('\n')) {
        if (!line) continue;
        const [name, sha] = line.split('|');
        if (name && sha) tags.push({ name, sha });
      }
    }

    return { workspace: ws, nodes, branches, tags };
  });
}

export async function parseGitCompare(workspaceName, base, head) {
  const workspaces = await loadWorkspaces();
  const ws = workspaces.find(w => w.name === workspaceName);
  if (!ws) return null;

  const [mergeBaseOutput, aheadOutput, behindOutput] = await Promise.all([
    git(ws.path, ['merge-base', base, head]),
    git(ws.path, ['log', `${base}..${head}`, '--format=%h|%an|%aI|%s']),
    git(ws.path, ['log', `${head}..${base}`, '--format=%h|%an|%aI|%s']),
  ]);

  function parseCommitLines(output) {
    if (!output) return [];
    return output.split('\n').filter(Boolean).map(line => {
      const [sha, author, date, ...msgParts] = line.split('|');
      return { sha, author, date, message: msgParts.join('|') };
    });
  }

  return {
    workspace: ws,
    base,
    head,
    mergeBase: mergeBaseOutput || null,
    ahead: parseCommitLines(aheadOutput),
    behind: parseCommitLines(behindOutput),
  };
}

export async function parseGitTimeline(sinceDays = 30) {
  return cached(`git-timeline-${sinceDays}`, 60000, async () => {
    const workspaces = await loadWorkspaces();
    const sinceArg = `${sinceDays} days ago`;

    const results = await pool(workspaces, 10, async (ws) => {
      const gitDir = path.join(ws.path, '.git');
      try { await fs.stat(gitDir); } catch { return []; }

      const output = await git(ws.path, ['log', '--all', `--since=${sinceArg}`, '--format=%aI|%an|%H|%s'], 10000);
      if (!output) return [];

      return output.split('\n').filter(Boolean).map(line => {
        const [date, author, sha, ...msgParts] = line.split('|');
        return { date, author, sha, message: msgParts.join('|'), workspace: ws.name, product: ws.product };
      });
    });

    const commits = results.flat().sort((a, b) => b.date.localeCompare(a.date));
    return { commits, sinceDays, generatedAt: new Date().toISOString() };
  });
}

export function clearGitCache() {
  cache.clear();
}
