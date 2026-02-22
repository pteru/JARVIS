---
name: backlog-add
description: Add items to orchestrator or product backlogs with specs, task codes, and duplicate detection
argument-hint: "<description of backlog item(s) to add>"
---

# Backlog Add — Unified Backlog Item Creator

Add items to the JARVIS orchestrator backlog or product backlogs. Handles classification, duplicate detection, spec generation, task code assignment, and index updates.

## Workflow

Work through the following steps sequentially.

---

### Step 1 — Parse Input

Read `$ARGUMENTS`.

- If **empty**, use AskUserQuestion to ask: "What backlog item(s) would you like to add? Describe the feature, improvement, or task."
- If **fewer than 10 words** and lacking clear scope (e.g., "fix stuff", "improve things"), ask for elaboration: "Could you provide more detail? What specifically needs to change, and where?"
- **Detect multiple items** by splitting on:
  - Semicolons (`;`)
  - Numbered lists (`1.`, `2.`, `3.`)
  - Bullet points (`-`, `*`)
- Process each item independently through Steps 2–8, then show a combined summary in Step 9.

---

### Step 2 — Classify Each Item

Route each item to either **Orchestrator** or a **Product** backlog using keyword heuristics.

**Orchestrator** (JARVIS self-improvement) — when input mentions any of:
- JARVIS, orchestrator, skill, MCP server, MCP tool, dashboard (JARVIS dashboard), cron, dispatch, automation, hook, sandbox, voice interface
- References paths under `scripts/`, `mcp-servers/`, `.claude/skills/`, `config/orchestrator/`

**Product** — when input mentions product names or domain terms:

| Product | Keywords |
|---------|----------|
| `diemaster` | diemaster, die, stamping, smartdie, hub, switch, sensor, firmware |
| `spotfusion` | spotfusion, spot welding, sparkeyes, weld, WTC |
| `visionking` | visionking, vision, inspection, surface, defect, inference, camera-acquisition |
| `sdk` | sdk, shared library, cross-product toolkit |
| `general` | cross-product items that don't fit SDK |

If **ambiguous** (no clear keywords match), use AskUserQuestion:
- Question: "Which backlog should this item go into?"
- Options: Orchestrator, DieMaster, SpotFusion, VisionKing, SDK, General

---

### Step 3 — Duplicate Detection

Check for existing similar items before creating new ones.

**For orchestrator items:**
1. Read `backlogs/orchestrator/README.md`
2. Scan both tables ("New Skills / MCP Servers" and "Improvements") for items with similar names or descriptions

**For product items:**
1. Read `backlogs/products/strokmatic.<product>.md`
2. Scan all entries for similar descriptions or overlapping scope

If a **near-duplicate** is found, warn the user and ask via AskUserQuestion:
- Question: "A similar item already exists: `<existing item>`. What would you like to do?"
- Options:
  - "Skip" — don't create this item
  - "Update existing" — modify the existing entry instead
  - "Create anyway" — add as a separate item

If the user chooses "Skip", move to the next item. If "Update existing", edit the existing entry and spec file instead of creating new ones.

---

### Step 4 — Determine Category (Orchestrator Items Only)

Classify into the correct README table:

- **"New Skills / MCP Servers"** — if the item is a new skill (`/slash-command`), MCP server, integration tool, or connector
- **"Improvements"** — if it enhances existing functionality, adds a feature to the dashboard, improves an existing script, etc.

---

### Step 5 — Generate Task Code (Product Items Only)

Select the appropriate prefix based on the item's nature:

| Prefix | Category |
|--------|----------|
| `SEC` | Security (credentials, auth, access control) |
| `TEST` | Testing (test suites, coverage, CI test steps) |
| `FEAT` | Product features (new functionality, UI features) |
| `TOOL` | Toolkit items (utilities, scripts, CLI tools) |
| `DOC` | Documentation (READMEs, runbooks, guides) |
| `CICD` | CI/CD (build configs, pipelines, automation) |
| `INFRA` | Infrastructure (networking, logging, monitoring) |
| `OPT` | Optimization (performance, resource usage) |
| `QUAL` | Quality (error handling, code standards, linting) |
| `CLEAN` | Cleanup (dead code, reorganization, file removal) |
| `GIT` | Git operations (submodules, history, branching) |
| `FW` | Firmware (embedded, PLC, hardware interfaces) |
| `DS` | Data science (ML models, training, datasets) |
| `HEALTH` | Health checks (monitoring, alerting, watchdogs) |

**To assign the number:**
1. Read `backlogs/products/strokmatic.<product>.md`
2. Find all existing entries with the chosen prefix (e.g., `FEAT-01`, `FEAT-07`)
3. Use the next available number (e.g., `FEAT-08`)

**Determine priority** from urgency keywords:
- **High**: "critical", "security", "broken", "urgent", "blocking", "credentials", "vulnerability"
- **Low**: "nice to have", "someday", "minor", "cosmetic", "cleanup"
- **Medium**: everything else
- If unclear, ask the user.

**Determine complexity:**
- `simple` — single file, docs, config, delete/archive
- `medium` — multiple files in one service, moderate refactoring
- `complex` — multi-service, new feature, architecture change

---

### Step 6 — Estimate Complexity & Effort

Apply these heuristics:

| Complexity | Indicators | Effort Range |
|------------|-----------|-------------|
| Simple | Single file, docs, config, delete/archive | 1–4h |
| Medium | Multiple files in one service, moderate refactoring | 4–16h |
| Complex/Large | Multi-service, new feature, architecture change | 16–40h |
| Very Large | Cross-product, new MCP server + skill + cron | 40h+ |

**For orchestrator items**, map to: Small / Medium / Large / Very Large.

Present the estimate to the user briefly. Allow them to override if they disagree.

---

### Step 7 — Generate Detailed Spec

**For orchestrator items**, create `backlogs/orchestrator/<kebab-case-name>.md`:

Use this template:

```markdown
# <Title>

**Status:** Planned
**Priority:** <High/Medium/Low>
**Estimated complexity:** <Small/Medium/Large/Very Large>

---

## Overview

<2-3 sentence summary of what this item does and why it matters>

## Problem Statement

<What problem does this solve? What's the current pain point?>

## Architecture / Components

<Key components, data flow, integration points>

## File Structure

<New files to create, existing files to modify>

## MCP Tools / Skills (if applicable)

<Any new MCP tools or skills this item introduces>

## Implementation Phases

1. **Phase 1: <name>** (~Xh) — <description>
2. **Phase 2: <name>** (~Xh) — <description>
3. ...

## Testing Strategy

<How to verify each feature works — manual tests, automated tests, smoke tests>

## Estimates Summary

| Phase | Hours | Dependencies |
|-------|-------|-------------|
| Phase 1 | X | — |
| Phase 2 | X | Phase 1 |
| **Total** | **X** | |

## Risk Register

| Risk | Impact | Mitigation |
|------|--------|------------|
| <risk> | <impact> | <mitigation> |
```

If the spec filename already exists, append a numeric suffix (e.g., `slack-integration-2.md`).

**For product items**, read `backlogs/plans/strokmatic.<product>.md` and append a new section at the end, before any summary table:

```markdown
---

### <TASK-CODE>: <Title>

**Current State**: <what exists today>

**Scope of Work**:
1. <step 1>
2. <step 2>
3. ...

**Repositories Involved**: <list>

**Testing Effort**: <what tests to write/run>

**Testing Infrastructure**: <what tooling exists or needs creating>

**Dependencies**: <other task codes or prerequisites>

**Hours Estimate**: <N>h
```

---

### Step 8 — Update Backlog Index

**For orchestrator items** — Edit `backlogs/orchestrator/README.md`:

- If the item belongs to **"New Skills / MCP Servers"** table, add a row:
  ```
  | <Item Name> | **Planned** | [spec](<kebab-case-name>.md) |
  ```
  Add the row at the bottom of the table, before the `---` separator.

- If the item belongs to **"Improvements"** table, add a row:
  ```
  | <Item Name> | **Planned** | — | — | [spec](<kebab-case-name>.md) | <brief one-line note> |
  ```
  Add the row at the bottom of the table, before the next section.

**For product items** — Use the `add_backlog_task` MCP tool with these parameters:
- `workspace`: `strokmatic.<product>` (e.g., `strokmatic.visionking`)
- `task`: `<TASK-CODE>: <Title> — <one-line description>`
- `priority`: `high`, `medium`, or `low`
- `complexity`: `simple`, `medium`, or `complex`

---

### Step 9 — Summary

Display a summary table for each item created:

```
## Backlog Items Created

| Field | Value |
|-------|-------|
| Type | Orchestrator / Product |
| Product | <product name, if product item> |
| Task Code | <TASK-CODE, if product item> |
| Title | <item title> |
| Spec File | `<path to spec file>` |
| Backlog Entry | `<path to backlog index file>` |
| Complexity | <estimate> |
| Effort | <hours range> |
```

If multiple items were created, show one table per item.

End with: **Suggest:** "Run `/cleanup` to commit these changes."

---

## Edge Cases

- **Empty input** → AskUserQuestion for description
- **Underspecified input** (<10 words, no clear scope) → ask for elaboration
- **Multiple items** → process each sequentially, combined summary at end
- **Ambiguous routing** → AskUserQuestion with product/orchestrator options
- **Duplicate detected** → warn + ask: Skip / Update existing / Create anyway
- **Spec filename collision** → append numeric suffix (`-2`, `-3`, etc.)
- **Cross-product item** → suggest `strokmatic.general` or ask user if it should be split per product

## Key File Paths

| File | Purpose |
|------|---------|
| `backlogs/orchestrator/README.md` | Orchestrator backlog index (two tables) |
| `backlogs/orchestrator/<name>.md` | Orchestrator spec files |
| `backlogs/products/strokmatic.<product>.md` | Product backlog files |
| `backlogs/plans/strokmatic.<product>.md` | Product implementation plans |
