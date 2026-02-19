---
name: md-to-pdf
description: Export Markdown files to PDF with proper typography, line breaks, and embedded images
argument-hint: "<file.md or directory>"
---

# Markdown to PDF Export

Export markdown reports to clean, well-typeset PDFs using `md-to-pdf` (Puppeteer/Chrome). **Never use pandoc or LaTeX** — they produce poor typography compared to HTML-rendered PDFs.

## Command

```bash
PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome npx --yes md-to-pdf <file>.md
```

The PDF is generated in the same directory as the source `.md` file. Move it to the `pdf/` directory after export.

## PMO Report Structure

```
pmo/<project>/reports/
├── md/          # Markdown source files
├── pdf/         # Exported PDFs (move here after export)
└── img/         # Shared images (if any)
```

## Critical Rules

### 1. Line Breaks in Header Metadata

Consecutive bold metadata lines **must** end with `<br>` — otherwise standard Markdown collapses them into a single line in the PDF.

```markdown
**Projeto:** 03002 — ArcelorMittal Barra Mansa<br>
**Autor:** Pedro Teruel (Strokmatic)<br>
**Data:** 19 de fevereiro de 2026<br>
**Severidade:** Alta
```

The last line does NOT need `<br>` (nothing follows it in the block).

### 2. Image Path Resolution (CWD matters)

`md-to-pdf` resolves relative image paths **from the working directory**, NOT from the `.md` file's location.

If a markdown file at `reports/md/report.md` references `../../charts/image.png`, you must run the export from the project root:

```bash
# CORRECT — CWD is the project root, ../../charts/ resolves properly
cd /path/to/pmo/02008
PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome npx --yes md-to-pdf reports/md/report.md
mv reports/md/report.pdf reports/pdf/

# WRONG — CWD is reports/md/, ../../charts/ resolves to the wrong place
cd /path/to/pmo/02008/reports/md
npx --yes md-to-pdf report.md  # Images will be missing!
```

**How to detect this:** If the exported PDF is suspiciously small (~100KB for a report with images), images failed to embed. A report with 6 chart PNGs should be ~900KB+.

### 3. Batch Export

```bash
cd /path/to/pmo/<project>
for f in reports/md/*.md; do
  echo "Exporting $f..."
  PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome npx --yes md-to-pdf "$f"
done
mv reports/md/*.pdf reports/pdf/
```

### 4. Single File Export (no images)

When the markdown has no image references, CWD doesn't matter:

```bash
cd /path/to/pmo/<project>/reports/md
PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome npx --yes md-to-pdf report.md
mv report.pdf ../pdf/
```

## Prerequisites

- Node.js (for `npx`)
- Google Chrome at `/usr/bin/google-chrome`

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| PDF is tiny (~100KB) with image placeholders | CWD wrong for relative image paths | Run from project root, not from `md/` |
| Header fields all on one line | Missing `<br>` on consecutive bold lines | Add `<br>` at end of each line except the last |
| `md-to-pdf` hangs indefinitely | Chrome not found by Puppeteer | Set `PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome` |
| Timeout on large files | Puppeteer taking too long | Increase shell timeout to 120s |
