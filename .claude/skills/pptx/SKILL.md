---
name: pptx
description: Work with PowerPoint (.pptx) files — create, read, edit, and inspect presentations
argument-hint: "[subcommand] [file]"
---

# PPTX Tool

A CLI tool for working with PowerPoint presentations. Always invoke via the dedicated venv:

```
PPTX="/home/teruel/JARVIS/tools/.venv/bin/python /home/teruel/JARVIS/tools/pptx-tool.py"
```

## Subcommands

### Read content
```bash
$PPTX read file.pptx                              # Plain text output
$PPTX read file.pptx --format json                # Structured JSON (slides, shapes, styles, metadata)
$PPTX read file.pptx --format markdown            # Convert to markdown
$PPTX read file.pptx --format json --with-styles  # Include font, color, bold/italic per run
$PPTX read file.pptx --range 1:5                  # Slides 1–5 only (1-based)
```

### Create from markdown or JSON
```bash
# From markdown via stdin:
echo "# Presentation Title\n\n## Slide 1\n\nBullet point" | $PPTX create output.pptx

# From markdown file:
$PPTX create output.pptx -i content.md

# From JSON structure:
$PPTX create output.pptx -i slides.json

# With template (uses existing theme/layouts):
$PPTX create output.pptx -i content.md --template company-template.pptx
```

### Edit existing presentation
```bash
$PPTX edit file.pptx --replace "old text" "new text"              # Replace first occurrence
$PPTX edit file.pptx --replace-all "old text" "new text"          # Replace all occurrences
$PPTX edit file.pptx --add-slide "Title and Content" --title "New Slide" --body "Content here"
$PPTX edit file.pptx --add-slide blank                             # Add blank slide
$PPTX edit file.pptx --delete-slide 3                              # Delete slide 3 (1-based)
$PPTX edit file.pptx --set-notes 2 "Speaker notes for slide 2"    # Set speaker notes
$PPTX edit file.pptx --set-metadata title "New Title"              # Set presentation metadata
```

### Inspect presentation
```bash
$PPTX info file.pptx                  # Human-readable summary
$PPTX info file.pptx --format json    # Machine-readable JSON
```

## Markdown Input Format

When creating from markdown, the tool maps headings to slides:

```markdown
# Presentation Title          → Title Slide (layout 0)

## Slide Title                 → Title and Content slide (layout 1)

Content paragraph here.

- Bullet point 1
- Bullet point 2
  - Sub-bullet (indented)

### Sub-heading               → Bold text within slide

> Notes text                  → Speaker notes

## Another Slide

| Col A | Col B |             → Table on slide
|-------|-------|
| val1  | val2  |
```

## JSON Input Format

```json
{
  "metadata": {"title": "My Deck", "author": "JARVIS"},
  "slides": [
    {
      "layout": "Title Slide",
      "title": "Welcome",
      "body": "Subtitle text"
    },
    {
      "layout": "Title and Content",
      "title": "Key Points",
      "bullets": ["First point", "Second point", {"text": "Sub-point", "level": 1}]
    },
    {
      "layout": "Blank",
      "table": {"rows": [["Header A", "Header B"], ["val1", "val2"]]},
      "notes": "Speaker notes here"
    }
  ]
}
```

## Common Patterns

**Read a presentation for analysis:**
```bash
$PPTX read presentation.pptx --format markdown > presentation.md
# Now work with the markdown version
```

**Extract structured content:**
```bash
data=$($PPTX read presentation.pptx --format json)
echo "$data" | python3 -c "
import json, sys
prs = json.load(sys.stdin)
for slide in prs['slides']:
    print(f\"Slide {slide['slide_number']}: {slide['layout']}\")
    for shape in slide['shapes']:
        if 'text' in shape and shape['text'].strip():
            print(f\"  {shape['text'][:80]}\")
"
```

**Quick text replacement across all slides:**
```bash
$PPTX edit deck.pptx --replace-all "COMPANY_NAME" "Strokmatic Ltda."
```

**Create a presentation from a template:**
```bash
$PPTX create report.pptx -i slides-content.md --template company-template.pptx
```

**Add a slide to an existing deck:**
```bash
$PPTX edit deck.pptx --add-slide "Title and Content" --title "Q1 Results" --body "Revenue up 15%"
```

## Layout Names

Common layout references (name or index):
- `0` / `Title Slide` — Title + subtitle
- `1` / `Title and Content` — Title + body content
- `2` / `Section Header` — Section divider
- `3` / `Two Content` — Title + two columns
- `5` / `Title Only` — Title, no body placeholder
- `6` / `Blank` — Empty slide
