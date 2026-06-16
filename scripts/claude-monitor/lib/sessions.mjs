import { readdirSync, readFileSync, statSync, openSync, readSync, closeSync, existsSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';

export function renameSessionFile(filepath, newName) {
  const trimmed = (newName ?? '').trim();
  if (!trimmed) throw new Error('Session name cannot be empty');
  const data = JSON.parse(readFileSync(filepath, 'utf8'));
  data.name = trimmed;
  const tmp = filepath + '.tmp';
  writeFileSync(tmp, JSON.stringify(data));
  renameSync(tmp, filepath);
}

const DEFAULT_TAIL_BYTES = 2 * 1024 * 1024; // 2MB — covers permission-mode + a full turn

function readTail(filepath, tailBytes) {
  const size = statSync(filepath).size;
  if (size <= tailBytes) return readFileSync(filepath, 'utf8');
  const fd = openSync(filepath, 'r');
  try {
    const buf = Buffer.alloc(tailBytes);
    readSync(fd, buf, 0, tailBytes, size - tailBytes);
    let text = buf.toString('utf8');
    // Drop the partial first line — it likely starts mid-record.
    const nl = text.indexOf('\n');
    if (nl >= 0) text = text.slice(nl + 1);
    return text;
  } finally {
    closeSync(fd);
  }
}

// Locates the session's JSONL transcript across project dirs and returns
// the tail of it as text, or null if not found.
export function readSessionTranscriptTail(projectsDir, sessionId, { tailBytes = DEFAULT_TAIL_BYTES } = {}) {
  let dirs;
  try {
    dirs = readdirSync(projectsDir);
  } catch {
    return null;
  }
  for (const sub of dirs) {
    const candidate = join(projectsDir, sub, `${sessionId}.jsonl`);
    if (!existsSync(candidate)) continue;
    try {
      return readTail(candidate, tailBytes);
    } catch {
      continue;
    }
  }
  return null;
}

// Scans projectsDir/*/<sessionId>.jsonl for recent session transcripts,
// filters out the IDs in excludeSessionIds, sorts by mtime descending, and
// returns up to `limit` enriched entries (kind=recent, with name/cwd/recap/lastPrompt).
export function listRecentSessions(projectsDir, {
  excludeSessionIds = new Set(),
  limit = 10,
  tailBytes = DEFAULT_TAIL_BYTES,
} = {}) {
  let subdirs;
  try {
    subdirs = readdirSync(projectsDir);
  } catch {
    return [];
  }
  const candidates = [];
  for (const sub of subdirs) {
    let files;
    try { files = readdirSync(join(projectsDir, sub)); } catch { continue; }
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue;
      const sessionId = f.slice(0, -'.jsonl'.length);
      if (excludeSessionIds.has(sessionId)) continue;
      const filepath = join(projectsDir, sub, f);
      let mtime;
      try { mtime = statSync(filepath).mtimeMs; } catch { continue; }
      candidates.push({ sessionId, filepath, mtime });
    }
  }
  candidates.sort((a, b) => b.mtime - a.mtime);
  const top = candidates.slice(0, limit);
  return top.map(({ sessionId, filepath, mtime }) => {
    let text = '';
    try { text = readTail(filepath, tailBytes); } catch { /* ignore */ }
    const meta = extractSessionMeta(text);
    return {
      kind: 'recent',
      sessionId,
      filepath,
      mtime,
      name: meta.name,
      cwd: meta.cwd,
      recap: meta.recap,
      lastPrompt: meta.lastPrompt,
    };
  });
}

export function readPermissionModeForSession(projectsDir, sessionId, opts = {}) {
  const text = readSessionTranscriptTail(projectsDir, sessionId, opts);
  return text == null ? null : findLatestPermissionMode(text);
}


export function readAllSessions(dir, { now, isPidAlive, projectsDir }) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const sessions = [];
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    let raw;
    try {
      raw = JSON.parse(readFileSync(join(dir, entry), 'utf8'));
    } catch {
      continue;
    }
    const classified = classifySession(raw, { alive: isPidAlive(raw.pid), now });
    classified.filepath = join(dir, entry);
    if (projectsDir) {
      const text = readSessionTranscriptTail(projectsDir, raw.sessionId);
      classified.permissionMode = text == null ? null : findLatestPermissionMode(text);
      classified.recap = text == null ? null : findLatestRecap(text);
      const turn = text == null ? null : findLastTurn(text);
      classified.lastTurnDurationMs = turn ? turn.durationMs : null;
      classified.lastTurnEndTs = turn ? turn.endTs : null;
    }
    sessions.push(classified);
  }
  return sessions;
}

export function findLatestPermissionMode(text) {
  if (!text) return null;
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line || !line.includes('"permission-mode"')) continue;
    try {
      const d = JSON.parse(line);
      if (d && d.type === 'permission-mode' && typeof d.permissionMode === 'string') {
        return d.permissionMode;
      }
    } catch { /* skip malformed */ }
  }
  return null;
}

// One pass over a transcript tail, picking up the latest values for the
// fields needed to display a "Recent" entry. All fields are optional.
export function extractSessionMeta(text) {
  let name = null, cwd = null, recap = null, lastPrompt = null;
  if (!text) return { name, cwd, recap, lastPrompt };
  for (const line of text.split('\n')) {
    if (!line) continue;
    let d;
    try { d = JSON.parse(line); } catch { continue; }
    if (!d || typeof d !== 'object') continue;
    if (typeof d.cwd === 'string') cwd = d.cwd;
    if (d.type === 'custom-title' && typeof d.customTitle === 'string') name = d.customTitle;
    else if (d.type === 'last-prompt' && typeof d.lastPrompt === 'string') lastPrompt = d.lastPrompt;
    else if (d.type === 'system' && d.subtype === 'away_summary' && typeof d.content === 'string' && d.content.length) {
      recap = d.content;
    }
  }
  return { name, cwd, recap, lastPrompt };
}

// Claude Code's auto-generated "recap" — emitted as system/away_summary
// entries while a session is idle. Returns the most recent one's text.
export function findLatestRecap(text) {
  if (!text) return null;
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line || !line.includes('"away_summary"')) continue;
    try {
      const d = JSON.parse(line);
      if (d && d.type === 'system' && d.subtype === 'away_summary'
          && typeof d.content === 'string' && d.content.length) {
        return d.content;
      }
    } catch { /* skip malformed */ }
  }
  return null;
}

function isRealUserPrompt(d) {
  if (!d || d.type !== 'user' || d.isMeta || d.isSidechain) return false;
  const content = d.message?.content;
  if (typeof content !== 'string') return false;
  if (content.startsWith('<command-') || content.startsWith('<local-command-')) return false;
  return true;
}

// Measures the most recently completed turn: from the last real user prompt
// up to the last assistant entry that followed it. Returns { durationMs, endTs }
// (endTs in epoch ms) or null if the transcript has no complete turn.
export function findLastTurn(text) {
  if (!text) return null;
  let turnStart = null;
  let lastTurnStart = null;
  let lastTurnEnd = null;
  for (const line of text.split('\n')) {
    if (!line) continue;
    let d;
    try { d = JSON.parse(line); } catch { continue; }
    if (!d || typeof d !== 'object') continue;
    if (isRealUserPrompt(d)) {
      const t = Date.parse(d.timestamp);
      if (!Number.isNaN(t)) turnStart = t;
    } else if (d.type === 'assistant' && turnStart !== null) {
      const t = Date.parse(d.timestamp);
      if (!Number.isNaN(t)) {
        lastTurnStart = turnStart;
        lastTurnEnd = t;
      }
    }
  }
  if (lastTurnStart === null || lastTurnEnd === null) return null;
  return { durationMs: lastTurnEnd - lastTurnStart, endTs: lastTurnEnd };
}

export function shortenCwd(cwd, home) {
  if (!cwd) return '';
  if (cwd === home) return '~';
  if (cwd.startsWith(home + '/')) return '~' + cwd.slice(home.length);
  return cwd;
}

const STATUS_ORDER = { running: 0, waiting: 0, idle: 1, ended: 2, unknown: 3 };
const STATUS_COLOR = {
  running: '\x1b[32m',     // green
  waiting: '\x1b[33m',     // yellow
  idle: '\x1b[90m',        // gray
  ended: '\x1b[31m\x1b[2m', // dim red
  unknown: '\x1b[35m',     // magenta
};
const MODE_COLOR = {
  auto: '\x1b[31m\x1b[1m',     // bold red — yolo
  acceptEdits: '\x1b[36m',     // cyan — auto-accept edits
  default: '\x1b[90m',         // gray — normal
};
const RESET = '\x1b[0m';

function padRight(s, w) { return s.length >= w ? s : s + ' '.repeat(w - s.length); }

export function renderTable(sessions, { now, home, useColor }) {
  if (sessions.length === 0) {
    return 'No active Claude Code sessions.\n';
  }
  const sorted = [...sessions].sort((a, b) => {
    const ord = (STATUS_ORDER[a.displayStatus] ?? 99) - (STATUS_ORDER[b.displayStatus] ?? 99);
    if (ord !== 0) return ord;
    return (a.name ?? '').localeCompare(b.name ?? '');
  });

  const showMode = sorted.some((s) => 'permissionMode' in s);

  const rows = sorted.map((s) => ({
    name: s.name ?? '',
    status: s.displayStatus,
    mode: s.permissionMode ?? '—',
    detail: s.waitingFor ?? '',
    cwd: shortenCwd(s.cwd ?? '', home),
    age: formatAge(s.ageMs),
  }));

  const widths = {
    name: Math.max(4, ...rows.map((r) => r.name.length)),
    status: Math.max(6, ...rows.map((r) => r.status.length)),
    mode: Math.max(4, ...rows.map((r) => r.mode.length)),
    detail: Math.max(6, ...rows.map((r) => r.detail.length)),
    cwd: Math.max(3, ...rows.map((r) => r.cwd.length)),
    age: Math.max(3, ...rows.map((r) => r.age.length)),
  };

  const headerCells = [
    padRight('NAME', widths.name),
    padRight('STATUS', widths.status),
  ];
  if (showMode) headerCells.push(padRight('MODE', widths.mode));
  headerCells.push(
    padRight('DETAIL', widths.detail),
    padRight('CWD', widths.cwd),
    padRight('AGE', widths.age),
  );
  const header = headerCells.join('  ');

  const lines = [header];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const original = sorted[i];
    let statusCell = padRight(r.status, widths.status);
    if (useColor) {
      const color = STATUS_COLOR[original.displayStatus] ?? '';
      statusCell = `${color}${statusCell}${RESET}`;
    }
    let modeCell = padRight(r.mode, widths.mode);
    if (useColor && showMode) {
      const mc = MODE_COLOR[original.permissionMode] ?? '';
      if (mc) modeCell = `${mc}${modeCell}${RESET}`;
    }
    const rowCells = [
      padRight(r.name, widths.name),
      statusCell,
    ];
    if (showMode) rowCells.push(modeCell);
    rowCells.push(
      padRight(r.detail, widths.detail),
      padRight(r.cwd, widths.cwd),
      padRight(r.age, widths.age),
    );
    lines.push(rowCells.join('  '));
  }
  return lines.join('\n') + '\n';
}

export function isPidAliveDefault(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}


export function classifySession(raw, { alive, now }) {
  const name = raw.name ?? (raw.sessionId ? raw.sessionId.slice(0, 8) : 'unknown');
  let displayStatus;
  if (!alive) {
    displayStatus = 'ended';
  } else if (raw.status === 'busy') {
    displayStatus = 'running';
  } else if (raw.status === 'waiting') {
    displayStatus = 'waiting';
  } else if (raw.status === 'idle') {
    displayStatus = 'idle';
  } else {
    displayStatus = 'unknown';
  }
  const waitingFor = displayStatus === 'waiting' ? raw.waitingFor ?? null : null;
  const ageMs = raw.updatedAt ? now - raw.updatedAt : null;
  return {
    name,
    pid: raw.pid,
    sessionId: raw.sessionId,
    cwd: raw.cwd,
    displayStatus,
    waitingFor,
    ageMs,
  };
}

export function formatAge(ms) {
  if (ms === null || ms === undefined) return '—';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}
