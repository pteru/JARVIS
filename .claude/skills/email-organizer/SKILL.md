---
name: email-organizer
description: Fetch, classify, parse, and store project emails from IMAP into PMO folders
argument-hint: "[subcommand] [args]"
---

# Email Organizer Tool

A CLI tool for managing project email ingestion. Always invoke via its dedicated venv:

```
EMAIL="/home/teruel/JARVIS/tools/.venv/bin/python /home/teruel/JARVIS/tools/email-organizer/main.py"
```

**Required env vars for IMAP:** `IMAP_USERNAME`, `IMAP_PASSWORD`, optionally `IMAP_HOST` (default: imap.gmail.com).

## Subcommands

### Fetch new emails from IMAP
```bash
$EMAIL fetch                    # Download + auto-classify
$EMAIL fetch --no-classify      # Download only (to staging)
```

### Classify staged emails
```bash
$EMAIL classify                         # Classify from default staging dir
$EMAIL classify --source /path/to/dir   # Classify from custom dir
```

### Parse raw emails for a project
```bash
$EMAIL parse 02008              # Parse new raw emails, update index
$EMAIL parse 02008 --force      # Re-parse all (even already parsed)
```

### Full pipeline (fetch → classify → parse)
```bash
$EMAIL ingest
```

### List ingested emails
```bash
$EMAIL list                     # All projects
$EMAIL list --project 02008     # Specific project
```

### Reprocess all emails for a project
```bash
$EMAIL reprocess 02008          # Re-parse everything with --force
```

## Project Codes

Projects are configured in `config/project-codes.json`. Each entry maps a 5-digit code to keywords, senders, and a PMO path for classification.

## Storage Layout

Emails are stored per-project in PMO folders:
```
pmo/{code}/
  emails/
    raw/         ← Original .eml files
    parsed/      ← Structured .json per email
    index.json   ← Master index (date, from, subject, attachments, category)
  attachments/   ← Deduplicated, indexed by email hash
```

## Common Workflows

**Initial setup for a new project:**
1. Add project entry to `config/project-codes.json`
2. Create Gmail label with the 5-digit project code
3. Run `$EMAIL fetch` to pull existing emails

**After updating project-codes.json:**
```bash
$EMAIL classify --source /home/teruel/JARVIS/data/email-organizer/unclassified
```

**For AI-powered analysis** (entity extraction, report generation), use the `/email-analyze` skill which delegates intelligence to Claude Code via the email-analyzer MCP tools.
