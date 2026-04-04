# Spec: Model Selection Learning

**Status:** Idea
**Type:** Enhancement / New MCP Tool

## Overview

Build a feedback loop for the task dispatcher to track which model + complexity + task-type combinations succeed, fail, or require retries. After N completions, surface patterns to automatically suggest updates to `/home/teruel/JARVIS/config/orchestrator/models.json` rules.

**Inspiration:** PAI's implicit signal capture — learning from outcomes without explicit feedback.

**Core Principle:** The orchestrator already dispatches tasks; we currently log the dispatch but never capture outcomes. By tracking success/failure/retry signals, we can iteratively improve model selection accuracy and reduce unnecessary costs (e.g., using Opus when Haiku would suffice).

---

## Design

### Data Model

Extend `/home/teruel/JARVIS/logs/dispatches.json` schema:

**Current schema:**
```json
{
  "id": "dispatch-1234567890-abc123",
  "workspace": "api-backend",
  "workspace_path": "/home/user/projects/api-backend",
  "task": "Add rate limiting middleware",
  "complexity": "medium",
  "priority": "medium",
  "model": "claude-sonnet-4-5-20250929",
  "status": "pending",
  "created_at": "2026-02-15T10:00:00Z",
  "updated_at": "2026-02-15T10:00:00Z"
}
```

**Enhanced schema (additions in bold):**
```json
{
  "id": "dispatch-1234567890-abc123",
  "workspace": "api-backend",
  "workspace_path": "/home/user/projects/api-backend",
  "task": "Add rate limiting middleware",
  "complexity": "medium",
  "priority": "medium",
  "model": "claude-sonnet-4-5-20250929",
  "status": "completed",
  "created_at": "2026-02-15T10:00:00Z",
  "updated_at": "2026-02-15T10:15:00Z",

  "outcome": "success",  // "success" | "failure" | "partial"
  "retry_count": 0,
  "execution_time_seconds": 120,
  "tokens_used": 15000,
  "task_keywords": ["rate limiting", "middleware", "express"],
  "model_was_sufficient": true,  // false if downgrade would have worked
  "notes": ""  // optional human or automated notes
}
```

### Learning Metrics

Track aggregates in `/home/teruel/JARVIS/logs/model-learning.json`:

```json
{
  "last_updated": "2026-02-15T10:15:00Z",
  "total_dispatches": 347,
  "patterns": [
    {
      "pattern_id": "architecture-opus",
      "trigger": "task contains 'architecture'",
      "complexity": "complex",
      "model": "claude-opus-4-5-20251101",
      "success_rate": 0.95,
      "sample_size": 20,
      "avg_tokens": 25000,
      "confidence": "high"
    },
    {
      "pattern_id": "docs-haiku-underperforming",
      "trigger": "task contains 'documentation'",
      "complexity": "simple",
      "model": "claude-haiku-4-5-20251001",
      "success_rate": 0.60,
      "sample_size": 15,
      "avg_tokens": 8000,
      "confidence": "medium",
      "suggestion": "Consider upgrading to sonnet for documentation tasks with > 3 files"
    }
  ],
  "suggestions": [
    {
      "type": "new_rule",
      "rule": {
        "if": "task contains 'API design' or 'OpenAPI'",
        "use": "sonnet"
      },
      "reason": "7/8 recent API design tasks succeeded with Sonnet, 1/3 failed with Haiku",
      "confidence": 0.85
    },
    {
      "type": "upgrade_complexity",
      "from": "simple",
      "to": "medium",
      "condition": "task contains 'refactor' and estimated_files > 2",
      "reason": "Refactor tasks marked 'simple' have 45% retry rate",
      "confidence": 0.72
    }
  ]
}
```

### Feedback Signals

**Implicit signals (automated):**
1. **Success:** Dispatch status transitions to `completed` with no retries
2. **Failure:** Status transitions to `failed` or retry_count > 0
3. **Retry:** Same task descriptor dispatched multiple times within 1 hour
4. **Execution time:** Longer execution may indicate model struggling
5. **Token usage:** Abnormally high token count may indicate inefficiency

**Explicit signals (optional, future):**
- Human rating via CLI: `claude-orchestrator rate-task <task-id> [success|failure|partial]`
- Post-task checkpoint: Prompt user after completion "Did this task complete successfully? (y/n)"

---

## Implementation Steps

### Phase 1: Outcome Tracking

**Goal:** Capture task outcomes without breaking existing dispatches.

1. **Extend task-dispatcher schema**
   - File: `/home/teruel/JARVIS/mcp-servers/task-dispatcher/index.js`
   - Add fields to dispatch object (lines 253-264): `outcome`, `retry_count`, `execution_time_seconds`, `tokens_used`, `task_keywords`, `model_was_sufficient`, `notes`
   - Defaults: `outcome: null`, `retry_count: 0`, others `null`

2. **Add `update_task_outcome` tool to task-dispatcher**
   - Tool signature:
     ```javascript
     {
       name: "update_task_outcome",
       description: "Record the outcome of a dispatched task",
       inputSchema: {
         task_id: string,
         outcome: "success" | "failure" | "partial",
         execution_time_seconds?: number,
         tokens_used?: number,
         notes?: string
       }
     }
     ```
   - Implementation:
     - Load `dispatches.json`
     - Find task by ID
     - Update `outcome`, `status` (set to `completed` or `failed`), `updated_at`
     - Increment `retry_count` if this is a re-dispatch
     - Save back to `dispatches.json`

3. **Extract task keywords automatically**
   - On dispatch, parse `task` string for common patterns:
     - Regex match: `/(architecture|design|refactor|bug|fix|test|docs|documentation|api|database|performance|security)/gi`
     - Store array in `task_keywords` field
   - Used later for pattern matching

### Phase 2: Pattern Analysis

**Goal:** Aggregate outcomes and detect patterns.

4. **Create `model-learning-analyzer` MCP tool**
   - New server: `/home/teruel/JARVIS/mcp-servers/model-learning-analyzer/index.js`
   - Package.json, install dependencies (same as other MCP servers)
   - Register in `/home/teruel/JARVIS/config/claude/config.json`

5. **Implement `analyze_model_performance` tool**
   - Reads `/home/teruel/JARVIS/logs/dispatches.json`
   - Filters to completed tasks (outcome != null, sample_size >= 5)
   - Groups by:
     - `complexity` + `model`
     - `task_keywords` + `model`
   - Calculates:
     - Success rate: `count(outcome == "success") / count(total)`
     - Avg tokens, avg execution time
     - Confidence: `min(sample_size / 20, 1.0)` (20 samples = high confidence)
   - Writes to `/home/teruel/JARVIS/logs/model-learning.json`

6. **Implement `suggest_model_rules` tool**
   - Reads `model-learning.json`
   - Identifies patterns:
     - **Underperforming models:** success_rate < 0.70, sample_size >= 8
     - **Over-provisioned models:** Opus used but Sonnet would suffice (compare keyword success rates)
     - **Missing rules:** Task keyword frequent (>10 occurrences) but no rule in `models.json`
   - Generates suggestions array (see schema above)
   - Returns markdown-formatted report

### Phase 3: Automatic Rule Updates

**Goal:** Semi-automated updates to `models.json`.

7. **Implement `apply_model_suggestion` tool**
   - Takes a suggestion ID from `model-learning.json`
   - Validates suggestion (confidence >= 0.70)
   - Backs up `/home/teruel/JARVIS/config/orchestrator/models.json` to `models.json.bak.<timestamp>`
   - Applies change:
     - `new_rule`: Append to `rules` array
     - `upgrade_complexity`: Update `task_complexity` mapping
     - `modify_rule`: Edit existing rule
   - Writes updated `models.json`
   - Logs change to `/home/teruel/JARVIS/logs/model-config-changes.log`

8. **Manual review workflow**
   - Run `analyze_model_performance` weekly (cron or manual)
   - Run `suggest_model_rules` to review suggestions
   - Human reviews markdown report
   - Approves suggestions via `apply_model_suggestion <id>`
   - Or rejects: `reject_model_suggestion <id>` (prevents re-suggesting)

### Phase 4: Retry Detection

**Goal:** Automatically detect when a task is retried.

9. **Add retry detection to task-dispatcher**
   - On `dispatch_task`, check if a task with similar description was dispatched recently:
     - Load `dispatches.json`
     - Find tasks with same `workspace` and Levenshtein distance < 20% in past 1 hour
     - If found and previous task failed/partial, increment `retry_count`
     - Link to previous task: `previous_dispatch_id`

10. **Surface retries in analysis**
    - `analyze_model_performance` weighs retries heavily:
      - Tasks with `retry_count > 0` count as failures for that model
      - Surfaced in "frequent retries" report section

---

## MCP Tool Interface

### New Tools in `task-dispatcher`

```javascript
{
  name: "update_task_outcome",
  description: "Record the outcome of a dispatched task",
  inputSchema: {
    type: "object",
    properties: {
      task_id: { type: "string", description: "Task ID from dispatch" },
      outcome: {
        type: "string",
        enum: ["success", "failure", "partial"],
        description: "Task outcome"
      },
      execution_time_seconds: { type: "number" },
      tokens_used: { type: "number" },
      notes: { type: "string" }
    },
    required: ["task_id", "outcome"]
  }
}
```

### New MCP Server: `model-learning-analyzer`

```javascript
{
  tools: [
    {
      name: "analyze_model_performance",
      description: "Analyze dispatch history and compute model success rates",
      inputSchema: {
        type: "object",
        properties: {
          min_sample_size: { type: "number", default: 5 },
          since_date: { type: "string", description: "ISO date, analyze only recent dispatches" }
        }
      }
    },
    {
      name: "suggest_model_rules",
      description: "Generate suggestions for models.json based on performance data",
      inputSchema: {
        type: "object",
        properties: {
          min_confidence: { type: "number", default: 0.70 }
        }
      }
    },
    {
      name: "apply_model_suggestion",
      description: "Apply an approved suggestion to models.json",
      inputSchema: {
        type: "object",
        properties: {
          suggestion_id: { type: "string" }
        },
        required: ["suggestion_id"]
      }
    },
    {
      name: "reject_model_suggestion",
      description: "Mark a suggestion as rejected to prevent re-surfacing",
      inputSchema: {
        type: "object",
        properties: {
          suggestion_id: { type: "string" },
          reason: { type: "string" }
        },
        required: ["suggestion_id"]
      }
    }
  ]
}
```

---

## Edge Cases & Risks

### Edge Cases

1. **Low sample size bias**
   - Risk: With <5 samples, patterns are noise
   - Mitigation: Require `min_sample_size >= 5` for pattern detection, display confidence scores

2. **Task description ambiguity**
   - Risk: "Fix bug" could be trivial or complex
   - Mitigation: Extract keywords AND consider file count, workspace type as additional signals

3. **Human error in outcome reporting**
   - Risk: User marks task as "success" but it actually failed
   - Mitigation: Cross-check with retry signals, execution time anomalies

4. **Model availability changes**
   - Risk: Opus becomes unavailable, rules reference non-existent model
   - Mitigation: Validate model IDs against API during `apply_model_suggestion`

5. **Circular feedback loops**
   - Risk: System downgrades to Haiku → fails → marks Haiku as bad → never tries Haiku again
   - Mitigation: Always maintain minimum sample across all models (force 10% exploration)

### Risks

1. **Over-optimization for cost**
   - Risk: System aggressively downgrades to Haiku, sacrifices quality
   - Impact: Tasks fail more, require retries (wasting more than saved)
   - Mitigation: Track total cost INCLUDING retries, optimize for cost-per-success not cost-per-dispatch

2. **Stale patterns**
   - Risk: Model capabilities improve (e.g., new Haiku release), old patterns no longer apply
   - Impact: Underutilization of cheaper models
   - Mitigation: Decay old data — only analyze dispatches from past 90 days

3. **Configuration drift**
   - Risk: Auto-applied rules contradict each other, `models.json` becomes unmaintainable
   - Impact: Non-deterministic model selection
   - Mitigation: Require human approval for rule conflicts, version-control `models.json`, log all changes

4. **Privacy/security**
   - Risk: Task descriptions may contain sensitive data, logged indefinitely
   - Impact: Compliance issues
   - Mitigation: Redact PII from task descriptions before logging, rotate `dispatches.json` after 90 days

---

## Dependencies & Prerequisites

### Existing Files & Schemas

- `/home/teruel/JARVIS/mcp-servers/task-dispatcher/index.js`
  - Modify: `dispatchTask()` method (lines 235-288)
  - Add: `updateTaskOutcome()` method
  - Add: Keyword extraction in dispatch flow

- `/home/teruel/JARVIS/config/orchestrator/models.json`
  - Schema reference for rules
  - Will be read and written by learning system

- `/home/teruel/JARVIS/logs/dispatches.json`
  - Extend schema (backwards compatible — new fields default to null)

### New Files

- `/home/teruel/JARVIS/logs/model-learning.json` (auto-generated)
- `/home/teruel/JARVIS/logs/model-config-changes.log` (append-only log)
- `/home/teruel/JARVIS/mcp-servers/model-learning-analyzer/index.js` (new MCP server)
- `/home/teruel/JARVIS/mcp-servers/model-learning-analyzer/package.json`

### External Dependencies

- **Node.js packages (for learning analyzer):**
  - `@modelcontextprotocol/sdk` (already used)
  - `fastest-levenshtein` (for retry detection via string similarity)

- **Optional future:**
  - LLM-based task classification (use Haiku to extract task type from description)
  - Cost API integration (pull actual $ spent per model)

### Configuration Changes

- Add `model-learning-analyzer` to `/home/teruel/JARVIS/config/claude/config.json` MCP servers list

### Workflow Prerequisites

1. **Outcome reporting adoption**
   - Orchestrator or human must call `update_task_outcome` after each task
   - Initially manual, later automated via post-task hooks or CI/CD integration

2. **Baseline data collection**
   - Need at least 50 completed dispatches with outcomes before analysis is meaningful
   - Consider backfilling historical dispatches (mark all old completed as "success")

3. **Monitoring & dashboards**
   - Weekly cron job to run `analyze_model_performance` and email report
   - Optional: Integrate with report-generator MCP to include in weekly reports

---

## Success Metrics

After 30 days of data collection:

1. **Accuracy:** Model selection success rate improves by 10%
2. **Efficiency:** Avg cost per successful task decreases by 15% (fewer retries, better model fit)
3. **Coverage:** 80% of common task types have a matching rule in `models.json`
4. **Confidence:** 90% of applied suggestions have confidence >= 0.75

---

## Future Enhancements

- **A/B testing:** Randomly dispatch 10% of tasks with alternate model, compare outcomes
- **Contextual signals:** Extract file count, workspace size, git diff size as complexity indicators
- **Multi-model consensus:** For critical tasks, dispatch to 2 models and compare outputs
- **Cost tracking:** Integrate with Anthropic API to pull actual token costs, optimize for $/success
- **LLM-assisted classification:** Use Haiku to auto-classify task complexity before dispatch (pre-dispatch scoring)
