# Google Workspace Connector — MCP Server + Skills

**Status:** Planned
**Priority:** High
**Estimated complexity:** Large

---

## Overview

MCP server providing tools to interact with Google Workspace (Docs, Sheets, Slides) from the orchestrator. Enables JARVIS to read, create, edit, and manage documents programmatically — supporting report generation, data export, collaborative editing, and meeting-minutes publishing.

## Architecture

### Auth Strategy: Dual-Mode

1. **Service Account (default)** — GCP service account with domain-wide delegation for the Strokmatic Google Workspace domain. No interactive consent needed. Tokens managed server-side.
2. **OAuth2 user flow (fallback)** — For personal Google accounts or domains without delegation. Interactive consent with persistent refresh tokens stored in `config/credentials/google-oauth-tokens.json`.

Auth mode is selected per-request or via config default:

```json
{
  "google_workspace": {
    "default_auth": "service_account",
    "service_account_key": "config/credentials/gcp-service-account.json",
    "oauth2": {
      "client_id": "...",
      "client_secret": "...",
      "token_store": "config/credentials/google-oauth-tokens.json",
      "scopes": [
        "https://www.googleapis.com/auth/documents",
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/presentations",
        "https://www.googleapis.com/auth/drive"
      ]
    }
  }
}
```

### MCP Server: `google-workspace`

Node.js MCP server (consistent with existing MCP servers in the orchestrator). Uses the official `googleapis` npm package.

### File Structure

```
mcp-servers/google-workspace/
├── package.json
├── src/
│   ├── index.ts            # MCP server entrypoint
│   ├── auth/
│   │   ├── service-account.ts
│   │   ├── oauth2.ts
│   │   └── auth-manager.ts  # Selects auth mode, caches tokens
│   ├── tools/
│   │   ├── docs.ts          # Google Docs tools
│   │   ├── sheets.ts        # Google Sheets tools
│   │   ├── slides.ts        # Google Slides tools
│   │   └── drive.ts         # Google Drive tools (list, search, share)
│   └── utils/
│       ├── formatting.ts    # Markdown ↔ Docs conversion
│       └── retry.ts         # Rate-limit handling with exponential backoff
└── tsconfig.json
```

## MCP Tools

### Google Docs

| Tool | Description |
|------|-------------|
| `create_doc` | Create a new Google Doc with optional initial content (Markdown → Docs formatting) |
| `read_doc` | Read a Google Doc by ID or URL, return as Markdown |
| `update_doc` | Append, replace, or insert content at a specific location |
| `list_docs` | List recent docs, optionally filtered by folder or search query |

### Google Sheets

| Tool | Description |
|------|-------------|
| `create_sheet` | Create a new spreadsheet with optional initial data (2D array or CSV) |
| `read_sheet` | Read a sheet or range, return as JSON array of rows |
| `update_sheet` | Write data to a range (overwrite or append) |
| `read_sheet_metadata` | Get sheet names, dimensions, named ranges |

### Google Slides

| Tool | Description |
|------|-------------|
| `create_presentation` | Create a presentation with title and optional template ID |
| `add_slide` | Add a slide with layout, title, and body content |
| `read_presentation` | Read presentation structure and text content |
| `update_slide` | Update text or replace placeholder content on a specific slide |

### Google Drive

| Tool | Description |
|------|-------------|
| `search_drive` | Search files by name, type, folder, or full-text content |
| `share_file` | Share a file with a user or make it link-accessible |
| `move_file` | Move a file to a different folder |
| `create_folder` | Create a folder, optionally nested under a parent |

## Skills

### `/gdoc` — Quick Google Doc operations

```yaml
name: gdoc
description: Create, read, or edit a Google Doc
argument-hint: "<url-or-title> [action]"
```

Dispatches to the appropriate MCP tool based on arguments. Examples:
- `/gdoc "Meeting Notes 2026-02-18"` → creates a new doc
- `/gdoc https://docs.google.com/d/...` → reads and summarizes
- `/gdoc https://docs.google.com/d/... append "## Action Items\n- ..."` → appends content

### `/gsheet` — Quick Sheets operations

```yaml
name: gsheet
description: Create, read, or edit a Google Sheet
argument-hint: "<url-or-title> [range] [action]"
```

### `/gslides` — Quick Slides operations

```yaml
name: gslides
description: Create, read, or edit a Google Slides presentation
argument-hint: "<url-or-title> [action]"
```

## Implementation Notes

- **Rate limits:** Google APIs have per-user and per-project quotas. The retry utility must handle 429s with exponential backoff and respect `Retry-After` headers.
- **Markdown ↔ Docs:** Use a lightweight converter for Docs API `batchUpdate` requests. Headings, bold, italic, lists, and links are the critical subset. No need for full HTML support.
- **Credential files must be gitignored.** `config/credentials/` is already in `.gitignore`; verify before implementation.
- **Sheets data format:** Return rows as `[{column_header: value, ...}]` when headers are present, raw 2D arrays otherwise.
- **Large documents:** For Docs/Sheets that exceed reasonable context size, support pagination or range-based reads.

## Dependencies

- `googleapis` (official Google API client)
- `@modelcontextprotocol/sdk` (MCP server framework)
- Existing auth infrastructure in `config/credentials/`

## Integration Points

- **Report generator:** Can publish daily/weekly reports directly to a shared Google Doc instead of local Markdown.
- **Email organizer:** Can create Sheets summaries of classified emails.
- **Meeting assistant (see: meeting-assistant.md):** Publishes meeting minutes to Google Docs, action items to Sheets.
