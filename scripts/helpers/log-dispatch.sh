#!/bin/bash
# Appends a dispatch record to logs/dispatches.json for dashboard visibility.
# Usage: log-dispatch.sh <type> <task> [workspace] [model] [status] [duration_secs]
#
# Examples:
#   log-dispatch.sh pr-review "Review diemaster-status#6" strokmatic.diemaster.services.status haiku complete 12
#   log-dispatch.sh pr-fetch "Fetched 7 open PRs across 96 repos" orchestrator none complete 45
#   log-dispatch.sh cron "Morning briefing" orchestrator none complete 30

set -e

ORCHESTRATOR_HOME="${ORCHESTRATOR_HOME:-$HOME/JARVIS}"
DISPATCHES_FILE="$ORCHESTRATOR_HOME/logs/dispatches.json"

TYPE="${1:?Usage: log-dispatch.sh <type> <task> [workspace] [model] [status] [duration_secs]}"
TASK="${2:?Missing task description}"
WORKSPACE="${3:-orchestrator}"
MODEL="${4:-none}"
STATUS="${5:-complete}"
DURATION="${6:-0}"

mkdir -p "$(dirname "$DISPATCHES_FILE")"

node -e "
const fs = require('fs');
const file = process.argv[1];
const [type, task, workspace, model, status, duration] = process.argv.slice(2);
const now = new Date().toISOString();

let dispatches = [];
try {
    dispatches = JSON.parse(fs.readFileSync(file, 'utf-8'));
    if (!Array.isArray(dispatches)) dispatches = [];
} catch {}

const record = { type, task, workspace, model, status, created_at: now, started_at: now, completed_at: now };
const dur = parseInt(duration);
if (dur > 0) record.duration_seconds = dur;

dispatches.push(record);
fs.writeFileSync(file, JSON.stringify(dispatches, null, 2));
" "$DISPATCHES_FILE" "$TYPE" "$TASK" "$WORKSPACE" "$MODEL" "$STATUS" "$DURATION"
