import fs from 'fs/promises';
import path from 'path';

const ORCHESTRATOR_HOME = process.env.ORCHESTRATOR_HOME || path.join(process.env.HOME, 'claude-orchestrator');

export async function parseDispatches() {
  const dispatchPath = path.join(ORCHESTRATOR_HOME, 'logs', 'dispatches.json');
  let dispatches = [];
  try {
    const raw = await fs.readFile(dispatchPath, 'utf-8');
    dispatches = JSON.parse(raw);
  } catch {
    return emptyResult();
  }

  if (!Array.isArray(dispatches)) return emptyResult();

  // Filter out batch records (type === 'batch')
  const tasks = dispatches.filter(d => d.type !== 'batch');

  // Sort newest first — use created_at (our field) or timestamp (legacy)
  tasks.sort((a, b) => (b.created_at || b.timestamp || '').localeCompare(a.created_at || a.timestamp || ''));

  // Aggregates
  const modelUsage = {};
  const workspaceActivity = {};
  const statusCounts = {};
  let totalDuration = 0;
  let durationCount = 0;

  for (const d of tasks) {
    const model = d.model || 'unknown';
    modelUsage[model] = (modelUsage[model] || 0) + 1;

    const ws = d.workspace || 'unknown';
    workspaceActivity[ws] = (workspaceActivity[ws] || 0) + 1;

    const status = (d.status || 'unknown').toLowerCase();
    statusCounts[status] = (statusCounts[status] || 0) + 1;

    // Calculate duration from started_at/completed_at or use stored value
    const duration = d.duration_seconds || d.execution_time_seconds ||
      (d.started_at && d.completed_at ? Math.round((new Date(d.completed_at) - new Date(d.started_at)) / 1000) : null);
    if (duration) {
      totalDuration += duration;
      durationCount++;
    }
  }

  // Last 24h / 7d counts
  const now = Date.now();
  const getTime = d => new Date(d.created_at || d.timestamp || 0).getTime();
  const last24h = tasks.filter(d => (now - getTime(d)) < 86400000).length;
  const last7d = tasks.filter(d => (now - getTime(d)) < 604800000).length;

  // Enrich recent records for display
  const recent = tasks.slice(0, 20).map(d => ({
    ...d,
    display_task: d.original_task || (d.task || '').replace(/<workspace-context>[\s\S]*?<\/workspace-context>\s*/g, ''),
    display_time: d.created_at || d.timestamp || d.updated_at,
    duration_seconds: d.duration_seconds || d.execution_time_seconds ||
      (d.started_at && d.completed_at ? Math.round((new Date(d.completed_at) - new Date(d.started_at)) / 1000) : null),
  }));

  return {
    total: tasks.length,
    last24h,
    last7d,
    avgDuration: durationCount > 0 ? Math.round(totalDuration / durationCount) : 0,
    statusCounts,
    modelUsage,
    workspaceActivity,
    recent
  };
}

function emptyResult() {
  return {
    total: 0,
    last24h: 0,
    last7d: 0,
    avgDuration: 0,
    statusCounts: {},
    modelUsage: {},
    workspaceActivity: {},
    recent: []
  };
}
