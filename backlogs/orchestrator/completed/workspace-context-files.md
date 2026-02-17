# Spec: Workspace Context Files (TELOS-style)

**Status:** Idea
**Type:** Enhancement - MCP Server + Task Dispatcher

## Overview

Add per-workspace context files at `<workspace>/.claude/context.md` to provide richer project understanding when tasks are dispatched. Inspired by PAI's TELOS system (MISSION.md, GOALS.md, PROJECTS.md), these context files capture purpose, tech stack, active goals, and constraints without requiring the orchestrator or executing agent to scan the entire codebase.

The task-dispatcher MCP injects this context when generating the `claude --model X --print "task"` command, giving the executing Claude Code session immediate visibility into project fundamentals.

---

## Design

### Context File Location

Each workspace gets a `.claude/context.md` file at its root:

```
/home/teruel/claude-orchestrator/workspaces/strokmatic/visionking/services/visionking-backend/.claude/context.md
```

The orchestrator **already pushes** `backlog.md` to `<workspace>/.claude/backlog.md` via the backlog-manager MCP (see `/home/teruel/claude-orchestrator/mcp-servers/backlog-manager/index.js` lines 53-66), establishing precedent for the `.claude/` directory pattern.

### Context File Structure

Format inspired by PAI's TELOS but simplified for code projects:

```markdown
# Context: <Workspace Name>

## Purpose
Brief description of what this workspace does (1-2 sentences).

## Tech Stack
- **Language:** Node.js / Python / C++ / etc.
- **Framework:** Express / FastAPI / Angular / etc.
- **Database:** PostgreSQL / Redis / etc.
- **Infrastructure:** Docker / Kubernetes / GCP / etc.

## Active Goals
- Short-term objectives currently in progress
- Key milestones or deliverables expected soon
- Areas of focus for the next sprint/iteration

## Constraints
- Known limitations (e.g., legacy code areas to avoid refactoring)
- Dependency freeze dates or versioning rules
- Performance/resource budgets
- Required approval gates (e.g., security review before deploying auth changes)

## Related Workspaces
- `<workspace-key>`: Brief description of relationship
- Example: `strokmatic.visionking.services.visionking-frontend`: Frontend consumer of this API
```

### Integration with Task Dispatcher

The task-dispatcher MCP at `/home/teruel/claude-orchestrator/mcp-servers/task-dispatcher/index.js` currently generates:

```javascript
command: `claude --model ${model} --print "${task}"`
```

**Enhancement:** Before dispatching, read `<workspace-path>/.claude/context.md`. If it exists, inject it into the task prompt:

```javascript
const contextPath = path.join(workspacePath, '.claude', 'context.md');
let enrichedTask = task;

try {
  const contextContent = await fs.readFile(contextPath, 'utf-8');
  enrichedTask = `# Workspace Context\n\n${contextContent}\n\n---\n\n# Task\n\n${task}`;
} catch {
  // No context file — proceed with original task
}

command: `claude --model ${model} --print "${enrichedTask}"`;
```

This approach mirrors how workspace-analyzer already reads workspace metadata (package.json, README.md, CLAUDE.md) in `/home/teruel/claude-orchestrator/mcp-servers/workspace-analyzer/index.js` lines 135-163.

---

## Implementation Steps

### 1. Generate Initial Context Files

**New MCP Tool:** Add `generate_workspace_context` to the workspace-analyzer MCP.

**Location:** `/home/teruel/claude-orchestrator/mcp-servers/workspace-analyzer/index.js`

**Logic:**
1. Analyze workspace using existing `analyzeWorkspaceHealth` method (detects package.json, README, test dirs, git status)
2. Infer tech stack:
   - Check `package.json` → Node.js, detect framework from dependencies (Express, Fastify, Angular, React, etc.)
   - Check `requirements.txt` / `pyproject.toml` / `Pipfile` → Python, detect framework (FastAPI, Flask, Django)
   - Check `pom.xml` / `build.gradle` → Java
   - Check `Cargo.toml` → Rust
   - Check `go.mod` → Go
   - Check `Makefile` + `.c`/`.cpp` files → C/C++
3. Extract purpose from README.md (first heading + first paragraph)
4. Generate a `context.md` template with detected values and placeholder sections for user review
5. Write to `<workspace-path>/.claude/context.md`
6. Return a summary prompting the user to review and refine the generated context

**Tool Schema:**
```javascript
{
  name: "generate_workspace_context",
  description: "Generate initial context.md file for a workspace based on codebase analysis",
  inputSchema: {
    type: "object",
    properties: {
      workspace_path: {
        type: "string",
        description: "Path to workspace root"
      },
      overwrite: {
        type: "boolean",
        description: "Overwrite existing context.md if present (default: false)"
      }
    },
    required: ["workspace_path"]
  }
}
```

### 2. Modify Task Dispatcher to Inject Context

**Location:** `/home/teruel/claude-orchestrator/mcp-servers/task-dispatcher/index.js`

**Changes:**

1. Add helper method `loadWorkspaceContext(workspacePath)` similar to the existing `getWorkspacePath` pattern in backlog-manager (lines 39-51):

```javascript
async loadWorkspaceContext(workspacePath) {
  const contextPath = path.join(workspacePath, '.claude', 'context.md');
  try {
    return await fs.readFile(contextPath, 'utf-8');
  } catch {
    return null;
  }
}
```

2. Update `dispatchTask` method (lines 235-288) to inject context before building the command:

```javascript
async dispatchTask(workspace, task, complexity = "medium", priority = "medium") {
  const config = await this.loadWorkspaces();
  const ws = config.workspaces?.[workspace];
  if (!ws) {
    throw new Error(`Workspace "${workspace}" not found in workspaces.json`);
  }

  const model = await this.selectModel(complexity, task);
  const taskId = `dispatch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // Load workspace context if available
  const contextContent = await this.loadWorkspaceContext(ws.path);
  let enrichedTask = task;

  if (contextContent) {
    enrichedTask = `# Workspace Context\n\n${contextContent}\n\n---\n\n# Task\n\n${task}`;
  }

  const dispatch = {
    id: taskId,
    workspace,
    workspace_path: ws.path,
    task: enrichedTask,  // Store enriched version
    original_task: task,  // Keep original for reference
    complexity,
    priority,
    model,
    status: "pending",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    has_context: !!contextContent
  };

  const dispatches = await this.loadDispatches();
  dispatches.push(dispatch);
  await this.saveDispatches(dispatches);

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            message: `Task dispatched to ${workspace}`,
            task_id: taskId,
            model,
            workspace_path: ws.path,
            context_injected: !!contextContent,
            command: `claude --model ${model} --print "${enrichedTask}"`,
          },
          null,
          2,
        ),
      },
    ],
  };
}
```

### 3. Bootstrap Context Files for Existing Workspaces

**Manual workflow:**

1. List all configured workspaces from `/home/teruel/claude-orchestrator/config/orchestrator/workspaces.json`
2. For each workspace, use the new `generate_workspace_context` tool to create initial drafts
3. Review and refine each generated `context.md` manually or with assistance from Claude
4. Commit the `.claude/context.md` files to each workspace's git repository

**Automation (optional):**

Create a one-time orchestrator script: `/home/teruel/claude-orchestrator/scripts/bootstrap-context-files.js`

```javascript
#!/usr/bin/env node
// Reads workspaces.json, calls generate_workspace_context for each, logs results
```

This follows the pattern established by the existing workspace-analyzer's suggest_tasks functionality (lines 208-268).

### 4. Documentation

Update `/home/teruel/claude-orchestrator/CLAUDE.md`:

**File Structure section:**
```markdown
## File Structure
- `backlogs/` - Per-workspace task backlogs (markdown)
- `changelogs/` - Per-workspace changelogs (Keep a Changelog format)
- `reports/` - Generated daily and weekly reports
- `logs/` - Dispatch logs and cron output
- `config/` - Workspace, model, and schedule configuration
- `backlog.md` - Self-improvement ideas and feature backlog for the orchestrator itself

**Per-Workspace `.claude/` Directory:**
- `context.md` - Workspace purpose, tech stack, goals, constraints (injected into dispatched tasks)
- `backlog.md` - Workspace-specific task backlog (synced from orchestrator)
- `CLAUDE.md` - Claude Code project instructions (workspace-specific)
```

**MCP Tools section:**
```markdown
## MCP Tools Available
- **backlog-manager**: Manage task backlogs per workspace
- **changelog-writer**: Record changes to workspace changelogs
- **workspace-analyzer**: Analyze workspace health, suggest tasks, generate context files
- **task-dispatcher**: Dispatch tasks with model selection and context injection
- **report-generator**: Generate daily/weekly activity reports
```

---

## MCP Tool Interface

### New Tool: `generate_workspace_context`

**Server:** workspace-analyzer (`/home/teruel/claude-orchestrator/mcp-servers/workspace-analyzer/index.js`)

**Input:**
```json
{
  "workspace_path": "/home/teruel/claude-orchestrator/workspaces/strokmatic/visionking/services/visionking-backend",
  "overwrite": false
}
```

**Output:**
```json
{
  "status": "created",
  "path": "/home/teruel/claude-orchestrator/workspaces/strokmatic/visionking/services/visionking-backend/.claude/context.md",
  "detected": {
    "tech_stack": "Node.js (Express)",
    "purpose": "VisionKing backend API service",
    "has_tests": true,
    "has_readme": true
  },
  "message": "Context file generated. Review and refine the Active Goals and Constraints sections."
}
```

**Error Cases:**
- Workspace path does not exist → `Error: Workspace path not found`
- Context file already exists and `overwrite: false` → `Error: Context file exists. Set overwrite: true to replace.`
- No detectable metadata (no package.json, README, etc.) → Warning, generate minimal template

### Modified Tool: `dispatch_task`

**Server:** task-dispatcher (`/home/teruel/claude-orchestrator/mcp-servers/task-dispatcher/index.js`)

**Input:** (unchanged)
```json
{
  "workspace": "strokmatic.visionking.services.visionking-backend",
  "task": "Add rate limiting to the /api/inference endpoint",
  "complexity": "medium",
  "priority": "high"
}
```

**Output:** (enhanced)
```json
{
  "message": "Task dispatched to strokmatic.visionking.services.visionking-backend",
  "task_id": "dispatch-1707856234567-a3f9c2",
  "model": "claude-sonnet-4-5-20250929",
  "workspace_path": "/home/teruel/claude-orchestrator/workspaces/strokmatic/visionking/services/visionking-backend",
  "context_injected": true,
  "command": "claude --model claude-sonnet-4-5-20250929 --print \"# Workspace Context\n\n[...context.md contents...]\n\n---\n\n# Task\n\nAdd rate limiting to the /api/inference endpoint\""
}
```

---

## Edge Cases & Risks

### 1. Context File Too Large

**Risk:** A verbose `context.md` (>4000 tokens) could bloat the task prompt and waste context window.

**Mitigation:**
- Enforce length guidelines in the template (e.g., "Purpose: 1-2 sentences, Active Goals: max 5 bullets")
- Add validation in `generate_workspace_context` to warn if generated file exceeds 3000 characters
- Task dispatcher could truncate or summarize context if needed (future enhancement)

### 2. Stale Context

**Risk:** Context files become outdated as projects evolve.

**Mitigation:**
- Add timestamp to context.md header: `Last updated: YYYY-MM-DD`
- workspace-analyzer's `suggest_tasks` tool could detect outdated context (>90 days) and suggest refreshing it
- Include a "Review workspace context" checklist item in the orchestrator's weekly report

### 3. Inconsistent Context Quality

**Risk:** Auto-generated context may be incomplete or inaccurate for workspaces with poor/missing documentation.

**Mitigation:**
- Mark auto-generated sections with `<!-- AUTO-GENERATED -->` comments
- Prompt user to review and refine after generation
- For workspaces with missing README/package.json, generate minimal template and flag for manual completion

### 4. Context Injection Breaks Prompts

**Risk:** Injecting context as a Markdown prefix could interfere with task prompts that expect specific formatting.

**Mitigation:**
- Use a clear delimiter (`---`) between context and task
- Make injection opt-out: add `skip_context: true` parameter to `dispatch_task`
- Test with varied task formats (questions, commands, code snippets) to ensure compatibility

### 5. `.claude/` Directory Not in Git

**Risk:** Workspaces may `.gitignore` the `.claude/` directory, losing context files when cloning.

**Mitigation:**
- Document recommended `.gitignore` pattern in CLAUDE.md:
  ```
  .claude/settings.local.json
  !.claude/context.md
  !.claude/CLAUDE.md
  ```
- Bootstrap script could check for context file presence and regenerate if missing

---

## Dependencies & Prerequisites

### Existing Infrastructure

- **backlog-manager MCP** already creates `.claude/` directories and writes `backlog.md` (lines 53-66 of `/home/teruel/claude-orchestrator/mcp-servers/backlog-manager/index.js`)
- **workspace-analyzer MCP** already analyzes package.json, README, tests, git status (lines 127-206 of `/home/teruel/claude-orchestrator/mcp-servers/workspace-analyzer/index.js`)
- **task-dispatcher MCP** already reads workspace paths from `/home/teruel/claude-orchestrator/config/orchestrator/workspaces.json` (lines 57-65 of `/home/teruel/claude-orchestrator/mcp-servers/task-dispatcher/index.js`)

### Configuration File

**Location:** `/home/teruel/claude-orchestrator/config/orchestrator/workspaces.json`

Each workspace entry has a `path` field:
```json
{
  "workspaces": {
    "strokmatic.visionking.services.visionking-backend": {
      "path": "/home/teruel/claude-orchestrator/workspaces/strokmatic/visionking/services/visionking-backend",
      "type": "nodejs",
      "category": "service",
      "product": "visionking",
      "priority": "high",
      "auto_review": true,
      "remotes": {
        "origin": "git@github.com:strokmatic/visionking-backend.git"
      }
    }
  }
}
```

The workspace-analyzer and task-dispatcher already resolve these paths — no schema changes required.

### Node.js Dependencies

All required modules already present in both MCPs:
- `fs/promises` for file I/O
- `path` for path resolution
- MCP SDK for tool definitions

**No additional npm packages needed.**

### Rollout Sequence

1. Implement `generate_workspace_context` in workspace-analyzer MCP
2. Test context generation on 2-3 representative workspaces (Node.js, Python, C++)
3. Modify task-dispatcher to inject context
4. Test end-to-end: generate context → dispatch task → verify enriched prompt
5. Bootstrap context files for all configured workspaces
6. Document in CLAUDE.md
7. Add "Refresh workspace context" to workspace-analyzer's `suggest_tasks` output

---

## References

- **PAI TELOS System:** `/home/teruel/claude-orchestrator/references/Personal_AI_Infrastructure/Releases/v2.3/.claude/CLAUDE.md` (lines 1-84)
- **backlog-manager `pushToWorkspace`:** `/home/teruel/claude-orchestrator/mcp-servers/backlog-manager/index.js` (lines 53-66)
- **workspace-analyzer `analyzeWorkspaceHealth`:** `/home/teruel/claude-orchestrator/mcp-servers/workspace-analyzer/index.js` (lines 127-206)
- **task-dispatcher `dispatchTask`:** `/home/teruel/claude-orchestrator/mcp-servers/task-dispatcher/index.js` (lines 235-288)
- **Workspace configuration:** `/home/teruel/claude-orchestrator/config/orchestrator/workspaces.json`
