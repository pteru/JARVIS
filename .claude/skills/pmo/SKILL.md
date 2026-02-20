---
name: pmo
description: Load a PMO project folder into context by its 5-digit code
argument-hint: "<project-code>"
---

# PMO Project Loader

Load a Strokmatic PMO project into context. The argument is a 5-digit project code (e.g., `02008`).

## Steps

1. Look up the project code in `/home/teruel/JARVIS/config/project-codes.json` to get the project name and language.

2. Read the project context file:
   ```
   /home/teruel/JARVIS/workspaces/strokmatic/pmo/{code}/.claude/context.md
   ```

3. Read the email index (if it exists):
   ```
   /home/teruel/JARVIS/workspaces/strokmatic/pmo/{code}/emails/index.json
   ```
   Summarize: total emails, breakdown by category, date range, top senders.

4. Read the technical report (if it exists):
   ```
   /home/teruel/JARVIS/workspaces/strokmatic/pmo/{code}/technical_report.md
   ```

5. Read the timeline (if it exists):
   ```
   /home/teruel/JARVIS/workspaces/strokmatic/pmo/{code}/timeline.json
   ```
   Summarize: total events, date range, key milestones.

6. List other key files in the project folder:
   ```
   /home/teruel/JARVIS/workspaces/strokmatic/pmo/{code}/
   ```
   Show: meetings/, reports/md/, reference/, and any top-level files.

7. If the project has a `drive` section in `config/project-codes.json`, load Google Drive context:
   a. Check if `drive-index.json` exists at `workspaces/strokmatic/pmo/{code}/drive-index.json`
   b. If it exists and is less than 24h old, read it and summarize:
      - Number of linked Drive folders and their roles
      - Total files and total size
      - File types breakdown
      - Most recently modified file and date
   c. If it exists but is stale (>24h), note it's outdated and suggest running `/gdrive {code} index`
   d. If no index exists, note that Drive folders are configured but not yet indexed — suggest `/gdrive {code} index`
   e. Show the configured folder names and roles from `project-codes.json`

## After Loading

Provide a brief project status summary including:
- Project name, code, and preferred language
- Current phase and key deadlines
- Email corpus size and latest activity date
- Number of open action items (from technical report)
- Available reports and reference documents
- Google Drive status (if configured): number of linked folders, total files, index freshness

Confirm you are ready to work on this project. Use the project's preferred language for all subsequent outputs unless instructed otherwise.
