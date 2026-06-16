# Email Analyzer

## Purpose
Classifies project emails, extracts structured entities (dates, action items, decisions, technical references), and maintains per-project technical reports and timelines. Works with the PMO directory structure organized by project codes (01xxx DieMaster, 02xxx SpotFusion, 03xxx VisionKing).

## MCP Tools
- **classify_email** — Classify an email into a project and category (technical/administrative/discussion/status) using project code keywords
- **extract_entities** — Extract structured entities from an email and update the project's index.json with analysis results
- **update_project_report** — Write or update the technical_report.md for a project, with automatic backup to history/
- **extract_timeline** — Write timeline events to timeline.json for a project, merging and deduplicating with existing entries
- **get_project_emails** — Retrieve all parsed emails for a project with optional body preview and unanalyzed filter
- **get_project_context** — Get current project context: report status, timeline event count, and email statistics

## Tech Stack
- Node.js (ESM), @modelcontextprotocol/sdk
- Uses `JARVIS_HOME` env var (not the shared config-loader)

## Configuration
- Project codes: `config/project-codes.json` (maps codes to names and keywords)
- Email indexes: `workspaces/strokmatic/pmo/<code>/emails/index.json`
- Reports: `workspaces/strokmatic/pmo/<code>/technical_report.md`
- Timelines: `workspaces/strokmatic/pmo/<code>/timeline.json`
- Report backups: `workspaces/strokmatic/pmo/<code>/history/`

## Integration Points
- Email ingestion scripts populate the index.json files that this server reads
- Google-workspace MCP server provides raw email access via Gmail API
- PMO dashboard may consume the generated reports and timelines

## Key Files
- `index.js` — Single-file server with email classification, entity extraction, and project report management
