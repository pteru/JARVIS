# Spec: Constraint Extraction on Dispatch

**Status:** Idea
**Type:** Enhancement to task-dispatcher MCP + execution protocol

## Overview

Extend the task dispatch system to automatically extract explicit acceptance criteria from task descriptions and store them in the dispatch record. When a task completes, the executing Claude Code session verifies each criterion programmatically (via CLI, tests, grep, read) before marking the task done. This prevents build drift by ensuring that what was asked for is actually delivered.

Inspired by PAI's Build Drift Prevention pattern: constraints are extracted up-front, stored as structured data, and verified mechanically rather than relying on subjective completion judgment.

---

## Design

### 1. Constraint Extraction at Dispatch Time

When `dispatch_task` is called in `/home/teruel/claude-orchestrator/mcp-servers/task-dispatcher/index.js`, the system performs the following:

1. **Parse the task description** for explicit acceptance criteria, including:
   - File existence checks (e.g., "create a file at X")
   - Test pass requirements (e.g., "all tests in Y must pass")
   - Content verification (e.g., "the file must contain Z")
   - Command success (e.g., "npm run build must succeed")
   - Lint/type checks (e.g., "no TypeScript errors")
   - Dependencies (e.g., "package X must be installed")

2. **Convert natural language criteria into structured constraints**:
   ```json
   {
     "type": "file_exists",
     "path": "src/components/Header.tsx"
   }
   ```
   ```json
   {
     "type": "test_pass",
     "command": "npm test",
     "pattern": "all tests passed"
   }
   ```
   ```json
   {
     "type": "content_match",
     "path": "README.md",
     "pattern": "## Installation"
   }
   ```
   ```json
   {
     "type": "command_success",
     "command": "npm run lint",
     "cwd": "."
   }
   ```

3. **Augment the dispatch record** in `/home/teruel/claude-orchestrator/logs/dispatches.json` with an `acceptance_criteria` array and a `universal_criteria` flag (defaults to true, enforces the CLAUDE.md checklist).

**Enhanced dispatch record schema**:
```json
{
  "id": "dispatch-1234567890-abc123",
  "workspace": "my-app",
  "workspace_path": "/path/to/my-app",
  "task": "Add header component with logo and navigation",
  "complexity": "medium",
  "priority": "high",
  "model": "claude-sonnet-4-5-20250929",
  "status": "pending",
  "created_at": "2026-02-15T10:00:00.000Z",
  "updated_at": "2026-02-15T10:00:00.000Z",
  "acceptance_criteria": [
    {
      "type": "file_exists",
      "path": "src/components/Header.tsx",
      "description": "Header component file must exist"
    },
    {
      "type": "test_pass",
      "command": "npm test -- Header.test.tsx",
      "description": "Header component tests must pass"
    },
    {
      "type": "content_match",
      "path": "src/components/Header.tsx",
      "pattern": "export.*Header",
      "description": "Header must be exported"
    }
  ],
  "universal_criteria": true,
  "verification_results": null
}
```

### 2. Universal Criteria (from CLAUDE.md)

The existing **Task Completion Checklist** in `/home/teruel/claude-orchestrator/CLAUDE.md` defines universal criteria for all tasks:

1. Code changes are implemented and working
2. Existing tests still pass
3. No linting or type errors introduced
4. Changelog entry added via the changelog-writer MCP tool
5. Backlog task marked complete via the backlog-manager MCP tool

When `universal_criteria: true`, the system automatically appends these as verifiable constraints:

```json
{
  "type": "tests_pass",
  "command": "npm test || pytest || cargo test",
  "description": "All existing tests must pass",
  "universal": true
}
```
```json
{
  "type": "no_lint_errors",
  "command": "npm run lint || eslint . || pylint . || cargo clippy",
  "description": "No linting or type errors",
  "universal": true
}
```
```json
{
  "type": "changelog_updated",
  "path": "changelogs/{workspace}.md",
  "pattern": "## \\d{4}-\\d{2}-\\d{2}",
  "description": "Changelog entry added for today",
  "universal": true
}
```
```json
{
  "type": "backlog_updated",
  "path": "backlogs/{workspace}.md",
  "pattern": "\\[x\\]",
  "description": "Backlog task marked complete",
  "universal": true
}
```

**Note**: The system infers the correct test/lint command by examining workspace files (`package.json`, `pyproject.toml`, `Cargo.toml`, etc.).

### 3. Constraint Verification at Completion Time

When the executing Claude Code session reaches the end of a task, it:

1. **Loads the dispatch record** from `/home/teruel/claude-orchestrator/logs/dispatches.json` using the task ID
2. **Iterates through each criterion** in `acceptance_criteria` and verifies it programmatically:
   - `file_exists` → use `Read` tool or `test -f`
   - `test_pass` → run the command via `Bash`, check exit code
   - `content_match` → use `Grep` or `Read` with regex
   - `command_success` → run via `Bash`, check exit code
   - `no_lint_errors` → run linter, verify exit code 0
   - `changelog_updated` → grep for today's date in changelog
   - `backlog_updated` → grep for `[x]` in backlog file

3. **Records verification results** in the dispatch record:
   ```json
   "verification_results": {
     "verified_at": "2026-02-15T11:30:00.000Z",
     "passed": true,
     "criteria_results": [
       {
         "criterion": {"type": "file_exists", "path": "src/components/Header.tsx"},
         "passed": true,
         "output": "File exists"
       },
       {
         "criterion": {"type": "test_pass", "command": "npm test -- Header.test.tsx"},
         "passed": true,
         "output": "✓ 3 tests passed"
       }
     ]
   }
   ```

4. **Updates the dispatch status**:
   - If all criteria pass → `status: "completed"`
   - If any criterion fails → `status: "failed"`, with details in `verification_results`

5. **Reports verification outcome** to the user in the Claude Code session output.

### 4. Failure Handling

If verification fails:
- The task remains in `status: "failed"`
- The `verification_results` object contains which criteria failed and why
- The executing session presents a summary to the user and offers to re-attempt or revise the task
- The user can manually override verification if the criterion was misunderstood (via a new `mark_task_complete_override` tool)

---

## Implementation Steps

### Step 1: Extend task-dispatcher MCP server

**File**: `/home/teruel/claude-orchestrator/mcp-servers/task-dispatcher/index.js`

1. Add a new method `extractAcceptanceCriteria(taskDescription, workspace)`:
   - Use a small language model or regex patterns to identify common constraint patterns
   - Return an array of structured criterion objects
   - Infer workspace-specific commands by reading `package.json`, `pyproject.toml`, etc.

2. Add universal criteria generator `generateUniversalCriteria(workspace)`:
   - Read workspace root to determine language/framework
   - Return standardized test/lint/changelog/backlog criteria
   - Reference the correct paths (`changelogs/{workspace}.md`, `backlogs/{workspace}.md`)

3. Modify `dispatchTask()` method:
   - Call `extractAcceptanceCriteria(task, workspace)` after model selection
   - Call `generateUniversalCriteria(workspace)` if `universal_criteria` flag is true (default)
   - Merge both criterion sets into `acceptance_criteria` array
   - Add `acceptance_criteria` and `universal_criteria` fields to the dispatch record before saving

4. Add a new tool `verify_task_completion`:
   - **Input**: `task_id`
   - **Output**: Verification results (pass/fail per criterion)
   - Loads the dispatch record, runs each verification, updates `verification_results`, changes `status`

5. Add a new tool `mark_task_complete_override`:
   - **Input**: `task_id`, `reason`
   - **Output**: Confirmation
   - Allows manual override of verification (logs the reason in the dispatch record)

### Step 2: Create constraint verification library

**File**: `/home/teruel/claude-orchestrator/mcp-servers/task-dispatcher/lib/verify-criteria.js` (new)

1. Implement verifier functions for each criterion type:
   ```javascript
   async function verifyFileExists(criterion, workspacePath) {
     const fullPath = path.join(workspacePath, criterion.path);
     const exists = await fs.access(fullPath).then(() => true).catch(() => false);
     return { passed: exists, output: exists ? "File exists" : "File not found" };
   }

   async function verifyTestPass(criterion, workspacePath) {
     const { stdout, stderr, exitCode } = await execCommand(criterion.command, workspacePath);
     const passed = exitCode === 0;
     return { passed, output: passed ? stdout : stderr };
   }

   async function verifyContentMatch(criterion, workspacePath) {
     const fullPath = path.join(workspacePath, criterion.path);
     const content = await fs.readFile(fullPath, 'utf-8');
     const regex = new RegExp(criterion.pattern);
     const passed = regex.test(content);
     return { passed, output: passed ? "Pattern found" : "Pattern not found" };
   }

   async function verifyCommandSuccess(criterion, workspacePath) {
     const { stdout, stderr, exitCode } = await execCommand(criterion.command, workspacePath);
     const passed = exitCode === 0;
     return { passed, output: passed ? stdout : stderr };
   }
   ```

2. Export a dispatcher function:
   ```javascript
   export async function verifyCriterion(criterion, workspacePath) {
     switch (criterion.type) {
       case "file_exists": return await verifyFileExists(criterion, workspacePath);
       case "test_pass": return await verifyTestPass(criterion, workspacePath);
       case "content_match": return await verifyContentMatch(criterion, workspacePath);
       case "command_success": return await verifyCommandSuccess(criterion, workspacePath);
       // ... add handlers for other types
       default: return { passed: false, output: `Unknown criterion type: ${criterion.type}` };
     }
   }
   ```

### Step 3: Update CLAUDE.md checklist

**File**: `/home/teruel/claude-orchestrator/CLAUDE.md`

1. Add a new section under **Task Completion Checklist**:
   ```markdown
   ## Task Completion Checklist
   Before marking any task as complete:
   1. Code changes are implemented and working
   2. Existing tests still pass
   3. No linting or type errors introduced
   4. Changelog entry added via the changelog-writer MCP tool
   5. Backlog task marked complete via the backlog-manager MCP tool
   6. **Acceptance criteria verified** (automatic via task-dispatcher MCP `verify_task_completion`)
   ```

2. Add a new section **Constraint Verification Protocol**:
   ```markdown
   ## Constraint Verification Protocol
   When a task is dispatched, acceptance criteria are extracted and stored in the dispatch record.
   Before marking a task complete, run `verify_task_completion` via the task-dispatcher MCP tool.
   If verification fails, address the failing criteria before marking the task done.
   If a criterion was misunderstood, use `mark_task_complete_override` with a clear reason.
   ```

### Step 4: Create constraint extraction prompt

**File**: `/home/teruel/claude-orchestrator/mcp-servers/task-dispatcher/lib/extract-criteria-prompt.txt` (new)

This prompt is used internally by the `extractAcceptanceCriteria()` function to guide criterion extraction:

```
You are analyzing a task description to extract explicit acceptance criteria.

Task description:
"""
{task}
"""

Workspace: {workspace}

Extract all verifiable acceptance criteria from the task description. Return a JSON array of criterion objects.

Supported criterion types:
- file_exists: A file must exist at a specific path
- test_pass: A test command must succeed
- content_match: A file must contain a specific pattern (regex)
- command_success: A command must run successfully (exit code 0)
- no_lint_errors: Linting must pass with no errors
- changelog_updated: Changelog must have an entry for today
- backlog_updated: Backlog task must be marked complete

Example output:
[
  {
    "type": "file_exists",
    "path": "src/components/Header.tsx",
    "description": "Header component file must exist"
  },
  {
    "type": "test_pass",
    "command": "npm test -- Header.test.tsx",
    "description": "Header component tests must pass"
  }
]

Only extract criteria that are explicitly stated or strongly implied in the task description.
Do not invent criteria that are not mentioned.
Return an empty array if no explicit criteria are found.
```

### Step 5: Update dispatch workflow documentation

**File**: `/home/teruel/claude-orchestrator/README.md` (if exists, otherwise add to CLAUDE.md)

Document the enhanced dispatch flow:
1. Task is dispatched → criteria extracted → stored in dispatch record
2. Claude Code session executes the task
3. Before marking done, session calls `verify_task_completion` tool
4. Tool runs all verifications, updates dispatch record, reports pass/fail
5. If pass → task marked complete; if fail → user addresses issues or overrides

---

## MCP Tool Interface

### New Tools in task-dispatcher

#### `verify_task_completion`

**Description**: Verify all acceptance criteria for a dispatched task

**Input**:
```json
{
  "task_id": "dispatch-1234567890-abc123"
}
```

**Output**:
```json
{
  "task_id": "dispatch-1234567890-abc123",
  "verified_at": "2026-02-15T11:30:00.000Z",
  "passed": true,
  "criteria_results": [
    {
      "criterion": {"type": "file_exists", "path": "src/components/Header.tsx"},
      "passed": true,
      "output": "File exists"
    },
    {
      "criterion": {"type": "test_pass", "command": "npm test"},
      "passed": true,
      "output": "✓ 15 tests passed"
    }
  ]
}
```

#### `mark_task_complete_override`

**Description**: Manually override verification and mark task complete

**Input**:
```json
{
  "task_id": "dispatch-1234567890-abc123",
  "reason": "Criterion misunderstood: tests are in a different location"
}
```

**Output**:
```json
{
  "task_id": "dispatch-1234567890-abc123",
  "status": "completed",
  "override_applied": true,
  "override_reason": "Criterion misunderstood: tests are in a different location",
  "overridden_at": "2026-02-15T11:35:00.000Z"
}
```

---

## Edge Cases & Risks

### 1. Ambiguous or Implicit Criteria
**Problem**: Some tasks have implicit acceptance criteria that are not stated explicitly (e.g., "refactor the auth module" doesn't specify what tests should pass).

**Mitigation**:
- Default to universal criteria (tests, lint, changelog) when no explicit criteria are found
- Extraction prompt explicitly instructs to only extract what is stated or strongly implied
- Users can manually add criteria to the dispatch record if needed (via a future `add_acceptance_criterion` tool)

### 2. False Negatives in Verification
**Problem**: A criterion might fail due to a brittle check (e.g., test output format changed).

**Mitigation**:
- Provide clear error output in `verification_results`
- Allow manual override via `mark_task_complete_override` with a logged reason
- Over time, refine criterion patterns based on observed failures

### 3. Over-Constraint
**Problem**: Too many criteria might make simple tasks feel bureaucratic.

**Mitigation**:
- Only extract criteria that are explicitly stated in the task
- Allow `universal_criteria: false` to skip the CLAUDE.md checklist for very simple tasks
- Provide a way to edit or remove criteria before execution (via a future `edit_dispatch` tool)

### 4. Workspace-Specific Commands
**Problem**: Extracting the correct test/lint command requires workspace inspection.

**Mitigation**:
- The `extractAcceptanceCriteria()` function reads `package.json`, `pyproject.toml`, etc. to infer commands
- Fallback to common defaults (`npm test`, `pytest`, `cargo test`) if not found
- Store the inferred command in the criterion object so it can be reviewed/edited

### 5. Parallel Execution
**Problem**: If multiple sessions execute tasks in the same workspace simultaneously, verification might interfere (e.g., one session's changes break another's tests).

**Mitigation**:
- Not addressed in this spec (out of scope)
- Future work: add workspace locking or execution queue

### 6. Criterion Extraction Accuracy
**Problem**: LLM-based extraction might misinterpret the task description.

**Mitigation**:
- Start with simple regex-based patterns for common criteria (file paths, test commands)
- Use a small, fast model (Haiku) for extraction to keep costs low
- Log extraction decisions so they can be audited and refined
- Allow manual review/edit of criteria before dispatch (future enhancement)

---

## Dependencies & Prerequisites

### Required Changes
1. **task-dispatcher MCP server** (`/home/teruel/claude-orchestrator/mcp-servers/task-dispatcher/index.js`):
   - Add `extractAcceptanceCriteria()` method
   - Add `generateUniversalCriteria()` method
   - Extend `dispatchTask()` to populate `acceptance_criteria` in dispatch record
   - Add `verify_task_completion` tool
   - Add `mark_task_complete_override` tool

2. **New verification library** (`/home/teruel/claude-orchestrator/mcp-servers/task-dispatcher/lib/verify-criteria.js`):
   - Implement verifier functions for each criterion type
   - Export unified verification dispatcher

3. **Dispatch record schema** (`/home/teruel/claude-orchestrator/logs/dispatches.json`):
   - Add `acceptance_criteria` array field
   - Add `universal_criteria` boolean field (default true)
   - Add `verification_results` object field (null until verified)

4. **CLAUDE.md** (`/home/teruel/claude-orchestrator/CLAUDE.md`):
   - Update Task Completion Checklist to reference constraint verification
   - Add new Constraint Verification Protocol section

### Optional Enhancements (Future Work)
- **Edit dispatch before execution**: Allow reviewing/editing criteria after extraction
- **Criterion library**: Predefined criterion templates for common patterns
- **Verification reports**: Generate a summary of verification results across all tasks
- **Interactive refinement**: If extraction misses criteria, user can teach the system

### External Dependencies
- None (uses existing Node.js filesystem and child process APIs)

### Testing Requirements
1. Unit tests for each verifier function in `verify-criteria.js`
2. Integration test: dispatch task → extract criteria → verify → update status
3. Edge case tests: empty criteria, all passing, all failing, mixed results
4. Override test: verify that manual override works and is logged correctly
