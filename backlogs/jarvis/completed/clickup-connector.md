# Spec: ClickUp Connector

**Status:** Idea
**Type:** New MCP Server
**ClickUp ID:** _(not yet created)_

## Overview

Integrate the orchestrator with ClickUp via the official ClickUp MCP Server. The connector acts as a two-way bridge: tasks can originate in either system and be kept in sync, with language translation at the boundary (PT-BR in ClickUp, English locally).

---

## ClickUp Workspace Structure

### Spaces in scope

| Space | Purpose |
|-------|---------|
| `TÉCNICO` | Low-level task tracking per product |
| `ROADMAP` | High-level project phase visualization across products (Gantt) |

Other spaces should be read and mapped for awareness but are **not part of the active workflow**.

### TÉCNICO

Each product has two folders: a **regular folder** and a **sprint folder**.

| Product | Regular Folder | Sprint Folder |
|---------|---------------|---------------|
| Smart Die | `[01] SMART DIE` | `[01] SMART DIE` (sprint variant) |
| Spot Fusion | `[02] SPOT FUSION` | `[02] SPOT FUSION` (sprint variant) |
| Vision King | `[03] VISION KING` | `[03] VISION KING` (sprint variant) |

**Regular folder** lists:
- One list per **project**: `[0X00X] Project Name` (e.g. `[01001] Project Alpha`)
- One list per **major product area**: e.g. `[01] Documentação`, `[02] Hardware`

**Sprint folder** lists: one per sprint. Tasks live in the regular list and are **added to the active sprint list** — they are not moved, just associated.

Task lifecycle in TÉCNICO: `Create in regular list → Add to active sprint`

### ROADMAP

- No folders — flat, one list per product
- Each task = a **project**; subtasks = **project phases**
- Primary visualization: **Gantt chart**

---

## Required Capabilities

### 1. Read from ClickUp → Local Backlog

- Fetch a task from ClickUp (by ID or URL), including title, description, status, assignees, and other metadata
- If the description is **well-defined** (has clear scope and acceptance criteria): translate it to English and populate the corresponding local backlog entry automatically
- If the description is **not well-defined**: load the raw task context, point to the associated local workspace, and enter a scoping discussion with the user to define requirements — the resulting spec is written locally and then pushed back to ClickUp (see Write flow below)

### 2. Write from Local → ClickUp

- When a task is created locally (in the orchestrator backlog), push it to ClickUp:
  - Determine the correct Space → Folder → List based on product and task type
  - Translate title and description from English to PT-BR
  - Set the appropriate status, priority, and assignees
  - Add the task to the active sprint in the sprint folder
- Return the ClickUp task ID and URL, and write them into the local backlog entry as a cross-reference

### 3. Cross-Referencing

- Every local backlog entry that has a ClickUp counterpart must include the ClickUp task ID and a direct link
- Format in local files:
  ```
  **ClickUp:** [#TASK_ID](https://app.clickup.com/t/TASK_ID)
  ```
- The connector must keep this reference up to date if the ClickUp task is moved or its ID changes

### 4. Language Handling

| Direction | Language |
|-----------|---------|
| ClickUp → Local | Translate PT-BR → English |
| Local → ClickUp | Translate English → PT-BR |

Translation applies to: title, description, comments, and any spec/strategy updates. Technical identifiers (IDs, code symbols, file names) are never translated.

### 5. Execution Updates

During active task execution:
- Post progress updates as **comments** to the ClickUp task's Activity feed (e.g. subtask completed, blocker found, decision made)
- If the **scope or strategy changes** during execution, update the ClickUp task description to reflect the revised spec — do not leave ClickUp out of sync with what was actually done
- Comment format should clearly mark the source: `[Orchestrator] <message>`

---

## Implementation Notes

- Evaluate the official ClickUp MCP Server to identify which of the above operations are natively supported vs. need wrapping
- Key MCP operations needed:
  - `get_task` — fetch task by ID with full metadata
  - `create_task` — create in the correct list
  - `update_task` — revise description/status
  - `add_task_to_list` — assign to sprint list
  - `create_task_comment` — post activity updates
  - `get_spaces`, `get_folders`, `get_lists` — structure discovery
- The connector must never bypass the `regular list → sprint` workflow when creating tasks in TÉCNICO
- Scoping discussions (undefined task descriptions) should be interactive: the connector presents the raw ClickUp context and facilitates the conversation before writing anything back
