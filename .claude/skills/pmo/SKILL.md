---
name: pmo
description: Load a PMO project folder into context by its 5-digit code
argument-hint: "<project-code>"
---

# PMO Project Loader

Load a Strokmatic PMO project into context. The argument is a 5-digit project code (e.g., `02008`).

## Steps

1. Look up the project code in `/home/teruel/JARVIS/workspaces/strokmatic/pmo/config/project-codes.json` to get the project name and language.

2. Read the OKF knowledge layer (preferred, if it exists):
   ```
   /home/teruel/JARVIS/workspaces/strokmatic/pmo/projects/{code}/knowledge/index.md
   ```
   Follow its links and read every listed page (small curated concept pages with
   YAML frontmatter). If this index exists, SKIP step 3 — the legacy context file
   is a pointer stub for migrated projects.

3. Otherwise, read the legacy project context file:
   ```
   /home/teruel/JARVIS/workspaces/strokmatic/pmo/projects/{code}/.claude/context.md
   ```

4. Read the email index (if it exists):
   ```
   /home/teruel/JARVIS/workspaces/strokmatic/pmo/projects/{code}/emails/index.json
   ```
   Summarize: total emails, breakdown by category, date range, top senders.

5. Read the technical report (if it exists):
   ```
   /home/teruel/JARVIS/workspaces/strokmatic/pmo/projects/{code}/technical_report.md
   ```

6. Read the timeline (if it exists):
   ```
   /home/teruel/JARVIS/workspaces/strokmatic/pmo/projects/{code}/timeline.json
   ```
   Summarize: total events, date range, key milestones.

7. List other key files in the project folder:
   ```
   /home/teruel/JARVIS/workspaces/strokmatic/pmo/projects/{code}/
   ```
   Show: meetings/, reports/md/, reference/, and any top-level files.

8. If the project has a `drive` section in `config/project-codes.json`, load Google Drive context:
   a. Check if `drive-index.json` exists at `workspaces/strokmatic/pmo/projects/{code}/drive-index.json`
   b. If it exists, read it and summarize:
      - Number of linked Drive folders and their roles
      - Total files and total size
      - File types breakdown
      - Most recently modified file and date
      - If the index is older than 24h, note: "drive-index.json is X days old — consider running `/gdrive {code} index` to refresh" (but always use the existing data regardless)
   c. If no index exists, note that Drive folders are configured but not yet indexed — suggest `/gdrive {code} index`
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

## Boot OKF (especialista pmo)

Antes de trabalhar, rehidrate contexto recente (convenção `~/JARVIS/journal/BOOT.md`):
`python3 ~/JARVIS/scripts/okf/okf.py search pmo processos sprints governanca drive --tag pmo`,
leia as 2–3 entradas mais recentes de `~/JARVIS/journal/` do tópico e as páginas
que elas linkam. Ao final do bloco, escreva `journal/YYYY-MM-DD-pmo.md`
(Feito · Decisões · Pendências · Links; **nunca segredos**) e rode
`python3 ~/JARVIS/scripts/okf/okf.py index journal`.
