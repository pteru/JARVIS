# Spec: Self-Improvement Mining

**Status:** Idea
**Type:** New MCP Server + Analysis Pipeline

## Overview

A meta-intelligence layer that periodically analyzes orchestrator operational data (dispatch logs, changelogs, backlogs, model routing) to surface patterns, detect inefficiencies, and generate targeted upgrade proposals for model rules, workspace priorities, and orchestrator behavior.

Inspired by PAI's Algorithm Self-Upgrade Loop, this system mines structured operational data, clusters recurring themes, identifies failure patterns, and routes improvement suggestions to specific configuration sections—creating a continuous feedback loop that makes the orchestrator progressively smarter.

**Core Insight:** The orchestrator already produces rich operational telemetry. This spec turns that data into actionable intelligence for self-improvement.

---

## Design

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Self-Improvement Pipeline                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  1. DATA COLLECTION                                              │
│     ├── logs/dispatches.json        (task routing history)      │
│     ├── changelogs/*.md             (what changed per workspace)│
│     ├── backlogs/*.md               (pending tasks per workspace)│
│     ├── config/models.json          (model routing rules)       │
│     └── config/workspaces.json      (workspace configuration)   │
│                                                                   │
│  2. PATTERN EXTRACTION                                           │
│     ├── Task frequency analysis     (which types recur most)    │
│     ├── Failure clustering          (common error patterns)     │
│     ├── Backlog growth tracking     (workspaces falling behind) │
│     ├── Model routing analysis      (misroutes, overuse)        │
│     └── Workspace health scoring    (activity vs backlog ratio) │
│                                                                   │
│  3. INSIGHT GENERATION                                           │
│     ├── Detect model routing inefficiencies                     │
│     ├── Identify growing/neglected workspaces                   │
│     ├── Surface recurring task patterns                         │
│     ├── Find tasks routed to wrong models                       │
│     └── Discover missing automation opportunities               │
│                                                                   │
│  4. UPGRADE PROPOSAL GENERATION                                  │
│     ├── Section-targeted suggestions (models.json, workspaces)  │
│     ├── New rule candidates for task routing                    │
│     ├── Priority adjustments for workspaces                     │
│     ├── New MCP tool suggestions                                │
│     └── Orchestrator behavior refinements                       │
│                                                                   │
│  5. REPORTING & INTEGRATION                                      │
│     ├── Weekly meta-report (markdown)                           │
│     ├── Dashboard integration (workspace-analyzer MCP)          │
│     ├── Auto-append to backlog.md (orchestrator improvements)   │
│     └── Optional: PR generation with rule updates               │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

### Data Sources & Schemas

#### 1. Dispatch Logs: `logs/dispatches.json`

**Schema** (to be created by task-dispatcher):
```json
{
  "dispatches": [
    {
      "id": "uuid",
      "timestamp": "2026-02-15T10:30:00Z",
      "workspace": "strokmatic.diemaster.services.smartdie-back-end",
      "task_description": "Add error logging to API endpoints",
      "task_type": "feature|bugfix|refactor|docs|test|chore",
      "estimated_complexity": "simple|medium|complex",
      "model_selected": "claude-haiku-4-5-20251001",
      "model_selection_rule": "task contains 'logging' → haiku",
      "status": "completed|failed|timeout|cancelled",
      "duration_minutes": 12,
      "outcome": {
        "files_changed": 3,
        "tests_added": 2,
        "commit_sha": "abc123",
        "error_message": null
      },
      "changelog_entry": "Added structured error logging to REST API",
      "tags": ["api", "logging", "observability"]
    }
  ]
}
```

**Current State:** File does not exist yet. **Prerequisite:** Extend `task-dispatcher` MCP to log all dispatches with this schema.

#### 2. Changelogs: `changelogs/*.md`

**Format:** Keep a Changelog (YAML frontmatter + markdown)
```yaml
---
workspace: strokmatic.diemaster.services.smartdie-back-end
last_updated: 2026-02-15
---

## 2026-02-15

### Added
- Structured error logging to REST API
- Rate limiting middleware

### Fixed
- Memory leak in WebSocket connections
```

**Mining Signals:**
- **Frequency of change:** Which workspaces are most active?
- **Type distribution:** Are we adding features or fixing bugs?
- **Recurring themes:** Same keywords appearing across workspaces?
- **Stagnation:** Workspaces with no changelog entries in 30+ days?

#### 3. Backlogs: `backlogs/*.md`

**Format:** Task list with optional metadata
```markdown
# Backlog: strokmatic.diemaster.services.smartdie-back-end

## High Priority
- [ ] Migrate to PostgreSQL 15
- [ ] Add OAuth2 authentication
- [ ] Fix critical performance bottleneck in query engine

## Medium Priority
- [ ] Add unit tests for auth module
- [ ] Update API documentation

## Low Priority
- [ ] Refactor legacy code in utils/
```

**Mining Signals:**
- **Growth rate:** Backlog size increasing faster than completion rate?
- **Priority distribution:** Too many high-priority items = needs triage?
- **Task age:** Items sitting in backlog for months?
- **Recurring types:** Always the same kind of task (e.g., "add tests")?

#### 4. Model Routing Config: `config/orchestrator/models.json`

**Current Schema:**
```json
{
  "task_complexity": { /* simple/medium/complex → model */ },
  "rules": [
    { "if": "condition", "use": "model_tier" }
  ]
}
```

**Mining Signals:**
- **Misroutes:** Tasks routed to Haiku that timed out or failed?
- **Overuse:** Opus used for simple tasks that Haiku could handle?
- **Missing rules:** Tasks with no matching rule, falling back to default?
- **Rule effectiveness:** Which rules catch the most tasks?

#### 5. Workspace Config: `config/orchestrator/workspaces.json`

**Current Schema:**
```json
{
  "workspaces": {
    "workspace.id": {
      "path": "/absolute/path",
      "type": "python|nodejs|angular|...",
      "category": "service|sdk|data-science|...",
      "product": "diemaster|spotfusion|visionking|sdk",
      "priority": "high|medium|low",
      "auto_review": true|false,
      "remotes": { "origin": "git@..." }
    }
  }
}
```

**Mining Signals:**
- **Priority mismatch:** High-priority workspaces with large backlogs?
- **Neglected workspaces:** Low-priority workspaces with no recent activity?
- **Type inference:** `type: "unknown"` workspaces that could be inferred?
- **Auto-review candidates:** High-activity workspaces not using auto-review?

---

## Implementation Steps

### Phase 1: Foundation (Week 1)

**1.1 Extend `task-dispatcher` MCP to log dispatches**
- Add `logs/dispatches.json` output to every dispatch
- Capture: timestamp, workspace, task, model selected, rule matched, outcome
- Append-only structure, rotate after 10MB or 90 days

**1.2 Create `self-improvement-miner` MCP server**
- New MCP server at `mcp-servers/self-improvement-miner/`
- Initial tools:
  - `analyze_dispatch_patterns` — Parse `dispatches.json`, output pattern summary
  - `analyze_workspace_health` — Cross-reference backlogs vs changelogs
  - `analyze_model_routing` — Detect misroutes, overuse, missing rules

**1.3 Define analysis output schemas**
```json
{
  "analysis_type": "dispatch_patterns",
  "date_range": { "start": "2026-02-01", "end": "2026-02-15" },
  "insights": [
    {
      "type": "recurring_task_type",
      "description": "35% of tasks in 'diemaster' workspaces are 'add tests'",
      "severity": "medium",
      "suggestion": "Consider creating a batch testing task or automated test generation"
    },
    {
      "type": "model_misroute",
      "description": "12 tasks routed to Haiku failed due to complexity",
      "severity": "high",
      "suggestion": "Add rule: if task contains 'architecture' or 'multi-file' → Sonnet"
    }
  ]
}
```

### Phase 2: Pattern Extraction (Week 2)

**2.1 Implement dispatch log analysis**
- **Metrics to compute:**
  - Task type distribution (feature, bugfix, refactor, docs, test, chore)
  - Model usage distribution (Haiku, Sonnet, Opus)
  - Success/failure rates per model per task type
  - Average duration per task type per model
  - Recurring keywords in task descriptions (NLP clustering)

**2.2 Implement backlog health analysis**
- **Metrics to compute:**
  - Backlog size growth rate per workspace (weekly Δ)
  - Task completion rate (changelog entries vs backlog reduction)
  - Average task age (time in backlog before completion)
  - High-priority task accumulation rate

**2.3 Implement model routing analysis**
- **Detect:**
  - Haiku tasks that failed/timed out → candidate for Sonnet
  - Opus tasks that completed in <5 min with <3 files → candidate for Haiku
  - Tasks with no matching rule → suggest new rule
  - Rules that never match → deprecation candidates

**2.4 Implement workspace health scoring**
```javascript
function calculateHealthScore(workspace) {
  const activityScore = changelogEntries.last30Days / 10; // 0-10
  const backlogScore = Math.max(0, 10 - (backlog.length / 5)); // 0-10
  const priorityWeight = { high: 1.5, medium: 1.0, low: 0.5 };
  const finalScore = (activityScore + backlogScore) * priorityWeight[priority];
  return Math.min(10, finalScore);
}
```

### Phase 3: Insight Generation (Week 3)

**3.1 Clustering recurring task patterns**
- Use keyword extraction (TF-IDF) on task descriptions
- Group similar tasks across workspaces
- Identify automation opportunities (e.g., "add tests" → test-generator tool)

**3.2 Detecting model routing inefficiencies**
- **Misroutes:** Failed tasks routed to Haiku → suggest new Sonnet rule
- **Overuse:** Opus tasks completing in <5 min → suggest downgrade to Haiku
- **Underuse:** Complex tasks always routed to Opus → suggest Sonnet trial

**3.3 Identifying workspace priority mismatches**
- High-priority workspace with no activity in 30 days → suggest deprioritization
- Medium-priority workspace with 50+ backlog items → suggest upgrade to high

**3.4 Finding missing workspace metadata**
- `type: "unknown"` → infer from file structure (package.json → nodejs, setup.py → python)
- Missing `category` → infer from path structure or README

### Phase 4: Upgrade Proposal Generation (Week 4)

**4.1 Section-targeted proposals**

Inspired by PAI's `create_upgrade_pack` pattern, generate proposals routed to specific config sections:

**Example: Model Routing Rule Proposal**
```json
{
  "target_file": "config/orchestrator/models.json",
  "target_section": "rules",
  "proposal_type": "add_rule",
  "rationale": "12 tasks with 'multi-file refactor' failed when routed to Haiku",
  "proposed_change": {
    "if": "task contains 'multi-file' or 'architecture'",
    "use": "sonnet"
  },
  "confidence": 0.85,
  "evidence": [
    { "dispatch_id": "uuid1", "task": "Refactor auth across 6 files", "model": "haiku", "outcome": "timeout" },
    { "dispatch_id": "uuid2", "task": "Multi-file logging refactor", "model": "haiku", "outcome": "failed" }
  ]
}
```

**Example: Workspace Priority Adjustment**
```json
{
  "target_file": "config/orchestrator/workspaces.json",
  "target_section": "strokmatic.diemaster.firmware.smartdie-firmware-hub",
  "proposal_type": "adjust_priority",
  "rationale": "Backlog grew from 5 to 42 tasks in 2 weeks, no changelog entries",
  "proposed_change": {
    "priority": "critical"  // escalate from "high"
  },
  "confidence": 0.92
}
```

**Example: New MCP Tool Suggestion**
```json
{
  "target_file": "backlog.md",
  "proposal_type": "new_tool",
  "rationale": "25% of all tasks across workspaces are 'add tests' or 'update tests'",
  "proposed_change": "MCP tool: test-generator — auto-generate unit tests from code structure",
  "confidence": 0.78
}
```

**4.2 Proposal ranking**
- Sort by confidence score (0-1, based on evidence strength)
- Group by impact (high: affects model routing, medium: workspace config, low: minor tweaks)
- Prioritize high-confidence, high-impact proposals

### Phase 5: Reporting & Integration (Week 5)

**5.1 Weekly meta-report generation**

Output: `reports/meta-YYYY-MM-DD.md`

```markdown
# Orchestrator Self-Improvement Report
**Period:** 2026-02-08 to 2026-02-15
**Generated:** 2026-02-15 18:00 UTC

---

## Executive Summary

- **Total dispatches:** 142
- **Model usage:** Haiku 58%, Sonnet 35%, Opus 7%
- **Success rate:** 89% (127/142)
- **Workspace health:** 12 healthy, 8 at-risk, 3 critical

---

## Key Insights

### 1. Model Routing Inefficiencies

**Finding:** 12 tasks routed to Haiku failed due to complexity.

**Evidence:**
- `strokmatic.diemaster.services.smartdie-back-end` — "Refactor auth module across 6 files" → timeout
- `strokmatic.spotfusion.services.sparkeyes-back-end` — "Multi-service logging integration" → failed

**Proposal:**
```json
{
  "target": "config/orchestrator/models.json",
  "action": "add_rule",
  "rule": { "if": "task contains 'multi-file' or 'refactor' and estimated_files > 3", "use": "sonnet" }
}
```

**Confidence:** 92%

---

### 2. Workspace Health Alerts

**Critical:**
- `strokmatic.diemaster.firmware.smartdie-firmware-hub` — Backlog: 42 tasks (+37 from last week), no changelog entries

**At-Risk:**
- `strokmatic.visionking.services.visionking-backend` — Backlog: 18 tasks, only 2 completed last week

**Proposal:**
- Escalate firmware workspace to `priority: critical`
- Schedule dedicated sprint for visionking-backend

---

### 3. Recurring Task Patterns

**Finding:** 35% of tasks in `diemaster` workspaces are "add tests" or "update tests"

**Proposal:**
- Create MCP tool: `test-generator` — auto-generate unit tests from code structure
- Add to `backlog.md` under "Self-improvement ideas"

---

## Upgrade Proposals Summary

| Priority | Target                  | Type        | Confidence |
|----------|-------------------------|-------------|------------|
| High     | models.json             | Add rule    | 92%        |
| High     | workspaces.json         | Priority ↑  | 89%        |
| Medium   | backlog.md              | New tool    | 78%        |
| Low      | workspaces.json (sdk)   | Infer type  | 65%        |

---

## Recommended Actions

1. **Immediate:** Add "multi-file refactor" rule to `models.json`
2. **This week:** Escalate firmware workspace to critical priority
3. **This month:** Prototype `test-generator` MCP tool
4. **Future:** Implement auto-type inference for `unknown` workspaces

---

## Appendix: Data Sources

- Dispatch logs: 142 entries from `logs/dispatches.json`
- Changelogs: 38 workspaces analyzed
- Backlogs: 23 workspaces with pending tasks
- Models config: 3 complexity tiers, 3 rules
- Workspaces config: 102 workspaces
```

**5.2 Integration with existing MCP tools**

- **`workspace-analyzer`:** Extend to display health scores from self-improvement analysis
- **`backlog-manager`:** Auto-append tool suggestions to `backlog.md`
- **`report-generator`:** Add "meta-report" option to weekly report generation

**5.3 Optional: Auto-PR generation**

For high-confidence, low-risk proposals (e.g., adding a simple routing rule):
- Generate PR with proposed config changes
- Include evidence and rationale in PR description
- Tag for human review before merge

---

## MCP Tool Interface

### Tool: `analyze_patterns`

**Description:** Analyze orchestrator operational data to surface improvement opportunities

**Input Schema:**
```typescript
{
  "date_range": {
    "start": "2026-02-01",  // Optional, defaults to 7 days ago
    "end": "2026-02-15"     // Optional, defaults to today
  },
  "analysis_types": [
    "dispatch_patterns",     // Task frequency, model usage, success rates
    "workspace_health",      // Backlog growth, activity levels
    "model_routing",         // Misroutes, overuse, missing rules
    "recurring_tasks"        // Cluster similar tasks across workspaces
  ],
  "min_confidence": 0.7      // Filter proposals below this threshold
}
```

**Output:**
```json
{
  "summary": {
    "total_dispatches": 142,
    "date_range": { "start": "2026-02-08", "end": "2026-02-15" },
    "insights_found": 12,
    "proposals_generated": 4
  },
  "insights": [
    {
      "type": "model_misroute",
      "severity": "high",
      "description": "12 tasks routed to Haiku failed due to complexity",
      "evidence": [...],
      "proposal": { "target": "models.json", "action": "add_rule", ... },
      "confidence": 0.92
    }
  ]
}
```

### Tool: `generate_meta_report`

**Description:** Generate a comprehensive self-improvement report

**Input Schema:**
```typescript
{
  "period": "week",          // "week" | "month" | "custom"
  "custom_range": {          // Required if period = "custom"
    "start": "2026-02-01",
    "end": "2026-02-15"
  },
  "output_path": "reports/meta-2026-02-15.md",  // Optional
  "include_proposals": true, // Include upgrade proposals in report
  "auto_append_backlog": false  // Auto-append to backlog.md
}
```

**Output:**
```json
{
  "report_path": "/home/teruel/claude-orchestrator/reports/meta-2026-02-15.md",
  "proposals_count": 4,
  "high_priority_count": 2,
  "backlog_appended": false
}
```

### Tool: `apply_proposal`

**Description:** Apply a specific upgrade proposal (with human approval)

**Input Schema:**
```typescript
{
  "proposal_id": "uuid-from-analysis",
  "dry_run": true,           // Preview changes without applying
  "create_pr": false         // Generate PR instead of direct commit
}
```

**Output:**
```json
{
  "status": "applied" | "dry_run" | "pr_created",
  "files_modified": ["config/orchestrator/models.json"],
  "pr_url": "https://github.com/.../pull/123",  // If create_pr = true
  "diff": "..."              // If dry_run = true
}
```

---

## Edge Cases & Risks

### Data Quality Issues

**Risk:** Incomplete or malformed dispatch logs
**Mitigation:**
- Validate JSON schema on every dispatch log write
- Handle missing fields gracefully (skip analysis, log warning)
- Provide data quality report in meta-report ("14% of dispatches missing `outcome`")

### False Positives

**Risk:** Spurious correlations leading to bad rule suggestions
**Mitigation:**
- Require minimum evidence threshold (e.g., 5+ failures before proposing rule)
- Include confidence scores (0-1) based on evidence strength
- Human-in-the-loop for all high-impact proposals (model routing, priority changes)
- Dry-run mode for testing proposals before applying

### Config Drift

**Risk:** Manual config edits bypass proposal system, creating inconsistencies
**Mitigation:**
- Git-track all config changes (already in place)
- Detect manual edits in analysis ("4 manual rules added since last analysis")
- Suggest consolidation of manually-added rules into formalized proposals

### Overfitting to Recent Data

**Risk:** Reacting to short-term anomalies (e.g., one-time spike in test tasks)
**Mitigation:**
- Require minimum time window (7 days) for pattern detection
- Weight older data to smooth out spikes
- Compare current period to historical baseline (e.g., "test tasks usually 15%, now 35%")

### Stale Proposals

**Risk:** Proposals become outdated as orchestrator evolves
**Mitigation:**
- Tag proposals with generation timestamp
- Re-evaluate proposals every 30 days (mark stale if no longer valid)
- Archive applied proposals for historical tracking

### Computational Cost

**Risk:** Analysis becomes slow with large dispatch logs
**Mitigation:**
- Paginate analysis (process in 1000-dispatch chunks)
- Cache intermediate results (e.g., workspace health scores)
- Rotate old dispatch logs (archive after 90 days, keep aggregates)

---

## Dependencies & Prerequisites

### Immediate Prerequisites

1. **`task-dispatcher` MCP enhancement**
   - Add `logs/dispatches.json` logging to every dispatch
   - Implement JSON schema validation for dispatch entries
   - **Estimated effort:** 2-3 hours

2. **Create `logs/` directory structure**
   - `logs/dispatches.json` — dispatch history
   - `logs/analysis-cache/` — cached analysis results
   - `logs/archive/` — rotated logs (90+ days old)

### External Dependencies

- **Node.js packages:**
  - `natural` — NLP for keyword clustering (task pattern detection)
  - `compromise` — Lightweight NLP for task description parsing
  - `lodash` — Data manipulation utilities

- **Existing MCP tools:**
  - `workspace-analyzer` — Extend with health scoring
  - `backlog-manager` — Auto-append proposals to backlog.md
  - `report-generator` — Add meta-report generation

### Configuration Files

- `config/self-improvement.json` (new):
```json
{
  "analysis_schedule": "weekly",
  "min_confidence": 0.7,
  "min_evidence": 5,
  "lookback_days": 30,
  "proposal_auto_apply": false,
  "proposal_create_pr": true,
  "notification_channels": ["console", "email"],
  "archive_after_days": 90
}
```

### File Structure After Implementation

```
claude-orchestrator/
├── mcp-servers/
│   ├── self-improvement-miner/
│   │   ├── index.js                  # Main MCP server
│   │   ├── analyzers/
│   │   │   ├── dispatch-patterns.js  # Dispatch log analysis
│   │   │   ├── workspace-health.js   # Backlog + changelog analysis
│   │   │   ├── model-routing.js      # Routing efficiency analysis
│   │   │   └── task-clustering.js    # NLP-based pattern detection
│   │   ├── proposers/
│   │   │   ├── rule-proposer.js      # Generate model routing rules
│   │   │   ├── priority-proposer.js  # Workspace priority adjustments
│   │   │   └── tool-proposer.js      # New MCP tool suggestions
│   │   ├── reporters/
│   │   │   └── meta-report.js        # Weekly meta-report generation
│   │   └── package.json
│   └── task-dispatcher/
│       └── index.js                  # (Enhanced with dispatch logging)
│
├── logs/
│   ├── dispatches.json               # Append-only dispatch log
│   ├── analysis-cache/               # Cached analysis results
│   │   └── workspace-health-2026-02-15.json
│   └── archive/                      # Rotated logs (90+ days)
│       └── dispatches-2025-11.json
│
├── reports/
│   └── meta-2026-02-15.md            # Weekly meta-report
│
├── config/
│   ├── orchestrator/
│   │   ├── models.json               # (Enhanced with proposed rules)
│   │   └── workspaces.json           # (Enhanced with health scores)
│   └── self-improvement.json         # (New) Analysis configuration
│
└── backlog.md                        # (Auto-appended with tool proposals)
```

---

## Future Enhancements

### Phase 6: Advanced Analytics (Future)

- **Workspace dependency mapping:** Detect which workspaces frequently have related tasks (e.g., frontend + backend)
- **Seasonal patterns:** Detect time-of-month/year trends (e.g., "testing tasks spike before releases")
- **Cross-workspace learning:** "Workspace A solved problem X; suggest same solution for Workspace B"
- **Predictive backlog forecasting:** "At current rate, this backlog will grow to 100 items in 2 months"

### Phase 7: Real-Time Feedback (Future)

- **Inline dispatch analysis:** Suggest model override during task dispatch ("This looks complex, use Sonnet instead of Haiku?")
- **Live workspace health dashboard:** Real-time health scores with drill-down into contributing factors
- **Notification system:** Alert on critical thresholds (backlog > 50, health score < 3)

### Phase 8: Automated Experiments (Future)

- **A/B testing for rules:** "Try new rule for 10 dispatches, compare success rate to baseline"
- **Model trial suggestions:** "Task X usually uses Opus; try Sonnet and compare cost/performance"
- **Auto-rollback:** If new rule degrades success rate, auto-revert and flag for review

---

## Success Metrics

### Operational Metrics
- **Analysis coverage:** % of dispatches successfully analyzed
- **Proposal precision:** % of applied proposals that improved outcomes
- **Detection latency:** Time from pattern emergence to proposal generation
- **False positive rate:** % of proposals rejected or reverted

### Improvement Metrics
- **Model routing accuracy:** ↑ success rate after applying routing proposals
- **Workspace health:** ↑ avg health score across all workspaces
- **Backlog efficiency:** ↓ average task age in backlog
- **Cost optimization:** ↓ Opus usage for tasks Haiku/Sonnet can handle

### Adoption Metrics
- **Proposal acceptance rate:** % of proposals applied (human approval)
- **Report readership:** % of weekly meta-reports opened/read
- **Tool usage:** Frequency of `analyze_patterns` invocations

---

## Timeline

| Phase | Duration | Deliverable |
|-------|----------|-------------|
| 1. Foundation | Week 1 | Enhanced task-dispatcher, new MCP server skeleton |
| 2. Pattern Extraction | Week 2 | Dispatch, backlog, routing analyzers |
| 3. Insight Generation | Week 3 | Clustering, scoring, inefficiency detection |
| 4. Proposal Generation | Week 4 | Section-targeted upgrade proposals |
| 5. Reporting | Week 5 | Weekly meta-report, backlog integration |

**Total:** 5 weeks (part-time, ~10 hours/week)

---

## References

- **PAI Algorithm Self-Upgrade Loop:** `references/Personal_AI_Infrastructure/Releases/v3.0/.claude/skills/PAI/Tools/algorithm.ts`
- **PAI Fabric Patterns:**
  - `extract_algorithm_update_recommendations`
  - `create_upgrade_pack`
  - `recommend_pipeline_upgrades`
- **Orchestrator MCP Tools:**
  - `mcp-servers/task-dispatcher/`
  - `mcp-servers/report-generator/`
  - `mcp-servers/workspace-analyzer/`

---

**Next Steps:**
1. Review and approve spec
2. Extend `task-dispatcher` to log dispatches (prerequisite)
3. Scaffold `self-improvement-miner` MCP server
4. Implement Phase 1 (Foundation) over 1 week
