#!/usr/bin/env node
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readAllSessions, renderTable, isPidAliveDefault } from './lib/sessions.mjs';

function parseArgs(argv) {
  const args = {
    once: false,
    interval: 2000,
    useColor: process.stdout.isTTY,
    sessionsDir: null,
    projectsDir: null,
    noMode: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--once') args.once = true;
    else if (a === '--no-color') args.useColor = false;
    else if (a === '--no-mode') args.noMode = true;
    else if (a === '--interval') args.interval = Math.max(250, Number(argv[++i]) || 2000);
    else if (a === '--sessions-dir') args.sessionsDir = argv[++i];
    else if (a === '--projects-dir') args.projectsDir = argv[++i];
    else if (a === '-h' || a === '--help') {
      process.stdout.write(`claude-monitor — show status of all running Claude Code sessions

Usage: node monitor.mjs [options]

Options:
  --once               Print once and exit (no live refresh)
  --interval <ms>      Refresh interval in ms (default 2000)
  --no-color           Disable ANSI colors
  --no-mode            Skip permission-mode lookup (faster, hides MODE column)
  --sessions-dir <p>   Override session dir (default ~/.claude/sessions)
  --projects-dir <p>   Override projects dir (default ~/.claude/projects)
  -h, --help           Show this message
`);
      process.exit(0);
    }
  }
  return args;
}

function tick({ sessionsDir, projectsDir, home, useColor }) {
  const now = Date.now();
  const sessions = readAllSessions(sessionsDir, {
    now,
    isPidAlive: isPidAliveDefault,
    projectsDir,
  });
  const table = renderTable(sessions, { now, home, useColor });
  if (!process.stdout.isTTY || process.env.NO_CLEAR === '1') {
    process.stdout.write(table);
    return;
  }
  // Clear screen + move cursor home
  process.stdout.write('\x1b[2J\x1b[H');
  const ts = new Date(now).toLocaleTimeString();
  process.stdout.write(`claude-monitor — ${ts}\n\n${table}`);
}

const args = parseArgs(process.argv.slice(2));
const home = homedir();
const sessionsDir = args.sessionsDir ?? join(home, '.claude', 'sessions');
const projectsDir = args.noMode ? null : (args.projectsDir ?? join(home, '.claude', 'projects'));
const ctx = { sessionsDir, projectsDir, home, useColor: args.useColor };

if (args.once) {
  tick(ctx);
} else {
  tick(ctx);
  setInterval(() => tick(ctx), args.interval);
  process.on('SIGINT', () => process.exit(0));
}
