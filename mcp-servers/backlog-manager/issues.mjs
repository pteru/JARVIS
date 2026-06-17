/**
 * Issue-backed backlog handlers for the backlog-manager MCP.
 * Thin adapters over scripts/lib/backlog-source.mjs (GitHub Issues = source of truth).
 */
import { listIssues, createIssue, closeIssue } from '../../scripts/lib/backlog-source.mjs';

const COMPLEXITY_LABELS = ['simple', 'medium', 'complex'];

function complexityOf(issue) {
  return issue.labels.find((l) => COMPLEXITY_LABELS.includes(l)) || 'medium';
}

/** List open backlog issues for a workspace as task objects. */
export async function listTasks(workspace, priority = 'all') {
  const issues = await listIssues(workspace, { label: 'backlog', state: 'open' });
  return issues
    .filter((i) => priority === 'all' || i.labels.includes(priority))
    .map((i) => ({
      number: i.number,
      // 'medium' is omitted: it collides with the complexity label of the same name
      priority: ['high', 'low'].find((p) => i.labels.includes(p)) || null,
      complexity: complexityOf(i),
      description: i.title,
      url: i.url,
    }));
}

/** Create a backlog issue. Returns a human-readable string with the URL. */
export async function addTask(workspace, task, priority, complexity = 'medium') {
  const title = task.split('\n')[0].slice(0, 80);
  const body = `${task}\n\n— filed via JARVIS backlog-manager`;
  const labels = ['backlog', complexity, priority].filter(Boolean);
  const { url } = await createIssue(workspace, { title, body, labels });
  return `Created backlog issue: ${url}`;
}

/**
 * Close a backlog issue. `pattern` is an issue number (or #N), or a title substring
 * that must match exactly one open issue.
 */
export async function completeTask(workspace, pattern) {
  const today = new Date().toISOString().split('T')[0];
  const numeric = String(pattern).replace(/^#/, '');
  if (/^\d+$/.test(numeric)) {
    const { url } = await closeIssue(workspace, { number: numeric, comment: `Completed via JARVIS on ${today}.` });
    return `Closed ${url}`;
  }
  const issues = await listIssues(workspace, { label: 'backlog', state: 'open' });
  const matches = issues.filter((i) => i.title.toLowerCase().includes(String(pattern).toLowerCase()));
  if (matches.length === 0) return `No open backlog issue matches "${pattern}".`;
  if (matches.length > 1) {
    return `Ambiguous — ${matches.length} issues match "${pattern}": ${matches.map((m) => '#' + m.number).join(', ')}. Pass an issue number.`;
  }
  const { url } = await closeIssue(workspace, { number: matches[0].number, comment: `Completed via JARVIS on ${today}.` });
  return `Closed ${url}`;
}
