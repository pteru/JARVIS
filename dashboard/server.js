import express from 'express';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { parseDispatches } from './parsers/dispatches.js';
import { parseBacklogs } from './parsers/backlogs.js';
import { parseChangelogs } from './parsers/changelogs.js';
import { parsePrInbox } from './parsers/pr-inbox.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ORCHESTRATOR_HOME = process.env.ORCHESTRATOR_HOME || path.join(process.env.HOME, 'claude-orchestrator');

const app = express();
const PORT = process.env.DASHBOARD_PORT || 3000;

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// API: Dispatches
app.get('/api/dispatches', async (_req, res) => {
  try {
    const data = await parseDispatches();
    res.json(data);
  } catch (err) {
    console.error('Error parsing dispatches:', err.message);
    res.json({ total: 0, last24h: 0, last7d: 0, avgDuration: 0, statusCounts: {}, modelUsage: {}, workspaceActivity: {}, recent: [] });
  }
});

// API: Workspaces
app.get('/api/workspaces', async (_req, res) => {
  try {
    const raw = await fs.readFile(path.join(ORCHESTRATOR_HOME, 'config', 'orchestrator', 'workspaces.json'), 'utf-8');
    const config = JSON.parse(raw);
    const workspaces = Object.entries(config.workspaces || {}).map(([name, ws]) => ({
      name,
      type: ws.type,
      category: ws.category,
      product: ws.product,
      priority: ws.priority,
      auto_review: ws.auto_review
    }));
    res.json(workspaces);
  } catch {
    res.json([]);
  }
});

// API: Backlogs
app.get('/api/backlogs', async (_req, res) => {
  try {
    const data = await parseBacklogs();
    res.json(data);
  } catch (err) {
    console.error('Error parsing backlogs:', err.message);
    res.json({ workspaces: [], summary: { total: 0, pending: 0, done: 0, byPriority: {} } });
  }
});

// API: Changelogs
app.get('/api/changelogs', async (_req, res) => {
  try {
    const data = await parseChangelogs();
    res.json(data);
  } catch (err) {
    console.error('Error parsing changelogs:', err.message);
    res.json({ changelogs: [], recentEntries: [] });
  }
});

// API: PR Inbox
app.get('/api/pr-inbox', async (_req, res) => {
  try {
    const data = await parsePrInbox();
    res.json(data);
  } catch (err) {
    console.error('Error parsing PR inbox:', err.message);
    res.json({ fetched_at: null, total: 0, needsReview: 0, approved: 0, changesRequested: 0, draft: 0, stale: 0, byProduct: {}, prs: [] });
  }
});

// API: Notifications
app.get('/api/notifications', async (_req, res) => {
  try {
    const raw = await fs.readFile(path.join(ORCHESTRATOR_HOME, 'logs', 'notifications.json'), 'utf-8');
    const notifications = JSON.parse(raw);
    const items = Array.isArray(notifications) ? notifications : [];
    items.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
    res.json(items.slice(0, 30));
  } catch {
    res.json([]);
  }
});

app.listen(PORT, () => {
  console.log(`Orchestrator Dashboard running on http://localhost:${PORT}`);
});
