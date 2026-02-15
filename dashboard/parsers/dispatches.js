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

  // Sort newest first
  dispatches.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));

  // Aggregates
  const modelUsage = {};
  const workspaceActivity = {};
  const statusCounts = { completed: 0, failed: 0, running: 0, pending: 0, timeout: 0 };
  let totalDuration = 0;
  let durationCount = 0;

  for (const d of dispatches) {
    const model = d.model || 'unknown';
    modelUsage[model] = (modelUsage[model] || 0) + 1;

    const ws = d.workspace || 'unknown';
    workspaceActivity[ws] = (workspaceActivity[ws] || 0) + 1;

    const status = (d.status || 'unknown').toLowerCase();
    statusCounts[status] = (statusCounts[status] || 0) + 1;

    if (d.duration_seconds) {
      totalDuration += d.duration_seconds;
      durationCount++;
    }
  }

  // Last 24h / 7d counts
  const now = Date.now();
  const last24h = dispatches.filter(d => d.timestamp && (now - new Date(d.timestamp).getTime()) < 86400000).length;
  const last7d = dispatches.filter(d => d.timestamp && (now - new Date(d.timestamp).getTime()) < 604800000).length;

  return {
    total: dispatches.length,
    last24h,
    last7d,
    avgDuration: durationCount > 0 ? Math.round(totalDuration / durationCount) : 0,
    statusCounts,
    modelUsage,
    workspaceActivity,
    recent: dispatches.slice(0, 20)
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
