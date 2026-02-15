# Spec: Parallel Workspace Dispatch

**Status:** Idea
**Type:** Feature Enhancement

## Overview

Enable the orchestrator to dispatch tasks to multiple workspaces simultaneously instead of sequentially. This feature allows for coordinated parallel execution across workspaces with centralized logging, resource management, and failure isolation. Inspired by PAI's loop mode parallel agent execution (algorithm.ts with `-a` flag supporting 1-16 parallel agents).

**Key Benefits:**
- Reduce total execution time when dispatching independent tasks across multiple workspaces
- Better utilize API rate limits and available concurrency
- Maintain coordinated logging and status tracking across parallel executions
- Enable batch operations for routine maintenance tasks (updates, audits, etc.)

## Design

### Architecture

**Batch Dispatch Flow:**
```
User/Scheduler → task-dispatcher MCP (dispatch_batch)
                      ↓
                 Create batch record in logs/dispatches.json
                      ↓
                 Generate batch execution script
                      ↓
                 Launch parallel Claude Code subprocesses
                      ↓
          [Workspace 1]  [Workspace 2]  [Workspace 3]  ...
                 ↓              ↓              ↓
          Individual logs with batch_id reference
                      ↓
                 Aggregate results → batch status update
```

**Key Components:**

1. **task-dispatcher MCP** (`/home/teruel/claude-orchestrator/mcp-servers/task-dispatcher/index.js`)
   - New tool: `dispatch_batch` — accepts array of workspace+task pairs
   - New tool: `get_batch_status` — query batch execution status
   - Generates shell script for parallel execution coordination
   - Writes batch metadata to `logs/dispatches.json`

2. **Batch Executor Script** (`/home/teruel/claude-orchestrator/scripts/execute-batch.sh`)
   - Spawns N parallel Claude Code subprocesses (configurable concurrency limit)
   - Manages process lifecycle and captures exit codes
   - Coordinates output to individual per-workspace log files
   - Updates batch status in real-time

3. **Dispatch Log Schema Extension** (`/home/teruel/claude-orchestrator/logs/dispatches.json`)
   - Add `batch_id` field to individual dispatches
   - Add batch-level entries tracking overall batch state
   - Store concurrency settings and execution timeline

4. **Configuration** (`/home/teruel/claude-orchestrator/config/orchestrator/dispatcher.json` — new file)
   - Max parallel workers (default: 4, respects API limits)
   - Per-workspace concurrency locks (prevent multiple simultaneous dispatches to same workspace)
   - Timeout settings for batch operations
   - Retry policy for failed batch members

### Data Model

**Batch Dispatch Entry:**
```json
{
  "id": "batch-1739617800-abc123",
  "type": "batch",
  "status": "running",
  "created_at": "2026-02-15T16:30:00Z",
  "updated_at": "2026-02-15T16:32:15Z",
  "started_at": "2026-02-15T16:30:02Z",
  "completed_at": null,
  "max_parallel": 4,
  "task_count": 12,
  "tasks_completed": 5,
  "tasks_failed": 1,
  "tasks_pending": 6,
  "dispatches": [
    "dispatch-1739617800-001",
    "dispatch-1739617800-002",
    ...
  ]
}
```

**Individual Dispatch (extended):**
```json
{
  "id": "dispatch-1739617800-001",
  "batch_id": "batch-1739617800-abc123",
  "workspace": "strokmatic.diemaster.services.smartdie-back-end",
  "workspace_path": "/home/teruel/claude-orchestrator/workspaces/strokmatic/diemaster/services/smartdie-back-end",
  "task": "Update dependencies to latest minor versions",
  "complexity": "medium",
  "priority": "medium",
  "model": "claude-sonnet-4-5-20250929",
  "status": "completed",
  "created_at": "2026-02-15T16:30:00Z",
  "started_at": "2026-02-15T16:30:05Z",
  "completed_at": "2026-02-15T16:31:42Z",
  "exit_code": 0,
  "log_file": "/home/teruel/claude-orchestrator/logs/batch-1739617800-abc123/dispatch-1739617800-001.log"
}
```

### Concurrency Control

**Rate Limiting Strategy:**
- Anthropic API limits (as of 2026): varies by plan tier
- Conservative default: max 4 parallel Claude Code sessions
- Configurable via `config/orchestrator/dispatcher.json`
- Exponential backoff on 429 errors (rate limit exceeded)

**Workspace Locking:**
- Maintain in-memory lock registry (or file-based lock: `logs/workspace-locks.json`)
- Before dispatching to a workspace, check if already running
- Prevent race conditions (multiple agents editing same files)
- Lock released on task completion or timeout

**Resource Allocation:**
- Token budget tracking per batch (future: integrate with Orchestrator Dashboard usage panel)
- Prioritize high-priority tasks within batch if approaching limits
- Graceful degradation: reduce parallelism if API errors detected

## Implementation Steps

### Phase 1: Core Batch Dispatch (MCP Extension)

**File:** `/home/teruel/claude-orchestrator/mcp-servers/task-dispatcher/index.js`

1. Add `dispatch_batch` tool to `setupToolHandlers()`
   - Input schema: `{ tasks: Array<{workspace, task, complexity?, priority?}>, max_parallel?: number }`
   - Generate unique `batch_id`
   - Create batch entry in dispatches.json with status "pending"
   - For each task: create individual dispatch entry with `batch_id` reference
   - Return batch ID and execution command

2. Add `get_batch_status` tool
   - Input: `{ batch_id: string }`
   - Read dispatches.json, filter by batch_id
   - Aggregate status across all batch members
   - Return: completed count, failed count, pending count, overall status

3. Add batch execution command generation
   - Output shell script path or direct execution via spawn
   - Command format: `/home/teruel/claude-orchestrator/scripts/execute-batch.sh <batch_id>`

**Testing:**
```javascript
// Dispatch 3 tasks in parallel
dispatch_batch({
  tasks: [
    { workspace: "strokmatic.sdk.project-organizer", task: "Run linter and fix issues", complexity: "simple" },
    { workspace: "strokmatic.sdk.sdk-defect-visualizer", task: "Update README with usage examples", complexity: "simple" },
    { workspace: "strokmatic.sdk.sdk-bos6000-toolkit", task: "Add type hints to main module", complexity: "medium" }
  ],
  max_parallel: 2
})
```

### Phase 2: Batch Execution Script

**File:** `/home/teruel/claude-orchestrator/scripts/execute-batch.sh`

```bash
#!/usr/bin/env bash
# Parallel batch executor for Claude orchestrator dispatches

BATCH_ID="$1"
ORCHESTRATOR_HOME="${ORCHESTRATOR_HOME:-$HOME/claude-orchestrator}"
DISPATCHES_FILE="$ORCHESTRATOR_HOME/logs/dispatches.json"
BATCH_LOG_DIR="$ORCHESTRATOR_HOME/logs/$BATCH_ID"

# Read batch config
MAX_PARALLEL=$(jq -r ".[] | select(.id == \"$BATCH_ID\") | .max_parallel // 4" "$DISPATCHES_FILE")
DISPATCH_IDS=$(jq -r ".[] | select(.batch_id == \"$BATCH_ID\") | .id" "$DISPATCHES_FILE")

# Create log directory
mkdir -p "$BATCH_LOG_DIR"

# Execute in parallel with xargs or GNU parallel
echo "$DISPATCH_IDS" | xargs -P "$MAX_PARALLEL" -I {} bash -c "
  dispatch_id={}
  workspace=\$(jq -r \".[] | select(.id == \\\"$dispatch_id\\\") | .workspace\" \"$DISPATCHES_FILE\")
  workspace_path=\$(jq -r \".[] | select(.id == \\\"$dispatch_id\\\") | .workspace_path\" \"$DISPATCHES_FILE\")
  task=\$(jq -r \".[] | select(.id == \\\"$dispatch_id\\\") | .task\" \"$DISPATCHES_FILE\")
  model=\$(jq -r \".[] | select(.id == \\\"$dispatch_id\\\") | .model\" \"$DISPATCHES_FILE\")

  # Update status to running
  update-dispatch-status.js \"$dispatch_id\" running

  # Execute task
  cd \"$workspace_path\" && \\
  claude --model \"$model\" --print \"$task\" \\
    > \"$BATCH_LOG_DIR/$dispatch_id.log\" 2>&1

  exit_code=\$?

  # Update status based on exit code
  if [ \$exit_code -eq 0 ]; then
    update-dispatch-status.js \"$dispatch_id\" completed \$exit_code
  else
    update-dispatch-status.js \"$dispatch_id\" failed \$exit_code
  fi
"

# Update batch status to completed
update-batch-status.js "$BATCH_ID"
```

### Phase 3: Status Update Utilities

**File:** `/home/teruel/claude-orchestrator/scripts/update-dispatch-status.js`
```javascript
#!/usr/bin/env node
const fs = require('fs/promises');
const path = require('path');

async function updateDispatchStatus(dispatchId, status, exitCode = null) {
  const dispatchesPath = path.join(
    process.env.ORCHESTRATOR_HOME || path.join(process.env.HOME, 'claude-orchestrator'),
    'logs',
    'dispatches.json'
  );

  const dispatches = JSON.parse(await fs.readFile(dispatchesPath, 'utf-8'));
  const dispatch = dispatches.find(d => d.id === dispatchId);

  if (dispatch) {
    dispatch.status = status;
    dispatch.updated_at = new Date().toISOString();

    if (status === 'running' && !dispatch.started_at) {
      dispatch.started_at = new Date().toISOString();
    }

    if (status === 'completed' || status === 'failed') {
      dispatch.completed_at = new Date().toISOString();
      if (exitCode !== null) dispatch.exit_code = exitCode;
    }

    await fs.writeFile(dispatchesPath, JSON.stringify(dispatches, null, 2), 'utf-8');
  }
}

const [dispatchId, status, exitCode] = process.argv.slice(2);
updateDispatchStatus(dispatchId, status, exitCode ? parseInt(exitCode) : null);
```

**File:** `/home/teruel/claude-orchestrator/scripts/update-batch-status.js`
```javascript
#!/usr/bin/env node
const fs = require('fs/promises');
const path = require('path');

async function updateBatchStatus(batchId) {
  const dispatchesPath = path.join(
    process.env.ORCHESTRATOR_HOME || path.join(process.env.HOME, 'claude-orchestrator'),
    'logs',
    'dispatches.json'
  );

  const dispatches = JSON.parse(await fs.readFile(dispatchesPath, 'utf-8'));
  const batch = dispatches.find(d => d.id === batchId && d.type === 'batch');
  const batchTasks = dispatches.filter(d => d.batch_id === batchId);

  if (batch) {
    batch.tasks_completed = batchTasks.filter(t => t.status === 'completed').length;
    batch.tasks_failed = batchTasks.filter(t => t.status === 'failed').length;
    batch.tasks_pending = batchTasks.filter(t => t.status === 'pending').length;
    batch.updated_at = new Date().toISOString();

    if (batch.tasks_pending === 0) {
      batch.status = batch.tasks_failed > 0 ? 'completed_with_failures' : 'completed';
      batch.completed_at = new Date().toISOString();
    }

    await fs.writeFile(dispatchesPath, JSON.stringify(dispatches, null, 2), 'utf-8');
  }
}

const [batchId] = process.argv.slice(2);
updateBatchStatus(batchId);
```

### Phase 4: Configuration & Safety

**File:** `/home/teruel/claude-orchestrator/config/orchestrator/dispatcher.json`
```json
{
  "max_parallel_workers": 4,
  "workspace_lock_timeout_minutes": 30,
  "batch_timeout_minutes": 120,
  "retry_on_failure": false,
  "api_rate_limit": {
    "requests_per_minute": 50,
    "tokens_per_minute": 100000
  },
  "priority_enforcement": true
}
```

**Workspace Locking:**
- Before dispatch: check `logs/workspace-locks.json`
- Lock entry: `{ "workspace": "name", "locked_by": "dispatch-id", "locked_at": "ISO8601" }`
- Auto-release on completion or timeout
- Prevent multiple Claude instances from editing same workspace simultaneously

### Phase 5: Integration with Existing Tools

**Update backlog-manager MCP:**
- New command: `dispatch_backlog_tasks` — read pending tasks from workspace backlog, create batch dispatch
- Filter by priority, complexity, or tags

**Update report-generator MCP:**
- Include batch execution statistics in daily/weekly reports
- Highlight parallel efficiency gains (wall time vs. sum of individual times)

**Dashboard integration (future):**
- Real-time batch progress visualization
- Per-workspace activity timeline showing parallel execution

## MCP Tool Interface

### New Tools

**1. dispatch_batch**
```typescript
{
  name: "dispatch_batch",
  description: "Dispatch tasks to multiple workspaces in parallel with coordinated execution",
  inputSchema: {
    type: "object",
    properties: {
      tasks: {
        type: "array",
        items: {
          type: "object",
          properties: {
            workspace: { type: "string", description: "Target workspace name" },
            task: { type: "string", description: "Task description/prompt" },
            complexity: { type: "string", enum: ["simple", "medium", "complex"] },
            priority: { type: "string", enum: ["high", "medium", "low"] }
          },
          required: ["workspace", "task"]
        }
      },
      max_parallel: { type: "number", description: "Max concurrent workers (default: 4)" },
      execute_now: { type: "boolean", description: "Start execution immediately (default: true)" }
    },
    required: ["tasks"]
  }
}
```

**2. get_batch_status**
```typescript
{
  name: "get_batch_status",
  description: "Get status and progress of a batch dispatch",
  inputSchema: {
    type: "object",
    properties: {
      batch_id: { type: "string", description: "Batch ID to query" },
      include_logs: { type: "boolean", description: "Include task log paths (default: false)" }
    },
    required: ["batch_id"]
  }
}
```

**3. list_batch_dispatches**
```typescript
{
  name: "list_batch_dispatches",
  description: "List all batch dispatches, optionally filtered",
  inputSchema: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["pending", "running", "completed", "completed_with_failures", "failed"] },
      limit: { type: "number", description: "Max results (default: 10)" }
    }
  }
}
```

## Edge Cases & Risks

### Concurrency Risks

**1. API Rate Limiting**
- **Risk:** Burst of parallel requests exceeds Anthropic API rate limits → 429 errors
- **Mitigation:**
  - Conservative default max_parallel (4 workers)
  - Exponential backoff retry logic in execute-batch.sh
  - Track request rate in dispatcher.json config
  - Graceful degradation: reduce parallelism on repeated 429s

**2. Workspace Lock Conflicts**
- **Risk:** Two batches try to dispatch to same workspace simultaneously
- **Mitigation:**
  - File-based locking with atomic writes (flock or lockfile)
  - Reject dispatch if workspace already locked
  - Auto-release stale locks (timeout after 30min)

**3. Resource Exhaustion**
- **Risk:** Too many Claude processes → system memory/CPU overload
- **Mitigation:**
  - Hard cap on max_parallel (configurable, default 4, max 8)
  - Monitor system resources before launching new worker
  - Kill runaway processes after timeout

### Failure Isolation

**4. Partial Batch Failures**
- **Risk:** 3 of 10 tasks fail — how to handle partial completion?
- **Mitigation:**
  - Batch status: "completed_with_failures" (distinct from "failed")
  - Individual task logs preserved for debugging
  - Retry mechanism (optional, off by default)
  - Operator can manually re-dispatch failed tasks

**5. Log Interleaving**
- **Risk:** Parallel stdout/stderr writes to same log file → garbled output
- **Mitigation:**
  - Separate log file per dispatch: `logs/<batch_id>/<dispatch_id>.log`
  - Aggregate logs into batch summary only after completion
  - Use line-buffered writes, timestamp prefixes

**6. Mid-Batch Cancellation**
- **Risk:** User stops batch execution — orphaned processes still running
- **Mitigation:**
  - Track PIDs in batch metadata
  - Cleanup handler: kill child processes on SIGINT/SIGTERM
  - Status "cancelled" distinct from "failed"

### Data Integrity

**7. Concurrent dispatches.json Writes**
- **Risk:** Multiple processes updating same JSON file → corruption
- **Mitigation:**
  - Atomic writes: write to temp file, then rename
  - Use lock file during JSON updates (e.g., `dispatches.json.lock`)
  - Alternative: migrate to SQLite for transactional safety (future)

**8. Stale Workspace State**
- **Risk:** Workspace modified externally during batch execution
- **Mitigation:**
  - Git status check before dispatch (detect uncommitted changes)
  - Fail fast if workspace dirty (unless override flag set)
  - Post-dispatch verification (optional): re-run tests

## Dependencies & Prerequisites

### Required

1. **jq** — JSON parsing in shell scripts
   - Install: `apt-get install jq` (Ubuntu/Debian) or `brew install jq` (macOS)
   - Verify: `which jq`

2. **GNU xargs or parallel** — Parallel execution orchestration
   - xargs with `-P` flag (available on most Linux/macOS)
   - Alternative: `gnu-parallel` for advanced features
   - Verify: `xargs --help | grep -- -P`

3. **Node.js** — Status update utilities
   - Already required for task-dispatcher MCP
   - Verify: `node --version`

### Optional

4. **flock** (Linux) or **lockfile** — Atomic file locking
   - Linux: built-in (`man flock`)
   - macOS: install via `brew install util-linux`

5. **SQLite** (future) — Replace JSON logs with transactional database
   - For high-frequency dispatches (100+ tasks/day)
   - Better concurrency handling

### Configuration Files to Create

1. `/home/teruel/claude-orchestrator/config/orchestrator/dispatcher.json` — Concurrency settings
2. `/home/teruel/claude-orchestrator/logs/workspace-locks.json` — Active locks registry
3. `/home/teruel/claude-orchestrator/scripts/execute-batch.sh` — Batch executor
4. `/home/teruel/claude-orchestrator/scripts/update-dispatch-status.js` — Status updater
5. `/home/teruel/claude-orchestrator/scripts/update-batch-status.js` — Batch aggregator

### Integration Points

- **backlog-manager MCP:** Batch dispatch pending tasks from backlog
- **changelog-writer MCP:** Record batch operations in orchestrator changelog
- **Orchestrator Dashboard:** Real-time batch progress visualization (future)
- **Cron schedules:** Nightly batch operations (e.g., "update all dependencies")

## Success Metrics

- Batch execution completes successfully with N parallel workers
- Total wall time < sum of individual task times (parallelism efficiency)
- No workspace lock conflicts or race conditions
- API rate limits respected (zero 429 errors under normal load)
- Individual task failures isolated (don't crash entire batch)
- Logs correctly separated and aggregated

## Future Enhancements

1. **Dynamic Concurrency Adjustment:** Monitor API response times, auto-tune max_parallel
2. **Priority Queue:** High-priority tasks jump ahead in batch queue
3. **Cross-Workspace Dependencies:** Task B waits for Task A completion (DAG execution)
4. **Retry Logic:** Auto-retry failed tasks with exponential backoff
5. **Progress Notifications:** Voice/Slack alerts on batch milestones (25%, 50%, 75%, 100%)
6. **Cost Tracking:** Estimate and track token usage per batch (integrate with Dashboard)
7. **Workspace Health Checks:** Pre-flight validation (dependencies installed, tests passing)
8. **Batch Templates:** Pre-defined batch operations ("Monthly Dependency Update", "Security Audit All Repos")
