# Git Graph Viewer — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an interactive multi-workspace git visualization dashboard as a new page in the orchestrator dashboard, with overview grid, D3.js commit graph, branch comparison, and cross-repo timeline.

**Architecture:** Express.js backend (existing dashboard) adds 4 API endpoints that shell out to `git` CLI via `child_process.execFile`. Frontend is a separate `git.html` page with D3.js for commit DAG rendering, Tailwind for styling. Data cached in-memory with TTL.

**Tech Stack:** Node.js/Express (existing), D3.js v7 (CDN), Tailwind CSS (CDN), vanilla JS

**Design doc:** `docs/plans/2026-03-11-git-graph-viewer-design.md`

---

## Task 1: Backend — Git Data Collection Module

**Files:**
- Create: `tools/orchestrator-dashboard/parsers/git-status.js`

This is the core data layer. All git operations go through this module.

**Step 1: Create the git helper utilities**

Create `tools/orchestrator-dashboard/parsers/git-status.js` with imports and utility functions:

```javascript
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
```

**Step 2: Add the overview scanner**

Append to the same file — the `parseGitOverview()` function that scans all workspaces in parallel:

```javascript
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
```

**Step 3: Add the workspace detail scanner (DAG)**

Append to the same file — `parseWorkspaceDetail(workspaceName)`:

```javascript
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
```

**Step 4: Add branch comparison and timeline functions**

Append to the same file:

```javascript
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
```

**Step 5: Verify module loads correctly**

Run: `cd /home/teruel/JARVIS/tools/orchestrator-dashboard && node -e "import('./parsers/git-status.js').then(m => console.log(Object.keys(m)))"`

Expected: `[ 'parseGitOverview', 'parseWorkspaceDetail', 'parseGitCompare', 'parseGitTimeline', 'clearGitCache' ]`

**Step 6: Commit**

```
git add tools/orchestrator-dashboard/parsers/git-status.js
git commit -m "feat(dashboard): add git data collection module

Adds parsers/git-status.js with 4 exported functions:
- parseGitOverview: parallel scan of all 98 workspaces
- parseWorkspaceDetail: full commit DAG for single workspace
- parseGitCompare: branch-vs-branch diff
- parseGitTimeline: cross-repo commit timeline

Uses child_process.execFile (no shell injection), promise pool
with concurrency 10, in-memory cache with TTL."
```

---

## Task 2: Backend — API Endpoints

**Files:**
- Modify: `tools/orchestrator-dashboard/server.js`

**Step 1: Add imports for git parser**

At the top of `server.js`, after the existing parser imports (line 8), add:

```javascript
import { parseGitOverview, parseWorkspaceDetail, parseGitCompare, parseGitTimeline, clearGitCache } from './parsers/git-status.js';
```

**Step 2: Add the 4 API routes**

After the existing `/api/notifications` route (around line 118), add:

```javascript
// API: Git Overview
app.get('/api/git/overview', async (_req, res) => {
  try {
    const data = await parseGitOverview();
    res.json(data);
  } catch (err) {
    console.error('Error scanning git overview:', err.message);
    res.json({ summary: { total: 0, available: 0, dirty: 0, featureBranches: 0, syncIssues: 0 }, byProduct: {}, workspaces: [], scannedAt: null });
  }
});

// API: Git Workspace Detail (DAG)
app.get('/api/git/workspace/:name', async (req, res) => {
  try {
    const data = await parseWorkspaceDetail(req.params.name);
    if (!data) return res.status(404).json({ error: 'Workspace not found' });
    res.json(data);
  } catch (err) {
    console.error('Error scanning workspace:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// API: Git Branch Comparison
app.get('/api/git/compare/:name', async (req, res) => {
  try {
    const { base, head } = req.query;
    if (!base || !head) return res.status(400).json({ error: 'base and head query params required' });
    const data = await parseGitCompare(req.params.name, base, head);
    if (!data) return res.status(404).json({ error: 'Workspace not found' });
    res.json(data);
  } catch (err) {
    console.error('Error comparing branches:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// API: Git Timeline
app.get('/api/git/timeline', async (req, res) => {
  try {
    const since = parseInt(req.query.since) || 30;
    const data = await parseGitTimeline(since);
    res.json(data);
  } catch (err) {
    console.error('Error generating timeline:', err.message);
    res.json({ commits: [], sinceDays: 30, generatedAt: null });
  }
});

// API: Clear git cache (for refresh button)
app.post('/api/git/refresh', (_req, res) => {
  clearGitCache();
  res.json({ cleared: true });
});
```

**Step 3: Test the endpoints manually**

Restart the dashboard and test with curl:

Run: `cd /home/teruel/JARVIS/tools/orchestrator-dashboard && node server.js &`

Then test:
- `curl -s http://localhost:3000/api/git/overview | node -e "process.stdin.on('data',d=>{const j=JSON.parse(d);console.log('Summary:',j.summary);console.log('Products:',Object.keys(j.byProduct))})"`
- `curl -s 'http://localhost:3000/api/git/workspace/strokmatic.diemaster.services.backend' | node -e "process.stdin.on('data',d=>{const j=JSON.parse(d);console.log('Nodes:',j.nodes.length,'Branches:',j.branches.length)})"`

Expected: Summary shows ~98 total workspaces; detail shows commit nodes and branches.

**Step 4: Commit**

```
git add tools/orchestrator-dashboard/server.js
git commit -m "feat(dashboard): add git API endpoints

5 new routes: /api/git/overview, /api/git/workspace/:name,
/api/git/compare/:name, /api/git/timeline, /api/git/refresh"
```

---

## Task 3: Frontend — Git Page HTML Structure

**Files:**
- Create: `tools/orchestrator-dashboard/public/git.html`
- Modify: `tools/orchestrator-dashboard/public/index.html` (add nav link)

**Step 1: Create git.html**

Create `tools/orchestrator-dashboard/public/git.html` with the full page structure. This mirrors the main dashboard's Tailwind + dark theme setup:

```html
<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>JARVIS — Git Graph</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js"></script>
  <link rel="stylesheet" href="/style.css">
  <script>
    tailwind.config = {
      darkMode: 'class',
      theme: {
        extend: {
          colors: {
            surface: '#1a1b2e',
            card: '#242640',
            accent: '#6c63ff',
            success: '#22c55e',
            danger: '#ef4444',
            warning: '#f59e0b'
          }
        }
      }
    }
  </script>
</head>
<body class="bg-surface text-gray-200 min-h-screen">
  <!-- Header -->
  <header class="bg-card border-b border-gray-700 px-6 py-4 flex items-center justify-between">
    <div class="flex items-center gap-4">
      <a href="/" class="flex items-center gap-3 hover:opacity-80 transition-opacity">
        <div class="w-8 h-8 bg-accent rounded-lg flex items-center justify-center text-white font-bold text-sm">J</div>
        <h1 class="text-xl font-semibold text-white">JARVIS</h1>
      </a>
      <span class="text-gray-500">|</span>
      <h2 class="text-lg text-gray-300">Git Graph</h2>
    </div>
    <div class="flex items-center gap-4">
      <span id="last-scanned" class="text-xs text-gray-400">Loading...</span>
      <button id="btn-refresh" class="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded-lg text-xs text-gray-200 transition-colors">Refresh</button>
    </div>
  </header>

  <main class="p-6 max-w-screen-2xl mx-auto">
    <!-- Top Bar: View Toggle + Product Filters + Search -->
    <div class="flex items-center justify-between mb-6 flex-wrap gap-3">
      <!-- View toggle -->
      <div class="flex items-center gap-1 bg-card rounded-lg p-1 border border-gray-700">
        <button class="view-tab active px-3 py-1.5 rounded-md text-xs font-medium transition-colors" data-view="overview">Overview</button>
        <button class="view-tab px-3 py-1.5 rounded-md text-xs font-medium transition-colors" data-view="timeline">Timeline</button>
      </div>

      <!-- Product filters -->
      <div class="flex items-center gap-1">
        <button class="product-filter active px-3 py-1.5 rounded-full text-xs font-medium border border-gray-600 transition-colors" data-product="all">All</button>
        <button class="product-filter px-3 py-1.5 rounded-full text-xs font-medium border border-gray-600 transition-colors" data-product="diemaster">DieMaster</button>
        <button class="product-filter px-3 py-1.5 rounded-full text-xs font-medium border border-gray-600 transition-colors" data-product="spotfusion">SpotFusion</button>
        <button class="product-filter px-3 py-1.5 rounded-full text-xs font-medium border border-gray-600 transition-colors" data-product="visionking">VisionKing</button>
        <button class="product-filter px-3 py-1.5 rounded-full text-xs font-medium border border-gray-600 transition-colors" data-product="sdk">SDK</button>
      </div>

      <!-- Search -->
      <input id="search" type="text" placeholder="Search workspace or branch..."
        class="px-3 py-1.5 bg-card border border-gray-700 rounded-lg text-sm text-gray-200 placeholder-gray-500 w-64 focus:outline-none focus:border-accent">
    </div>

    <!-- Summary Stats -->
    <div id="stats-row" class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
      <div class="bg-card rounded-xl p-4 border border-gray-700">
        <div class="text-xs text-gray-400 uppercase tracking-wide">Workspaces</div>
        <div id="stat-total" class="text-2xl font-bold text-white mt-1">--</div>
      </div>
      <div class="bg-card rounded-xl p-4 border border-gray-700">
        <div class="text-xs text-gray-400 uppercase tracking-wide">Dirty Repos</div>
        <div id="stat-dirty" class="text-2xl font-bold text-danger mt-1">--</div>
      </div>
      <div class="bg-card rounded-xl p-4 border border-gray-700">
        <div class="text-xs text-gray-400 uppercase tracking-wide">Feature Branches</div>
        <div id="stat-features" class="text-2xl font-bold text-success mt-1">--</div>
      </div>
      <div class="bg-card rounded-xl p-4 border border-gray-700">
        <div class="text-xs text-gray-400 uppercase tracking-wide">Sync Issues</div>
        <div id="stat-sync" class="text-2xl font-bold text-warning mt-1">--</div>
      </div>
    </div>

    <!-- Overview View -->
    <div id="view-overview">
      <div id="workspace-groups" class="space-y-4">
        <div class="text-gray-500 text-sm text-center py-8">Loading workspace data...</div>
      </div>
    </div>

    <!-- Timeline View (hidden by default) -->
    <div id="view-timeline" class="hidden">
      <div class="bg-card rounded-xl p-5 border border-gray-700">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-sm font-semibold text-gray-300 uppercase tracking-wide">Cross-Repo Timeline</h2>
          <select id="timeline-range" class="bg-gray-700 border border-gray-600 rounded-lg px-3 py-1 text-xs text-gray-200">
            <option value="30">Last 30 days</option>
            <option value="60">Last 60 days</option>
            <option value="90">Last 90 days</option>
          </select>
        </div>
        <div id="timeline-container" class="w-full overflow-x-auto custom-scrollbar" style="min-height: 400px;">
          <div class="text-gray-500 text-sm text-center py-8">Select Timeline view to load...</div>
        </div>
      </div>
    </div>
  </main>

  <!-- Detail Slide-in Panel -->
  <div id="detail-panel" class="fixed top-0 right-0 h-full w-[70vw] bg-surface border-l border-gray-700 shadow-2xl transform translate-x-full transition-transform duration-300 z-40 flex flex-col">
    <!-- Panel Header -->
    <div class="bg-card border-b border-gray-700 px-5 py-3 flex items-center justify-between flex-shrink-0">
      <div>
        <h3 id="detail-title" class="text-sm font-semibold text-white"></h3>
        <div id="detail-meta" class="text-xs text-gray-400 mt-0.5"></div>
      </div>
      <button id="detail-close" class="text-gray-400 hover:text-white text-xl leading-none px-2">&times;</button>
    </div>

    <!-- Panel Body: Branch Selector + Graph -->
    <div class="flex flex-1 overflow-hidden">
      <!-- Branch Sidebar -->
      <div id="branch-sidebar" class="w-56 border-r border-gray-700 overflow-y-auto custom-scrollbar flex-shrink-0 bg-card/50">
        <div class="p-3">
          <h4 class="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Branches</h4>
          <div id="branch-list" class="space-y-1"></div>
          <div id="compare-actions" class="mt-3 hidden">
            <button id="btn-compare" class="w-full px-3 py-1.5 bg-accent hover:bg-accent/80 rounded-lg text-xs text-white font-medium transition-colors">Compare Selected</button>
          </div>
        </div>
      </div>

      <!-- Graph Area -->
      <div id="graph-area" class="flex-1 overflow-auto custom-scrollbar relative">
        <div id="commit-graph" class="w-full" style="min-height: 600px;"></div>
      </div>
    </div>

    <!-- Comparison View (hidden by default, replaces graph) -->
    <div id="compare-view" class="flex-1 overflow-auto custom-scrollbar hidden p-5">
      <div id="compare-header" class="mb-4"></div>
      <div class="grid grid-cols-3 gap-4">
        <div>
          <h4 class="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2" id="compare-behind-title">Behind</h4>
          <div id="compare-behind" class="space-y-1"></div>
        </div>
        <div class="flex items-start justify-center pt-8">
          <div id="compare-merge-base" class="text-center"></div>
        </div>
        <div>
          <h4 class="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2" id="compare-ahead-title">Ahead</h4>
          <div id="compare-ahead" class="space-y-1"></div>
        </div>
      </div>
    </div>
  </div>

  <!-- Panel Overlay -->
  <div id="detail-overlay" class="fixed inset-0 bg-black/50 z-30 hidden" onclick="closeDetail()"></div>

  <!-- Tooltip -->
  <div id="tooltip" class="fixed z-50 hidden bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-xs max-w-sm shadow-xl pointer-events-none">
  </div>

  <script src="/git-graph.js"></script>
  <script src="/git-app.js"></script>
</body>
</html>
```

**Step 2: Add nav link to main dashboard**

In `tools/orchestrator-dashboard/public/index.html`, find the header `<div>` with the JARVIS logo (around line 33). After the `<h1>JARVIS</h1>` closing tag, add a git link:

Find this block in `index.html` (line 32-35):
```html
    <div class="flex items-center gap-3">
      <div class="w-8 h-8 bg-accent rounded-lg flex items-center justify-center text-white font-bold text-sm">J</div>
      <h1 class="text-xl font-semibold text-white">JARVIS</h1>
    </div>
```

Replace with:
```html
    <div class="flex items-center gap-4">
      <div class="flex items-center gap-3">
        <div class="w-8 h-8 bg-accent rounded-lg flex items-center justify-center text-white font-bold text-sm">J</div>
        <h1 class="text-xl font-semibold text-white">JARVIS</h1>
      </div>
      <a href="/git.html" class="text-sm text-gray-400 hover:text-accent transition-colors">Git Graph</a>
    </div>
```

**Step 3: Verify page loads**

Open `http://localhost:3000/git.html` in browser. Should show the dark-themed skeleton with "Loading workspace data..." placeholder.

**Step 4: Commit**

```
git add tools/orchestrator-dashboard/public/git.html tools/orchestrator-dashboard/public/index.html
git commit -m "feat(dashboard): add git graph page skeleton

New git.html page with overview grid, timeline, detail panel,
and branch comparison layouts. Nav link added to main dashboard."
```

---

## Task 4: Frontend — Overview Grid Logic

**Files:**
- Create: `tools/orchestrator-dashboard/public/git-app.js`

**Step 1: Create git-app.js with constants and utilities**

```javascript
// === Constants ===
const PRODUCT_COLORS = {
  diemaster: '#f59e0b',
  spotfusion: '#3b82f6',
  visionking: '#22c55e',
  sdk: '#8b5cf6',
};

const BRANCH_COLORS = {
  master: '#6b7280', main: '#6b7280',
  develop: '#3b82f6',
};

function branchColor(name) {
  if (BRANCH_COLORS[name]) return BRANCH_COLORS[name];
  if (name.startsWith('feat')) return '#22c55e';
  if (name.startsWith('fix')) return '#f59e0b';
  if (name.startsWith('hotfix')) return '#ef4444';
  return '#8b5cf6';
}

function ageColor(dateStr) {
  if (!dateStr) return 'text-gray-500';
  const days = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
  if (days <= 1) return 'text-white';
  if (days <= 7) return 'text-gray-300';
  if (days <= 30) return 'text-warning';
  return 'text-danger';
}

function formatDate(dateStr) {
  if (!dateStr) return '--';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function shortName(wsName) {
  // Strip strokmatic.<product>. prefix
  const parts = wsName.split('.');
  if (parts.length > 2) return parts.slice(2).join('.');
  if (parts.length === 2) return parts[1];
  return wsName;
}

async function fetchJSON(url) {
  try {
    const res = await fetch(url);
    return await res.json();
  } catch { return null; }
}
```

**Step 2: Add overview rendering logic**

Append to `git-app.js`:

```javascript
// === State ===
let currentData = null;
let activeProduct = 'all';
let searchQuery = '';
let expandedGroups = new Set();
let currentView = 'overview';

// === Overview Rendering ===
function renderStats(summary) {
  document.getElementById('stat-total').textContent = summary.total;
  const dirtyEl = document.getElementById('stat-dirty');
  dirtyEl.textContent = summary.dirty;
  dirtyEl.className = `text-2xl font-bold mt-1 ${summary.dirty > 0 ? 'text-danger' : 'text-success'}`;
  document.getElementById('stat-features').textContent = summary.featureBranches;
  const syncEl = document.getElementById('stat-sync');
  syncEl.textContent = summary.syncIssues;
  syncEl.className = `text-2xl font-bold mt-1 ${summary.syncIssues > 0 ? 'text-warning' : 'text-success'}`;
}

function renderOverview(data) {
  if (!data) return;
  currentData = data;
  renderStats(data.summary);

  const container = document.getElementById('workspace-groups');
  const productOrder = ['diemaster', 'spotfusion', 'visionking', 'sdk'];
  const products = productOrder.filter(p => data.byProduct[p]);

  // Add any unlisted products
  for (const p of Object.keys(data.byProduct)) {
    if (!products.includes(p)) products.push(p);
  }

  let html = '';
  for (const product of products) {
    if (activeProduct !== 'all' && activeProduct !== product) continue;

    const workspaces = data.byProduct[product].filter(ws => {
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      return ws.name.toLowerCase().includes(q) || (ws.branch || '').toLowerCase().includes(q);
    });

    if (workspaces.length === 0) continue;

    const dirty = workspaces.filter(w => w.dirty).length;
    const features = workspaces.filter(w => w.available && w.branch !== 'master' && w.branch !== 'main' && w.branch !== 'develop' && w.branch !== 'detached').length;
    const syncIssues = workspaces.filter(w => w.sync && !w.sync.inSync).length;
    const expanded = expandedGroups.has(product);
    const color = PRODUCT_COLORS[product] || '#6b7280';

    html += `<div class="bg-card rounded-xl border border-gray-700 overflow-hidden">
      <div class="px-5 py-3 flex items-center justify-between cursor-pointer hover:bg-gray-700/30 transition-colors" onclick="toggleGroup('${product}')">
        <div class="flex items-center gap-3">
          <div class="w-3 h-3 rounded-full" style="background: ${color}"></div>
          <span class="text-sm font-semibold text-white capitalize">${product}</span>
          <span class="text-xs text-gray-400">(${workspaces.length})</span>
        </div>
        <div class="flex items-center gap-4">
          ${dirty > 0 ? `<span class="text-xs text-danger">${dirty} dirty</span>` : ''}
          ${features > 0 ? `<span class="text-xs text-success">${features} feature</span>` : ''}
          ${syncIssues > 0 ? `<span class="text-xs text-warning">${syncIssues} sync</span>` : ''}
          <span class="text-gray-500 text-sm transition-transform ${expanded ? 'rotate-180' : ''}">\u25BC</span>
        </div>
      </div>
      ${expanded ? renderWorkspaceTable(workspaces) : ''}
    </div>`;
  }

  container.innerHTML = html || '<div class="text-gray-500 text-sm text-center py-8">No workspaces match filters</div>';
  document.getElementById('last-scanned').textContent = data.scannedAt ? `Scanned ${new Date(data.scannedAt).toLocaleTimeString()}` : '';
}

function renderWorkspaceTable(workspaces) {
  let html = `<div class="overflow-x-auto custom-scrollbar">
    <table class="w-full text-sm">
      <thead>
        <tr class="text-gray-400 border-b border-gray-700 bg-gray-800/30">
          <th class="text-left py-2 px-4">Workspace</th>
          <th class="text-left py-2 px-3">Branch</th>
          <th class="text-center py-2 px-2">M</th>
          <th class="text-center py-2 px-2">D</th>
          <th class="text-left py-2 px-3">Status</th>
          <th class="text-left py-2 px-3">Sync</th>
          <th class="text-left py-2 px-3">Last Commit</th>
          <th class="text-left py-2 px-3">Message</th>
        </tr>
      </thead>
      <tbody>`;

  for (const ws of workspaces) {
    if (!ws.available) {
      html += `<tr class="border-b border-gray-700/30">
        <td class="py-2 px-4 text-xs text-gray-500">${shortName(ws.name)}</td>
        <td colspan="7" class="py-2 px-3 text-xs text-gray-500">unavailable</td>
      </tr>`;
      continue;
    }

    const bColor = branchColor(ws.branch);
    const dirtyBadge = ws.dirty
      ? '<span class="badge badge-danger">dirty</span>'
      : '<span class="badge badge-success">clean</span>';

    let syncStr = '<span class="text-gray-500">--</span>';
    if (ws.sync) {
      syncStr = ws.sync.inSync
        ? '<span class="text-success">in sync</span>'
        : `<span class="text-warning">\u2191${ws.sync.ahead} \u2193${ws.sync.behind}</span>`;
    }

    const commitDate = ws.lastCommit ? ws.lastCommit.date : null;
    const commitMsg = ws.lastCommit ? ws.lastCommit.message : '--';

    html += `<tr class="border-b border-gray-700/30 hover:bg-gray-800/30 cursor-pointer" onclick="openDetail('${ws.name}')">
      <td class="py-2 px-4 text-xs font-mono text-gray-300">${shortName(ws.name)}</td>
      <td class="py-2 px-3 text-xs"><span class="px-2 py-0.5 rounded" style="background: ${bColor}20; color: ${bColor}">${ws.branch}</span></td>
      <td class="py-2 px-2 text-center text-xs">${ws.hasMaster ? '<span class="text-success">\u2713</span>' : '<span class="text-gray-600">-</span>'}</td>
      <td class="py-2 px-2 text-center text-xs">${ws.hasDevelop ? '<span class="text-success">\u2713</span>' : '<span class="text-gray-600">-</span>'}</td>
      <td class="py-2 px-3">${dirtyBadge}</td>
      <td class="py-2 px-3 text-xs">${syncStr}</td>
      <td class="py-2 px-3 text-xs ${ageColor(commitDate)}">${formatDate(commitDate)}</td>
      <td class="py-2 px-3 text-xs text-gray-400 max-w-[250px] truncate" title="${(commitMsg || '').replace(/"/g, '&quot;')}">${(commitMsg || '').slice(0, 60)}</td>
    </tr>`;
  }

  html += '</tbody></table></div>';
  return html;
}
```

**Step 3: Add event handlers and initialization**

Append to `git-app.js`:

```javascript
// === Group Toggle ===
function toggleGroup(product) {
  if (expandedGroups.has(product)) expandedGroups.delete(product);
  else expandedGroups.add(product);
  renderOverview(currentData);
}

// === Product Filter ===
document.querySelectorAll('.product-filter').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.product-filter').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeProduct = btn.dataset.product;
    renderOverview(currentData);
  });
});

// === Search ===
document.getElementById('search').addEventListener('input', (e) => {
  searchQuery = e.target.value;
  renderOverview(currentData);
});

// === View Toggle ===
document.querySelectorAll('.view-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.view-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentView = btn.dataset.view;
    document.getElementById('view-overview').classList.toggle('hidden', currentView !== 'overview');
    document.getElementById('view-timeline').classList.toggle('hidden', currentView !== 'timeline');
    if (currentView === 'timeline') loadTimeline();
  });
});

// === Refresh ===
document.getElementById('btn-refresh').addEventListener('click', async () => {
  document.getElementById('btn-refresh').textContent = 'Scanning...';
  await fetch('/api/git/refresh', { method: 'POST' });
  await loadOverview();
  document.getElementById('btn-refresh').textContent = 'Refresh';
});

// === Detail Panel ===
async function openDetail(wsName) {
  const panel = document.getElementById('detail-panel');
  const overlay = document.getElementById('detail-overlay');
  document.getElementById('detail-title').textContent = wsName;
  document.getElementById('detail-meta').textContent = 'Loading...';
  document.getElementById('branch-list').innerHTML = '';
  document.getElementById('commit-graph').innerHTML = '<div class="text-gray-500 text-sm text-center py-20">Loading commit graph...</div>';

  // Show panel
  overlay.classList.remove('hidden');
  requestAnimationFrame(() => panel.classList.remove('translate-x-full'));

  // Hide compare view, show graph
  document.getElementById('compare-view').classList.add('hidden');
  document.getElementById('graph-area').classList.remove('hidden');

  const data = await fetchJSON(`/api/git/workspace/${encodeURIComponent(wsName)}`);
  if (!data) {
    document.getElementById('detail-meta').textContent = 'Failed to load workspace data';
    return;
  }

  // Update header
  const ws = data.workspace;
  const productColor = PRODUCT_COLORS[ws.product] || '#6b7280';
  document.getElementById('detail-meta').innerHTML = `
    <span class="px-2 py-0.5 rounded text-[10px] font-semibold uppercase" style="background: ${productColor}20; color: ${productColor}">${ws.product}</span>
    <span class="ml-2">${data.branches.length} branches</span>
    <span class="ml-2">${data.nodes.length} commits loaded</span>
  `;

  // Render branch list
  renderBranchList(data, wsName);

  // Render commit graph
  if (typeof renderCommitGraph === 'function') {
    renderCommitGraph(data);
  }
}

function closeDetail() {
  document.getElementById('detail-panel').classList.add('translate-x-full');
  document.getElementById('detail-overlay').classList.add('hidden');
  selectedBranches = [];
}

document.getElementById('detail-close').addEventListener('click', closeDetail);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeDetail();
});

// === Branch List ===
let selectedBranches = [];

function renderBranchList(data, wsName) {
  const list = document.getElementById('branch-list');
  const localBranches = data.branches.filter(b => !b.isRemote);
  const remoteBranches = data.branches.filter(b => b.isRemote);

  let html = '';

  // Local branches
  for (const b of localBranches) {
    const color = branchColor(b.name);
    const selected = selectedBranches.includes(b.name);
    html += `<div class="flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer hover:bg-gray-700/50 transition-colors ${selected ? 'bg-gray-700/70 ring-1 ring-accent' : ''}"
      onclick="toggleBranchSelect('${b.name}', '${wsName}')">
      <div class="w-2 h-2 rounded-full flex-shrink-0" style="background: ${color}"></div>
      <span class="text-xs truncate flex-1" title="${b.name}">${b.name}</span>
      ${b.ahead || b.behind ? `<span class="text-[10px] text-gray-500">\u2191${b.ahead}\u2193${b.behind}</span>` : ''}
    </div>`;
  }

  // Remote branches (collapsed)
  if (remoteBranches.length > 0) {
    html += `<div class="mt-3 pt-2 border-t border-gray-700">
      <div class="text-[10px] text-gray-500 uppercase tracking-wide mb-1">Remote (${remoteBranches.length})</div>`;
    for (const b of remoteBranches.slice(0, 10)) {
      html += `<div class="px-2 py-1 text-xs text-gray-500 truncate" title="${b.name}">${b.name}</div>`;
    }
    if (remoteBranches.length > 10) {
      html += `<div class="px-2 py-1 text-xs text-gray-600">+ ${remoteBranches.length - 10} more</div>`;
    }
    html += '</div>';
  }

  list.innerHTML = html;

  // Show/hide compare button
  const compareActions = document.getElementById('compare-actions');
  compareActions.classList.toggle('hidden', selectedBranches.length !== 2);
}

function toggleBranchSelect(branchName, wsName) {
  const idx = selectedBranches.indexOf(branchName);
  if (idx >= 0) {
    selectedBranches.splice(idx, 1);
  } else {
    if (selectedBranches.length >= 2) selectedBranches.shift();
    selectedBranches.push(branchName);
  }
  // Re-fetch data to re-render branch list (data is cached)
  fetchJSON(`/api/git/workspace/${encodeURIComponent(wsName)}`).then(data => {
    if (data) renderBranchList(data, wsName);
  });
}

// === Branch Comparison ===
document.getElementById('btn-compare')?.addEventListener('click', async () => {
  if (selectedBranches.length !== 2) return;
  const wsName = document.getElementById('detail-title').textContent;
  const [base, head] = selectedBranches;

  document.getElementById('graph-area').classList.add('hidden');
  const compareView = document.getElementById('compare-view');
  compareView.classList.remove('hidden');
  compareView.querySelector('#compare-header').innerHTML = '<div class="text-gray-400 text-sm">Loading comparison...</div>';

  const data = await fetchJSON(`/api/git/compare/${encodeURIComponent(wsName)}?base=${encodeURIComponent(base)}&head=${encodeURIComponent(head)}`);
  if (!data) {
    compareView.querySelector('#compare-header').innerHTML = '<div class="text-danger text-sm">Failed to load comparison</div>';
    return;
  }

  // Header summary
  document.getElementById('compare-header').innerHTML = `
    <div class="text-sm text-gray-300 mb-2">
      <span class="font-mono px-2 py-0.5 rounded" style="background: ${branchColor(base)}20; color: ${branchColor(base)}">${base}</span>
      <span class="mx-2 text-gray-500">vs</span>
      <span class="font-mono px-2 py-0.5 rounded" style="background: ${branchColor(head)}20; color: ${branchColor(head)}">${head}</span>
    </div>
    <div class="text-xs text-gray-400">
      ${head} is <span class="text-success">${data.ahead.length} commits ahead</span> and <span class="text-warning">${data.behind.length} commits behind</span> ${base}
    </div>
  `;

  document.getElementById('compare-behind-title').textContent = `Only in ${base} (${data.behind.length})`;
  document.getElementById('compare-ahead-title').textContent = `Only in ${head} (${data.ahead.length})`;

  function renderCommitList(commits) {
    if (commits.length === 0) return '<div class="text-xs text-gray-500">No unique commits</div>';
    return commits.map(c => `
      <div class="bg-gray-800/50 rounded px-3 py-2">
        <div class="flex items-center gap-2">
          <span class="font-mono text-[10px] text-accent">${c.sha}</span>
          <span class="text-[10px] text-gray-500">${formatDate(c.date)}</span>
        </div>
        <div class="text-xs text-gray-300 mt-0.5 truncate" title="${c.message.replace(/"/g, '&quot;')}">${c.message}</div>
        <div class="text-[10px] text-gray-500">${c.author}</div>
      </div>
    `).join('');
  }

  document.getElementById('compare-behind').innerHTML = renderCommitList(data.behind);
  document.getElementById('compare-ahead').innerHTML = renderCommitList(data.ahead);

  if (data.mergeBase) {
    document.getElementById('compare-merge-base').innerHTML = `
      <div class="text-[10px] text-gray-500 uppercase tracking-wide">Merge Base</div>
      <div class="font-mono text-xs text-accent mt-1">${data.mergeBase.slice(0, 10)}</div>
    `;
  }
});

// === Timeline ===
async function loadTimeline() {
  const container = document.getElementById('timeline-container');
  container.innerHTML = '<div class="text-gray-500 text-sm text-center py-8">Loading timeline data...</div>';

  const since = document.getElementById('timeline-range').value;
  const data = await fetchJSON(`/api/git/timeline?since=${since}`);
  if (!data || !data.commits || data.commits.length === 0) {
    container.innerHTML = '<div class="text-gray-500 text-sm text-center py-8">No commits found in the selected range</div>';
    return;
  }

  if (typeof renderTimeline === 'function') {
    renderTimeline(data, container);
  } else {
    container.innerHTML = '<div class="text-gray-500 text-sm text-center py-8">Timeline renderer not loaded</div>';
  }
}

document.getElementById('timeline-range').addEventListener('change', () => {
  if (currentView === 'timeline') loadTimeline();
});

// === Initial Load ===
async function loadOverview() {
  const data = await fetchJSON('/api/git/overview');
  if (data) {
    // Expand all groups by default on first load
    if (expandedGroups.size === 0) {
      for (const p of Object.keys(data.byProduct)) expandedGroups.add(p);
    }
    renderOverview(data);
  }
}

loadOverview();
```

**Step 4: Add CSS for active states**

Append to `tools/orchestrator-dashboard/public/style.css`:

```css
/* Git page active states */
.view-tab { color: #6b7280; }
.view-tab.active { background: #6c63ff; color: white; }
.view-tab:not(.active):hover { background: rgba(107, 114, 128, 0.2); }

.product-filter { color: #6b7280; background: transparent; }
.product-filter.active { background: rgba(108, 99, 255, 0.2); color: #6c63ff; border-color: #6c63ff; }
.product-filter:not(.active):hover { background: rgba(107, 114, 128, 0.15); }
```

**Step 5: Verify overview renders**

Open `http://localhost:3000/git.html` — should show 4 stat cards with real numbers, and 4 collapsible product groups with workspace rows. Click a group header to expand/collapse. Product filters and search should filter the list.

**Step 6: Commit**

```
git add tools/orchestrator-dashboard/public/git-app.js tools/orchestrator-dashboard/public/style.css
git commit -m "feat(dashboard): add git overview grid with filters

Interactive overview with collapsible product groups, product
filter buttons, search, branch comparison, detail panel logic."
```

---

## Task 5: Frontend — D3.js Commit Graph Renderer

**Files:**
- Create: `tools/orchestrator-dashboard/public/git-graph.js`

This is the most complex piece — the D3.js DAG visualization engine.

**Step 1: Create git-graph.js with lane assignment algorithm**

```javascript
// === Git Graph Renderer (D3.js) ===

const LANE_WIDTH = 24;
const ROW_HEIGHT = 32;
const NODE_RADIUS = 5;
const MERGE_RADIUS = 7;
const GRAPH_PADDING = { top: 40, left: 20, right: 200 };

function assignLanes(nodes) {
  // Build SHA→node index
  const bysha = new Map();
  for (const node of nodes) bysha.set(node.sha, node);

  // Track which lane each branch tip occupies
  const branchLane = new Map();
  let nextLane = 0;

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];

    // Check if this node is a branch tip (has a ref)
    const branchRef = (node.refs || []).find(r => !r.startsWith('tag:'));

    // If node already has a lane assigned (from a child), keep it
    if (node.lane === undefined) {
      // Check if any child assigned a lane to this parent
      let assignedLane = null;

      // Look through earlier (newer) nodes to find children pointing to this node
      for (let j = 0; j < i; j++) {
        const child = nodes[j];
        if (child.parents.includes(node.sha)) {
          if (child.parents[0] === node.sha) {
            // First parent = same branch, inherit lane
            assignedLane = child.lane;
            break;
          }
        }
      }

      node.lane = assignedLane !== null ? assignedLane : nextLane++;
    }

    // For merge commits, assign lanes to non-first parents
    if (node.parents.length > 1) {
      for (let p = 1; p < node.parents.length; p++) {
        const parent = bysha.get(node.parents[p]);
        if (parent && parent.lane === undefined) {
          // Check if parent already has a lane from another path
          parent.lane = nextLane++;
        }
      }
    }

    // First parent inherits our lane
    if (node.parents.length > 0) {
      const firstParent = bysha.get(node.parents[0]);
      if (firstParent && firstParent.lane === undefined) {
        firstParent.lane = node.lane;
      }
    }
  }

  return nextLane; // total lanes used
}

function renderCommitGraph(data) {
  const container = document.getElementById('commit-graph');
  container.innerHTML = '';

  const nodes = data.nodes;
  if (!nodes || nodes.length === 0) {
    container.innerHTML = '<div class="text-gray-500 text-sm text-center py-20">No commits found</div>';
    return;
  }

  // Assign lanes
  const totalLanes = assignLanes(nodes);

  // Compute dimensions
  const graphWidth = GRAPH_PADDING.left + totalLanes * LANE_WIDTH + GRAPH_PADDING.right;
  const graphHeight = GRAPH_PADDING.top + nodes.length * ROW_HEIGHT + 40;

  // Create SVG
  const svg = d3.select(container)
    .append('svg')
    .attr('width', Math.max(graphWidth, container.clientWidth))
    .attr('height', graphHeight)
    .style('font-family', 'ui-monospace, monospace');

  // Build SHA→index map
  const shaIndex = new Map();
  nodes.forEach((n, i) => shaIndex.set(n.sha, i));

  // Position function
  function nodeX(node) { return GRAPH_PADDING.left + (node.lane || 0) * LANE_WIDTH + LANE_WIDTH / 2; }
  function nodeY(idx) { return GRAPH_PADDING.top + idx * ROW_HEIGHT; }

  // Lane colors based on branch
  function laneColor(node) {
    const ref = (node.refs || []).find(r => !r.startsWith('tag:'));
    if (ref) {
      const branchName = ref.replace('HEAD -> ', '').replace(/^origin\//, '').split(',')[0].trim();
      return branchColor(branchName);
    }
    // No ref — use generic lane color
    const colors = ['#3b82f6', '#22c55e', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4', '#ec4899'];
    return colors[(node.lane || 0) % colors.length];
  }

  // Draw edges (lines from child to parent)
  const edgeGroup = svg.append('g').attr('class', 'edges');
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const cx = nodeX(node);
    const cy = nodeY(i);
    const color = laneColor(node);

    for (const parentSha of node.parents) {
      const pi = shaIndex.get(parentSha);
      if (pi === undefined) continue;
      const parent = nodes[pi];
      const px = nodeX(parent);
      const py = nodeY(pi);

      if (cx === px) {
        // Same lane — straight line
        edgeGroup.append('line')
          .attr('x1', cx).attr('y1', cy)
          .attr('x2', px).attr('y2', py)
          .attr('stroke', color)
          .attr('stroke-width', 2)
          .attr('stroke-opacity', 0.6);
      } else {
        // Cross-lane — curved path
        const midY = cy + (py - cy) * 0.3;
        edgeGroup.append('path')
          .attr('d', `M ${cx} ${cy} C ${cx} ${midY}, ${px} ${midY}, ${px} ${py}`)
          .attr('stroke', laneColor(parent))
          .attr('stroke-width', 2)
          .attr('stroke-opacity', 0.4)
          .attr('fill', 'none');
      }
    }
  }

  // Draw nodes
  const nodeGroup = svg.append('g').attr('class', 'nodes');
  const tooltip = document.getElementById('tooltip');

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const cx = nodeX(node);
    const cy = nodeY(i);
    const isMerge = node.parents.length > 1;
    const color = laneColor(node);
    const r = isMerge ? MERGE_RADIUS : NODE_RADIUS;

    // Node circle
    nodeGroup.append('circle')
      .attr('cx', cx).attr('cy', cy).attr('r', r)
      .attr('fill', color)
      .attr('stroke', '#242640')
      .attr('stroke-width', 2)
      .style('cursor', 'pointer')
      .on('mouseover', (event) => {
        const refs = node.refs.length > 0 ? `<div class="text-accent">${node.refs.join(', ')}</div>` : '';
        tooltip.innerHTML = `
          ${refs}
          <div class="font-mono text-gray-300">${node.sha.slice(0, 10)}</div>
          <div class="text-gray-400">${node.author} &middot; ${formatDate(node.date)}</div>
          <div class="text-gray-200 mt-1">${node.message}</div>
        `;
        tooltip.style.left = `${event.pageX + 12}px`;
        tooltip.style.top = `${event.pageY - 10}px`;
        tooltip.classList.remove('hidden');
      })
      .on('mousemove', (event) => {
        tooltip.style.left = `${event.pageX + 12}px`;
        tooltip.style.top = `${event.pageY - 10}px`;
      })
      .on('mouseout', () => {
        tooltip.classList.add('hidden');
      });

    // Short SHA text (right of the graph lanes)
    const textX = GRAPH_PADDING.left + totalLanes * LANE_WIDTH + 10;
    nodeGroup.append('text')
      .attr('x', textX).attr('y', cy + 4)
      .attr('fill', '#6b7280')
      .attr('font-size', '10px')
      .text(node.sha.slice(0, 7));

    // Message text
    nodeGroup.append('text')
      .attr('x', textX + 60).attr('y', cy + 4)
      .attr('fill', '#9ca3af')
      .attr('font-size', '11px')
      .text(node.message.slice(0, 50) + (node.message.length > 50 ? '...' : ''));

    // Author + date
    nodeGroup.append('text')
      .attr('x', textX + 440).attr('y', cy + 4)
      .attr('fill', '#4b5563')
      .attr('font-size', '10px')
      .text(`${node.author} · ${formatDate(node.date)}`);

    // Branch / tag labels at tips
    for (const ref of node.refs) {
      if (ref.startsWith('tag:')) {
        const tagName = ref.replace('tag: ', '');
        nodeGroup.append('rect')
          .attr('x', cx + r + 4).attr('y', cy - 9)
          .attr('width', tagName.length * 6.5 + 10).attr('height', 16)
          .attr('rx', 8).attr('fill', 'rgba(245, 158, 11, 0.2)');
        nodeGroup.append('text')
          .attr('x', cx + r + 9).attr('y', cy + 3)
          .attr('fill', '#f59e0b').attr('font-size', '10px').attr('font-weight', '600')
          .text(tagName);
      } else {
        const branchName = ref.replace('HEAD -> ', '');
        const labelColor = branchColor(branchName.replace(/^origin\//, ''));
        nodeGroup.append('rect')
          .attr('x', cx - r - branchName.length * 5.5 - 14).attr('y', cy - 9)
          .attr('width', branchName.length * 5.5 + 10).attr('height', 16)
          .attr('rx', 8).attr('fill', `${labelColor}30`);
        nodeGroup.append('text')
          .attr('x', cx - r - branchName.length * 5.5 - 9).attr('y', cy + 3)
          .attr('fill', labelColor).attr('font-size', '10px').attr('font-weight', '600')
          .text(branchName);
      }
    }
  }
}

// === Timeline Renderer ===
function renderTimeline(data, container) {
  container.innerHTML = '';

  const commits = data.commits;
  if (!commits || commits.length === 0) return;

  const products = ['diemaster', 'spotfusion', 'visionking', 'sdk'];
  const laneHeight = 80;
  const margin = { top: 40, right: 30, bottom: 40, left: 100 };
  const width = Math.max(container.clientWidth - margin.left - margin.right, 800);
  const height = margin.top + products.length * laneHeight + margin.bottom;

  // Time scale
  const dates = commits.map(c => new Date(c.date));
  const xScale = d3.scaleTime()
    .domain(d3.extent(dates))
    .range([0, width]);

  // Product Y positions
  const yScale = (product) => {
    const idx = products.indexOf(product);
    return margin.top + (idx >= 0 ? idx : products.length) * laneHeight + laneHeight / 2;
  };

  const svg = d3.select(container)
    .append('svg')
    .attr('width', width + margin.left + margin.right)
    .attr('height', height);

  const g = svg.append('g').attr('transform', `translate(${margin.left},0)`);

  // Time axis
  g.append('g')
    .attr('transform', `translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(xScale).ticks(10).tickFormat(d3.timeFormat('%b %d')))
    .selectAll('text').attr('fill', '#6b7280').attr('font-size', '10px');
  g.selectAll('.domain, .tick line').attr('stroke', '#374151');

  // Swim lane backgrounds and labels
  for (const product of products) {
    const y = yScale(product) - laneHeight / 2;
    g.append('rect')
      .attr('x', 0).attr('y', y)
      .attr('width', width).attr('height', laneHeight)
      .attr('fill', products.indexOf(product) % 2 === 0 ? 'rgba(36, 38, 64, 0.3)' : 'transparent');

    svg.append('text')
      .attr('x', margin.left - 10).attr('y', yScale(product) + 4)
      .attr('text-anchor', 'end')
      .attr('fill', PRODUCT_COLORS[product] || '#6b7280')
      .attr('font-size', '11px')
      .attr('font-weight', '600')
      .text(product);
  }

  // Commit dots
  const tooltip = document.getElementById('tooltip');

  for (const commit of commits) {
    const cx = xScale(new Date(commit.date));
    const cy = yScale(commit.product);
    const color = PRODUCT_COLORS[commit.product] || '#6b7280';

    g.append('circle')
      .attr('cx', cx).attr('cy', cy)
      .attr('r', 4)
      .attr('fill', color)
      .attr('fill-opacity', 0.7)
      .style('cursor', 'pointer')
      .on('mouseover', (event) => {
        tooltip.innerHTML = `
          <div class="font-mono text-[10px] text-gray-500">${commit.workspace}</div>
          <div class="text-xs text-gray-300">${commit.message.slice(0, 80)}</div>
          <div class="text-[10px] text-gray-400">${commit.author} &middot; ${new Date(commit.date).toLocaleDateString()}</div>
        `;
        tooltip.style.left = `${event.pageX + 12}px`;
        tooltip.style.top = `${event.pageY - 10}px`;
        tooltip.classList.remove('hidden');
      })
      .on('mouseout', () => tooltip.classList.add('hidden'));
  }

  // Brush for zoom
  const brush = d3.brushX()
    .extent([[0, margin.top], [width, height - margin.bottom]])
    .on('end', (event) => {
      if (!event.selection) return;
      const [x0, x1] = event.selection.map(xScale.invert);
      xScale.domain([x0, x1]);

      // Re-render with new scale
      g.selectAll('circle').attr('cx', d => {
        const commit = commits.find(c => c.sha === d.__data__?.sha);
        return commit ? xScale(new Date(commit.date)) : 0;
      });

      // Update axis
      g.select('.tick').remove();
    });

  g.append('g').attr('class', 'brush').call(brush);
}
```

**Step 2: Verify the graph renders**

Open `http://localhost:3000/git.html`, expand a product group, click a workspace row. The detail panel should slide in with:
- Branch list on the left
- SVG commit graph in the main area with colored lanes, curves for merges, hover tooltips

**Step 3: Commit**

```
git add tools/orchestrator-dashboard/public/git-graph.js
git commit -m "feat(dashboard): add D3.js commit graph and timeline renderer

SVG-based DAG visualization with lane assignment, curved merge
lines, branch/tag labels, hover tooltips. Cross-repo timeline
with swim lanes per product and brush zoom."
```

---

## Task 6: Integration Testing & Polish

**Files:**
- Modify: `tools/orchestrator-dashboard/public/git-graph.js` (polish)
- Modify: `tools/orchestrator-dashboard/public/git-app.js` (polish)
- Modify: `tools/orchestrator-dashboard/public/git.html` (polish)

**Step 1: Test the overview page**

Open `http://localhost:3000/git.html` and verify:
- [ ] 4 stat cards show correct numbers
- [ ] All 4 product groups render and expand/collapse
- [ ] Product filter buttons filter correctly
- [ ] Search filters by workspace name and branch name
- [ ] Refresh button clears cache and re-fetches
- [ ] "Last scanned" timestamp updates

**Step 2: Test the detail panel**

Click a workspace row and verify:
- [ ] Panel slides in from the right
- [ ] Header shows workspace name, product badge, stats
- [ ] Branch list shows local and remote branches
- [ ] Commit graph renders with colored lanes
- [ ] Merge commits show curved lines
- [ ] Branch labels appear at branch tips
- [ ] Hover tooltip shows SHA, author, date, message
- [ ] Escape key closes the panel

**Step 3: Test branch comparison**

In the detail panel:
- [ ] Click two branches in the sidebar
- [ ] "Compare Selected" button appears
- [ ] Click Compare — shows three-column layout
- [ ] Ahead/behind counts are correct
- [ ] Merge base SHA is shown

**Step 4: Test the timeline**

Switch to Timeline view:
- [ ] Timeline loads with swim lanes per product
- [ ] Commit dots are colored by product
- [ ] Hover shows commit details
- [ ] Time range dropdown (30/60/90 days) reloads data
- [ ] Brush selection zooms into time range

**Step 5: Fix any rendering issues found during testing**

Common issues to check:
- Overlapping branch labels (adjust positioning)
- Very wide graphs for repos with many branches (add horizontal scroll)
- Timeline too sparse for repos with few commits
- Mobile/narrow viewport handling

**Step 6: Commit**

```
git add -A tools/orchestrator-dashboard/public/
git commit -m "fix(dashboard): polish git graph rendering and interactions

Fix edge cases in lane assignment, label positioning, timeline
brush zoom, and responsive layout."
```

---

## Task 7: Dashboard Header Navigation Update

**Files:**
- Modify: `tools/orchestrator-dashboard/public/index.html`
- Modify: `tools/orchestrator-dashboard/public/git.html`

**Step 1: Ensure consistent nav between both pages**

The main dashboard (`index.html`) should have a "Git Graph" link in the header, and `git.html` should have a link back. This was partially done in Task 3 — verify both directions work.

**Step 2: Commit final state**

```
git add tools/orchestrator-dashboard/
git commit -m "feat(dashboard): complete git graph viewer integration

New git.html page with:
- Overview grid (collapsible product groups, filters, search)
- D3.js commit graph (DAG with lanes, merge lines, labels)
- Branch comparison (ahead/behind, merge base)
- Cross-repo timeline (swim lanes, brush zoom)

Backend: 5 new API endpoints in server.js
Parser: parsers/git-status.js (parallel git scanning, cached)
Renderer: git-graph.js (D3.js SVG DAG engine)"
```

---

## Summary

| Task | What | Files | Estimated Complexity |
|------|------|-------|---------------------|
| 1 | Backend git data module | `parsers/git-status.js` | Medium |
| 2 | API endpoints | `server.js` | Low |
| 3 | HTML page skeleton | `git.html`, `index.html` | Low |
| 4 | Overview grid logic | `git-app.js`, `style.css` | Medium |
| 5 | D3.js graph renderer | `git-graph.js` | High |
| 6 | Integration testing | All files | Medium |
| 7 | Final polish & nav | `index.html`, `git.html` | Low |

**Total new files:** 3 (`git-status.js`, `git.html`, `git-app.js`, `git-graph.js`)
**Modified files:** 2 (`server.js`, `index.html`, `style.css`)
**External deps:** D3.js v7 (CDN only)
