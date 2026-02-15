let modelChart = null;
let workspaceChart = null;

const MODEL_COLORS = {
  'claude-opus-4-5-20251101': '#8b5cf6',
  'claude-sonnet-4-5-20250929': '#3b82f6',
  'claude-haiku-4-5-20251001': '#22c55e',
};
const FALLBACK_COLORS = ['#f59e0b', '#ef4444', '#06b6d4', '#ec4899', '#14b8a6'];

const STATUS_CLASSES = {
  completed: 'badge-success',
  complete: 'badge-success',
  failed: 'badge-danger',
  error: 'badge-danger',
  running: 'badge-warning',
  pending: 'badge-neutral',
  timeout: 'badge-danger',
};

function formatDuration(seconds) {
  if (!seconds) return '--';
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function formatTime(ts) {
  if (!ts) return '--';
  const d = new Date(ts);
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatDate(dateStr) {
  if (!dateStr) return '--';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function shortModel(model) {
  if (!model) return 'unknown';
  if (model.includes('opus')) return 'Opus';
  if (model.includes('sonnet')) return 'Sonnet';
  if (model.includes('haiku')) return 'Haiku';
  return model.split('-').slice(0, 2).join('-');
}

function shortWorkspace(ws) {
  if (!ws) return 'unknown';
  const parts = ws.split('.');
  return parts.length > 2 ? parts.slice(-2).join('.') : ws;
}

async function fetchJSON(url) {
  try {
    const res = await fetch(url);
    return await res.json();
  } catch {
    return null;
  }
}

async function loadAll() {
  const [dispatches, backlogs, changelogs, notifications] = await Promise.all([
    fetchJSON('/api/dispatches'),
    fetchJSON('/api/backlogs'),
    fetchJSON('/api/changelogs'),
    fetchJSON('/api/notifications'),
  ]);

  renderStats(dispatches);
  renderDispatchSummary(dispatches);
  renderModelChart(dispatches);
  renderWorkspaceChart(dispatches);
  renderDispatchTable(dispatches);
  renderBacklogHealth(backlogs);
  renderChangelog(changelogs);
  renderNotifications(notifications);

  document.getElementById('last-updated').textContent = 'Updated ' + new Date().toLocaleTimeString();
}

function renderStats(data) {
  if (!data) return;
  document.getElementById('stat-total').textContent = data.total || 0;
  document.getElementById('stat-24h').textContent = data.last24h || 0;
  document.getElementById('stat-7d').textContent = data.last7d || 0;
  document.getElementById('stat-duration').textContent = formatDuration(data.avgDuration);
}

function renderDispatchSummary(data) {
  const el = document.getElementById('dispatch-summary');
  if (!data || !data.statusCounts) {
    el.innerHTML = '<div class="text-gray-500 text-sm">No dispatch data available</div>';
    return;
  }

  const counts = data.statusCounts;
  const items = Object.entries(counts)
    .filter(([, v]) => v > 0)
    .map(([status, count]) => {
      const cls = STATUS_CLASSES[status] || 'badge-neutral';
      return `<div class="flex justify-between items-center">
        <span class="badge ${cls}">${status}</span>
        <span class="text-white font-medium">${count}</span>
      </div>`;
    });

  el.innerHTML = items.length > 0 ? items.join('') : '<div class="text-gray-500 text-sm">No dispatches recorded</div>';
}

function renderModelChart(data) {
  const canvas = document.getElementById('chart-models');
  if (!data || !data.modelUsage || Object.keys(data.modelUsage).length === 0) {
    canvas.parentElement.innerHTML = '<div class="text-gray-500 text-sm text-center">No model data</div>';
    return;
  }

  const labels = Object.keys(data.modelUsage).map(shortModel);
  const values = Object.values(data.modelUsage);
  const colors = Object.keys(data.modelUsage).map((m, i) => MODEL_COLORS[m] || FALLBACK_COLORS[i % FALLBACK_COLORS.length]);

  if (modelChart) modelChart.destroy();
  modelChart = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{ data: values, backgroundColor: colors, borderWidth: 0 }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { color: '#9ca3af', padding: 12, font: { size: 11 } } }
      }
    }
  });
}

function renderWorkspaceChart(data) {
  const canvas = document.getElementById('chart-workspaces');
  if (!data || !data.workspaceActivity || Object.keys(data.workspaceActivity).length === 0) {
    canvas.parentElement.innerHTML = '<div class="text-gray-500 text-sm text-center">No workspace data</div>';
    return;
  }

  // Top 10 workspaces by activity
  const sorted = Object.entries(data.workspaceActivity).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const labels = sorted.map(([w]) => shortWorkspace(w));
  const values = sorted.map(([, v]) => v);

  if (workspaceChart) workspaceChart.destroy();
  workspaceChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{ data: values, backgroundColor: '#6c63ff', borderRadius: 4 }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: 'y',
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#9ca3af' }, grid: { color: '#374151' } },
        y: { ticks: { color: '#9ca3af', font: { size: 10 } }, grid: { display: false } }
      }
    }
  });
}

function renderDispatchTable(data) {
  const tbody = document.getElementById('dispatch-table');
  if (!data || !data.recent || data.recent.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-gray-500 py-4 text-center">No dispatches recorded</td></tr>';
    return;
  }

  tbody.innerHTML = data.recent.map(d => {
    const status = (d.status || 'unknown').toLowerCase();
    const cls = STATUS_CLASSES[status] || 'badge-neutral';
    const task = d.display_task || d.original_task || d.task || '--';
    const time = d.display_time || d.created_at || d.timestamp;
    return `<tr class="border-b border-gray-700/50 hover:bg-gray-800/30">
      <td class="py-2 px-2 text-xs text-gray-400 whitespace-nowrap">${formatTime(time)}</td>
      <td class="py-2 px-2 text-xs font-mono">${shortWorkspace(d.workspace)}</td>
      <td class="py-2 px-2 text-xs max-w-[200px] truncate" title="${task.replace(/"/g, '&quot;')}">${task.slice(0, 80)}</td>
      <td class="py-2 px-2 text-xs">${shortModel(d.model)}</td>
      <td class="py-2 px-2"><span class="badge ${cls}">${status}</span></td>
      <td class="py-2 px-2 text-xs text-right text-gray-400">${formatDuration(d.duration_seconds)}</td>
    </tr>`;
  }).join('');
}

function renderBacklogHealth(data) {
  const el = document.getElementById('backlog-health');
  if (!data || !data.summary) {
    el.innerHTML = '<div class="text-gray-500 text-sm">No backlog data</div>';
    return;
  }

  const s = data.summary;
  const pct = s.total > 0 ? Math.round((s.done / s.total) * 100) : 0;

  let html = `
    <div class="flex justify-between text-sm">
      <span class="text-gray-400">Completion</span>
      <span class="text-white font-medium">${s.done}/${s.total} (${pct}%)</span>
    </div>
    <div class="w-full bg-gray-700 rounded-full h-2 mt-1 mb-3">
      <div class="bg-accent h-2 rounded-full" style="width: ${pct}%"></div>
    </div>
    <div class="flex justify-between text-sm">
      <span class="text-gray-400">Pending</span>
      <span class="text-warning font-medium">${s.pending}</span>
    </div>
  `;

  if (s.byPriority && Object.keys(s.byPriority).length > 0) {
    html += '<div class="mt-3 pt-3 border-t border-gray-700 space-y-1">';
    for (const [priority, count] of Object.entries(s.byPriority)) {
      if (count > 0) {
        const color = priority === 'high' ? 'text-danger' : priority === 'medium' ? 'text-warning' : 'text-gray-400';
        html += `<div class="flex justify-between text-xs">
          <span class="text-gray-400 capitalize">${priority} priority</span>
          <span class="${color} font-medium">${count}</span>
        </div>`;
      }
    }
    html += '</div>';
  }

  // Top workspaces with backlogs
  if (data.workspaces && data.workspaces.length > 0) {
    html += '<div class="mt-3 pt-3 border-t border-gray-700 space-y-1">';
    const top = data.workspaces.sort((a, b) => b.pending - a.pending).slice(0, 5);
    for (const ws of top) {
      html += `<div class="flex justify-between text-xs">
        <span class="text-gray-400 truncate max-w-[140px]" title="${ws.workspace}">${shortWorkspace(ws.workspace)}</span>
        <span class="text-white">${ws.pending} pending</span>
      </div>`;
    }
    html += '</div>';
  }

  el.innerHTML = html;
}

function renderNotifications(data) {
  const el = document.getElementById('notifications-list');
  if (!data || data.length === 0) {
    el.innerHTML = '<div class="text-gray-500 text-sm">No notifications</div>';
    return;
  }

  el.innerHTML = data.slice(0, 15).map(n => {
    const status = (n.status || n.event || 'info').toLowerCase();
    const cls = status.includes('fail') || status.includes('error') ? 'border-l-danger'
      : status.includes('complete') || status.includes('success') ? 'border-l-success'
      : 'border-l-accent';
    return `<div class="border-l-2 ${cls} pl-3 py-1">
      <div class="text-xs text-gray-400">${formatTime(n.timestamp)}</div>
      <div class="text-sm text-gray-200 truncate" title="${(n.message || n.text || '').replace(/"/g, '&quot;')}">${n.message || n.text || n.event || '--'}</div>
    </div>`;
  }).join('');
}

function renderChangelog(data) {
  const el = document.getElementById('changelog-entries');
  if (!el) return;
  if (!data || !data.recentEntries || data.recentEntries.length === 0) {
    el.innerHTML = '<div class="text-gray-500 text-sm">No changelog entries</div>';
    return;
  }

  // Flatten section entries (each has items array) into individual lines
  const flat = [];
  for (const e of data.recentEntries) {
    const items = e.items || [];
    for (const item of items) {
      flat.push({ section: e.section, date: e.date, workspace: e.workspace, text: item });
      if (flat.length >= 20) break;
    }
    if (flat.length >= 20) break;
  }

  el.innerHTML = flat.map(e => {
    const type = (e.section || '').toLowerCase();
    const color = type.includes('added') ? 'border-l-success'
      : type.includes('fixed') ? 'border-l-accent'
      : type.includes('changed') ? 'border-l-warning'
      : type.includes('removed') ? 'border-l-danger'
      : 'border-l-gray-500';
    const badge = type.includes('added') ? 'badge-success'
      : type.includes('fixed') ? 'badge-accent'
      : type.includes('changed') ? 'badge-warning'
      : 'badge-neutral';
    return `<div class="border-l-2 ${color} pl-3 py-1">
      <div class="flex items-center gap-2">
        <span class="badge ${badge} text-[10px]">${e.section || 'change'}</span>
        <span class="text-xs text-gray-400">${e.date ? formatDate(e.date) : ''}</span>
        ${e.workspace ? `<span class="text-xs text-gray-500">${shortWorkspace(e.workspace)}</span>` : ''}
      </div>
      <div class="text-sm text-gray-200 mt-0.5" title="${e.text.replace(/"/g, '&quot;')}">${e.text}</div>
    </div>`;
  }).join('');
}

// Initial load
loadAll();

// Auto-refresh every 30 seconds
setInterval(loadAll, 30000);
