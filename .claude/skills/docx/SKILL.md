---
name: docx
description: Work with Word (.docx) files — create, read, edit, and inspect documents
argument-hint: "[subcommand] [file]"
---

# DOCX Tool

A CLI tool for working with Word documents. Always invoke via the dedicated venv:

```
DOCX="/home/teruel/JARVIS/tools/.venv/bin/python /home/teruel/JARVIS/tools/docx-tool.py"
```

## Subcommands

### Read content
```bash
$DOCX read file.docx                              # Plain text output
$DOCX read file.docx --format json                # Structured JSON (paragraphs, tables, styles, metadata)
$DOCX read file.docx --format markdown            # Convert to markdown
$DOCX read file.docx --format json --with-styles  # Include font, color, bold/italic per run
$DOCX read file.docx --range 10:50                # Sections 10–50 only (for large docs)
```

### Create from markdown or JSON
```bash
# From markdown via stdin:
echo "# Title\n\nParagraph text" | $DOCX create output.docx

# From markdown file:
$DOCX create output.docx -i content.md

# From JSON structure:
$DOCX create output.docx -i data.json

# With template (copies styles from an existing docx):
$DOCX create output.docx -i content.md --template template.docx
```

### Edit existing document
```bash
$DOCX edit file.docx --replace "old text" "new text"            # Replace first occurrence
$DOCX edit file.docx --replace-all "old text" "new text"        # Replace all occurrences
$DOCX edit file.docx --append "New paragraph at the end"        # Append paragraph
$DOCX edit file.docx --insert 5 "Inserted paragraph"            # Insert at paragraph index
$DOCX edit file.docx --delete 3                                  # Delete paragraph at index
$DOCX edit file.docx --set-metadata title "New Title"            # Set document metadata
```

### Inspect document
```bash
$DOCX info file.docx                  # Human-readable summary
$DOCX info file.docx --format json    # Machine-readable JSON
```

## Common Patterns

**Read a regulation document:**
```bash
$DOCX read regulamento.docx --format markdown > regulamento.md
# Now work with the markdown version
```

**Extract structured content for analysis:**
```bash
data=$($DOCX read document.docx --format json)
echo "$data" | python3 -c "
import json, sys
doc = json.load(sys.stdin)
for sec in doc['sections']:
    if sec['type'] == 'table':
        print(sec['rows'])
"
```

**Quick text replacement across a document:**
```bash
$DOCX edit contract.docx --replace-all "COMPANY_NAME" "Strokmatic Ltda."
```

**Create a document from a template:**
```bash
$DOCX create report.docx -i report-content.md --template company-template.docx
```
