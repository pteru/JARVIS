import express from 'express';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { parseDispatches } from './parsers/dispatches.js';
import { parseBacklogs } from './parsers/backlogs.js';
import { parseChangelogs } from './parsers/changelogs.js';
import { parsePrInbox, parseArchivedReviews } from './parsers/pr-inbox.js';
import { parseGitOverview, parseWorkspaceDetail, parseGitCompare, parseGitTimeline, clearGitCache } from './parsers/git-status.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ORCHESTRATOR_HOME = process.env.ORCHESTRATOR_HOME || path.join(process.env.HOME, 'JARVIS');

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

// API: PR Review file
app.get('/api/pr-review/:repo/:number', async (req, res) => {
  try {
    const { repo, number } = req.params;
    const archived = req.query.archived === 'true';
    const base = path.join(ORCHESTRATOR_HOME, 'reports', 'pr-reviews');
    const filePath = path.join(archived ? path.join(base, 'archived') : base, `${repo}-${number}.md`);
    const content = await fs.readFile(filePath, 'utf-8');
    res.json({ content, exists: true });
  } catch {
    res.json({ content: null, exists: false });
  }
});

// API: Archived PR reviews
app.get('/api/pr-reviews/archived', async (_req, res) => {
  try {
    const data = await parseArchivedReviews();
    res.json(data);
  } catch (err) {
    console.error('Error parsing archived reviews:', err.message);
    res.json([]);
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

app.listen(PORT, () => {
  console.log(`Orchestrator Dashboard running on http://localhost:${PORT}`);
});
