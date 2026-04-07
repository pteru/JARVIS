---
name: email-analyze
description: AI-powered email analysis — classify emails, extract entities, generate project reports
argument-hint: "[action] [project-code]"
---

# Email Analyze — AI-Powered Email Analysis

This skill orchestrates intelligent email analysis using `index.json` as the single source of truth and the `read_email` MCP tool for on-demand body access.

## Actions

### Analyze new emails for a project
When asked to analyze emails for a project (e.g., "Analyze new emails for 02008"):

1. Use the `get_project_emails` MCP tool to list emails:
   - `get_project_emails(project_code, unanalyzed_only=true)` for uncategorized emails
2. For each uncategorized email, classify it as: `technical`, `status`, `discussion`, or `administrative`
   - The `snippet` field (~200 chars) + subject + sender is usually sufficient for classification
   - If more context is needed, use `read_email` MCP tool with the `gmail_id` to fetch full body
3. Extract structured data: key dates, action items, decisions, technical notes
4. Use `extract_entities` MCP tool to write category + analysis back to `index.json`

**Batch classification** (automated, no MCP):
```bash
bash scripts/email-analyze.sh
```
This uses `claude --print` (haiku) to classify all uncategorized emails across all projects in one batch.

### Generate/update project report
When asked to generate or update a report for a project:

1. Use `get_project_context` MCP tool to get current stats and existing report
2. Use `get_project_emails` MCP tool to get all emails with analysis data
3. For emails needing deeper analysis, fetch full body via `read_email` MCP tool using `gmail_id`
4. Generate/update a comprehensive technical report covering:
   - Project timeline and milestones
   - Technical decisions and requirements
   - Open action items and pending replies
   - Key participants and their roles
5. Use `update_project_report` MCP tool to write the report

### Extract timeline
When asked to extract a timeline:

1. Use `get_project_emails` MCP tool to get all emails
2. Extract date-event pairs from email metadata and analysis
3. Use `extract_timeline` MCP tool to write chronological timeline

## MCP Tools

| Tool | Server | Purpose |
|------|--------|---------|
| `get_project_emails` | email-analyzer | List emails from index.json |
| `get_project_context` | email-analyzer | Project stats, report preview |
| `extract_entities` | email-analyzer | Write category + analysis to index |
| `update_project_report` | email-analyzer | Write technical_report.md |
| `extract_timeline` | email-analyzer | Write timeline.json |
| `read_email` | google-workspace | Fetch full email body by gmail_id |
| `search_emails` | google-workspace | Search Gmail with query syntax |

## Key Paths
- Project codes: `workspaces/strokmatic/pmo/config/project-codes.json`
- PMO folders: `workspaces/strokmatic/pmo/projects/{code}/`
- Email index: `pmo/projects/{code}/emails/index.json`
- Reports: `pmo/projects/{code}/technical_report.md`
- Timeline: `pmo/projects/{code}/timeline.json`
