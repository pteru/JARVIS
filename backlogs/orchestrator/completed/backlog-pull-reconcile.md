# Spec: Backlog Pull/Reconcile

**Status:** Implemented
**Type:** Enhancement to backlog-manager MCP Server

## Overview

Enable bidirectional backlog synchronization between the central orchestrator backlogs (`/home/teruel/claude-orchestrator/backlogs/<workspace>-backlog.md`) and workspace-local backlogs (`<workspace>/.claude/backlog.md`). Currently, the backlog-manager only pushes changes from central to workspace. This spec adds the ability to pull changes back when a collaborator (human or Claude session) edits the workspace backlog directly, such as through a PR, during local development, or from a different orchestrator instance.

The reconciliation strategy must handle three cases: (1) workspace unchanged, (2) central unchanged, (3) both changed (conflict). The goal is to preserve work from both sides when possible, with clear conflict markers when automatic merge is unsafe.

## Design

### Data Flow

```
Central Backlog                      Workspace Backlog
(orchestrator/backlogs/)     <-->    (<workspace>/.claude/)

Write flows:
1. [Existing] add_backlog_task / complete_backlog_task
   → writes to central → pushes to workspace

2. [New] Pull/reconcile
   ← reads from workspace
   ← merges into central
   → writes merged result to both
```

### Merge Strategy

The reconciliation operates at the **task line level** using a three-way merge approach:

1. **Baseline**: The last known content of workspace backlog (stored as `<workspace>/.claude/backlog.md.baseline` by the orchestrator after each push)
2. **Central**: Current central backlog content
3. **Workspace**: Current workspace backlog content

#### Reconciliation Algorithm

For each task line in the backlog:

| Baseline | Central | Workspace | Action |
|----------|---------|-----------|--------|
| exists | exists (same) | exists (same) | No change |
| exists | exists (same) | exists (different) | Accept workspace change (user edited locally) |
| exists | exists (different) | exists (same) | Accept central change (orchestrator edited centrally) |
| exists | exists (different) | exists (different) | **CONFLICT** — preserve both with markers |
| exists | deleted | exists (same) | Accept deletion (orchestrator removed it) |
| exists | exists (same) | deleted | Accept deletion (user removed it) |
| exists | deleted | exists (different) | **CONFLICT** — preserve workspace with marker |
| not exists | exists | not exists | Accept addition (orchestrator added it) |
| not exists | not exists | exists | Accept addition (user added it) |
| not exists | exists | exists (different) | **CONFLICT** — preserve both with markers |

**Conflict marker format:**
```markdown
<!-- CONFLICT: Central vs. Workspace -->
- [ ] [MEDIUM] Task A (Central version)
<!-- vs. -->
- [ ] [MEDIUM] Task A - with local edits (Workspace version)
<!-- END CONFLICT -->
```

### Baseline Tracking

- After every `add_backlog_task`, `complete_backlog_task`, or `sync_backlog` write operation, the orchestrator writes the current workspace content to `<workspace>/.claude/backlog.md.baseline`
- This file is **not checked into version control** (add to workspace `.gitignore` automatically)
- If the baseline file does not exist (first sync), treat all workspace content as new additions

### When to Reconcile

1. **Session start hook**: At the beginning of each orchestrator session, scan all configured workspaces and reconcile any with local changes
2. **Manual tool call**: New MCP tool `sync_backlog` that reconciles a specific workspace on demand
3. **Pre-dispatch**: Before dispatching a task to a workspace, reconcile to ensure the backlog is current

## Implementation Steps

### 1. Add Baseline Write to Existing Push Logic

**File**: `/home/teruel/claude-orchestrator/mcp-servers/backlog-manager/index.js`

**Changes**:
- Modify `pushToWorkspace(workspace, content)` to also write `<workspace>/.claude/backlog.md.baseline` with the same content
- Add error handling to silently skip if workspace is not accessible (consistent with existing push behavior)

```javascript
async pushToWorkspace(workspace, content) {
  const wsPath = await this.getWorkspacePath(workspace);
  if (!wsPath) return;

  try {
    const targetDir = path.join(wsPath, ".claude");
    await fs.mkdir(targetDir, { recursive: true });

    // Write workspace backlog
    const backlogPath = path.join(targetDir, "backlog.md");
    await fs.writeFile(backlogPath, content, "utf-8");

    // Write baseline for future reconciliation
    const baselinePath = path.join(targetDir, "backlog.md.baseline");
    await fs.writeFile(baselinePath, content, "utf-8");
  } catch {
    // Workspace path may not be mounted on this machine — silently skip.
  }
}
```

### 2. Implement Backlog Parser

**New method**: `parseBacklog(content)` returns structured representation

```javascript
parseBacklog(content) {
  const lines = content.split("\n");
  const tasks = [];
  let currentPriority = null;
  let lineNumber = 0;

  for (const line of lines) {
    if (line.startsWith("## ")) {
      currentPriority = line.replace("## ", "").toLowerCase().split(" ")[0];
    } else if (line.startsWith("- [")) {
      const taskMatch = line.match(/- \[([ x])\] (?:\[(\w+)\] )?(.+)/);
      if (taskMatch) {
        const [, checked, complexity, description] = taskMatch;
        tasks.push({
          lineNumber,
          priority: currentPriority,
          complexity: complexity || "medium",
          description: description.trim(),
          completed: checked === "x",
          originalLine: line,
        });
      }
    }
    lineNumber++;
  }

  return tasks;
}
```

### 3. Implement Three-Way Merge

**New method**: `mergeTasks(baselineTasks, centralTasks, workspaceTasks)`

```javascript
mergeTasks(baselineTasks, centralTasks, workspaceTasks) {
  const merged = [];
  const conflicts = [];

  // Build lookup maps by description (tasks are identified by their description)
  const baselineMap = new Map(baselineTasks.map(t => [t.description, t]));
  const centralMap = new Map(centralTasks.map(t => [t.description, t]));
  const workspaceMap = new Map(workspaceTasks.map(t => [t.description, t]));

  // All unique task descriptions across all three versions
  const allDescriptions = new Set([
    ...baselineMap.keys(),
    ...centralMap.keys(),
    ...workspaceMap.keys(),
  ]);

  for (const desc of allDescriptions) {
    const baseline = baselineMap.get(desc);
    const central = centralMap.get(desc);
    const workspace = workspaceMap.get(desc);

    // Apply reconciliation logic from the table above
    if (!baseline && central && !workspace) {
      // Central added, workspace didn't
      merged.push(central);
    } else if (!baseline && !central && workspace) {
      // Workspace added, central didn't
      merged.push(workspace);
    } else if (baseline && !central && !workspace) {
      // Both deleted — omit
      continue;
    } else if (baseline && central && workspace) {
      // All three exist — check for differences
      const centralSame = (central.originalLine === baseline.originalLine);
      const workspaceSame = (workspace.originalLine === baseline.originalLine);

      if (centralSame && workspaceSame) {
        merged.push(central); // No change
      } else if (centralSame && !workspaceSame) {
        merged.push(workspace); // Workspace edited
      } else if (!centralSame && workspaceSame) {
        merged.push(central); // Central edited
      } else {
        // Both edited — conflict
        conflicts.push({ central, workspace });
      }
    } else if (baseline && central && !workspace) {
      // Workspace deleted
      if (central.originalLine !== baseline.originalLine) {
        // Central also edited — conflict
        conflicts.push({ central, workspace: null });
      }
      // else: accept deletion
    } else if (baseline && !central && workspace) {
      // Central deleted
      if (workspace.originalLine !== baseline.originalLine) {
        // Workspace also edited — conflict
        conflicts.push({ central: null, workspace });
      }
      // else: accept deletion
    } else if (!baseline && central && workspace) {
      // Both added the same description — check if same line
      if (central.originalLine === workspace.originalLine) {
        merged.push(central);
      } else {
        conflicts.push({ central, workspace });
      }
    }
  }

  return { merged, conflicts };
}
```

### 4. Implement Backlog Reconstruction

**New method**: `reconstructBacklog(tasks, conflicts)`

Rebuilds markdown from parsed tasks, grouped by priority, with conflict markers.

```javascript
reconstructBacklog(tasks, conflicts) {
  const sections = {
    high: [],
    medium: [],
    low: [],
  };

  // Group tasks by priority
  for (const task of tasks) {
    const priority = task.priority || "medium";
    if (sections[priority]) {
      sections[priority].push(task.originalLine);
    }
  }

  // Add conflict markers at the end of the appropriate section
  for (const conflict of conflicts) {
    const priority = (conflict.central?.priority || conflict.workspace?.priority || "medium");
    const conflictBlock = [
      "<!-- CONFLICT: Central vs. Workspace -->",
      conflict.central ? conflict.central.originalLine + " (Central)" : "<!-- Deleted in Central -->",
      "<!-- vs. -->",
      conflict.workspace ? conflict.workspace.originalLine + " (Workspace)" : "<!-- Deleted in Workspace -->",
      "<!-- END CONFLICT -->",
    ];
    sections[priority].push(...conflictBlock);
  }

  // Build final markdown
  let markdown = "# Backlog\n\n";
  markdown += "## High Priority\n" + sections.high.join("\n") + "\n\n";
  markdown += "## Medium Priority\n" + sections.medium.join("\n") + "\n\n";
  markdown += "## Low Priority\n" + sections.low.join("\n") + "\n";

  return markdown;
}
```

### 5. Add `sync_backlog` MCP Tool

**Tool definition** (add to `setupToolHandlers`):

```javascript
{
  name: "sync_backlog",
  description: "Pull changes from workspace backlog and reconcile with central backlog. Returns conflict report if any.",
  inputSchema: {
    type: "object",
    properties: {
      workspace: {
        type: "string",
        description: "Workspace name",
      },
    },
    required: ["workspace"],
  },
}
```

**Tool handler** (add to `CallToolRequestSchema` switch):

```javascript
case "sync_backlog":
  return await this.syncBacklog(args.workspace);
```

**Method implementation**:

```javascript
async syncBacklog(workspace) {
  const wsPath = await this.getWorkspacePath(workspace);
  if (!wsPath) {
    return {
      content: [{
        type: "text",
        text: `Workspace "${workspace}" not found in config`,
      }],
    };
  }

  const centralPath = path.join(ORCHESTRATOR_HOME, "backlogs", `${workspace}-backlog.md`);
  const workspacePath = path.join(wsPath, ".claude", "backlog.md");
  const baselinePath = path.join(wsPath, ".claude", "backlog.md.baseline");

  try {
    // Read all three versions
    const centralContent = await fs.readFile(centralPath, "utf-8");
    const workspaceContent = await fs.readFile(workspacePath, "utf-8").catch(() => "");
    const baselineContent = await fs.readFile(baselinePath, "utf-8").catch(() => "");

    // If workspace is empty or same as baseline, no changes to pull
    if (!workspaceContent || workspaceContent === baselineContent) {
      return {
        content: [{
          type: "text",
          text: `No changes detected in workspace backlog for "${workspace}"`,
        }],
      };
    }

    // Parse all three
    const baselineTasks = this.parseBacklog(baselineContent);
    const centralTasks = this.parseBacklog(centralContent);
    const workspaceTasks = this.parseBacklog(workspaceContent);

    // Merge
    const { merged, conflicts } = this.mergeTasks(baselineTasks, centralTasks, workspaceTasks);

    // Reconstruct
    const reconciledContent = this.reconstructBacklog(merged, conflicts);

    // Write back to both central and workspace
    await fs.writeFile(centralPath, reconciledContent, "utf-8");
    await this.pushToWorkspace(workspace, reconciledContent); // Also updates baseline

    // Report
    if (conflicts.length > 0) {
      return {
        content: [{
          type: "text",
          text: `Synchronized backlog for "${workspace}" with ${conflicts.length} conflict(s). Review and resolve conflict markers in the backlog.`,
        }],
      };
    } else {
      return {
        content: [{
          type: "text",
          text: `Successfully synchronized backlog for "${workspace}". ${merged.length} task(s) reconciled.`,
        }],
      };
    }
  } catch (error) {
    return {
      content: [{
        type: "text",
        text: `Error syncing backlog: ${error.message}`,
      }],
    };
  }
}
```

### 6. Add Session-Start Reconciliation Script

**File**: `/home/teruel/claude-orchestrator/scripts/reconcile-all-backlogs.sh`

```bash
#!/bin/bash
# Reconcile all workspace backlogs at session start

set -e

ORCHESTRATOR_HOME="${ORCHESTRATOR_HOME:-$HOME/claude-orchestrator}"

# Use the backlog-manager MCP to sync each workspace
WORKSPACES=$(jq -r '.workspaces | keys[]' "$ORCHESTRATOR_HOME/config/orchestrator/workspaces.json")

for workspace in $WORKSPACES; do
  echo "Reconciling backlog for: $workspace"
  # Call sync_backlog via MCP (requires mcp-cli or direct Node invocation)
  node "$ORCHESTRATOR_HOME/mcp-servers/backlog-manager/index.js" <<EOF
{"jsonrpc":"2.0","method":"tools/call","params":{"name":"sync_backlog","arguments":{"workspace":"$workspace"}},"id":1}
EOF
done

echo "All backlogs reconciled."
```

Make executable: `chmod +x /home/teruel/claude-orchestrator/scripts/reconcile-all-backlogs.sh`

### 7. Integrate into Session Initialization

**Option A: Add to orchestrator's `.claude/CLAUDE.md`**

Append to the "Session Directives" section:

```markdown
- At the start of each session, run `/home/teruel/claude-orchestrator/scripts/reconcile-all-backlogs.sh` to pull any workspace backlog changes
```

**Option B: Use a Claude Code hook** (if available in future)

Create `/home/teruel/claude-orchestrator/.claude/hooks/session-start.sh`:

```bash
#!/bin/bash
/home/teruel/claude-orchestrator/scripts/reconcile-all-backlogs.sh
```

### 8. Update Workspace `.gitignore`

After the first sync, ensure `<workspace>/.claude/backlog.md.baseline` is excluded from version control.

**Automated approach**: Modify `pushToWorkspace` to append to workspace `.gitignore` if needed:

```javascript
async pushToWorkspace(workspace, content) {
  const wsPath = await this.getWorkspacePath(workspace);
  if (!wsPath) return;

  try {
    const targetDir = path.join(wsPath, ".claude");
    await fs.mkdir(targetDir, { recursive: true });

    const backlogPath = path.join(targetDir, "backlog.md");
    await fs.writeFile(backlogPath, content, "utf-8");

    const baselinePath = path.join(targetDir, "backlog.md.baseline");
    await fs.writeFile(baselinePath, content, "utf-8");

    // Ensure baseline is ignored
    const gitignorePath = path.join(targetDir, ".gitignore");
    let gitignoreContent = "";
    try {
      gitignoreContent = await fs.readFile(gitignorePath, "utf-8");
    } catch {
      // File doesn't exist yet
    }

    if (!gitignoreContent.includes("backlog.md.baseline")) {
      gitignoreContent += "\nbacklog.md.baseline\n";
      await fs.writeFile(gitignorePath, gitignoreContent, "utf-8");
    }
  } catch {
    // Workspace path may not be mounted on this machine — silently skip.
  }
}
```

## MCP Tool Interface

### Existing Tools (No Changes)

- `list_backlog_tasks`
- `add_backlog_task`
- `complete_backlog_task`

### New Tool

**`sync_backlog`**

**Input Schema:**
```json
{
  "workspace": "string (required)"
}
```

**Returns:**
```json
{
  "content": [
    {
      "type": "text",
      "text": "Synchronized backlog for \"<workspace>\" with N conflict(s). Review and resolve conflict markers in the backlog."
    }
  ]
}
```

**Behavior:**
- Reads workspace backlog, baseline, and central backlog
- Performs three-way merge
- Writes reconciled result to both central and workspace
- Updates baseline
- Reports conflicts if any

## Edge Cases & Risks

### 1. Baseline Missing (First Sync)

**Risk**: No baseline means all workspace changes are treated as new.

**Mitigation**: On first sync, if baseline does not exist, treat current central backlog as the implicit baseline. This assumes central was the source of truth before workspace edits began.

### 2. Workspace Path Not Accessible

**Risk**: Workspace is configured but not mounted on the current machine.

**Mitigation**: Skip silently (consistent with existing `pushToWorkspace` behavior). Log a warning in orchestrator logs but do not fail.

### 3. Conflicting Edits to Same Task

**Risk**: Orchestrator marks a task complete centrally while user edits the same task description locally.

**Mitigation**: Conflict markers preserve both versions. User must manually resolve by choosing one or merging them, then removing the markers.

### 4. Multiple Simultaneous Syncs

**Risk**: Two orchestrator sessions sync the same workspace concurrently, causing race conditions.

**Mitigation**: Not addressed in this spec. Future enhancement: add file-based locking (e.g., `<workspace>/.claude/backlog.lock`) or treat conflicts as resolvable afterward.

### 5. Task Identity Collision

**Risk**: Two tasks with identical descriptions but different metadata (priority, complexity).

**Mitigation**: Current design uses task description as the unique identifier. If descriptions match, they are treated as the same task. To avoid collisions, enforce unique descriptions or add a task UUID field in a future enhancement.

### 6. Large Backlogs

**Risk**: Parsing and merging hundreds of tasks may be slow.

**Mitigation**: Performance is acceptable for backlogs up to ~500 tasks. For larger backlogs, optimize by indexing tasks or using a structured format (JSON) instead of markdown parsing.

### 7. Non-Markdown Edits in Workspace

**Risk**: User adds non-standard markdown (e.g., embedded HTML, nested lists) that breaks the parser.

**Mitigation**: Parser only processes lines matching `- [ ]` or `- [x]` format. Non-standard content is ignored during merge and may be lost. Document the expected format in workspace `CLAUDE.md`.

### 8. Baseline Drift Due to Manual Edits

**Risk**: User manually edits baseline file, breaking the merge logic.

**Mitigation**: Baseline is always overwritten by the orchestrator after every sync. If user edits it, it will be reset on next sync. Document that baseline is orchestrator-managed and should not be edited.

## Dependencies & Prerequisites

### Existing Components Required

1. **Workspace Configuration**: `/home/teruel/claude-orchestrator/config/orchestrator/workspaces.json`
   - Must contain valid workspace paths
2. **Central Backlog Structure**: `/home/teruel/claude-orchestrator/backlogs/<workspace>-backlog.md`
   - Must follow the standard format: `## High Priority`, `## Medium Priority`, `## Low Priority` sections with `- [ ] [COMPLEXITY] task` items
3. **Workspace Backlog Structure**: `<workspace>/.claude/backlog.md`
   - Same format as central backlog
4. **MCP Infrastructure**: `@modelcontextprotocol/sdk` installed in `/home/teruel/claude-orchestrator/mcp-servers/backlog-manager/`

### New Files Created

1. `<workspace>/.claude/backlog.md.baseline` — baseline tracking file (auto-generated)
2. `<workspace>/.claude/.gitignore` — updated to exclude baseline
3. `/home/teruel/claude-orchestrator/scripts/reconcile-all-backlogs.sh` — session-start sync script

### Configuration Changes

- Add session-start directive to `/home/teruel/claude-orchestrator/CLAUDE.md` or implement as a hook

### Testing Prerequisites

Before deploying, test with:
1. A single workspace with a few tasks
2. Manually edit workspace backlog to simulate PR changes
3. Run `sync_backlog` and verify conflicts are detected
4. Resolve conflicts and re-sync to confirm clean merge

### Migration Path

1. Deploy code changes to backlog-manager
2. Run initial sync for all workspaces to generate baselines
3. Verify baselines are created and ignored by git
4. Enable session-start reconciliation
5. Monitor logs for conflicts during first few sessions
