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

function escapeHtml(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
        <td class="py-2 px-4 text-xs text-gray-500">${escapeHtml(shortName(ws.name))}</td>
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

    html += `<tr class="border-b border-gray-700/30 hover:bg-gray-800/30 cursor-pointer" onclick="openDetail('${escapeHtml(ws.name)}')">
      <td class="py-2 px-4 text-xs font-mono text-gray-300">${escapeHtml(shortName(ws.name))}</td>
      <td class="py-2 px-3 text-xs"><span class="px-2 py-0.5 rounded" style="background: ${bColor}20; color: ${bColor}">${escapeHtml(ws.branch)}</span></td>
      <td class="py-2 px-2 text-center text-xs">${ws.hasMaster ? '<span class="text-success">\u2713</span>' : '<span class="text-gray-600">-</span>'}</td>
      <td class="py-2 px-2 text-center text-xs">${ws.hasDevelop ? '<span class="text-success">\u2713</span>' : '<span class="text-gray-600">-</span>'}</td>
      <td class="py-2 px-3">${dirtyBadge}</td>
      <td class="py-2 px-3 text-xs">${syncStr}</td>
      <td class="py-2 px-3 text-xs ${ageColor(commitDate)}">${formatDate(commitDate)}</td>
      <td class="py-2 px-3 text-xs text-gray-400 max-w-[250px] truncate" title="${escapeHtml(commitMsg)}">${escapeHtml((commitMsg || '').slice(0, 60))}</td>
    </tr>`;
  }

  html += '</tbody></table></div>';
  return html;
}

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
    <span class="px-2 py-0.5 rounded text-[10px] font-semibold uppercase" style="background: ${productColor}20; color: ${productColor}">${escapeHtml(ws.product)}</span>
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
      onclick="toggleBranchSelect('${escapeHtml(b.name)}', '${escapeHtml(wsName)}')">
      <div class="w-2 h-2 rounded-full flex-shrink-0" style="background: ${color}"></div>
      <span class="text-xs truncate flex-1" title="${escapeHtml(b.name)}">${escapeHtml(b.name)}</span>
      ${b.ahead || b.behind ? `<span class="text-[10px] text-gray-500">\u2191${b.ahead}\u2193${b.behind}</span>` : ''}
    </div>`;
  }

  // Remote branches (collapsed)
  if (remoteBranches.length > 0) {
    html += `<div class="mt-3 pt-2 border-t border-gray-700">
      <div class="text-[10px] text-gray-500 uppercase tracking-wide mb-1">Remote (${remoteBranches.length})</div>`;
    for (const b of remoteBranches.slice(0, 10)) {
      html += `<div class="px-2 py-1 text-xs text-gray-500 truncate" title="${escapeHtml(b.name)}">${escapeHtml(b.name)}</div>`;
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
      <span class="font-mono px-2 py-0.5 rounded" style="background: ${branchColor(base)}20; color: ${branchColor(base)}">${escapeHtml(base)}</span>
      <span class="mx-2 text-gray-500">vs</span>
      <span class="font-mono px-2 py-0.5 rounded" style="background: ${branchColor(head)}20; color: ${branchColor(head)}">${escapeHtml(head)}</span>
    </div>
    <div class="text-xs text-gray-400">
      ${escapeHtml(head)} is <span class="text-success">${data.ahead.length} commits ahead</span> and <span class="text-warning">${data.behind.length} commits behind</span> ${escapeHtml(base)}
    </div>
  `;

  document.getElementById('compare-behind-title').textContent = `Only in ${base} (${data.behind.length})`;
  document.getElementById('compare-ahead-title').textContent = `Only in ${head} (${data.ahead.length})`;

  function renderCommitList(commits) {
    if (commits.length === 0) return '<div class="text-xs text-gray-500">No unique commits</div>';
    return commits.map(c => `
      <div class="bg-gray-800/50 rounded px-3 py-2">
        <div class="flex items-center gap-2">
          <span class="font-mono text-[10px] text-accent">${escapeHtml(c.sha)}</span>
          <span class="text-[10px] text-gray-500">${formatDate(c.date)}</span>
        </div>
        <div class="text-xs text-gray-300 mt-0.5 truncate" title="${escapeHtml(c.message)}">${escapeHtml(c.message)}</div>
        <div class="text-[10px] text-gray-500">${escapeHtml(c.author)}</div>
      </div>
    `).join('');
  }

  document.getElementById('compare-behind').innerHTML = renderCommitList(data.behind);
  document.getElementById('compare-ahead').innerHTML = renderCommitList(data.ahead);

  if (data.mergeBase) {
    document.getElementById('compare-merge-base').innerHTML = `
      <div class="text-[10px] text-gray-500 uppercase tracking-wide">Merge Base</div>
      <div class="font-mono text-xs text-accent mt-1">${escapeHtml(data.mergeBase.slice(0, 10))}</div>
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
