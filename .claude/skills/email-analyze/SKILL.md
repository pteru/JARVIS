---
name: email-analyze
description: AI-powered email analysis — classify ambiguous emails, extract entities, generate project reports
argument-hint: "[action] [project-code]"
---

# Email Analyze — AI-Powered Email Analysis

This skill orchestrates intelligent email analysis using the email-organizer CLI tool for data plumbing and Claude Code's reasoning for intelligence.

## Actions

### Analyze new emails for a project
When asked to analyze emails for a project (e.g., "Analyze new emails for 02008"):

1. Run the email-organizer to check for new emails:
```bash
EMAIL="/home/teruel/JARVIS/tools/email-organizer/.venv/bin/python /home/teruel/JARVIS/tools/email-organizer/main.py"
$EMAIL list --project {code}
```

2. Read the parsed JSON files from `workspaces/strokmatic/pmo/{code}/emails/parsed/`
3. For each email without a `category`, classify it as: `technical`, `status`, `discussion`, or `administrative`
4. Extract structured data: key dates, action items, decisions, technical notes
5. Update the parsed JSON files and index with the extracted data

### Reclassify unclassified emails
When asked to reclassify unclassified emails:

1. Check `data/email-organizer/unclassified/` for .eml files
2. Read each email's content and the project-codes map from `config/project-codes.json`
3. Use contextual understanding to match emails to projects
4. Move matched emails to the correct PMO folder using:
```bash
$EMAIL classify --source /home/teruel/JARVIS/data/email-organizer/unclassified
```

### Generate/update project report
When asked to generate or update a report for a project:

1. Read all parsed emails from `pmo/{code}/emails/parsed/`
2. Read existing `pmo/{code}/technical_report.md` if it exists
3. Generate/update a comprehensive technical report covering:
   - Project timeline and milestones
   - Technical decisions and requirements
   - Open action items and pending replies
   - Key participants and their roles
4. Write the updated report to `pmo/{code}/technical_report.md`

### Extract timeline
When asked to extract a timeline:

1. Read all parsed emails for the project
2. Extract date-event pairs from email content
3. Write chronological `pmo/{code}/timeline.json`

## Key Paths
- Project codes: `config/project-codes.json`
- PMO folders: `workspaces/strokmatic/pmo/{code}/`
- Parsed emails: `pmo/{code}/emails/parsed/*.json`
- Email index: `pmo/{code}/emails/index.json`
- Reports: `pmo/{code}/technical_report.md`
- Timeline: `pmo/{code}/timeline.json`
