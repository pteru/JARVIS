---
type: Implementation Plan
title: Document Templates Plugin — Implementation Plan
description: Expected: plugin.json (59 bytes), 4 asset files (colors.json + 3 logos)
timestamp: 2026-04-01
---

# Document Templates Plugin — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a Strokmatic marketplace plugin that centralizes document templates (reports, proposals, presentations, quotes, expense reports) with shared branding, CSS, and a `/doc` skill.

**Architecture:** Plugin follows the existing `sdk-agent-standards` pattern — `plugin.json` + `skills/` + `scripts/` + `assets/`. Templates are parameterized HTML/MD files. A single Python CLI tool (`doc-tool.py`) handles rendering, preview, and XLSX expense automation. CSS is split into `base.css` + `components.css` to avoid duplication across templates.

**Tech Stack:** Python 3.10+ (openpyxl, Pillow, anthropic), Node.js (md-to-pdf, marp-cli), Chrome headless (HTML→PDF), `{{placeholder}}` substitution via `str.replace` in templates.

**Plugin target path:** `/home/teruel/JARVIS/workspaces/strokmatic/sdk/sdk-agent-standards/plugins/claude-code/document-templates/`

**Spec:** `/home/teruel/JARVIS/backlogs/plans/plugin-document-templates.md`

**Deviations from spec (intentional):**
- `SKILL.md` placed at `skills/doc/SKILL.md` (not plugin root) — follows existing `office-suite` plugin pattern
- `scripts/render.sh` + `scripts/preview.sh` consolidated into a single `scripts/doc-tool.py` CLI with `render`, `preview`, `export` subcommands
- `css/themes/navy.css` and `css/themes/dark.css` deferred — Marp CSS stays inlined in `presentation.md` template; themes can be extracted later if needed
- System dependency: `poppler-utils` required at OS level for `fill.py` PDF receipt parsing (`sudo apt install poppler-utils`)

---

## File Structure

```
document-templates/
├── .claude-plugin/
│   └── plugin.json                          # Plugin metadata
├── assets/
│   ├── strokmatic-w.svg                     # White logo (watermarks)
│   ├── logo-strokmatic.svg                  # Color logo (headers)
│   ├── logo-strokmatic.png                  # PNG fallback
│   └── colors.json                          # Centralized color palette
├── css/
│   ├── base.css                             # Reset, typography, @page, watermark
│   └── components.css                       # Boxes, KPI cards, tables, bars, timeline, actions
├── templates/
│   ├── report.html                          # Gerencial report (HTML → PDF)
│   ├── proposal.md                          # Technical proposal (MD → PDF)
│   ├── presentation.md                      # Marp slides (MD → PDF/PPTX)
│   ├── quote/
│   │   ├── strokmatic.py                    # Strokmatic quote generator
│   │   └── lume.py                          # Lume quote generator
│   └── expense/
│       ├── strokmatic.xlsx                  # MODELO reembolso mensal
│       ├── embrapii.xlsx                    # EMBRAPII prestação de contas
│       ├── senai-dn.xlsx                    # SENAI-DN prestação de contas
│       ├── report.html                      # HTML visual expense report
│       └── fill.py                          # OCR automation (Claude Vision → XLSX)
├── scripts/
│   ├── doc-tool.py                          # Main CLI: render, preview, validate
│   └── requirements.txt                     # Python dependencies
├── skills/
│   └── doc/
│       └── SKILL.md                         # /doc skill entry point
└── examples/
    ├── report-example.html                  # Working example with sample data
    └── expense-example.html                 # Working expense report example
```

---

## Task 1: Plugin scaffold + assets + colors

**Files:**
- Create: `.claude-plugin/plugin.json`
- Create: `assets/colors.json`
- Copy: `assets/strokmatic-w.svg` ← `visionking/toolkit/defect-report-toolkit/assets/strokmatic-w.svg`
- Copy: `assets/logo-strokmatic.svg` ← `pmo/03010/reports/md/img/logo-strokmatic.svg`
- Copy: `assets/logo-strokmatic.png` ← `pmo/03010/reports/md/img/logo-strokmatic.png`

- [ ] **Step 1: Create plugin directory and plugin.json**

```bash
PLUGIN_DIR="/home/teruel/JARVIS/workspaces/strokmatic/sdk/sdk-agent-standards/plugins/claude-code/document-templates"
mkdir -p "$PLUGIN_DIR/.claude-plugin"
cat > "$PLUGIN_DIR/.claude-plugin/plugin.json" << 'EOF'
{
  "name": "document-templates",
  "description": "Strokmatic document templates — reports, proposals, presentations, quotes, expense reports",
  "version": "1.0.0"
}
EOF
```

- [ ] **Step 2: Create colors.json**

```bash
cat > "$PLUGIN_DIR/assets/colors.json" << 'EOF'
{
  "primary": {
    "navy": "#0f3460",
    "navy-dark": "#16213e",
    "navy-light": "#1a3a5c",
    "navy-alt": "#1B3A5C"
  },
  "accent": {
    "cyan": "#058DC7",
    "cyan-light": "#2980b9"
  },
  "alert": {
    "red": "#e74c3c",
    "orange": "#f39c12",
    "green": "#27ae60",
    "blue": "#2980b9",
    "orange-alt": "#ED561B"
  },
  "neutral": {
    "text": "#1a1a2e",
    "text-light": "#555",
    "text-muted": "#777",
    "border": "#e0e0e0",
    "bg-alt": "#f8f9fb",
    "bg-row": "#F5F7FA"
  }
}
EOF
```

- [ ] **Step 3: Copy logo assets**

```bash
mkdir -p "$PLUGIN_DIR/assets"
cp /home/teruel/JARVIS/workspaces/strokmatic/visionking/toolkit/defect-report-toolkit/assets/strokmatic-w.svg "$PLUGIN_DIR/assets/"
cp /home/teruel/JARVIS/workspaces/strokmatic/pmo/03010/reports/md/img/logo-strokmatic.svg "$PLUGIN_DIR/assets/"
cp /home/teruel/JARVIS/workspaces/strokmatic/pmo/03010/reports/md/img/logo-strokmatic.png "$PLUGIN_DIR/assets/"
```

- [ ] **Step 4: Verify files exist**

```bash
ls -la "$PLUGIN_DIR/.claude-plugin/plugin.json" "$PLUGIN_DIR/assets/"
```

Expected: plugin.json (59 bytes), 4 asset files (colors.json + 3 logos)

- [ ] **Step 5: Commit**

```bash
cd /home/teruel/JARVIS/workspaces/strokmatic/sdk/sdk-agent-standards
git add plugins/claude-code/document-templates/
git commit -m "feat(document-templates): scaffold plugin with assets and color palette"
```

---

## Task 2: Extract CSS into base.css + components.css

**Files:**
- Create: `css/base.css`
- Create: `css/components.css`
- Reference: `pmo/03002/reports/html/relatorio-gerencial-gpu-vk01.html` (lines 7–332, the `<style>` block)

Extract the CSS from the GPU report into two files. `base.css` gets the reset, typography, page rules, and watermark. `components.css` gets the reusable UI components (boxes, KPI cards, tables, bars, timeline, action items, footer).

- [ ] **Step 1: Create base.css**

Extract from the report HTML: `@page`, `*` reset, `body`, `.page-break`, `.watermark`, `.header`, `.header-*`, `.severity-banner`, `.content`, `h2`, `h3`, `p`, `li`, `.footer`, `ul`. These are the structural/layout rules that every document type shares.

```bash
mkdir -p "$PLUGIN_DIR/css"
```

Write `css/base.css` with the extracted structural CSS from lines 8–113 and 297–331 of the report HTML.

- [ ] **Step 2: Create components.css**

Extract the reusable component classes: `.box`, `.box-red/orange/blue/green`, `table`/`th`/`td`/`tr` styling, `.kpi-row`/`.kpi-card`, `.bar-chart`/`.bar-*`, `.legend`, `.timeline-*`, `.action-item`/`.action-number`/`.action-text`, `.num-big`/`.num-green`.

Write `css/components.css` with these from lines 115–265 and 307–328 of the report HTML.

- [ ] **Step 3: Verify CSS files parse correctly**

```bash
wc -l "$PLUGIN_DIR/css/base.css" "$PLUGIN_DIR/css/components.css"
```

Expected: base.css ~120 lines, components.css ~150 lines

- [ ] **Step 4: Commit**

```bash
git add plugins/claude-code/document-templates/css/
git commit -m "feat(document-templates): extract base.css and components.css from report template"
```

---

## Task 3: Report template (HTML → PDF)

**Files:**
- Create: `templates/report.html`
- Create: `examples/report-example.html`
- Reference: `pmo/03002/reports/html/relatorio-gerencial-gpu-vk01.html`

Parameterize the report template with `{{placeholders}}` for: title, subtitle, project, author, date, severity (level + message), body content. The template imports `base.css` and `components.css` via inline `<style>` (since HTML→PDF needs self-contained files). Logo references use relative path `../assets/strokmatic-w.svg`.

- [ ] **Step 1: Create report.html template**

Replace hardcoded content in the GPU report with `{{TITLE}}`, `{{SUBTITLE}}`, `{{PROJECT}}`, `{{AUTHOR}}`, `{{DATE}}`, `{{SEVERITY_COLOR}}`, `{{SEVERITY_MESSAGE}}`, `{{BODY}}` placeholders. Inline the CSS from `base.css` + `components.css` in the `<style>` block. Keep the full component library available.

- [ ] **Step 2: Create report-example.html**

Copy report.html and fill in the placeholders with sample data (reuse the GPU report content as the example body).

- [ ] **Step 3: Verify example renders in browser**

```bash
google-chrome "$PLUGIN_DIR/examples/report-example.html" &
```

Expected: Renders with header, severity banner, KPI cards, tables, watermark.

- [ ] **Step 4: Test PDF export**

```bash
google-chrome --headless --disable-gpu --print-to-pdf="$PLUGIN_DIR/examples/report-example.pdf" "$PLUGIN_DIR/examples/report-example.html"
ls -la "$PLUGIN_DIR/examples/report-example.pdf"
```

Expected: PDF file generated, multi-page A4.

- [ ] **Step 5: Commit**

```bash
git add plugins/claude-code/document-templates/templates/report.html plugins/claude-code/document-templates/examples/
git commit -m "feat(document-templates): add parameterized report template with example"
```

---

## Task 4: Proposal template (MD → PDF)

**Files:**
- Create: `templates/proposal.md`
- Reference: `pmo/03010/reports/md/proposta-tecnica-03010.md` (lines 1–44 for YAML + CSS + header)

Extract the header bar CSS and YAML frontmatter into a reusable template. Placeholders: `{{TITLE}}`, `{{SUBTITLE}}`, `{{CLIENT}}`, `{{PROJECT}}`, `{{DATE}}`, `{{REFERENCE}}`, `{{BODY}}`.

- [ ] **Step 1: Create proposal.md template**

Copy the YAML frontmatter + `<style>` + `<div class="header-bar">` from the Stellantis proposal. Replace content with placeholders. Logo path: `{{LOGO_PATH}}` (resolved at generation time to absolute path of `assets/logo-strokmatic.svg`).

- [ ] **Step 2: Verify with md-to-pdf**

```bash
cd "$PLUGIN_DIR" && PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome npx --yes md-to-pdf templates/proposal.md
ls -la templates/proposal.pdf
```

Expected: PDF with Strokmatic header bar, placeholder text.

- [ ] **Step 3: Create examples/proposal-example.md**

Copy `proposal.md` and fill placeholders with sample data (client: "ACME Corp", project: "Inspeção Automatizada").

- [ ] **Step 4: Commit**

```bash
git add plugins/claude-code/document-templates/templates/proposal.md plugins/claude-code/document-templates/examples/proposal-example.md
git commit -m "feat(document-templates): add parameterized proposal template with example"
```

---

## Task 5: Presentation template (Marp MD → PDF)

**Files:**
- Create: `templates/presentation.md`
- Reference: `pmo/reports/2026-03-31-gm-test-results/gm-test-results.md` (lines 1–100 for Marp YAML + CSS)

Extract the Marp theme CSS (title, divider, compact, end slide classes) into a reusable template. Placeholders: `{{TITLE}}`, `{{SUBTITLE}}`, `{{AUTHOR}}`, `{{DATE}}`, `{{SLIDES}}`.

- [ ] **Step 1: Create presentation.md template**

Copy the Marp frontmatter + full CSS from the GM test results. Replace slide content with a title slide + `{{SLIDES}}` placeholder.

- [ ] **Step 2: Verify with marp-cli**

```bash
npx --yes @marp-team/marp-cli "$PLUGIN_DIR/templates/presentation.md" --pdf -o "$PLUGIN_DIR/examples/presentation-example.pdf"
ls -la "$PLUGIN_DIR/examples/presentation-example.pdf"
```

Expected: PDF slides with Strokmatic theme.

- [ ] **Step 3: Create examples/presentation-example.md**

Copy `presentation.md` and fill placeholders with sample slides (title + 2 content slides + end slide).

- [ ] **Step 4: Commit**

```bash
git add plugins/claude-code/document-templates/templates/presentation.md plugins/claude-code/document-templates/examples/presentation-example.md
git commit -m "feat(document-templates): add parameterized Marp presentation template with example"
```

---

## Task 6: Quote generators (Strokmatic + Lume)

**Files:**
- Copy+adapt: `templates/quote/strokmatic.py` ← `pmo/tools/quote-generator/skm/generate.py`
- Copy+adapt: `templates/quote/lume.py` ← `pmo/tools/quote-generator/lume/generate.py`

Migrate the two generators. Update output paths to use `PLUGIN_DIR` relative references. Keep the pixel-accurate CSS and layout intact.

- [ ] **Step 1: Copy generators**

```bash
mkdir -p "$PLUGIN_DIR/templates/quote"
cp /home/teruel/JARVIS/workspaces/strokmatic/pmo/tools/quote-generator/skm/generate.py "$PLUGIN_DIR/templates/quote/strokmatic.py"
cp /home/teruel/JARVIS/workspaces/strokmatic/pmo/tools/quote-generator/lume/generate.py "$PLUGIN_DIR/templates/quote/lume.py"
```

- [ ] **Step 2: Update output paths**

In both files, change `OUT_DIR` to resolve relative to the script location:
```python
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(SCRIPT_DIR, "output")
```

Also update any asset paths in `lume.py` that reference `../lume/assets/` to use `SCRIPT_DIR`-relative paths.

- [ ] **Step 3: Check Lume external asset dependencies**

Inspect `lume.py` for external file references (images loaded for base64 encoding). If found, copy them to `templates/quote/assets/` and update paths.

```bash
grep -n "open\|imread\|read\|load.*image\|base64" "$PLUGIN_DIR/templates/quote/lume.py" | head -20
```

- [ ] **Step 4: Test strokmatic generator**

```bash
cd "$PLUGIN_DIR/templates/quote" && python3 strokmatic.py
ls -la output/
```

Expected: HTML files generated in output/.

- [ ] **Step 4: Commit**

```bash
git add plugins/claude-code/document-templates/templates/quote/
git commit -m "feat(document-templates): migrate strokmatic and lume quote generators"
```

---

## Task 7: Expense XLSX templates + fill automation

**Files:**
- Copy: `templates/expense/strokmatic.xlsx` ← `personal/reimbursement-automation/templates/MODELO.xlsx`
- Copy: `templates/expense/embrapii.xlsx` ← `personal/reimbursement-automation/templates/EMBRAPII*.xlsx`
- Copy: `templates/expense/senai-dn.xlsx` ← `personal/reimbursement-automation/templates/PLATAFORMA DN*.xlsx`
- Copy+adapt: `templates/expense/fill.py` ← `personal/reimbursement-automation/fill_reimbursement.py`

- [ ] **Step 1: Copy XLSX templates**

```bash
mkdir -p "$PLUGIN_DIR/templates/expense"
cp "/home/teruel/JARVIS/workspaces/personal/reimbursement-automation/templates/MODELO.xlsx" "$PLUGIN_DIR/templates/expense/strokmatic.xlsx"
cp "/home/teruel/JARVIS/workspaces/personal/reimbursement-automation/templates/EMBRAPII - Relatório de Prestação de Contas (Rev_set_2025) (1).xlsx" "$PLUGIN_DIR/templates/expense/embrapii.xlsx"
cp "/home/teruel/JARVIS/workspaces/personal/reimbursement-automation/templates/PLATAFORMA DN - Relatório de Prestação de Contas (Rev_set_2025).xlsx" "$PLUGIN_DIR/templates/expense/senai-dn.xlsx"
```

- [ ] **Step 2: Copy and adapt fill.py**

```bash
cp /home/teruel/JARVIS/workspaces/personal/reimbursement-automation/fill_reimbursement.py "$PLUGIN_DIR/templates/expense/fill.py"
```

Update template paths in `fill.py` to reference the co-located XLSX files via `SCRIPT_DIR`.

- [ ] **Step 3: Verify XLSX files are readable**

```bash
python3 -c "import openpyxl; wb = openpyxl.load_workbook('$PLUGIN_DIR/templates/expense/strokmatic.xlsx'); print(wb.sheetnames)"
python3 -c "import openpyxl; wb = openpyxl.load_workbook('$PLUGIN_DIR/templates/expense/embrapii.xlsx'); print(wb.sheetnames)"
python3 -c "import openpyxl; wb = openpyxl.load_workbook('$PLUGIN_DIR/templates/expense/senai-dn.xlsx'); print(wb.sheetnames)"
```

Expected: Sheet names printed for each.

- [ ] **Step 4: Commit**

```bash
git add plugins/claude-code/document-templates/templates/expense/
git commit -m "feat(document-templates): add expense XLSX templates and fill automation"
```

---

## Task 8: Expense HTML report template

**Files:**
- Create: `templates/expense/report.html`
- Create: `examples/expense-example.html`

Design a new HTML template for visual expense reports, reusing components from `base.css` + `components.css`. Structure:

- Header (navy gradient, logo, project + traveler + period metadata)
- Summary KPI cards (total despesas, total viajantes, valor total, saldo)
- Table per traveler: despesas individuais (data, descrição, categoria, valor)
- Consolidated totals table (category subtotals, grand total)
- Signature block (gestor, coordenador)
- Watermark + footer

This template supports all 3 variants — the data structure is the same (traveler → expenses), only the source XLSX differs.

- [ ] **Step 1: Create expense report.html template**

Use the same CSS framework as `report.html` (inline base.css + components.css). Placeholders: `{{TITLE}}`, `{{PROJECT}}`, `{{INSTITUTION}}`, `{{PERIOD}}`, `{{AUTHOR}}`, `{{DATE}}`, `{{KPI_CARDS}}`, `{{TRAVELER_SECTIONS}}`, `{{CONSOLIDATED_TABLE}}`, `{{SIGNATURES}}`.

- [ ] **Step 2: Create expense-example.html with sample data**

Fill with realistic sample: 2 travelers, 5 expenses each, categories matching EMBRAPII types.

- [ ] **Step 3: Verify renders in browser and PDF**

```bash
google-chrome "$PLUGIN_DIR/examples/expense-example.html" &
google-chrome --headless --disable-gpu --print-to-pdf="$PLUGIN_DIR/examples/expense-example.pdf" "$PLUGIN_DIR/examples/expense-example.html"
```

Expected: Professional-looking expense report with Strokmatic branding.

- [ ] **Step 4: Commit**

```bash
git add plugins/claude-code/document-templates/templates/expense/report.html plugins/claude-code/document-templates/examples/expense-example.html
git commit -m "feat(document-templates): add HTML visual expense report template"
```

---

## Task 9: doc-tool.py CLI + requirements.txt

**Files:**
- Create: `scripts/doc-tool.py`
- Create: `scripts/requirements.txt`

Single CLI tool that handles all template operations:

```
doc-tool.py render <template> <output> [--data key=value ...]   # Substitute placeholders → output file
doc-tool.py preview <file>                                       # Open in browser
doc-tool.py export <file> [--format pdf]                         # HTML/MD → PDF
doc-tool.py expense fill <folder> [--template embrapii|senai-dn] # OCR → XLSX
```

The `render` subcommand reads a template, substitutes `{{KEY}}` placeholders with provided values, and writes the output. For report/expense, output is HTML. For proposal, output is MD. Logo paths are resolved to absolute paths of the plugin's `assets/` directory.

- [ ] **Step 1: Create requirements.txt**

```
openpyxl>=3.1.0
Pillow>=10.0.0
anthropic>=0.40.0
```

Note: `poppler-utils` must be installed at OS level (`sudo apt install poppler-utils`) for `fill.py` PDF receipt parsing.

- [ ] **Step 2: Create doc-tool.py with render + preview + export subcommands**

Use `argparse` for CLI. `render` does simple `{{KEY}}` replacement via `str.replace` (no Jinja2 dependency for basic templates). `preview` opens with `xdg-open`. `export` detects file type: `.html` → Chrome headless `--print-to-pdf`, `.md` → `md-to-pdf` or `marp-cli` (if Marp frontmatter detected).

- [ ] **Step 3: Test render**

```bash
SCRIPTS_DIR="$PLUGIN_DIR/scripts"
python3 -m venv "$SCRIPTS_DIR/.venv"
"$SCRIPTS_DIR/.venv/bin/pip" install -r "$SCRIPTS_DIR/requirements.txt"
"$SCRIPTS_DIR/.venv/bin/python" "$SCRIPTS_DIR/doc-tool.py" render "$PLUGIN_DIR/templates/report.html" /tmp/test-report.html --data TITLE="Test Report" SUBTITLE="Test" PROJECT="99999" AUTHOR="JARVIS" DATE="2026-04-01" SEVERITY_COLOR="#e74c3c" SEVERITY_MESSAGE="TEST" BODY="<p>Hello world</p>"
```

Expected: `/tmp/test-report.html` with substituted values.

- [ ] **Step 4: Test export**

```bash
"$SCRIPTS_DIR/.venv/bin/python" "$SCRIPTS_DIR/doc-tool.py" export /tmp/test-report.html
ls -la /tmp/test-report.pdf
```

Expected: PDF generated.

- [ ] **Step 5: Commit**

```bash
git add plugins/claude-code/document-templates/scripts/
git commit -m "feat(document-templates): add doc-tool.py CLI with render, preview, export"
```

---

## Task 10: /doc SKILL.md

**Files:**
- Create: `skills/doc/SKILL.md`

- [ ] **Step 1: Create SKILL.md**

Follow the existing plugin pattern (YAML frontmatter + setup + subcommands + examples). Reference `${CLAUDE_SKILL_DIR}` for path resolution.

```markdown
---
name: doc
description: Generate Strokmatic-branded documents — reports, proposals, presentations, quotes, expense reports
argument-hint: "[template] [options]"
---

# Document Templates

Generate professional Strokmatic-branded documents from templates.

## Setup (automatic on first use)

\`\`\`bash
SCRIPTS_DIR="${CLAUDE_SKILL_DIR}/../scripts"
if [ ! -d "$SCRIPTS_DIR/.venv" ]; then
  python3 -m venv "$SCRIPTS_DIR/.venv"
  "$SCRIPTS_DIR/.venv/bin/pip" install -r "$SCRIPTS_DIR/requirements.txt"
fi
DOC="$SCRIPTS_DIR/.venv/bin/python $SCRIPTS_DIR/doc-tool.py"
PLUGIN_ROOT="${CLAUDE_SKILL_DIR}/../.."
\`\`\`

## Available Templates

| Template | Format | Output | Use case |
|----------|--------|--------|----------|
| `report` | HTML → PDF | Gerencial reports | Client-facing technical reports |
| `proposal` | MD → PDF | Technical proposals | Commercial proposals |
| `presentation` | Marp MD → PDF | Slide decks | Test results, reviews |
| `quote/strokmatic` | Python → HTML → PDF | Quotes | Strokmatic commercial quotes |
| `quote/lume` | Python → HTML → PDF | Quotes | Lume distribution quotes |
| `expense/strokmatic` | XLSX + HTML | Expense reports | Monthly reimbursement |
| `expense/embrapii` | XLSX + HTML | Expense reports | EMBRAPII project travel |
| `expense/senai-dn` | XLSX + HTML | Expense reports | SENAI-DN project travel |

## Subcommands

### Render a template
\`\`\`bash
$DOC render $PLUGIN_ROOT/templates/report.html output.html --data TITLE="Monthly Report" PROJECT="03002" ...
\`\`\`

### Preview in browser
\`\`\`bash
$DOC preview output.html
\`\`\`

### Export to PDF
\`\`\`bash
$DOC export output.html                    # HTML → PDF via Chrome headless
$DOC export proposal.md                    # MD → PDF via md-to-pdf
$DOC export presentation.md               # Marp → PDF via marp-cli
\`\`\`

### Fill expense from receipts (OCR)
\`\`\`bash
$SCRIPTS_DIR/.venv/bin/python $PLUGIN_ROOT/templates/expense/fill.py <travel_folder> --template embrapii
\`\`\`

## Assets

Logos and color palette are in `$PLUGIN_ROOT/assets/`:
- `strokmatic-w.svg` — white logo (watermarks, dark backgrounds)
- `logo-strokmatic.svg` — color logo (headers, light backgrounds)
- `logo-strokmatic.png` — PNG fallback
- `colors.json` — centralized color palette

## Tips

- For HTML templates, logo paths must be absolute or relative to the output file location
- `md-to-pdf` resolves image paths from CWD, not from the .md file — run from the directory containing the images
- Marp presentations need `npx @marp-team/marp-cli` installed globally or via npx
- The expense `fill.py` requires `ANTHROPIC_API_KEY` environment variable for receipt OCR
```

- [ ] **Step 2: Verify skill loads**

Check the YAML frontmatter parses correctly:
```bash
head -5 "$PLUGIN_DIR/skills/doc/SKILL.md"
```

Expected: YAML block with name, description, argument-hint.

- [ ] **Step 3: Commit**

```bash
git add plugins/claude-code/document-templates/skills/
git commit -m "feat(document-templates): add /doc skill with full CLI reference"
```

---

## Task 11: Register plugin in marketplace.json

**Files:**
- Modify: `/home/teruel/JARVIS/workspaces/strokmatic/sdk/sdk-agent-standards/.claude-plugin/marketplace.json`

- [ ] **Step 1: Add document-templates entry to plugins array**

Add after the last plugin entry:
```json
{
  "name": "document-templates",
  "source": "./plugins/claude-code/document-templates",
  "description": "Strokmatic document templates — reports, proposals, presentations, quotes, expense reports",
  "version": "1.0.0"
}
```

- [ ] **Step 2: Verify JSON is valid**

```bash
python3 -c "import json; json.load(open('/home/teruel/JARVIS/workspaces/strokmatic/sdk/sdk-agent-standards/.claude-plugin/marketplace.json'))"
```

Expected: No error.

- [ ] **Step 3: Commit**

```bash
git add .claude-plugin/marketplace.json
git commit -m "feat(document-templates): register plugin in marketplace"
```

---

## Task 12: End-to-end smoke test

- [ ] **Step 1: Generate a report from template**

```bash
DOC="$PLUGIN_DIR/scripts/.venv/bin/python $PLUGIN_DIR/scripts/doc-tool.py"
$DOC render "$PLUGIN_DIR/templates/report.html" /tmp/smoke-report.html \
  --data TITLE="Smoke Test" SUBTITLE="E2E Validation" PROJECT="99999" \
  AUTHOR="JARVIS" DATE="2026-04-01" SEVERITY_COLOR="#27ae60" \
  SEVERITY_MESSAGE="OK — smoke test" BODY="<h2>Test</h2><p>This is a smoke test.</p>"
$DOC export /tmp/smoke-report.html
ls -la /tmp/smoke-report.pdf
```

- [ ] **Step 2: Generate a proposal from template**

```bash
$DOC render "$PLUGIN_DIR/templates/proposal.md" /tmp/smoke-proposal.md \
  --data TITLE="Smoke Proposal" SUBTITLE="Test" CLIENT="ACME" PROJECT="99999" \
  DATE="Abril/2026" REFERENCE="N/A" BODY="## Test\n\nSmoke test content." \
  LOGO_PATH="$PLUGIN_DIR/assets/logo-strokmatic.svg"
$DOC export /tmp/smoke-proposal.md
ls -la /tmp/smoke-proposal.pdf
```

- [ ] **Step 3: Verify all template files exist**

```bash
find "$PLUGIN_DIR" -type f | sort
```

Expected: ~20 files across assets/, css/, templates/, scripts/, skills/, examples/.

- [ ] **Step 4: Final commit if any fixes needed**

```bash
git status
# If changes exist, stage specific files:
git add plugins/claude-code/document-templates/<changed-files>
git commit -m "fix(document-templates): smoke test fixes"
```
