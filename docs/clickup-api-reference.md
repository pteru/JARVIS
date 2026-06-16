# ClickUp REST API Reference

**Last updated:** 2026-03-24
**API base URL:** `https://api.clickup.com`
**Developer portal:** https://developer.clickup.com/
**OpenAPI v2 spec:** https://developer.clickup.com/openapi/clickup-api-v2-reference.json
**OpenAPI v3 spec:** https://developer.clickup.com/openapi/ClickUp_PUBLIC_API_V3.yaml

---

## Table of Contents

1. [Move Task Endpoint (KEY FINDING)](#1-move-task-endpoint-key-finding)
2. [API Versions (v2 vs v3)](#2-api-versions-v2-vs-v3)
3. [Authentication](#3-authentication)
4. [Rate Limits](#4-rate-limits)
5. [ClickUp 4.0 Changes](#5-clickup-40-changes)
6. [Complete API Surface — v2 Endpoints](#6-complete-api-surface--v2-endpoints)
7. [Complete API Surface — v3 Endpoints](#7-complete-api-surface--v3-endpoints)
8. [Webhook Events](#8-webhook-events)
9. [Task Data Model](#9-task-data-model)
10. [Custom Field Types](#10-custom-field-types)
11. [Key Gotchas and FAQ](#11-key-gotchas-and-faq)

---

## 1. Move Task Endpoint (KEY FINDING)

This is the endpoint needed to change a task's PRIMARY (home) list.

### Endpoint

```
PUT /api/v3/workspaces/{workspace_id}/tasks/{task_id}/home_list/{list_id}
```

Full URL: `https://api.clickup.com/api/v3/workspaces/{workspace_id}/tasks/{task_id}/home_list/{list_id}`

### This is a v3 endpoint

It uses the v3 path pattern with `workspaces/{workspace_id}` (not `team/{team_id}`).

### Path Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `workspace_id` | integer | Yes | The Workspace ID (same as `team_id` in v2) |
| `task_id` | string | Yes | The task ID to move |
| `list_id` | string | Yes | The destination List ID (new home list) |

### Request Body (optional)

```json
{
  "move_custom_fields": true,
  "custom_fields_to_move": ["field_id_1", "field_id_2"],
  "status_mappings": [
    {
      "source_status": "old_status_id",
      "destination_status": "new_status_id"
    }
  ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `move_custom_fields` | boolean | When `true`, transfers Custom Fields from old List to new List |
| `custom_fields_to_move` | string[] | Optional subset of Custom Field IDs to transfer (requires `move_custom_fields: true`) |
| `status_mappings` | object[] | Maps old status IDs to new status IDs when statuses differ between Lists |

### Behavior

- **Moves the task's HOME LIST** — this is the primary list change
- Does NOT affect secondary list memberships (Tasks in Multiple Lists)
- If a task is in List A (home) + List B (secondary), moving home to List C results in: List C (home) + List B (secondary)
- Status IDs can be obtained via the Get Task endpoint
- If the task's current status does not exist in the destination List, you MUST provide `status_mappings` or it will fail/auto-map

### curl Example

```bash
curl -X PUT "https://api.clickup.com/api/v3/workspaces/3081126/tasks/TASK_ID/home_list/LIST_ID" \
  -H "Authorization: TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'
```

### Comparison: Move vs Add vs Remove

| Operation | Endpoint | Version | Effect |
|-----------|----------|---------|--------|
| **Move home list** | `PUT /api/v3/workspaces/{wid}/tasks/{tid}/home_list/{lid}` | v3 | Changes primary list |
| **Add to list** | `POST /api/v2/list/{lid}/task/{tid}` | v2 | Adds as secondary (requires "Tasks in Multiple Lists" ClickApp) |
| **Remove from list** | `DELETE /api/v2/list/{lid}/task/{tid}` | v2 | Removes secondary list only (cannot remove from home list) |

### Strategy for Fixing 57 Tasks

For each task that has the wrong primary list:

1. **No need to add first** — the move endpoint changes the home list directly
2. Just call `PUT /api/v3/workspaces/3081126/tasks/{task_id}/home_list/{correct_list_id}` with an empty body `{}`
3. The sprint list (if any) remains as a secondary location
4. Rate limit: 100 req/min on Business plan — 57 tasks is well within a single minute

---

## 2. API Versions (v2 vs v3)

### Overview

| Aspect | v2 | v3 |
|--------|----|----|
| Base path | `/api/v2/` | `/api/v3/` |
| Top-level entity term | "Team" (`team_id`) | "Workspace" (`workspace_id`) |
| Status | Stable, full coverage | Partial, expanding |
| Can mix? | Yes | Yes, use both side by side |

### v3 Stability

- v3 is **partially released**. A handful of endpoints are v3, the rest remain v2-only.
- The Chat API endpoints (v3) are explicitly marked **"experimental and subject to change at any time"**.
- Non-Chat v3 endpoints (Docs, Move Task, Attachments, ACLs, Audit Logs) appear stable but lack an explicit stability label.
- ClickUp is actively migrating v2 endpoints to v3. During transition, both versions coexist.

### Terminology Mapping

| v2 Term | v3 Term | Notes |
|---------|---------|-------|
| Team | Workspace | Top-level entity |
| team_id | workspace_id | Same numeric ID |
| Project | Folder | Historical rename |
| group_id | — | User group/Team ID |

### What's New in v3 Only

These endpoints exist ONLY in v3:
- Move Task (home_list)
- Docs CRUD (search, create, get, pages)
- Chat Channels & Messages (experimental)
- Attachments (entity-based)
- Privacy & Access Control (ACLs)
- Audit Logs (Enterprise)
- Time Estimates by User

### Recommendation

Use v3 for: Move Task, Docs, Chat, Attachments, ACLs.
Use v2 for: Everything else (Tasks CRUD, Lists, Folders, Spaces, Comments, Goals, Views, Webhooks, Time Tracking, etc.).

---

## 3. Authentication

### Personal API Token

- Format: starts with `pk_`
- Header: `Authorization: {personal_token}` (no "Bearer" prefix)
- Never expires
- Generate at: https://app.clickup.com/settings/apps

### OAuth 2.0

- Grant type: Authorization Code
- Authorization URL: `https://app.clickup.com/api?client_id={client_id}&redirect_uri={redirect_uri}`
- Token URL: `POST https://api.clickup.com/api/v2/oauth/token`
- Token header: `Authorization: Bearer {access_token}`
- Access tokens currently do not expire (subject to change)
- No refresh token flow documented
- Only Workspace owners/admins can create OAuth apps

### Required Headers

```
Authorization: pk_xxxxx  (personal token — no Bearer)
Authorization: Bearer xxxxx  (OAuth token)
Content-Type: application/json  (required for all POST/PUT/PATCH)
```

---

## 4. Rate Limits

### Per-Plan Limits

| Plan | Requests/Minute/Token |
|------|-----------------------|
| Free Forever | 100 |
| Unlimited | 100 |
| Business | 100 |
| Business Plus | 1,000 |
| Enterprise | 10,000 |

### Response Headers

| Header | Description |
|--------|-------------|
| `X-RateLimit-Limit` | Max requests per minute for this token |
| `X-RateLimit-Remaining` | Requests remaining in current window |
| `X-RateLimit-Reset` | Unix timestamp when the limit resets |

### When Rate Limited

- HTTP `429 Too Many Requests` returned
- No documented difference between read and write rate limits
- No endpoint-specific limits documented
- Applies to both personal and OAuth tokens
- Limit is per token, determined by the Workspace plan hosting the token

### Practical Notes for Our Use Case

- Business plan = 100 req/min
- 57 move operations = comfortably under the limit in a single batch
- For safety, add a small delay between requests (not strictly required)
- Check `X-RateLimit-Remaining` header and pause if approaching 0

---

## 5. ClickUp 4.0 Changes

### What is ClickUp 4.0?

A major UI/UX overhaul released in late 2025, converging Tasks, Chat, Docs, Whiteboards, Dashboards, and Calendar into a unified navigation. It is NOT a new API version.

### Key Changes

- **New unified sidebar** — Tasks, Docs, Chat, Whiteboards, Dashboards, Calendar all in one navigation
- **Personal Lists** — users can create personal task lists
- **Teams Hub** — org structure visualization with capacity analytics
- **AI Agents ("Super Agents")** — personalized AI teammates for automation
- **SyncUp** — native video calling with AI notetaker and transcription
- **My Tasks hub** — personalized task view

### API Impact

- **No breaking API changes.** ClickUp 4.0 is a UI update, not an API update.
- The underlying data model (Workspaces > Spaces > Folders > Lists > Tasks) is unchanged.
- New UI features (Chat, Personal Lists, SyncUp) are served by the v3 API endpoints.
- The Chat API (v3) was introduced alongside 4.0 features.

### Deprecation Timeline

- Workspace admins can switch back to ClickUp 3.0 UI until **March 27, 2026** (3 days from now)
- After that date, 4.0 is mandatory for all workspaces
- No API deprecations announced alongside 4.0

---

## 6. Complete API Surface -- v2 Endpoints

### Authorization

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v2/oauth/token` | Get OAuth access token |
| GET | `/api/v2/user` | Get authorized user |

### Attachments

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v2/task/{task_id}/attachment` | Create task attachment |

### Comments

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v2/task/{task_id}/comment` | Get task comments |
| POST | `/api/v2/task/{task_id}/comment` | Create task comment |
| GET | `/api/v2/view/{view_id}/comment` | Get chat view comments |
| POST | `/api/v2/view/{view_id}/comment` | Create chat view comment |
| GET | `/api/v2/list/{list_id}/comment` | Get list comments |
| POST | `/api/v2/list/{list_id}/comment` | Create list comment |
| PUT | `/api/v2/comment/{comment_id}` | Update comment |
| DELETE | `/api/v2/comment/{comment_id}` | Delete comment |
| GET | `/api/v2/comment/{comment_id}/reply` | Get threaded comments |
| POST | `/api/v2/comment/{comment_id}/reply` | Create threaded comment |

### Custom Task Types

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v2/team/{team_id}/custom_item` | Get custom task types |

### Custom Fields

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v2/list/{list_id}/field` | Get list custom fields |
| GET | `/api/v2/folder/{folder_id}/field` | Get folder custom fields |
| GET | `/api/v2/space/{space_id}/field` | Get space custom fields |
| GET | `/api/v2/team/{team_id}/field` | Get workspace custom fields |
| POST | `/api/v2/task/{task_id}/field/{field_id}` | Set custom field value |
| DELETE | `/api/v2/task/{task_id}/field/{field_id}` | Remove custom field value |

### Folders

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v2/space/{space_id}/folder` | Get folders |
| POST | `/api/v2/space/{space_id}/folder` | Create folder |
| GET | `/api/v2/folder/{folder_id}` | Get folder |
| PUT | `/api/v2/folder/{folder_id}` | Update folder |
| DELETE | `/api/v2/folder/{folder_id}` | Delete folder |
| POST | `/api/v2/team/{team_id}/folder_template/{template_id}` | Create folder from template |

### Goals

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v2/team/{team_id}/goal` | Get goals |
| POST | `/api/v2/team/{team_id}/goal` | Create goal |
| GET | `/api/v2/goal/{goal_id}` | Get goal |
| PUT | `/api/v2/goal/{goal_id}` | Update goal |
| DELETE | `/api/v2/goal/{goal_id}` | Delete goal |
| POST | `/api/v2/goal/{goal_id}/key_result` | Create key result |
| PUT | `/api/v2/key_result/{key_result_id}` | Edit key result |
| DELETE | `/api/v2/key_result/{key_result_id}` | Delete key result |

### Guests

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v2/team/{team_id}/guest` | Invite guest to workspace |
| GET | `/api/v2/team/{team_id}/guest/{guest_id}` | Get guest |
| PUT | `/api/v2/team/{team_id}/guest/{guest_id}` | Edit guest on workspace |
| DELETE | `/api/v2/team/{team_id}/guest/{guest_id}` | Remove guest from workspace |
| POST | `/api/v2/task/{task_id}/guest/{guest_id}` | Add guest to task |
| DELETE | `/api/v2/task/{task_id}/guest/{guest_id}` | Remove guest from task |
| POST | `/api/v2/list/{list_id}/guest/{guest_id}` | Add guest to list |
| DELETE | `/api/v2/list/{list_id}/guest/{guest_id}` | Remove guest from list |
| POST | `/api/v2/folder/{folder_id}/guest/{guest_id}` | Add guest to folder |
| DELETE | `/api/v2/folder/{folder_id}/guest/{guest_id}` | Remove guest from folder |

### Lists

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v2/folder/{folder_id}/list` | Get lists in folder |
| POST | `/api/v2/folder/{folder_id}/list` | Create list in folder |
| GET | `/api/v2/space/{space_id}/list` | Get folderless lists |
| POST | `/api/v2/space/{space_id}/list` | Create folderless list |
| GET | `/api/v2/list/{list_id}` | Get list |
| PUT | `/api/v2/list/{list_id}` | Update list |
| DELETE | `/api/v2/list/{list_id}` | Delete list |
| POST | `/api/v2/list/{list_id}/task/{task_id}` | **Add task to list (secondary)** |
| DELETE | `/api/v2/list/{list_id}/task/{task_id}` | **Remove task from list (secondary only)** |
| POST | `/api/v2/folder/{folder_id}/list_template/{template_id}` | Create list from folder template |
| POST | `/api/v2/space/{space_id}/list_template/{template_id}` | Create list from space template |

### Members

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v2/task/{task_id}/member` | Get task members |
| GET | `/api/v2/list/{list_id}/member` | Get list members |

### Roles

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v2/team/{team_id}/customroles` | Get custom roles |

### Shared Hierarchy

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v2/team/{team_id}/shared` | Get shared hierarchy |

### Spaces

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v2/team/{team_id}/space` | Get spaces |
| POST | `/api/v2/team/{team_id}/space` | Create space |
| GET | `/api/v2/space/{space_id}` | Get space |
| PUT | `/api/v2/space/{space_id}` | Update space |
| DELETE | `/api/v2/space/{space_id}` | Delete space |

### Tags

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v2/space/{space_id}/tag` | Get space tags |
| POST | `/api/v2/space/{space_id}/tag` | Create space tag |
| PUT | `/api/v2/space/{space_id}/tag/{tag_name}` | Edit space tag |
| DELETE | `/api/v2/space/{space_id}/tag/{tag_name}` | Delete space tag |
| POST | `/api/v2/task/{task_id}/tag/{tag_name}` | Add tag to task |
| DELETE | `/api/v2/task/{task_id}/tag/{tag_name}` | Remove tag from task |

### Tasks

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v2/list/{list_id}/task` | Get tasks in list |
| POST | `/api/v2/list/{list_id}/task` | Create task |
| GET | `/api/v2/task/{task_id}` | Get task |
| PUT | `/api/v2/task/{task_id}` | Update task |
| DELETE | `/api/v2/task/{task_id}` | Delete task |
| GET | `/api/v2/team/{team_id}/task` | Get filtered workspace tasks |
| POST | `/api/v2/task/{task_id}/merge` | Merge tasks |
| GET | `/api/v2/task/{task_id}/time_in_status` | Get task time in status |
| GET | `/api/v2/team/{team_id}/task/bulk_time_in_status/task_ids` | Get bulk tasks time in status |
| POST | `/api/v2/list/{list_id}/task_template/{template_id}` | Create task from template |

### Task Checklists

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v2/task/{task_id}/checklist` | Create checklist |
| PUT | `/api/v2/checklist/{checklist_id}` | Edit checklist |
| DELETE | `/api/v2/checklist/{checklist_id}` | Delete checklist |
| POST | `/api/v2/checklist/{checklist_id}/checklist_item` | Create checklist item |
| PUT | `/api/v2/checklist/{checklist_id}/checklist_item/{checklist_item_id}` | Edit checklist item |
| DELETE | `/api/v2/checklist/{checklist_id}/checklist_item/{checklist_item_id}` | Delete checklist item |

### Task Relationships

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v2/task/{task_id}/dependency` | Add dependency |
| DELETE | `/api/v2/task/{task_id}/dependency` | Delete dependency |
| POST | `/api/v2/task/{task_id}/link/{links_to}` | Add task link |
| DELETE | `/api/v2/task/{task_id}/link/{links_to}` | Delete task link |

### Templates

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v2/team/{team_id}/task_template` | Get task templates |
| GET | `/api/v2/team/{team_id}/list_template` | Get list templates |
| GET | `/api/v2/team/{team_id}/folder_template` | Get folder templates |

### Workspaces

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v2/team` | Get authorized workspaces |
| GET | `/api/v2/team/{team_id}/seats` | Get workspace seats |
| GET | `/api/v2/team/{team_id}/plan` | Get workspace plan |

### User Groups

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v2/team/{team_id}/group` | Create group |
| PUT | `/api/v2/group/{group_id}` | Update group |
| DELETE | `/api/v2/group/{group_id}` | Delete group |
| GET | `/api/v2/team/{team_id}/group` | Get groups |

### Time Tracking

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v2/team/{team_id}/time_entries` | Get time entries in date range |
| POST | `/api/v2/team/{team_id}/time_entries` | Create time entry |
| GET | `/api/v2/team/{team_id}/time_entries/{timer_id}` | Get singular time entry |
| DELETE | `/api/v2/team/{team_id}/time_entries/{timer_id}` | Delete time entry |
| PUT | `/api/v2/team/{team_id}/time_entries/{timer_id}` | Update time entry |
| GET | `/api/v2/team/{team_id}/time_entries/{timer_id}/history` | Get time entry history |
| GET | `/api/v2/team/{team_id}/time_entries/current` | Get running time entry |
| DELETE | `/api/v2/team/{team_id}/time_entries/tags` | Remove tags from time entries |
| GET | `/api/v2/team/{team_id}/time_entries/tags` | Get all time entry tags |
| POST | `/api/v2/team/{team_id}/time_entries/tags` | Add tags to time entries |
| PUT | `/api/v2/team/{team_id}/time_entries/tags` | Change time entry tag names |
| POST | `/api/v2/team/{team_id}/time_entries/start` | Start time entry |
| POST | `/api/v2/team/{team_id}/time_entries/stop` | Stop time entry |

### Time Tracking (Legacy)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v2/task/{task_id}/time` | Get tracked time |
| POST | `/api/v2/task/{task_id}/time` | Track time |
| PUT | `/api/v2/task/{task_id}/time/{interval_id}` | Edit time tracked |
| DELETE | `/api/v2/task/{task_id}/time/{interval_id}` | Delete time tracked |

### Users

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v2/team/{team_id}/user` | Invite user to workspace |
| GET | `/api/v2/team/{team_id}/user/{user_id}` | Get user |
| PUT | `/api/v2/team/{team_id}/user/{user_id}` | Edit user on workspace |
| DELETE | `/api/v2/team/{team_id}/user/{user_id}` | Remove user from workspace |

### Views

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v2/team/{team_id}/view` | Get workspace views |
| POST | `/api/v2/team/{team_id}/view` | Create workspace view |
| GET | `/api/v2/space/{space_id}/view` | Get space views |
| POST | `/api/v2/space/{space_id}/view` | Create space view |
| GET | `/api/v2/folder/{folder_id}/view` | Get folder views |
| POST | `/api/v2/folder/{folder_id}/view` | Create folder view |
| GET | `/api/v2/list/{list_id}/view` | Get list views |
| POST | `/api/v2/list/{list_id}/view` | Create list view |
| GET | `/api/v2/view/{view_id}` | Get view |
| PUT | `/api/v2/view/{view_id}` | Update view |
| DELETE | `/api/v2/view/{view_id}` | Delete view |
| GET | `/api/v2/view/{view_id}/task` | Get view tasks |

### Webhooks

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v2/team/{team_id}/webhook` | Get webhooks |
| POST | `/api/v2/team/{team_id}/webhook` | Create webhook |
| PUT | `/api/v2/webhook/{webhook_id}` | Update webhook |
| DELETE | `/api/v2/webhook/{webhook_id}` | Delete webhook |

---

## 7. Complete API Surface -- v3 Endpoints

All v3 endpoints use the pattern `/api/v3/workspaces/{workspace_id}/...`

### Tasks (v3)

| Method | Path | Description |
|--------|------|-------------|
| PUT | `.../tasks/{task_id}/home_list/{list_id}` | **Move task to new home list** |
| PATCH | `.../tasks/{task_id}/time_estimates_by_user` | Update time estimates by user |
| PUT | `.../tasks/{task_id}/time_estimates_by_user` | Replace time estimates by user |

### Docs (v3)

| Method | Path | Description |
|--------|------|-------------|
| GET | `.../docs` | Search for docs |
| POST | `.../docs` | Create a doc |
| GET | `.../docs/{doc_id}` | Fetch a doc |
| GET | `.../docs/{doc_id}/page_listing` | Fetch page listing for doc |
| GET | `.../docs/{doc_id}/pages` | Fetch pages in doc |
| POST | `.../docs/{doc_id}/pages` | Create a page |
| GET | `.../docs/{doc_id}/pages/{page_id}` | Get page |
| PUT | `.../docs/{doc_id}/pages/{page_id}` | Edit a page |

### Chat (v3, EXPERIMENTAL)

| Method | Path | Description |
|--------|------|-------------|
| GET | `.../chat/channels` | Retrieve channels |
| POST | `.../chat/channels` | Create a channel |
| POST | `.../chat/channels/location` | Create channel on Space/Folder/List |
| POST | `.../chat/channels/direct_message` | Create direct message |
| GET | `.../chat/channels/{channel_id}` | Retrieve a channel |
| PATCH | `.../chat/channels/{channel_id}` | Update a channel |
| DELETE | `.../chat/channels/{channel_id}` | Delete a channel |
| GET | `.../chat/channels/{channel_id}/followers` | Retrieve channel followers |
| GET | `.../chat/channels/{channel_id}/members` | Retrieve channel members |
| GET | `.../chat/channels/{channel_id}/messages` | Retrieve channel messages |
| POST | `.../chat/channels/{channel_id}/messages` | Send a message |
| PATCH | `.../chat/messages/{message_id}` | Update a message |
| DELETE | `.../chat/messages/{message_id}` | Delete a message |
| GET | `.../chat/messages/{message_id}/reactions` | Get message reactions |
| POST | `.../chat/messages/{message_id}/reactions` | Create message reaction |
| DELETE | `.../chat/messages/{message_id}/reactions/{reaction}` | Delete message reaction |
| GET | `.../chat/messages/{message_id}/replies` | Get message replies |
| POST | `.../chat/messages/{message_id}/replies` | Create reply message |
| GET | `.../chat/messages/{message_id}/tagged_users` | Get mentioned users |

### Attachments (v3)

| Method | Path | Description |
|--------|------|-------------|
| GET | `.../{entity_type}/{entity_id}/attachments` | Get attachments |
| POST | `.../{entity_type}/{entity_id}/attachments` | Create attachment |

### Access Control (v3)

| Method | Path | Description |
|--------|------|-------------|
| PATCH | `.../{object_type}/{object_id}/acls` | Update privacy and access |

### Comments (v3)

| Method | Path | Description |
|--------|------|-------------|
| GET | `.../comments/types/{comment_type}/subtypes` | Get post subtype IDs |

### Audit Logs (v3, Enterprise only)

| Method | Path | Description |
|--------|------|-------------|
| POST | `.../auditlogs` | Create workspace-level audit logs |

**Total v3 endpoints: 38**

---

## 8. Webhook Events

Create/manage webhooks via the v2 endpoints. Subscribe using `*` wildcard for all events.

### Task Events

| Event | Trigger |
|-------|---------|
| `taskCreated` | New task created |
| `taskUpdated` | Task updated (any field) |
| `taskDeleted` | Task deleted |
| `taskPriorityUpdated` | Priority changed |
| `taskStatusUpdated` | Status changed |
| `taskAssigneeUpdated` | Assignee changed |
| `taskDueDateUpdated` | Due date changed |
| `taskTagUpdated` | Tags changed |
| `taskMoved` | Task moved to new list |
| `taskCommentPosted` | New comment added |
| `taskCommentUpdated` | Comment edited |
| `taskTimeEstimateUpdated` | Time estimate changed |
| `taskTimeTrackedUpdated` | Time entry added/updated/deleted |

### List Events

| Event | Trigger |
|-------|---------|
| `listCreated` | New list created |
| `listUpdated` | List updated |
| `listDeleted` | List deleted |

### Folder Events

| Event | Trigger |
|-------|---------|
| `folderCreated` | New folder created |
| `folderUpdated` | Folder updated |
| `folderDeleted` | Folder deleted |

### Space Events

| Event | Trigger |
|-------|---------|
| `spaceCreated` | New space created |
| `spaceUpdated` | Space updated |
| `spaceDeleted` | Space deleted |

### Goal Events

| Event | Trigger |
|-------|---------|
| `goalCreated` | New goal created |
| `goalUpdated` | Goal updated |
| `goalDeleted` | Goal deleted |
| `keyResultCreated` | New key result created |
| `keyResultUpdated` | Key result updated |
| `keyResultDeleted` | Key result deleted |

---

## 9. Task Data Model

### Core Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Task ID |
| `custom_id` | string | Custom task ID (if enabled) |
| `name` | string | Task title |
| `description` | string | Plain text description |
| `markdown_description` | string | Markdown-formatted description |
| `status` | object | Status with `id`, `status`, `color`, `type` |
| `priority` | object | Priority (1=Urgent, 2=High, 3=Normal, 4=Low) |
| `assignees` | array | Assigned users |
| `watchers` | array | Users watching the task |
| `tags` | array | Tag objects |
| `custom_fields` | array | Custom field values |
| `parent` | string/null | Parent task ID (`null` = not a subtask) |
| `linked_tasks` | array | Linked task references |
| `dependencies` | array | Dependency references |
| `list` | object | Home list reference (id, name) |
| `folder` | object | Folder reference (id, name) |
| `space` | object | Space reference (id) |
| `url` | string | ClickUp web URL |
| `due_date` | string | Unix timestamp in milliseconds |
| `due_date_time` | boolean | Whether due date includes time |
| `start_date` | string | Unix timestamp in milliseconds |
| `start_date_time` | boolean | Whether start date includes time |
| `time_estimate` | integer | Estimate in milliseconds |
| `time_spent` | integer | Tracked time in milliseconds (only if entries exist) |
| `points` | number | Sprint points / effort |
| `date_created` | string | Creation timestamp |
| `date_updated` | string | Last update timestamp |
| `date_closed` | string | Closure timestamp |
| `creator` | object | Creator user object |
| `order_index` | string | Display order (NOT reliable for tasks) |
| `archived` | boolean | Whether archived |

### Pagination

- `GET /api/v2/list/{list_id}/task` — returns max 100 tasks per page
- `GET /api/v2/team/{team_id}/task` — returns max 100 tasks per page
- Use `?page=0`, `?page=1`, etc.

---

## 10. Custom Field Types

16 types supported:

| Type | Value Format | Notes |
|------|-------------|-------|
| `url` | `"https://..."` | URL string |
| `drop_down` | `"option_id"` | From `type_config.options` |
| `labels` | `["label_id", ...]` | Array of label IDs |
| `email` | `"user@example.com"` | Email string |
| `phone` | `"string"` | With country code |
| `date` | `1234567890000` | Unix ms, optional `"time": true` |
| `short_text` | `"string"` | Single-line text |
| `text` | `"string"` | Multi-line text |
| `checkbox` | `true/false` | Boolean |
| `number` | `123.45` | Numeric |
| `currency` | `123.45` | Numeric, currency set in config |
| `tasks` | `{"add":["id"],"rem":["id"]}` | Task relationships |
| `users` | `{"add":[id],"rem":[id]}` | User IDs |
| `emoji` | `1-5` | Rating scale |
| `automatic_progress` | — | Read-only, auto-calculated |
| `manual_progress` | `{"current": 50, "type_config": {"end": 100}}` | Manual progress bar |
| `location` | `{"lat":..., "lng":..., "formatted_address":"..."}` | Google Maps location |

**Note:** Voting custom field values are read-only via API.

Set via: `POST /api/v2/task/{task_id}/field/{field_id}` with `{"value": ...}`

---

## 11. Key Gotchas and FAQ

### Task Movement

- **"Add Task To List" does NOT move** — it adds the task as a secondary list association. Requires "Tasks in Multiple Lists" ClickApp.
- **"Remove Task From List" cannot remove from home list** — only works on secondary lists.
- **Move Task (v3) changes the home list** — this is what you need for changing a task's primary location.
- The FAQ historically said "It is not possible to move a task between lists" — this was true for v2 but is now possible via the v3 `home_list` endpoint.

### IDs and References

- `team_id` (v2) = `workspace_id` (v3) = same numeric value
- `custom_task_ids` parameter: set to `true` + provide `team_id` to reference tasks by custom ID
- `order_index` is returned for tasks but is NOT reliable for ordering

### Content Type

- Always use `Content-Type: application/json`
- Form-encoded data is not fully supported and causes issues

### Notifications

- API-triggered actions generate the SAME notifications as manual ClickUp usage
- Creating a task via API notifies assignees just like creating it in the UI

### User Roles (numeric)

| Role | Meaning |
|------|---------|
| 1 | Workspace owner |
| 2 | Admin |
| 3 | Member |
| 4 | Guest |

### Subtasks

- Check `parent` field: `null` = top-level task, non-null = subtask
- Use `?subtasks=true` parameter on Get Tasks endpoints to include subtasks
- Create subtasks by setting `parent` field in Create Task

### OAuth Tokens

- Access tokens currently do NOT expire
- No refresh token flow documented
- This is subject to change per ClickUp's docs

---

## Sources

- [ClickUp Developer Portal](https://developer.clickup.com/)
- [ClickUp API Getting Started](https://developer.clickup.com/docs/Getting%20Started)
- [ClickUp API v2 and v3 Terminology](https://developer.clickup.com/docs/general-v2-v3-api)
- [Move a Task to a New List (docs)](https://developer.clickup.com/docs/move-a-task-to-a-new-list)
- [Move a Task to a New List (reference)](https://developer.clickup.com/reference/movetask)
- [Add Task To List](https://developer.clickup.com/reference/addtasktolist)
- [Remove Task From List](https://developer.clickup.com/reference/removetaskfromlist)
- [Rate Limits](https://developer.clickup.com/docs/rate-limits)
- [Authentication](https://developer.clickup.com/docs/authentication)
- [FAQ](https://developer.clickup.com/docs/faq)
- [Webhooks](https://developer.clickup.com/docs/webhooks)
- [Custom Fields](https://developer.clickup.com/docs/customfields)
- [Tasks](https://developer.clickup.com/docs/tasks)
- [Chat API](https://developer.clickup.com/docs/chat)
- [OpenAPI Specification](https://developer.clickup.com/docs/open-api-spec)
- [ClickUp 4.0 Blog Post](https://clickup.com/blog/clickup-4-0/)
- [ClickUp 4.0 Changelog](https://help.clickup.com/hc/en-us/articles/31142544849815-ClickUp-4-0-changelog)
- [Move Task Feedback](https://feedback.clickup.com/public-api/p/move-task-between-lists-using-the-api)
- [Get Filtered Team Tasks](https://developer.clickup.com/reference/getfilteredteamtasks)
- [Task Filter Custom Fields](https://developer.clickup.com/docs/taskfilters)
