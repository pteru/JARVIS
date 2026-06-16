const vscode = require('vscode');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

let sessionsLib = null;
async function loadLib() {
  if (sessionsLib) return sessionsLib;
  sessionsLib = await import(path.join(__dirname, 'lib', 'sessions.mjs'));
  return sessionsLib;
}

function resolveSessionsDir() {
  const cfg = vscode.workspace.getConfiguration('claudeMonitor').get('sessionsDir');
  if (cfg && cfg.length) return cfg;
  return path.join(os.homedir(), '.claude', 'sessions');
}

function resolveProjectsDir() {
  const cfg = vscode.workspace.getConfiguration('claudeMonitor').get('projectsDir');
  if (cfg && cfg.length) return cfg;
  return path.join(os.homedir(), '.claude', 'projects');
}

function resolveCheckInThresholdMs() {
  const min = vscode.workspace.getConfiguration('claudeMonitor').get('checkInThresholdMinutes');
  return (typeof min === 'number' && min > 0 ? min : 5) * 60_000;
}

const MODE_LABEL = { auto: 'AUTO', acceptEdits: 'edits', default: 'default' };

const STATUS_ICON = {
  'needs-checkin': new vscode.ThemeIcon('bell-dot', new vscode.ThemeColor('charts.blue')),
  running: new vscode.ThemeIcon('sync~spin', new vscode.ThemeColor('charts.green')),
  waiting: new vscode.ThemeIcon('warning', new vscode.ThemeColor('charts.yellow')),
  idle: new vscode.ThemeIcon('circle-outline', new vscode.ThemeColor('disabledForeground')),
  ended: new vscode.ThemeIcon('circle-slash', new vscode.ThemeColor('charts.red')),
  recent: new vscode.ThemeIcon('history', new vscode.ThemeColor('disabledForeground')),
  unknown: new vscode.ThemeIcon('question'),
};

const GROUP_ORDER = ['needs-checkin', 'waiting', 'running', 'idle', 'ended', 'recent', 'unknown'];
const GROUP_LABEL = {
  'needs-checkin': 'Needs check-in',
  waiting: 'Waiting for input',
  running: 'Running',
  idle: 'Idle',
  ended: 'Ended',
  recent: 'Recent',
  unknown: 'Unknown',
};
const GROUP_DEFAULT_EXPANDED = new Set(['needs-checkin', 'waiting', 'running', 'idle']);

// Sessions whose long-run "needs check-in" flag the user has acknowledged.
// Keyed by sessionId -> the lastTurnEndTs that was dismissed; a new turn
// produces a new endTs and re-flags the session automatically.
const dismissed = new Map();

function fmtDuration(ms) {
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h${m % 60}m`;
}

// Claude Code appends a "(disable recaps in /config)" hint to recap text;
// strip it for a cleaner tooltip.
function cleanRecap(recap) {
  if (!recap) return null;
  return recap.replace(/\s*\(disable recaps in \/config\)\s*$/, '').trim() || null;
}

function isNeedsCheckIn(s, thresholdMs) {
  return s.displayStatus === 'idle'
    && typeof s.lastTurnDurationMs === 'number'
    && s.lastTurnDurationMs >= thresholdMs
    && dismissed.get(s.sessionId) !== s.lastTurnEndTs;
}

// --- /proc-based process tree (Linux). Returns null on macOS/Windows. ---
function getParentPid(pid) {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    // Format: "pid (comm) state ppid ...". `comm` may contain spaces and parens.
    const closeParen = stat.lastIndexOf(')');
    const fields = stat.slice(closeParen + 2).split(' ');
    return parseInt(fields[1], 10);
  } catch { return null; }
}

function ancestorsOf(pid, maxDepth = 12) {
  const result = [];
  let cur = pid;
  for (let i = 0; i < maxDepth; i++) {
    const ppid = getParentPid(cur);
    if (!ppid || ppid <= 1) break;
    result.push(ppid);
    cur = ppid;
  }
  return result;
}

async function findTerminalForSession(sessionPid) {
  const candidates = new Set([sessionPid, ...ancestorsOf(sessionPid)]);
  for (const term of vscode.window.terminals) {
    const tpid = await term.processId;
    if (tpid && candidates.has(tpid)) return term;
  }
  return null;
}

// --- Tree provider with status groups as parents. ---
class SessionsProvider {
  constructor() {
    this._onDidChange = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChange.event;
    this._groups = [];
    this._actives = [];
    this._recents = [];
  }

  async _populateActives() {
    const lib = await loadLib();
    const dir = resolveSessionsDir();
    const projectsDir = resolveProjectsDir();
    const now = Date.now();
    const sessions = lib.readAllSessions(dir, {
      now,
      isPidAlive: lib.isPidAliveDefault,
      projectsDir,
    });
    sessions.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
    this._actives = sessions;
  }

  async _populateRecents() {
    const lib = await loadLib();
    const projectsDir = resolveProjectsDir();
    const limit = vscode.workspace.getConfiguration('claudeMonitor').get('recentLimit') ?? 10;
    const exclude = new Set(this._actives.map((s) => s.sessionId));
    this._recents = lib.listRecentSessions(projectsDir, {
      excludeSessionIds: exclude,
      limit,
    });
  }

  _rebuildGroups() {
    const thresholdMs = resolveCheckInThresholdMs();
    const byStatus = new Map();
    for (const s of this._actives) {
      s._needsCheckIn = isNeedsCheckIn(s, thresholdMs);
      const k = s._needsCheckIn ? 'needs-checkin' : (s.displayStatus ?? 'unknown');
      if (!byStatus.has(k)) byStatus.set(k, []);
      byStatus.get(k).push(s);
    }
    if (this._recents.length) byStatus.set('recent', this._recents);
    this._groups = GROUP_ORDER
      .filter((k) => byStatus.has(k))
      .map((k) => ({
        kind: 'group',
        status: k,
        label: GROUP_LABEL[k],
        sessions: byStatus.get(k),
      }));
  }

  // Cheap refresh: only re-reads active sessions. Used by the polling timer.
  async refresh() {
    await this._populateActives();
    this._rebuildGroups();
    this._onDidChange.fire();
  }

  // Full refresh: also re-scans the projects dir for recent sessions.
  // Used on activation, manual refresh, and sessions-dir change events.
  async refreshAll() {
    await this._populateActives();
    await this._populateRecents();
    this._rebuildGroups();
    this._onDidChange.fire();
  }

  getChildren(element) {
    if (!element) return this._groups;
    if (element.kind === 'group') return element.sessions;
    return [];
  }

  getTreeItem(element) {
    if (element.kind === 'group') {
      const expanded = GROUP_DEFAULT_EXPANDED.has(element.status)
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.Collapsed;
      const item = new vscode.TreeItem(element.label, expanded);
      item.description = `${element.sessions.length}`;
      item.contextValue = `group-${element.status}`;
      item.iconPath = STATUS_ICON[element.status] ?? STATUS_ICON.unknown;
      item.id = `group:${element.status}`;
      return item;
    }
    if (element.kind === 'recent') return this.makeRecentItem(element);
    return this.makeSessionItem(element);
  }

  makeRecentItem(element) {
    const label = element.name ?? element.sessionId.slice(0, 8);
    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
    const home = os.homedir();
    const cwdShort = element.cwd === home
      ? '~'
      : element.cwd?.startsWith(home + '/') ? '~' + element.cwd.slice(home.length) : (element.cwd ?? '?');
    const ageMs = Date.now() - element.mtime;
    const ageStr = ageMs < 60_000 ? '<1m'
      : ageMs < 3600_000 ? `${Math.floor(ageMs / 60_000)}m ago`
      : ageMs < 86400_000 ? `${Math.floor(ageMs / 3600_000)}h ago`
      : `${Math.floor(ageMs / 86400_000)}d ago`;
    const parts = [];
    if (cwdShort) parts.push(cwdShort);
    parts.push(ageStr);
    item.description = parts.join(' · ');
    const recap = cleanRecap(element.recap);
    item.tooltip = new vscode.MarkdownString(
      `**${label}**\n\n` +
      `- Last used: ${ageStr}\n` +
      `- CWD: \`${cwdShort}\`\n` +
      `- Session: \`${element.sessionId}\`` +
      (element.lastPrompt ? `\n\n---\n\n**Last prompt**\n\n> ${element.lastPrompt.split('\n')[0].slice(0, 200)}` : '') +
      (recap ? `\n\n---\n\n**Recap**\n\n${recap}` : ''),
    );
    item.iconPath = STATUS_ICON.recent;
    item.contextValue = 'session-recent';
    item.id = `recent:${element.sessionId}`;
    item.session = element;
    // Click → resume in a new terminal.
    item.command = {
      command: 'claudeMonitor.resume',
      title: 'Resume',
      arguments: [{ session: element }],
    };
    return item;
  }

  makeSessionItem(element) {
    const isAuto = element.permissionMode === 'auto' && element.displayStatus !== 'ended';
    const label = isAuto ? `⚡ ${element.name ?? '?'}` : (element.name ?? '?');
    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
    const home = os.homedir();
    const cwdShort = element.cwd === home
      ? '~'
      : element.cwd?.startsWith(home + '/') ? '~' + element.cwd.slice(home.length) : element.cwd;
    const ageMin = element.ageMs == null ? null : Math.floor(element.ageMs / 60000);
    const ageStr = ageMin == null ? '' : ageMin < 1 ? '<1m' : ageMin < 60 ? `${ageMin}m` : `${Math.floor(ageMin / 60)}h${ageMin % 60}m`;
    const modeLabel = element.permissionMode ? MODE_LABEL[element.permissionMode] ?? element.permissionMode : null;
    const ranStr = element._needsCheckIn && typeof element.lastTurnDurationMs === 'number'
      ? `ran ${fmtDuration(element.lastTurnDurationMs)}`
      : null;
    const parts = [];
    if (ranStr) parts.push(ranStr);
    if (modeLabel) parts.push(modeLabel);
    if (element.waitingFor) parts.push(element.waitingFor);
    if (ageStr) parts.push(ageStr);
    item.description = parts.join(' · ');
    const recap = cleanRecap(element.recap);
    item.tooltip = new vscode.MarkdownString(
      `**${element.name ?? '(unnamed)'}**\n\n` +
      `- Status: \`${element.displayStatus}\`\n` +
      (element._needsCheckIn ? `- ⚠️ Finished a long task — last turn ran **${fmtDuration(element.lastTurnDurationMs)}**\n` : '') +
      (modeLabel ? `- Permission mode: \`${element.permissionMode}\`\n` : '') +
      (element.waitingFor ? `- Waiting for: ${element.waitingFor}\n` : '') +
      `- CWD: \`${cwdShort}\`\n` +
      `- PID: ${element.pid}\n` +
      `- Session: \`${element.sessionId}\`` +
      (recap ? `\n\n---\n\n**Recap**\n\n${recap}` : ''),
    );
    // Status icon always reflects running/waiting/idle/ended; a session that
    // finished a long task gets the bell icon to draw a check-in.
    // Auto-mode is signalled by the ⚡ prefix on the label instead.
    item.iconPath = element._needsCheckIn
      ? STATUS_ICON['needs-checkin']
      : (STATUS_ICON[element.displayStatus] ?? STATUS_ICON.unknown);
    const isActive = element.displayStatus !== 'ended' && element.displayStatus !== 'unknown';
    item.contextValue = isActive ? 'session-active' : 'session-ended';
    item.id = `session:${element.sessionId}`;
    item.session = element;
    item.command = {
      command: isActive ? 'claudeMonitor.focusTerminal' : 'claudeMonitor.resume',
      title: isActive ? 'Focus terminal' : 'Resume',
      arguments: [{ session: element }],
    };
    return item;
  }
}

async function focusTerminalForSession(session) {
  const term = await findTerminalForSession(session.pid);
  if (term) {
    term.show(true);
    return;
  }
  vscode.window.showInformationMessage(
    `No VS Code terminal found for "${session.name ?? session.sessionId}" (pid ${session.pid}). It may be running in an external terminal.`,
  );
}

function resumeSession(session) {
  const target = (session.name && session.name.length) ? session.name : session.sessionId;
  const term = vscode.window.createTerminal({
    name: `Claude: ${target}`,
    cwd: session.cwd || os.homedir(),
  });
  term.show();
  term.sendText(`claude --resume ${target}`);
}

async function renameSession(session, providerRefresh) {
  if (session.kind === 'recent') {
    vscode.window.showInformationMessage(
      'Recent sessions are not active — resume one and use /rename inside the session to rename it.',
    );
    return;
  }
  const lib = await loadLib();
  const newName = await vscode.window.showInputBox({
    prompt: 'New name for this Claude Code session',
    value: session.name ?? '',
    validateInput: (v) => (v && v.trim().length ? null : 'Name cannot be empty'),
  });
  if (!newName) return;
  try {
    lib.renameSessionFile(session.filepath, newName);
    providerRefresh();
    vscode.window.setStatusBarMessage(`Renamed to "${newName.trim()}"`, 2500);
  } catch (e) {
    vscode.window.showErrorMessage(`Rename failed: ${e.message}`);
  }
}

function activate(context) {
  const provider = new SessionsProvider();
  const view = vscode.window.createTreeView('claudeMonitor.sessions', { treeDataProvider: provider });
  context.subscriptions.push(view);

  const refresh = () => provider.refresh();
  const refreshAll = () => provider.refreshAll();

  context.subscriptions.push(
    vscode.commands.registerCommand('claudeMonitor.refresh', refreshAll),
    vscode.commands.registerCommand('claudeMonitor.openCwd', (arg) => {
      const cwd = arg?.session?.cwd ?? arg?.cwd;
      if (!cwd) return;
      vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(cwd), { forceNewWindow: true });
    }),
    vscode.commands.registerCommand('claudeMonitor.focusTerminal', (arg) => {
      const session = arg?.session ?? arg;
      if (!session?.pid) return;
      // Acknowledge the "needs check-in" flag for this turn.
      dismissed.set(session.sessionId, session.lastTurnEndTs ?? null);
      focusTerminalForSession(session);
      refresh();
    }),
    vscode.commands.registerCommand('claudeMonitor.resume', (arg) => {
      const session = arg?.session ?? arg;
      if (session) resumeSession(session);
    }),
    vscode.commands.registerCommand('claudeMonitor.rename', (arg) => {
      const session = arg?.session ?? arg;
      if (session) renameSession(session, refresh);
    }),
  );

  // Initial load includes recents.
  refreshAll();

  // Live: watch the sessions dir; debounce a full refresh (a session
  // ending/starting affects both active and recent groups).
  const dir = resolveSessionsDir();
  let debounceTimer = null;
  const scheduleRefreshAll = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(refreshAll, 250);
  };
  try {
    if (fs.existsSync(dir)) {
      const watcher = fs.watch(dir, { persistent: false }, scheduleRefreshAll);
      context.subscriptions.push({ dispose: () => watcher.close() });
    }
  } catch { /* watch failure non-fatal */ }

  const interval = vscode.workspace.getConfiguration('claudeMonitor').get('refreshIntervalMs') ?? 2000;
  const timer = setInterval(refresh, interval);
  context.subscriptions.push({ dispose: () => clearInterval(timer) });
}

function deactivate() {}

module.exports = { activate, deactivate };
