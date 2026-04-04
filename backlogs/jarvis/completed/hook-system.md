# Spec: Hook System for Orchestrator Events

**Status:** Idea
**Type:** Infrastructure Enhancement

## Overview

Implement a Claude Code hook system for the orchestrator's own `.claude/settings.json` to provide automated event-driven workflows around task dispatching, backlog management, and session activities. This system will mirror patterns from PAI's 20-hook event architecture, adapting them to orchestration-specific use cases.

The hook system will enable:
- **Pre-dispatch context loading** — Ensure workspace backlog is fresh before dispatching tasks
- **Post-dispatch notifications** — Alert operator when tasks complete or fail
- **Session startup dashboard** — Display orchestrator health summary at session start
- **Security validation** — Prevent accidental dispatch to non-existent workspaces
- **Activity tracking** — Record dispatch events for analysis and reporting

## Design

### Hook Architecture

Claude Code supports five hook event types:
1. **PreToolUse** — Runs before a tool executes; can block execution with `{decision: "block", reason: "..."}`
2. **PostToolUse** — Runs after a tool completes; receives tool result
3. **SessionStart** — Runs once when a Claude Code session begins
4. **SessionEnd** — Runs when a session terminates
5. **UserPromptSubmit** — Runs when user submits a prompt

For the orchestrator, we'll focus on:
- **PreToolUse** hooks for `mcp__backlog-manager__dispatch_task` and workspace validation
- **PostToolUse** hooks for completion tracking and changelog verification
- **SessionStart** hooks for dashboard display and context loading

### Hook Execution Model

Hooks are shell commands that:
- Receive JSON input via stdin (tool name, arguments, session metadata)
- Output to stdout (visible to Claude) and stderr (hidden from Claude, for diagnostics)
- Return exit code 0 for success, non-zero for failure
- For PreToolUse: can return JSON `{decision: "block"|"allow", reason: "..."}` to gate execution

### Data Sources

Hooks will read from:
- `logs/dispatches.json` — Task dispatch history and status
- `config/workspaces.json` — Workspace definitions
- `backlog/*.md` — Per-workspace task backlogs
- `changelogs/*.md` — Per-workspace changelogs (if using Keep a Changelog format)

## Implementation Steps

### Phase 1: Foundation (Core Hook Infrastructure)

1. **Create `.claude/hooks/` directory structure**
   ```bash
   mkdir -p /home/teruel/JARVIS/.claude/hooks
   mkdir -p /home/teruel/JARVIS/.claude/hooks/lib
   ```

2. **Create shared utility library** (`hooks/lib/utils.sh`)
   - JSON parsing helpers (using `jq`)
   - Workspace validation functions
   - Dispatch log reader/writer
   - Timestamp formatting

3. **Update `.claude/settings.json`** to register hooks
   - Start with PreToolUse for `dispatch_task`
   - Add SessionStart for dashboard

### Phase 2: Pre-Dispatch Validation Hooks

4. **Implement `PreDispatchValidator.hook.sh`**
   - Validates workspace exists in `config/workspaces.json`
   - Checks workspace path is accessible
   - Verifies model selection is valid (references `config/models.json`)
   - Blocks dispatch if validation fails

5. **Implement `BacklogPreloader.hook.sh`**
   - Syncs workspace backlog from `<workspace>/.claude/backlog.md` to central `backlog/*.md`
   - Updates central backlog with any local edits from collaborators
   - Runs as PreToolUse for `list_backlog_tasks` and `dispatch_task`

### Phase 3: Post-Dispatch Tracking Hooks

6. **Implement `DispatchTracker.hook.sh`**
   - Records dispatch event to `logs/dispatches.json` with timestamp, workspace, model, task description
   - Increments dispatch counter in `logs/stats.json`
   - Runs as PostToolUse for `dispatch_task`

7. **Implement `CompletionNotifier.hook.sh`**
   - Detects task completion (by polling `logs/dispatches.json` or via a completion signal)
   - Sends notification (stdout message, or integrates with ntfy/Discord if available)
   - Runs as PostToolUse for `complete_backlog_task`

8. **Implement `ChangelogVerifier.hook.sh`**
   - Checks that a changelog entry was added for the completed task
   - Warns if changelog is missing (non-blocking)
   - Runs as PostToolUse for `complete_backlog_task`

### Phase 4: Session Lifecycle Hooks

9. **Implement `DashboardSummary.hook.sh`**
   - Displays orchestrator health dashboard at session start
   - Shows: active dispatches, pending task counts per workspace, recent completion stats
   - Reads from `logs/dispatches.json`, `backlog/*.md`, `changelogs/*.md`
   - Runs as SessionStart

10. **Implement `SessionCleanup.hook.sh`**
    - Archives old dispatch logs (e.g., move entries older than 30 days to `logs/archive/`)
    - Prunes stale temp files
    - Runs as SessionEnd

### Phase 5: Advanced Hooks (Optional Enhancements)

11. **Implement `ModelUsageTracker.hook.sh`**
    - Logs model selection for each dispatch
    - Aggregates usage stats for cost estimation
    - Runs as PostToolUse for `dispatch_task`

12. **Implement `FailureAnalyzer.hook.sh`**
    - Detects failed tasks (status = `failed` in dispatches.json)
    - Captures error logs and suggests remediation
    - Runs as PostToolUse for task failure events

## Hook Definitions

### 1. PreDispatchValidator Hook

**File:** `.claude/hooks/PreDispatchValidator.hook.sh`

**Purpose:** Validate workspace and model before dispatching a task.

**Trigger:** PreToolUse, matcher: `mcp__backlog-manager__dispatch_task`

**Config:**
```json
{
  "matcher": "mcp__backlog-manager__dispatch_task",
  "hooks": [
    {
      "type": "command",
      "command": "/home/teruel/JARVIS/.claude/hooks/PreDispatchValidator.hook.sh"
    }
  ]
}
```

**Script:**
```bash
#!/usr/bin/env bash
# PreDispatchValidator.hook.sh - Validate dispatch parameters

set -euo pipefail

ORCHESTRATOR_HOME="${ORCHESTRATOR_HOME:-$HOME/claude-orchestrator}"

# Read hook input from stdin
INPUT=$(cat)
WORKSPACE=$(echo "$INPUT" | jq -r '.tool_input.workspace // empty')
MODEL=$(echo "$INPUT" | jq -r '.tool_input.model // empty')

# Validate workspace exists
if ! jq -e ".workspaces[\"$WORKSPACE\"]" "$ORCHESTRATOR_HOME/config/workspaces.json" >/dev/null 2>&1; then
  echo "❌ Workspace '$WORKSPACE' not found in config/workspaces.json" >&2
  echo '{"decision": "block", "reason": "Workspace not configured"}'
  exit 0
fi

# Validate workspace path is accessible
WORKSPACE_PATH=$(jq -r ".workspaces[\"$WORKSPACE\"].path" "$ORCHESTRATOR_HOME/config/workspaces.json")
if [ ! -d "$WORKSPACE_PATH" ]; then
  echo "⚠️ Workspace path does not exist: $WORKSPACE_PATH" >&2
  echo '{"decision": "block", "reason": "Workspace path not accessible"}'
  exit 0
fi

# Validate model if specified
if [ -n "$MODEL" ]; then
  if ! grep -q "$MODEL" "$ORCHESTRATOR_HOME/config/models.json" 2>/dev/null; then
    echo "⚠️ Model '$MODEL' not found in config/models.json" >&2
    echo '{"decision": "allow", "reason": "Unknown model, proceeding with caution"}'
    exit 0
  fi
fi

echo "✅ Dispatch validation passed for workspace '$WORKSPACE'" >&2
echo '{"decision": "allow"}'
exit 0
```

---

### 2. BacklogPreloader Hook

**File:** `.claude/hooks/BacklogPreloader.hook.sh`

**Purpose:** Sync workspace-local backlog changes before listing or dispatching tasks.

**Trigger:** PreToolUse, matcher: `mcp__backlog-manager__list_backlog_tasks|mcp__backlog-manager__dispatch_task`

**Config:**
```json
{
  "matcher": "mcp__backlog-manager__list_backlog_tasks",
  "hooks": [
    {
      "type": "command",
      "command": "/home/teruel/JARVIS/.claude/hooks/BacklogPreloader.hook.sh"
    }
  ]
},
{
  "matcher": "mcp__backlog-manager__dispatch_task",
  "hooks": [
    {
      "type": "command",
      "command": "/home/teruel/JARVIS/.claude/hooks/BacklogPreloader.hook.sh"
    }
  ]
}
```

**Script:**
```bash
#!/usr/bin/env bash
# BacklogPreloader.hook.sh - Sync workspace backlog from local .claude/backlog.md

set -euo pipefail

ORCHESTRATOR_HOME="${ORCHESTRATOR_HOME:-$HOME/claude-orchestrator}"

INPUT=$(cat)
WORKSPACE=$(echo "$INPUT" | jq -r '.tool_input.workspace // empty')

if [ -z "$WORKSPACE" ]; then
  echo "⚠️ No workspace specified, skipping backlog sync" >&2
  exit 0
fi

# Get workspace path
WORKSPACE_PATH=$(jq -r ".workspaces[\"$WORKSPACE\"].path" "$ORCHESTRATOR_HOME/config/workspaces.json" 2>/dev/null || echo "")
if [ -z "$WORKSPACE_PATH" ] || [ ! -d "$WORKSPACE_PATH" ]; then
  echo "⚠️ Workspace path not found for '$WORKSPACE', skipping sync" >&2
  exit 0
fi

LOCAL_BACKLOG="$WORKSPACE_PATH/.claude/backlog.md"
CENTRAL_BACKLOG="$ORCHESTRATOR_HOME/backlog/$WORKSPACE.md"

if [ ! -f "$LOCAL_BACKLOG" ]; then
  echo "📝 No local backlog at $LOCAL_BACKLOG" >&2
  exit 0
fi

# Compare timestamps and sync if local is newer
if [ -f "$CENTRAL_BACKLOG" ]; then
  LOCAL_MTIME=$(stat -c %Y "$LOCAL_BACKLOG" 2>/dev/null || stat -f %m "$LOCAL_BACKLOG" 2>/dev/null)
  CENTRAL_MTIME=$(stat -c %Y "$CENTRAL_BACKLOG" 2>/dev/null || stat -f %m "$CENTRAL_BACKLOG" 2>/dev/null)

  if [ "$LOCAL_MTIME" -gt "$CENTRAL_MTIME" ]; then
    echo "🔄 Syncing newer local backlog from workspace '$WORKSPACE'" >&2
    cp "$LOCAL_BACKLOG" "$CENTRAL_BACKLOG"
  fi
else
  echo "📋 Importing backlog from workspace '$WORKSPACE'" >&2
  mkdir -p "$ORCHESTRATOR_HOME/backlog"
  cp "$LOCAL_BACKLOG" "$CENTRAL_BACKLOG"
fi

exit 0
```

---

### 3. DispatchTracker Hook

**File:** `.claude/hooks/DispatchTracker.hook.sh`

**Purpose:** Log dispatch events for analytics and dashboard display.

**Trigger:** PostToolUse, matcher: `mcp__backlog-manager__dispatch_task`

**Config:**
```json
{
  "matcher": "mcp__backlog-manager__dispatch_task",
  "hooks": [
    {
      "type": "command",
      "command": "/home/teruel/JARVIS/.claude/hooks/DispatchTracker.hook.sh"
    }
  ]
}
```

**Script:**
```bash
#!/usr/bin/env bash
# DispatchTracker.hook.sh - Record dispatch events

set -euo pipefail

ORCHESTRATOR_HOME="${ORCHESTRATOR_HOME:-$HOME/claude-orchestrator}"
DISPATCH_LOG="$ORCHESTRATOR_HOME/logs/dispatches.json"

INPUT=$(cat)
WORKSPACE=$(echo "$INPUT" | jq -r '.tool_input.workspace // empty')
TASK=$(echo "$INPUT" | jq -r '.tool_input.task // empty')
MODEL=$(echo "$INPUT" | jq -r '.tool_input.model // "auto"')
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

mkdir -p "$ORCHESTRATOR_HOME/logs"

# Read existing log or initialize
if [ -f "$DISPATCH_LOG" ]; then
  DISPATCHES=$(cat "$DISPATCH_LOG")
else
  DISPATCHES="[]"
fi

# Append new dispatch event
NEW_ENTRY=$(jq -n \
  --arg ws "$WORKSPACE" \
  --arg task "$TASK" \
  --arg model "$MODEL" \
  --arg ts "$TIMESTAMP" \
  '{workspace: $ws, task: $task, model: $model, timestamp: $ts, status: "dispatched"}')

echo "$DISPATCHES" | jq ". += [$NEW_ENTRY]" > "$DISPATCH_LOG"

echo "📊 Dispatch logged: $WORKSPACE @ $TIMESTAMP" >&2
exit 0
```

---

### 4. DashboardSummary Hook

**File:** `.claude/hooks/DashboardSummary.hook.sh`

**Purpose:** Display orchestrator health dashboard at session start.

**Trigger:** SessionStart

**Config:**
```json
{
  "hooks": [
    {
      "type": "command",
      "command": "/home/teruel/JARVIS/.claude/hooks/DashboardSummary.hook.sh"
    }
  ]
}
```

**Script:**
```bash
#!/usr/bin/env bash
# DashboardSummary.hook.sh - Display orchestrator health at session start

set -euo pipefail

ORCHESTRATOR_HOME="${ORCHESTRATOR_HOME:-$HOME/claude-orchestrator}"

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  CLAUDE ORCHESTRATOR - Session Dashboard"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# Count pending tasks per workspace
BACKLOG_DIR="$ORCHESTRATOR_HOME/backlog"
if [ -d "$BACKLOG_DIR" ]; then
  echo "📋 Pending Tasks by Workspace:"
  for backlog in "$BACKLOG_DIR"/*.md; do
    [ -f "$backlog" ] || continue
    WORKSPACE=$(basename "$backlog" .md)
    PENDING=$(grep -c "^- \[ \]" "$backlog" 2>/dev/null || echo 0)
    if [ "$PENDING" -gt 0 ]; then
      echo "   • $WORKSPACE: $PENDING task(s)"
    fi
  done
  echo ""
fi

# Show recent dispatches
DISPATCH_LOG="$ORCHESTRATOR_HOME/logs/dispatches.json"
if [ -f "$DISPATCH_LOG" ]; then
  RECENT_COUNT=$(jq '. | length' "$DISPATCH_LOG" 2>/dev/null || echo 0)
  echo "🚀 Recent Dispatches: $RECENT_COUNT total"

  # Last 3 dispatches
  jq -r '.[-3:] | reverse | .[] | "   • \(.workspace) [\(.status)] - \(.timestamp)"' "$DISPATCH_LOG" 2>/dev/null || true
  echo ""
fi

# Show active sessions (if tracked)
if [ -f "$ORCHESTRATOR_HOME/logs/active-sessions.json" ]; then
  ACTIVE=$(jq '. | length' "$ORCHESTRATOR_HOME/logs/active-sessions.json" 2>/dev/null || echo 0)
  if [ "$ACTIVE" -gt 0 ]; then
    echo "⚡ Active Sessions: $ACTIVE"
    echo ""
  fi
fi

echo "═══════════════════════════════════════════════════════════════"
echo ""

exit 0
```

---

### 5. CompletionNotifier Hook

**File:** `.claude/hooks/CompletionNotifier.hook.sh`

**Purpose:** Notify when a task completes.

**Trigger:** PostToolUse, matcher: `mcp__backlog-manager__complete_backlog_task`

**Config:**
```json
{
  "matcher": "mcp__backlog-manager__complete_backlog_task",
  "hooks": [
    {
      "type": "command",
      "command": "/home/teruel/JARVIS/.claude/hooks/CompletionNotifier.hook.sh"
    }
  ]
}
```

**Script:**
```bash
#!/usr/bin/env bash
# CompletionNotifier.hook.sh - Notify on task completion

set -euo pipefail

INPUT=$(cat)
WORKSPACE=$(echo "$INPUT" | jq -r '.tool_input.workspace // empty')
TASK_ID=$(echo "$INPUT" | jq -r '.tool_input.task_id // empty')

if [ -z "$WORKSPACE" ] || [ -z "$TASK_ID" ]; then
  echo "⚠️ Missing workspace or task_id, skipping notification" >&2
  exit 0
fi

echo ""
echo "✅ TASK COMPLETED"
echo "   Workspace: $WORKSPACE"
echo "   Task ID: $TASK_ID"
echo "   Completed at: $(date '+%Y-%m-%d %H:%M:%S')"
echo ""

# Optional: Send external notification (ntfy, Discord, etc.)
# Uncomment if notification infrastructure is available:
# if command -v curl >/dev/null 2>&1; then
#   curl -d "Task completed: $WORKSPACE - $TASK_ID" https://ntfy.sh/orchestrator-alerts 2>/dev/null || true
# fi

exit 0
```

---

### 6. ChangelogVerifier Hook

**File:** `.claude/hooks/ChangelogVerifier.hook.sh`

**Purpose:** Verify changelog entry exists for completed task.

**Trigger:** PostToolUse, matcher: `mcp__backlog-manager__complete_backlog_task`

**Config:**
```json
{
  "matcher": "mcp__backlog-manager__complete_backlog_task",
  "hooks": [
    {
      "type": "command",
      "command": "/home/teruel/JARVIS/.claude/hooks/ChangelogVerifier.hook.sh"
    }
  ]
}
```

**Script:**
```bash
#!/usr/bin/env bash
# ChangelogVerifier.hook.sh - Check changelog entry exists

set -euo pipefail

ORCHESTRATOR_HOME="${ORCHESTRATOR_HOME:-$HOME/claude-orchestrator}"

INPUT=$(cat)
WORKSPACE=$(echo "$INPUT" | jq -r '.tool_input.workspace // empty')
CHANGELOG="$ORCHESTRATOR_HOME/changelogs/$WORKSPACE.md"

if [ -z "$WORKSPACE" ]; then
  exit 0
fi

# Get workspace path
WORKSPACE_PATH=$(jq -r ".workspaces[\"$WORKSPACE\"].path" "$ORCHESTRATOR_HOME/config/workspaces.json" 2>/dev/null || echo "")
if [ -n "$WORKSPACE_PATH" ] && [ -d "$WORKSPACE_PATH" ]; then
  WORKSPACE_CHANGELOG="$WORKSPACE_PATH/CHANGELOG.md"
  if [ -f "$WORKSPACE_CHANGELOG" ]; then
    CHANGELOG="$WORKSPACE_CHANGELOG"
  fi
fi

if [ ! -f "$CHANGELOG" ]; then
  echo "⚠️ No changelog found for workspace '$WORKSPACE'" >&2
  echo "   Consider adding an entry to document this change." >&2
  exit 0
fi

# Check if changelog was modified today
TODAY=$(date +%Y-%m-%d)
if grep -q "## $TODAY" "$CHANGELOG" 2>/dev/null; then
  echo "✅ Changelog entry found for today ($TODAY)" >&2
else
  echo "⚠️ No changelog entry for today. Remember to document changes!" >&2
fi

exit 0
```

---

## Complete settings.json Hook Configuration

**File:** `.claude/settings.json`

```json
{
  "permissions": {
    "allow": [
      "Bash",
      "Read",
      "Write",
      "Edit",
      "Glob",
      "Grep",
      "mcp__*"
    ]
  },
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "/home/teruel/JARVIS/.claude/hooks/DashboardSummary.hook.sh"
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "mcp__backlog-manager__dispatch_task",
        "hooks": [
          {
            "type": "command",
            "command": "/home/teruel/JARVIS/.claude/hooks/PreDispatchValidator.hook.sh"
          },
          {
            "type": "command",
            "command": "/home/teruel/JARVIS/.claude/hooks/BacklogPreloader.hook.sh"
          }
        ]
      },
      {
        "matcher": "mcp__backlog-manager__list_backlog_tasks",
        "hooks": [
          {
            "type": "command",
            "command": "/home/teruel/JARVIS/.claude/hooks/BacklogPreloader.hook.sh"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "mcp__backlog-manager__dispatch_task",
        "hooks": [
          {
            "type": "command",
            "command": "/home/teruel/JARVIS/.claude/hooks/DispatchTracker.hook.sh"
          }
        ]
      },
      {
        "matcher": "mcp__backlog-manager__complete_backlog_task",
        "hooks": [
          {
            "type": "command",
            "command": "/home/teruel/JARVIS/.claude/hooks/CompletionNotifier.hook.sh"
          },
          {
            "type": "command",
            "command": "/home/teruel/JARVIS/.claude/hooks/ChangelogVerifier.hook.sh"
          }
        ]
      }
    ]
  }
}
```

---

## Edge Cases & Risks

### 1. Hook Execution Failures
**Risk:** Hook script crashes or times out, blocking tool execution (for PreToolUse hooks).

**Mitigation:**
- Add timeout guards to all hooks (5-10 second max execution)
- Wrap hook logic in try-catch (bash `set -euo pipefail` + trap handlers)
- For PreToolUse hooks: default to `{"decision": "allow"}` on error
- Log all hook errors to `logs/hook-errors.log` for debugging

### 2. Workspace Path Changes
**Risk:** Workspace path in `config/workspaces.json` changes, breaking BacklogPreloader.

**Mitigation:**
- Validate paths exist before syncing
- Gracefully skip sync if path is inaccessible (log warning, don't fail)
- Add workspace path validation to PreDispatchValidator hook

### 3. Concurrent Modifications
**Risk:** Multiple sessions or hooks modify `logs/dispatches.json` simultaneously, causing corruption.

**Mitigation:**
- Use atomic writes (write to temp file, then `mv`)
- Add file locking with `flock` (Linux) or equivalent
- Consider switching to append-only log format (JSONL instead of JSON array)

### 4. Hook Output Pollution
**Risk:** Hooks output too much to stdout, cluttering Claude's context with debug messages.

**Mitigation:**
- Reserve stdout for user-facing messages only
- Use stderr for all diagnostic/debug output (Claude doesn't see stderr)
- Keep stdout messages concise and actionable

### 5. Missing Dependencies
**Risk:** Hook scripts assume `jq`, `curl`, or other tools that may not be installed.

**Mitigation:**
- Check for dependencies at hook start: `command -v jq >/dev/null || { echo "jq not found" >&2; exit 1; }`
- Add dependency check to setup/installation script
- Provide fallback behavior where possible (e.g., skip notification if `curl` missing)

### 6. Hook Order Dependencies
**Risk:** Hooks run in undefined order when multiple are registered for the same event.

**Mitigation:**
- Claude Code executes hooks in the order listed in `settings.json`
- Place critical hooks first (e.g., PreDispatchValidator before BacklogPreloader)
- Document execution order in comments within settings.json

### 7. Security: Command Injection
**Risk:** Hooks process user input (workspace names, task descriptions) without sanitization.

**Mitigation:**
- Always use `jq -r` to safely extract JSON fields
- Never use `eval` or unquoted variable expansion in hooks
- Validate workspace names against known set in `config/workspaces.json`

---

## Dependencies & Prerequisites

### System Requirements
- **bash** (≥4.0) — Hook execution shell
- **jq** (≥1.5) — JSON parsing and manipulation
- **coreutils** — Standard Unix tools (grep, stat, date, etc.)
- **flock** (optional) — File locking for concurrent write safety

### Orchestrator Components
- **config/workspaces.json** — Must exist and define workspace paths
- **config/models.json** — Must exist for model validation
- **logs/** directory — Must be writable for dispatch/event logging
- **backlog/** directory — Must exist for backlog sync

### MCP Servers
- **backlog-manager** — Provides `dispatch_task`, `complete_backlog_task`, `list_backlog_tasks` tools
- **changelog-writer** (optional) — Enables changelog verification hooks

### External Services (Optional)
- **ntfy.sh** or **Discord webhook** — For external notifications in CompletionNotifier
- Configured in `settings.json` under a future `notifications` section (similar to PAI)

---

## Testing Plan

### Unit Tests (per-hook)
1. **PreDispatchValidator**
   - Test with valid workspace → `{"decision": "allow"}`
   - Test with invalid workspace → `{"decision": "block"}`
   - Test with missing config file → graceful error

2. **BacklogPreloader**
   - Test sync when local backlog is newer
   - Test skip when central backlog is up-to-date
   - Test behavior when workspace path doesn't exist

3. **DispatchTracker**
   - Test log creation from scratch
   - Test append to existing log
   - Test JSON structure integrity after multiple writes

### Integration Tests
1. **End-to-end dispatch flow**
   - Start session → DashboardSummary displays
   - Call `dispatch_task` → PreDispatchValidator runs → BacklogPreloader syncs → DispatchTracker logs
   - Call `complete_backlog_task` → CompletionNotifier fires → ChangelogVerifier checks

2. **Concurrent dispatch test**
   - Launch multiple dispatches in parallel (via background tasks)
   - Verify `dispatches.json` integrity (no missing/corrupted entries)

3. **Failure recovery test**
   - Simulate hook timeout (add sleep in hook script)
   - Verify PreToolUse hook doesn't block indefinitely
   - Verify error is logged to `logs/hook-errors.log`

### Manual Testing
1. Create fresh orchestrator instance
2. Install hooks via setup script
3. Dispatch task to test workspace
4. Verify dashboard shows correct pending count
5. Complete task and verify notification + changelog check

---

## Future Enhancements

### 1. Real-time Dispatch Monitoring
- Add WebSocket hook that pushes dispatch events to browser-based dashboard
- Inspired by PAI's UpdateTabTitle hook (but for web UI instead of terminal tabs)

### 2. Auto-Remediation Hooks
- If ChangelogVerifier finds missing entry, auto-generate template changelog entry
- If PreDispatchValidator detects missing workspace config, offer to run workspace init

### 3. Model Usage Cost Tracking
- Extend DispatchTracker to estimate cost per dispatch based on model pricing
- Aggregate weekly/monthly cost reports in SessionStart dashboard

### 4. Task Lifecycle State Machine
- Move from simple "dispatched/completed" to full state machine:
  - `pending → queued → running → verifying → completed|failed`
- Add hooks for each state transition (similar to PAI's WorkCompletionLearning)

### 5. Inter-Workspace Dependency Tracking
- Add PreToolUse hook that checks if workspace A depends on workspace B
- Block dispatch to A if B has pending critical tasks
- Read dependency graph from `config/workspace-dependencies.json`

### 6. Voice Notifications (PAI Integration)
- If orchestrator is running inside PAI environment, use PAI's voice notification system
- Announce task completions via TTS (similar to PAI's VoiceGate hook)

---

## References

### PAI Hook System Patterns
- **LoadContext.hook.ts** — Session startup context injection (inspired DashboardSummary)
- **QuestionAnswered.hook.ts** — PostToolUse state restoration (inspired CompletionNotifier)
- **SecurityValidator.hook.ts** — PreToolUse blocking hook (inspired PreDispatchValidator)
- **AlgorithmTracker.hook.ts** — PostToolUse event logging (inspired DispatchTracker)
- **WorkCompletionLearning.hook.ts** — SessionEnd analytics (future enhancement for orchestrator)

### Hook Documentation
- [Claude Code Hooks Reference](https://docs.anthropic.com/claude-code/hooks)
- Hook input schema: `{session_id, tool_name, tool_input, ...}`
- Hook output for PreToolUse: `{decision: "allow"|"block", reason: string}`

---

## Success Metrics

1. **Hook Reliability:** >99% success rate (measured via hook error logs)
2. **Execution Speed:** SessionStart hooks complete in <500ms
3. **Dispatch Accuracy:** 0 invalid dispatches to non-existent workspaces (blocked by PreDispatchValidator)
4. **Backlog Sync Coverage:** >90% of workspace backlogs auto-synced before dispatch
5. **Notification Delivery:** 100% of completed tasks trigger CompletionNotifier
6. **Developer Experience:** Dashboard summary reduces time-to-context by 30%

---

## Migration Path (Rollout Strategy)

### Stage 1: Opt-in Alpha (Week 1)
- Create `.claude/hooks/` directory
- Implement DashboardSummary hook only
- No PreToolUse hooks (non-blocking changes only)
- Collect feedback on dashboard format

### Stage 2: Validation Layer (Week 2)
- Add PreDispatchValidator hook
- Test on non-production workspaces
- Monitor block rate and false positives

### Stage 3: Full Deployment (Week 3)
- Enable all hooks in `settings.json`
- Document hook behavior in `CLAUDE.md`
- Add troubleshooting guide to `docs/`

### Stage 4: Optimization (Week 4+)
- Profile hook execution time
- Optimize slow hooks (e.g., parallel jq processing)
- Add advanced features (cost tracking, voice notifications)

---

## Conclusion

The hook system transforms the orchestrator from a passive task queue into an intelligent, self-monitoring system. By leveraging Claude Code's event-driven architecture and PAI's proven hook patterns, we achieve:

- **Proactive validation** (prevent errors before they happen)
- **Automatic context loading** (no manual backlog syncing)
- **Real-time feedback** (instant notifications on completion)
- **Long-term analytics** (dispatch logs enable future ML-driven optimizations)

This system lays the groundwork for advanced features like auto-remediation, cost optimization, and eventually, a fully autonomous orchestration loop inspired by PAI's Algorithm Self-Upgrade pattern.
