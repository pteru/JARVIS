# Spec: Task Lifecycle Tracking

**Status:** Idea
**Type:** Enhancement to existing MCP Server (task-dispatcher)

## Overview

The current task-dispatcher MCP server creates dispatches with status `"pending"` and never updates them. Tasks lack proper lifecycle tracking, making it impossible to monitor execution state, detect failures, or verify completion.

This spec introduces a formal task lifecycle with five states (`pending → running → verifying → complete | failed`) and adds an `update_task_status` tool that executing sessions can call to report progress.

## Design

### Task Lifecycle States

| State | Description | Entry Point | Exit Conditions |
|-------|-------------|-------------|-----------------|
| `pending` | Task created, not yet started | `dispatch_task` creates with this status | Session starts execution → `running` |
| `running` | Session actively working on task | Execution session calls `update_task_status` at start | Task finished → `verifying`, or error → `failed` |
| `verifying` | Task code complete, running tests/validation | Execution session reports completion → auto-enter this state | Tests pass → `complete`, tests fail → `failed` |
| `complete` | Task finished successfully | Verification passes | Terminal state |
| `failed` | Task failed (error, tests failed, etc.) | Any state can transition here on error | Terminal state (can be manually reset to `pending` for retry) |

### State Transitions

```
┌─────────┐
│ pending │
└────┬────┘
     │ (session starts)
     v
┌─────────┐
│ running │──────────┐
└────┬────┘          │ (error)
     │               │
     │ (task done)   v
     v           ┌────────┐
┌───────────┐   │ failed │ (terminal)
│ verifying │   └────────┘
└─────┬─────┘
      │
      ├─(pass)──> complete (terminal)
      │
      └─(fail)──> failed (terminal)
```

### Data Model Changes

Current `dispatches.json` entry:
```json
{
  "id": "dispatch-1234567890-abc123",
  "workspace": "strokmatic.sdk.project-organizer",
  "workspace_path": "/home/teruel/claude-orchestrator/workspaces/strokmatic/sdk/project-organizer",
  "task": "Add unit tests for file scanner",
  "complexity": "medium",
  "priority": "medium",
  "model": "claude-sonnet-4-5-20250929",
  "status": "pending",
  "created_at": "2026-02-15T10:30:00.000Z",
  "updated_at": "2026-02-15T10:30:00.000Z"
}
```

Enhanced entry:
```json
{
  "id": "dispatch-1234567890-abc123",
  "workspace": "strokmatic.sdk.project-organizer",
  "workspace_path": "/home/teruel/claude-orchestrator/workspaces/strokmatic/sdk/project-organizer",
  "task": "Add unit tests for file scanner",
  "complexity": "medium",
  "priority": "medium",
  "model": "claude-sonnet-4-5-20250929",
  "status": "running",
  "created_at": "2026-02-15T10:30:00.000Z",
  "updated_at": "2026-02-15T10:35:12.000Z",
  "started_at": "2026-02-15T10:35:12.000Z",
  "completed_at": null,
  "status_history": [
    {
      "status": "pending",
      "timestamp": "2026-02-15T10:30:00.000Z",
      "note": "Task dispatched"
    },
    {
      "status": "running",
      "timestamp": "2026-02-15T10:35:12.000Z",
      "note": "Session started execution"
    }
  ],
  "error_message": null,
  "verification_log": null
}
```

New fields:
- `started_at`: ISO timestamp when status changed to `running`
- `completed_at`: ISO timestamp when status reached `complete` or `failed`
- `status_history`: Array of status transitions with timestamps and optional notes
- `error_message`: String describing failure reason (only set when `status: "failed"`)
- `verification_log`: String with test/validation output (set during `verifying` state)

## Implementation Steps

### 1. Extend task-dispatcher schema

**File:** `/home/teruel/claude-orchestrator/mcp-servers/task-dispatcher/index.js`

**Changes:**
- Update `dispatchTask()` method to initialize new fields (`started_at: null`, `completed_at: null`, `status_history: [{ status: "pending", timestamp: ..., note: "Task dispatched" }]`, `error_message: null`, `verification_log: null`)
- Update `list_dispatched_tasks` enum to include all five states: `["pending", "running", "verifying", "complete", "failed"]`

### 2. Add `update_task_status` tool

**File:** `/home/teruel/claude-orchestrator/mcp-servers/task-dispatcher/index.js`

**Tool definition:**
```javascript
{
  name: "update_task_status",
  description: "Update the status of a dispatched task (called by executing sessions)",
  inputSchema: {
    type: "object",
    properties: {
      task_id: {
        type: "string",
        description: "Task dispatch ID"
      },
      status: {
        type: "string",
        enum: ["pending", "running", "verifying", "complete", "failed"],
        description: "New status to set"
      },
      note: {
        type: "string",
        description: "Optional note describing the transition (e.g., 'Tests passed', 'Compilation error')"
      },
      error_message: {
        type: "string",
        description: "Error details (required when status=failed)"
      },
      verification_log: {
        type: "string",
        description: "Test or validation output (optional, used in verifying state)"
      }
    },
    required: ["task_id", "status"]
  }
}
```

**Implementation method:**
```javascript
async updateTaskStatus(taskId, status, note, errorMessage, verificationLog) {
  const dispatches = await this.loadDispatches();
  const index = dispatches.findIndex((d) => d.id === taskId);

  if (index === -1) {
    throw new Error(`Task "${taskId}" not found`);
  }

  const dispatch = dispatches[index];
  const now = new Date().toISOString();

  // Validate state transition
  const validTransitions = {
    pending: ["running", "failed"],
    running: ["verifying", "failed"],
    verifying: ["complete", "failed"],
    complete: [], // terminal
    failed: ["pending"] // allow retry
  };

  if (!validTransitions[dispatch.status].includes(status)) {
    throw new Error(
      `Invalid transition from "${dispatch.status}" to "${status}"`
    );
  }

  // Update status
  dispatch.status = status;
  dispatch.updated_at = now;

  // Track timestamps
  if (status === "running" && !dispatch.started_at) {
    dispatch.started_at = now;
  }
  if (status === "complete" || status === "failed") {
    dispatch.completed_at = now;
  }

  // Append to history
  if (!dispatch.status_history) {
    dispatch.status_history = [];
  }
  dispatch.status_history.push({
    status,
    timestamp: now,
    note: note || null
  });

  // Store additional context
  if (status === "failed") {
    dispatch.error_message = errorMessage || "Unknown error";
  }
  if (verificationLog) {
    dispatch.verification_log = verificationLog;
  }

  dispatches[index] = dispatch;
  await this.saveDispatches(dispatches);

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            message: `Task status updated to "${status}"`,
            task_id: taskId,
            previous_status: dispatch.status_history[dispatch.status_history.length - 2]?.status,
            current_status: status
          },
          null,
          2
        )
      }
    ]
  };
}
```

**Wire up handler in `CallToolRequestSchema`:**
```javascript
case "update_task_status":
  return await this.updateTaskStatus(
    args.task_id,
    args.status,
    args.note,
    args.error_message,
    args.verification_log
  );
```

### 3. Migration for existing dispatches

**File:** `/home/teruel/claude-orchestrator/mcp-servers/task-dispatcher/index.js`

Add a migration check in `loadDispatches()`:
```javascript
async loadDispatches() {
  try {
    const content = await fs.readFile(this.getDispatchLogPath(), "utf-8");
    const dispatches = JSON.parse(content);

    // Migrate old format to new format
    return dispatches.map(d => ({
      ...d,
      started_at: d.started_at || null,
      completed_at: d.completed_at || null,
      status_history: d.status_history || [
        {
          status: d.status || "pending",
          timestamp: d.created_at,
          note: "Task dispatched (migrated)"
        }
      ],
      error_message: d.error_message || null,
      verification_log: d.verification_log || null
    }));
  } catch {
    return [];
  }
}
```

### 4. Update execution session workflow

**Context:** When the orchestrator dispatches a task, it should instruct the Claude session to call `update_task_status` at key points.

**Prompt additions for dispatched sessions:**
```
Your task ID is: {task_id}

IMPORTANT: Update task status at these milestones:
1. At session start: Call update_task_status(task_id, "running", "Session started")
2. Before running tests: Call update_task_status(task_id, "verifying", "Running tests")
3. On success: Call update_task_status(task_id, "complete", "Task completed successfully")
4. On failure: Call update_task_status(task_id, "failed", note="<error summary>", error_message="<full error>")

Use the task-dispatcher MCP server to make these calls.
```

### 5. Add status query shortcuts

**File:** `/home/teruel/claude-orchestrator/mcp-servers/task-dispatcher/index.js`

Enhance `list_dispatched_tasks` to support common queries:
```javascript
async listDispatchedTasks(workspace, status, limit = 20) {
  let dispatches = await this.loadDispatches();

  if (workspace) {
    dispatches = dispatches.filter((d) => d.workspace === workspace);
  }
  if (status) {
    dispatches = dispatches.filter((d) => d.status === status);
  }

  // Most recent first
  dispatches = dispatches.reverse().slice(0, limit);

  // Add duration for completed/failed tasks
  const enriched = dispatches.map(d => {
    const result = { ...d };
    if (d.started_at && d.completed_at) {
      const start = new Date(d.started_at);
      const end = new Date(d.completed_at);
      result.duration_seconds = Math.round((end - start) / 1000);
    }
    return result;
  });

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(enriched, null, 2)
      }
    ]
  };
}
```

### 6. Create logs directory if needed

**File:** `/home/teruel/claude-orchestrator/mcp-servers/task-dispatcher/index.js`

The current implementation already handles this in `saveDispatches()` via `fs.mkdir(path.dirname(logPath), { recursive: true })`. No changes needed.

## MCP Tool Interface

### New Tool: `update_task_status`

**Purpose:** Allow executing sessions to update their task status

**Parameters:**
- `task_id` (string, required): The dispatch ID returned by `dispatch_task`
- `status` (enum, required): One of `["pending", "running", "verifying", "complete", "failed"]`
- `note` (string, optional): Human-readable transition note
- `error_message` (string, conditional): Required when `status="failed"`, describes what went wrong
- `verification_log` (string, optional): Test/validation output for debugging

**Returns:**
```json
{
  "message": "Task status updated to \"running\"",
  "task_id": "dispatch-1234567890-abc123",
  "previous_status": "pending",
  "current_status": "running"
}
```

**Example calls:**

Start task:
```javascript
await mcp.call("update_task_status", {
  task_id: "dispatch-1234567890-abc123",
  status: "running",
  note: "Session started execution"
});
```

Report verification:
```javascript
await mcp.call("update_task_status", {
  task_id: "dispatch-1234567890-abc123",
  status: "verifying",
  note: "Running test suite",
  verification_log: "===== Test Results =====\n✓ 15 tests passed\n..."
});
```

Report success:
```javascript
await mcp.call("update_task_status", {
  task_id: "dispatch-1234567890-abc123",
  status: "complete",
  note: "All tests passed, changes committed"
});
```

Report failure:
```javascript
await mcp.call("update_task_status", {
  task_id: "dispatch-1234567890-abc123",
  status: "failed",
  note: "Compilation failed",
  error_message: "SyntaxError: Unexpected token '}' at line 42"
});
```

### Enhanced Tool: `list_dispatched_tasks`

**New behavior:** Returns enriched results with `duration_seconds` for completed/failed tasks.

**Example response:**
```json
[
  {
    "id": "dispatch-1234567890-abc123",
    "workspace": "strokmatic.sdk.project-organizer",
    "task": "Add unit tests for file scanner",
    "status": "complete",
    "created_at": "2026-02-15T10:30:00.000Z",
    "started_at": "2026-02-15T10:35:12.000Z",
    "completed_at": "2026-02-15T10:42:08.000Z",
    "duration_seconds": 416,
    "status_history": [
      { "status": "pending", "timestamp": "2026-02-15T10:30:00.000Z", "note": "Task dispatched" },
      { "status": "running", "timestamp": "2026-02-15T10:35:12.000Z", "note": "Session started" },
      { "status": "verifying", "timestamp": "2026-02-15T10:41:30.000Z", "note": "Running tests" },
      { "status": "complete", "timestamp": "2026-02-15T10:42:08.000Z", "note": "Tests passed" }
    ]
  }
]
```

## Edge Cases & Risks

### 1. Invalid State Transitions

**Problem:** Session tries to jump from `pending` directly to `complete`

**Solution:** `updateTaskStatus()` validates transitions using the `validTransitions` map and throws an error if invalid

**Example error:** `"Invalid transition from \"pending\" to \"complete\""`

### 2. Session Crashes Without Updating Status

**Problem:** Task stuck in `running` forever

**Solution (future enhancement):** Add timeout monitoring:
- If a task stays `running` for > 30 minutes, auto-transition to `failed` with note "Timeout"
- This could be a separate cron job or a `check_stale_tasks` tool

**Workaround for now:** Manual intervention via:
```javascript
update_task_status(task_id, "failed", "Session timed out", "No status update received within expected timeframe")
```

### 3. Multiple Sessions for Same Task

**Problem:** Two sessions both call `update_task_status` for the same task

**Solution:** Not currently prevented (would require session locking). For MVP, orchestrator should only dispatch each task once.

**Mitigation:** `status_history` will show conflicting updates, making this easy to detect manually

### 4. Dispatcher Restarted Mid-Task

**Problem:** Task status updates could be lost if writes aren't flushed

**Solution:** `saveDispatches()` writes synchronously to disk on every update (via `await fs.writeFile`), so crashes won't lose committed state

### 5. Corrupted dispatches.json

**Problem:** File becomes invalid JSON

**Solution:** Add error handling to `loadDispatches()`:
```javascript
async loadDispatches() {
  try {
    const content = await fs.readFile(this.getDispatchLogPath(), "utf-8");
    return JSON.parse(content);
  } catch (error) {
    console.error("[ERROR] Failed to load dispatches.json:", error.message);
    // Option 1: Return empty array (lose history)
    // Option 2: Throw error and refuse to operate
    // For safety, choose option 2:
    throw new Error("Dispatch log corrupted. Manual recovery required.");
  }
}
```

**Recovery:** Keep timestamped backups of `dispatches.json` (separate enhancement)

### 6. Verification Auto-Transition

**Problem:** Should `complete` be set automatically after `verifying`, or should the session explicitly call it?

**Decision:** Session must explicitly call `update_task_status` with `status: "complete"` or `status: "failed"` after verification. This gives the session control over interpreting test results.

### 7. Retry Failed Tasks

**Problem:** How to retry a failed task?

**Solution:** Allow `failed → pending` transition (already in `validTransitions`). The orchestrator can reset the task:
```javascript
update_task_status(task_id, "pending", "Retrying after fixing error")
```

Then dispatch again (reuse same task ID or create new dispatch).

## Dependencies & Prerequisites

### Code Dependencies

- Existing task-dispatcher at `/home/teruel/claude-orchestrator/mcp-servers/task-dispatcher/index.js`
- `@modelcontextprotocol/sdk` (already installed)
- Node.js `fs/promises`, `path` (built-in)

### Configuration Dependencies

- `config/orchestrator/workspaces.json` (already exists)
- `logs/dispatches.json` (will be created on first dispatch if missing)

### Runtime Prerequisites

- Node.js >= 18 (for `fs/promises` support)
- Write permissions to `/home/teruel/claude-orchestrator/logs/`

### Testing Prerequisites

Before marking this complete:
1. Dispatch a test task to a workspace
2. Manually call `update_task_status` through each lifecycle stage
3. Verify `status_history` is populated correctly
4. Attempt invalid transitions and confirm errors
5. Check that `list_dispatched_tasks` returns enriched data
6. Confirm `dispatches.json` is properly formatted after updates

### Integration Points

**Orchestrator session prompts:** Need to be updated to instruct Claude sessions to call `update_task_status` at start/end of execution

**Report generator:** Should read the new status fields when generating daily/weekly reports (separate enhancement)

**Future webhook:** Could send notifications when tasks transition to `complete` or `failed` (separate enhancement)
