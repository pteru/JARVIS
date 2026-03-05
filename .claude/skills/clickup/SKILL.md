---
name: clickup
description: Interact with ClickUp tasks using the official ClickUp MCP server with JARVIS-specific business logic (product routing, status mapping, bilingual handling)
argument-hint: "<task-id|url|command> [args...]"
---

# ClickUp Skill

Wraps the official `mcp__clickup__*` MCP tools with JARVIS-specific business logic: product routing, status mapping, bilingual handling, and backlog cross-referencing.

## Workspace Structure

| Space | ID |
|-------|----|
| TÉCNICO | `3164545` |
| ROADMAP | `90113605013` |
| COMERCIAL | `3164542` |
| GESTÃO DE PROJETOS | `90113477754` |
| MARKETING | `90113551495` |

## Product Routing Table

| Product | Prefix | TÉCNICO Folder ID | ROADMAP List ID |
|---------|--------|-------------------|-----------------|
| diemaster | `[01]` | `7213380` | `901109563254` |
| spotfusion | `[02]` | `7213400` | `901109563247` |
| visionking | `[03]` | `90071039181` | `901109563266` |

### Sprint Folders

| Product | Sprint Folder ID | Current Sprint List |
|---------|-----------------|---------------------|
| diemaster | `90115085362` | SD Sprint 30 → `901113205646` |
| spotfusion | `90115784429` | SF Sprint 26 → `901113208606` |
| visionking | `90115784442` | VK Sprint 26 → `901113209295` |

> **Note:** Sprint list IDs change each sprint. If fetching the current sprint list returns empty or an error, call `clickup_get_folder` on the Sprint Folder ID to discover the latest sprint list.

## Status Mapping (Bidirectional)

| Local Status | ClickUp Status |
|--------------|----------------|
| pending | to do |
| running | in progress |
| verifying | in review |
| complete | complete |
| failed | to do |

When **reading** from ClickUp: map ClickUp status → local status for display.
When **writing** to ClickUp: map local status → ClickUp status before calling the API.

## Commands

Parse the skill argument to determine which command to run:

### `<task-id>` or `<url>` — Fetch a Task

If the argument is a ClickUp task ID (alphanumeric like `868dxm6ex`) or a URL containing `app.clickup.com/t/`:

1. Extract the task ID (from URL: last path segment after `/t/`)
2. Call `clickup_get_task` with the task ID
3. Display:
   - **Title**, status (mapped to local), priority, assignees
   - **Description** (translated summary if PT-BR)
   - Due date, tags, custom fields if present
   - Direct link: `https://app.clickup.com/t/<task_id>`

### `search <query>` — Search Tasks

1. Call `clickup_search` with the query string
2. Present results as a numbered list with: title, status, list name, assignee, link
3. If results span multiple spaces, group by space

### `create <product> "<title>" "<description>"` — Create a Task

1. Resolve `<product>` to the TÉCNICO folder ID via the routing table above
2. The task goes into the **Software** list inside that product's TÉCNICO folder. To find the Software list ID:
   - Call `clickup_get_folder` with the product's TÉCNICO Folder ID
   - Find the list named "Software" (or the primary development list)
3. Write the title and description in **PT-BR** (ClickUp's language)
   - If the user provides English text, translate it to PT-BR before creating
4. Call `clickup_create_task` with:
   - `list_id`: the resolved Software list ID
   - `name`: PT-BR title
   - `description`: PT-BR description
   - `status`: "to do"
5. After creation, cross-reference in backlog (see Backlog Cross-Reference below)
6. Confirm to user with task ID and link

### `status <task-id> <local-status>` — Update Task Status

1. Map `<local-status>` to ClickUp status via the mapping table
2. Call `clickup_update_task` with the mapped status
3. Confirm the change to the user

### `comment <task-id> "<message>"` — Add a Comment

1. Prefix the message with `[JARVIS] `
2. Call `clickup_create_task_comment` with the prefixed message
3. Confirm to the user

### `sprint <product>` — Show Current Sprint

1. Resolve `<product>` to its Sprint Folder ID from the table above
2. Call `clickup_get_folder` on the Sprint Folder ID to get the latest sprint lists
3. Find the most recent sprint list (highest number)
4. Call `clickup_get_list` to get tasks in that sprint
5. Display tasks grouped by status (mapped to local), with assignees and due dates

### `members` — List Workspace Members

1. Call `clickup_get_workspace_members`
2. Present as a table: name, email, role

### `hierarchy` — Show Workspace Hierarchy

1. Call `clickup_get_workspace_hierarchy`
2. Present as an indented tree: Spaces → Folders → Lists
3. Highlight the TÉCNICO space product folders

## Bilingual Convention

- **Creating/updating** tasks in ClickUp: always write in **PT-BR** (ClickUp is the PT-BR system of record)
- **Displaying** to user: present in **English**, keep PT-BR for proper nouns (space names, folder names, sprint names)
- **Never translate**: task IDs, branch names, file paths, technical identifiers, ClickUp status names in API calls

## Backlog Cross-Reference

After creating a ClickUp task, update the local backlog:

1. Path: `backlogs/products/strokmatic.<product>.md`
2. Read the backlog file
3. If a matching task line exists (by title similarity), append: `**ClickUp:** [#TASK_ID](https://app.clickup.com/t/TASK_ID)`
4. If no match, inform the user of the ClickUp link for manual backlog update

## Official MCP Tools Reference

These are the `mcp__clickup__*` tools this skill delegates to. Use `ToolSearch` to load them before calling:

| Tool | Purpose |
|------|---------|
| `clickup_search` | Global search across workspace |
| `clickup_get_task` | Fetch task details by ID |
| `clickup_create_task` | Create a new task in a list |
| `clickup_update_task` | Update task fields (status, assignee, etc.) |
| `clickup_create_task_comment` | Post a comment on a task |
| `clickup_get_workspace_hierarchy` | Full workspace tree |
| `clickup_get_workspace_members` | List team members |
| `clickup_resolve_assignees` | Resolve member names to IDs |
| `clickup_get_task_comments` | Read task comments |
| `clickup_get_list` | Get list details and tasks |
| `clickup_get_folder` | Get folder contents (lists) |

## Tool Loading

Before calling any `mcp__clickup__*` tool, you **must** load it via `ToolSearch`:

```
ToolSearch query: "+clickup <keyword>"
```

For example, to fetch a task:
1. `ToolSearch` with query `"+clickup get_task"`
2. Then call `mcp__clickup__clickup_get_task`

## Examples

```
/clickup 868dxm6ex
→ Fetches and displays VisionKing task #868dxm6ex

/clickup https://app.clickup.com/t/868dxm6ex
→ Same as above, extracts task ID from URL

/clickup search "Sprint 30"
→ Searches for tasks matching "Sprint 30"

/clickup create diemaster "Implement sensor calibration" "Add auto-calibration routine for DRAWIN sensors"
→ Creates task in [01] SMART DIE Software list (translated to PT-BR)

/clickup status 868dxm6ex running
→ Updates task status to "in progress" in ClickUp

/clickup comment 868dxm6ex "Deployed to staging, ready for QA"
→ Posts: "[JARVIS] Deployed to staging, ready for QA"

/clickup sprint visionking
→ Shows current VK Sprint 26 tasks

/clickup members
→ Lists workspace team members

/clickup hierarchy
→ Shows full workspace structure
```
