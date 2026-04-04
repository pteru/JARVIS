# Gmail API Migration — Google Workspace MCP Server

**Status:** Planned
**Priority:** Medium
**Estimated complexity:** Medium

---

## Overview

Add Gmail tools to the existing Google Workspace MCP server and migrate the email fetching pipeline from raw IMAP (`imaplib`) to Gmail API. This consolidates authentication (service account already impersonates `pedro@lumesolutions.com`) and eliminates the separate Python CLI tool + app password credential.

## Problem Statement

The current email pipeline uses a standalone Python tool (`tools/email-organizer/main.py`) that connects to Gmail via raw IMAP with an app-specific password stored in `.env`. This creates:
- **Credential sprawl** — separate IMAP app password outside the service account auth
- **Fragile IMAP parsing** — raw `imaplib` + `email` module for MIME parsing
- **No MCP integration** — fetching requires shelling out to Python, can't be done natively in a Claude session
- **Duplicate infrastructure** — two separate email-related systems (fetcher vs analyzer) with no shared auth

Gmail API provides structured JSON responses, proper threading, label management, and query syntax — all through the same service account already authorized for Docs/Sheets/Drive.

## Architecture / Components

### Current Pipeline
```
Gmail IMAP → tools/email-organizer/main.py (imaplib) → .eml files → parsed JSON
                                                         ↓
                                              scripts/email-analyze.sh (claude --print)
                                                         ↓
                                              mcp-servers/email-analyzer/ (entity extraction)
```

### Target Pipeline
```
Gmail API → mcp-servers/google-workspace/ (new Gmail tools) → parsed JSON
                          ↓
               mcp-servers/email-analyzer/ (entity extraction, unchanged)
```

### Scope
- **In scope:** Gmail read tools (list, read, search, labels), email-organizer skill rewrite, IMAP deprecation
- **Out of scope:** Send/compose email, Gmail write operations, email-analyzer MCP changes

## New MCP Tools

Add to `mcp-servers/google-workspace/index.js`:

| Tool | Description |
|------|-------------|
| `list_emails` | List messages with query filter (from, to, subject, date range, label). Pagination via `nextPageToken`. Returns metadata (id, threadId, subject, from, date, snippet, labels). |
| `read_email` | Read full message by ID. Returns headers, body (text + HTML), attachments (metadata only). |
| `search_emails` | Full Gmail query syntax (`from:X after:2026/01/01 has:attachment`). Returns matching message list. |
| `get_labels` | List all user labels (system + custom). |
| `download_attachment` | Download a specific attachment by messageId + attachmentId to local path. |

## File Structure

**Modified files:**
- `mcp-servers/google-workspace/index.js` — Add Gmail scope + 5 tools + implementations
- `.claude/skills/email-organizer/SKILL.md` — Rewrite to use MCP tools instead of Python CLI
- `scripts/email-ingest.sh` — Rewrite to use `claude --print` with Gmail MCP tools

**No changes needed:**
- `mcp-servers/email-analyzer/` — Operates on parsed JSON, unchanged
- `config/project-codes.json` — Classification rules unchanged
- `data/email-organizer/imap_state.json` — Will be replaced by Gmail historyId or query-based dedup

**Deprecated (keep but mark):**
- `tools/email-organizer/main.py` — Original IMAP fetcher (keep for reference, stop using)
- `tools/email-organizer/.env` — IMAP credentials (can be removed after migration)

## Implementation Phases

1. **Phase 1: Gmail tools in MCP server** (~4h) — Add `gmail.readonly` scope to auth, implement 5 Gmail tools, test with MCP inspector. Follow existing patterns in `index.js` (error handling, auth mode support).

2. **Phase 2: Email organizer skill migration** (~3h) — Rewrite `/email-organizer` skill to use MCP Gmail tools instead of Python CLI. Maintain same output format (parsed JSON in PMO folders) for compatibility with email-analyzer MCP.

3. **Phase 3: Ingest script migration** (~2h) — Rewrite `scripts/email-ingest.sh` to use `claude --print` with Gmail MCP tools. Replace IMAP UID tracking with Gmail query-based dedup (`after:YYYY/MM/DD`).

4. **Phase 4: Cleanup & validation** (~1h) — Mark old Python tool as deprecated, remove IMAP `.env` from active use, verify full pipeline (fetch → classify → parse → analyze) works end-to-end.

## Testing Strategy

- **Phase 1:** Manual MCP tool test — `list_emails` with query, `read_email` for known message, `search_emails` with various filters
- **Phase 2:** Run `/email-organizer` on a project, verify parsed JSON format matches old pipeline output
- **Phase 3:** Run `email-ingest.sh`, verify no duplicate fetches, verify new emails appear in PMO folders
- **Phase 4:** Full pipeline test on project 02008 (Nissan Smyrna — largest email corpus)

## Estimates Summary

| Phase | Hours | Dependencies |
|-------|-------|-------------|
| Phase 1: Gmail MCP tools | 4 | Gmail scope in Admin Console (done) |
| Phase 2: Skill migration | 3 | Phase 1 |
| Phase 3: Ingest script | 2 | Phase 2 |
| Phase 4: Cleanup | 1 | Phase 3 |
| **Total** | **10** | |

## Prerequisites

- [x] Gmail `readonly` scope added to domain-wide delegation in Admin Console
- [ ] MCP server restart after code changes (requires `/exit` + relaunch)

## Risk Register

| Risk | Impact | Mitigation |
|------|--------|------------|
| Gmail API rate limits (250 quota units/sec) | Slow batch fetch | Use `list` with date filters, batch requests |
| Service account impersonation rejected for Gmail | Can't access inbox | Verify scope propagation, test with simple list call first |
| Parsed JSON format mismatch | Breaks email-analyzer MCP | Map Gmail API fields to existing schema, validate with diff |
| Large attachments (>25MB) | Memory/timeout issues | Stream downloads, skip attachments above threshold |
