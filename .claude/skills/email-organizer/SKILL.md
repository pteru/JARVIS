---
name: email-organizer
description: Sync project emails from Gmail API into PMO folders
argument-hint: "[project-code] [--migrate]"
---

# Email Organizer — Gmail API Sync

Syncs project emails from Gmail via service account API into local `emails/index.json` files per PMO project. Replaces the old IMAP-based Python tool.

## Sync Script

```bash
NODE_PATH=mcp-servers/node_modules node scripts/email-sync.mjs            # Sync all projects
NODE_PATH=mcp-servers/node_modules node scripts/email-sync.mjs 02008      # Sync specific project
NODE_PATH=mcp-servers/node_modules node scripts/email-sync.mjs --migrate  # Enrich old entries with gmail_id
```

Auth: GCP service account (`config/credentials/gcp-service-account.json`) impersonating `pedro@lumesolutions.com` with `gmail.readonly` scope.

## How It Works

1. Reads `workspaces/strokmatic/pmo/config/project-codes.json` for project list
2. Queries Gmail for messages with label matching each project code (e.g., `label:02008`)
3. Fetches metadata (subject, from, to, date, message-id, snippet, attachments) for each new message
4. Appends to `pmo/projects/{code}/emails/index.json`, deduplicating by `gmail_id`

### Migration mode (`--migrate`)

For existing entries that have `hash` (from old IMAP pipeline) but no `gmail_id`:
- Resolves `gmail_id` via `rfc822msgid:{message_id}` query
- Enriches with Gmail snippet, labels, thread_id
- Pulls analysis data from `parsed/*.json` files if present

## Project Codes

Projects are configured in `workspaces/strokmatic/pmo/config/project-codes.json`. Each entry maps a 5-digit code to a PMO path. Gmail labels must match the project code.

## Storage Layout

```
pmo/projects/{code}/
  emails/
    index.json   ← Master index (gmail_id, hash, date, from, subject, snippet, category, analysis)
    raw/         ← [Legacy] Original .eml files
    parsed/      ← [Legacy] Structured .json per email
  attachments/   ← Deduplicated, indexed by email hash
```

New entries from Gmail API have `gmail_id` + `snippet`. Legacy entries have `hash` + optional `gmail_id` (after migration). Full email body is fetched on-demand via the `read_email` MCP tool from the google-workspace server.

## Common Workflows

**Initial setup for a new project:**
1. Add project entry to `workspaces/strokmatic/pmo/config/project-codes.json`
2. Create Gmail label with the 5-digit project code
3. Run `NODE_PATH=mcp-servers/node_modules node scripts/email-sync.mjs {code}`

**Automated pipeline** (called by `system-update.sh`):
```bash
scripts/email-sync.mjs   # sync new emails
scripts/email-analyze.sh  # classify uncategorized via Claude
```

**For AI-powered analysis** (entity extraction, report generation), use the `/email-analyze` skill which delegates intelligence to Claude Code via the email-analyzer MCP tools.
