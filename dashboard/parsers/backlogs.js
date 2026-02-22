import fs from 'fs/promises';
import path from 'path';
import { ORCHESTRATOR_HOME } from '../../mcp-servers/lib/config-loader.js';

export async function parseBacklogs() {
  const workspacesPath = path.join(ORCHESTRATOR_HOME, 'config', 'orchestrator', 'workspaces.json');
  let workspaces = {};
  try {
    const raw = await fs.readFile(workspacesPath, 'utf-8');
    workspaces = JSON.parse(raw).workspaces || {};
  } catch {
    return { workspaces: [], summary: { total: 0, pending: 0, done: 0, byPriority: {} } };
  }

  const results = [];
  let totalPending = 0;
  let totalDone = 0;
  const byPriority = { high: 0, medium: 0, low: 0 };

  for (const [name, ws] of Object.entries(workspaces)) {
    const backlogPath = path.join(ws.path, '.claude', 'backlog.md');
    let tasks = [];
    try {
      const content = await fs.readFile(backlogPath, 'utf-8');
      tasks = parseMarkdownTasks(content);
    } catch {
      // No backlog file for this workspace
    }

    const pending = tasks.filter(t => !t.done).length;
    const done = tasks.filter(t => t.done).length;
    totalPending += pending;
    totalDone += done;

    if (tasks.length > 0) {
      results.push({
        workspace: name,
        category: ws.category,
        product: ws.product,
        priority: ws.priority,
        pending,
        done,
        total: tasks.length,
        tasks
      });
    }

    if (ws.priority && pending > 0) {
      byPriority[ws.priority] = (byPriority[ws.priority] || 0) + pending;
    }
  }

  return {
    workspaces: results,
    summary: {
      total: totalPending + totalDone,
      pending: totalPending,
      done: totalDone,
      byPriority
    }
  };
}

function parseMarkdownTasks(content) {
  const lines = content.split('\n');
  const tasks = [];
  let currentPriority = 'medium';

  for (const line of lines) {
    const priorityMatch = line.match(/^##\s+.*?(high|medium|low)/i);
    if (priorityMatch) {
      currentPriority = priorityMatch[1].toLowerCase();
    }

    const taskMatch = line.match(/^[-*]\s+\[([ xX])\]\s+(.*)/);
    if (taskMatch) {
      tasks.push({
        done: taskMatch[1] !== ' ',
        text: taskMatch[2].trim(),
        priority: currentPriority
      });
    }
  }
  return tasks;
}
