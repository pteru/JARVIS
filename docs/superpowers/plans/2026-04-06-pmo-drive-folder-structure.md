# PMO Local ↔ Drive Folder Structure — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the PMO repo to be self-contained with standardized project folder skeleton, update all skills to reference new paths, and configure gitignore.

**Architecture:** Move project-codes.json into PMO repo, nest project folders under `projects/`, create symlink for backward compatibility, update 6 skills that reference PMO paths, add .gitignore.

**Tech Stack:** Bash (file operations), Markdown (skill files), JSON (config), Git (symlinks)

**Spec:** `docs/superpowers/specs/2026-04-06-pmo-drive-folder-structure-design.md`

---

## File Map

### Files to create
- `workspaces/strokmatic/pmo/config/project-codes.json` (moved from `config/orchestrator/`)
- `workspaces/strokmatic/pmo/.gitignore`
- `config/orchestrator/project-codes.json` (symlink → `../../workspaces/strokmatic/pmo/config/project-codes.json`)

### Files to modify
- `.claude/skills/pmo/SKILL.md` — update all path references from `pmo/{code}/` to `pmo/projects/{code}/`
- `.claude/skills/gdrive/SKILL.md` — update path references
- `.claude/skills/gdrive-setup/SKILL.md` — update path references, add skeleton scaffolding
- `.claude/skills/email-organizer/SKILL.md` — update path references
- `.claude/skills/email-analyze/SKILL.md` — update path references
- `config/orchestrator/drive-organize-rules.json` — move to `pmo/config/` (if it exists and is PMO-only)

### Directories to move
- `workspaces/strokmatic/pmo/01001/` → `workspaces/strokmatic/pmo/projects/01001/`
- (repeat for all 24 project folders: 01000–01005, 02000–02008, 03001–03003, 03005–03010, 03901)

---

### Task 1: Create PMO config directory and move project-codes.json

**Files:**
- Create: `workspaces/strokmatic/pmo/config/` (directory)
- Move: `config/orchestrator/project-codes.json` → `workspaces/strokmatic/pmo/config/project-codes.json`
- Create: `config/orchestrator/project-codes.json` (symlink)

- [ ] **Step 1: Create the config directory in PMO repo**

```bash
mkdir -p /home/teruel/JARVIS/workspaces/strokmatic/pmo/config
```

- [ ] **Step 2: Copy project-codes.json to new location**

Use `cp` first, verify, then remove original.

```bash
cp /home/teruel/JARVIS/config/orchestrator/project-codes.json \
   /home/teruel/JARVIS/workspaces/strokmatic/pmo/config/project-codes.json
```

- [ ] **Step 3: Verify the copy is identical**

```bash
diff /home/teruel/JARVIS/config/orchestrator/project-codes.json \
     /home/teruel/JARVIS/workspaces/strokmatic/pmo/config/project-codes.json
# Expected: no output
```

- [ ] **Step 4: Replace original with symlink**

```bash
rm /home/teruel/JARVIS/config/orchestrator/project-codes.json
ln -s ../../workspaces/strokmatic/pmo/config/project-codes.json \
      /home/teruel/JARVIS/config/orchestrator/project-codes.json
```

- [ ] **Step 5: Verify symlink works**

```bash
ls -la /home/teruel/JARVIS/config/orchestrator/project-codes.json
# Expected: symlink → ../../workspaces/strokmatic/pmo/config/project-codes.json

node -e "const d = JSON.parse(require('fs').readFileSync('/home/teruel/JARVIS/config/orchestrator/project-codes.json','utf-8')); console.log(Object.keys(d).length + ' entries')"
# Expected: ~22 entries (projects + _design_resources)
```

- [ ] **Step 6: Commit in JARVIS repo**

```bash
cd /home/teruel/JARVIS
git add config/orchestrator/project-codes.json
git commit -m "refactor: symlink project-codes.json to PMO repo

Original moved to workspaces/strokmatic/pmo/config/project-codes.json.
Symlink preserves backward compatibility for all consumers."
```

- [ ] **Step 7: Commit in PMO repo**

```bash
cd /home/teruel/JARVIS/workspaces/strokmatic/pmo
git add config/project-codes.json
git commit -m "feat: move project-codes.json into PMO config

Self-contained PMO repo — project registry now lives here.
JARVIS has a symlink at config/orchestrator/project-codes.json."
```

---

### Task 2: Nest project folders under `projects/`

**Files:**
- Create: `workspaces/strokmatic/pmo/projects/` (directory)
- Move: all 24 project folders from `pmo/<code>/` to `pmo/projects/<code>/`

- [ ] **Step 1: Create projects directory**

```bash
cd /home/teruel/JARVIS/workspaces/strokmatic/pmo
mkdir -p projects
```

- [ ] **Step 2: Move all project folders (5-digit codes)**

```bash
cd /home/teruel/JARVIS/workspaces/strokmatic/pmo
for dir in [0-9][0-9][0-9][0-9][0-9]; do
  if [ -d "$dir" ]; then
    echo "Moving $dir → projects/$dir"
    git mv "$dir" "projects/$dir"
  fi
done
```

- [ ] **Step 3: Verify the move**

```bash
ls /home/teruel/JARVIS/workspaces/strokmatic/pmo/projects/ | head -10
# Expected: 01000, 01001, 01002, ...

ls /home/teruel/JARVIS/workspaces/strokmatic/pmo/[0-9][0-9][0-9][0-9][0-9] 2>&1
# Expected: No such file or directory (all moved)
```

- [ ] **Step 4: Update pmo_path in project-codes.json**

Every project entry has `"pmo_path": "workspaces/strokmatic/pmo/XXXXX"`. Update all to `"workspaces/strokmatic/pmo/projects/XXXXX"`.

```bash
cd /home/teruel/JARVIS/workspaces/strokmatic/pmo
sed -i 's|"workspaces/strokmatic/pmo/\([0-9]\)|"workspaces/strokmatic/pmo/projects/\1|g' config/project-codes.json

# Verify
grep pmo_path config/project-codes.json | head -5
# Expected: "pmo_path": "workspaces/strokmatic/pmo/projects/01001"
```

- [ ] **Step 5: Commit in PMO repo**

```bash
cd /home/teruel/JARVIS/workspaces/strokmatic/pmo
git add -A
git commit -m "refactor: nest project folders under projects/

All project folders (01000-03901) moved to projects/ subdirectory.
Separates project data from repo config and tools.
Updated pmo_path in config/project-codes.json."
```

---

### Task 3: Create .gitignore for PMO repo

**Files:**
- Create: `workspaces/strokmatic/pmo/.gitignore`

- [ ] **Step 1: Create the .gitignore**

```bash
cat > /home/teruel/JARVIS/workspaces/strokmatic/pmo/.gitignore << 'EOF'
# On-demand Drive download cache (disposable)
**/cache/

# Large datasets (not committed)
**/data/

# Email body/attachment cache (fetched on demand)
**/emails/cache/
EOF
```

- [ ] **Step 2: Verify gitignore works**

```bash
cd /home/teruel/JARVIS/workspaces/strokmatic/pmo
mkdir -p projects/01001/cache/test
touch projects/01001/cache/test/file.txt
git status projects/01001/cache/
# Expected: nothing (ignored)
rm -rf projects/01001/cache/test
```

- [ ] **Step 3: Commit**

```bash
cd /home/teruel/JARVIS/workspaces/strokmatic/pmo
git add .gitignore
git commit -m "feat: add .gitignore for PMO repo

Ignores on-demand cache/, data/, and emails/cache/ directories."
```

---

### Task 4: Update /pmo skill paths

**Files:**
- Modify: `.claude/skills/pmo/SKILL.md`

- [ ] **Step 1: Read current SKILL.md**

```bash
cat /home/teruel/JARVIS/.claude/skills/pmo/SKILL.md
```

- [ ] **Step 2: Update all path references**

Replace every occurrence of these patterns:

| Old | New |
|-----|-----|
| `config/project-codes.json` | `workspaces/strokmatic/pmo/config/project-codes.json` |
| `workspaces/strokmatic/pmo/{code}/` | `workspaces/strokmatic/pmo/projects/{code}/` |
| `pmo/{code}/` (relative) | `pmo/projects/{code}/` |

Also update the drive-index.json staleness behavior: change from "block if stale" to "suggest refresh if older than 24h, always use existing data".

- [ ] **Step 3: Verify no old paths remain**

```bash
grep -n "pmo/{code}" /home/teruel/JARVIS/.claude/skills/pmo/SKILL.md | grep -v "projects/"
# Expected: no output (all updated)
```

- [ ] **Step 4: Commit**

```bash
cd /home/teruel/JARVIS
git add .claude/skills/pmo/SKILL.md
git commit -m "refactor(pmo): update paths for projects/ nesting

All references now point to pmo/projects/{code}/.
project-codes.json referenced at PMO config path.
drive-index.json TTL is suggestion-only, never blocks."
```

---

### Task 5: Update /gdrive skill paths

**Files:**
- Modify: `.claude/skills/gdrive/SKILL.md`

- [ ] **Step 1: Read current SKILL.md**

```bash
cat /home/teruel/JARVIS/.claude/skills/gdrive/SKILL.md
```

- [ ] **Step 2: Update path references**

| Old | New |
|-----|-----|
| `config/project-codes.json` | `workspaces/strokmatic/pmo/config/project-codes.json` |
| `workspaces/strokmatic/pmo/{code}/drive-index.json` | `workspaces/strokmatic/pmo/projects/{code}/drive-index.json` |

Add to the `upload` command documentation:
- When uploading a `.md` file, auto-run `md-to-pdf` first, then upload both `.md` and `.pdf` to the same Drive folder.

Add to the `download` command documentation:
- Save downloaded files to `projects/{code}/cache/<Drive-path>/filename` instead of the project root.

- [ ] **Step 3: Verify**

```bash
grep -n "pmo/{code}" /home/teruel/JARVIS/.claude/skills/gdrive/SKILL.md | grep -v "projects/"
# Expected: no output
```

- [ ] **Step 4: Commit**

```bash
cd /home/teruel/JARVIS
git add .claude/skills/gdrive/SKILL.md
git commit -m "refactor(gdrive): update paths, add md auto-pdf and cache download

Paths updated for projects/ nesting.
upload: auto md-to-pdf for .md files, dual upload.
download: saves to cache/<Drive-path>/ instead of project root."
```

---

### Task 6: Update /gdrive-setup skill — paths and skeleton scaffolding

**Files:**
- Modify: `.claude/skills/gdrive-setup/SKILL.md`

- [ ] **Step 1: Read current SKILL.md**

```bash
cat /home/teruel/JARVIS/.claude/skills/gdrive-setup/SKILL.md
```

- [ ] **Step 2: Update path references**

| Old | New |
|-----|-----|
| `config/project-codes.json` | `workspaces/strokmatic/pmo/config/project-codes.json` |
| `workspaces/strokmatic/pmo/{code}/` | `workspaces/strokmatic/pmo/projects/{code}/` |

- [ ] **Step 3: Add skeleton scaffolding step**

After linking Drive folders and before running initial index, add a step that creates the standard local skeleton:

```
After writing project-codes.json, scaffold the local project directory:

mkdir -p workspaces/strokmatic/pmo/projects/{code}/emails
mkdir -p workspaces/strokmatic/pmo/projects/{code}/meetings
mkdir -p workspaces/strokmatic/pmo/projects/{code}/reports/md
mkdir -p workspaces/strokmatic/pmo/projects/{code}/reports/pdf
mkdir -p workspaces/strokmatic/pmo/projects/{code}/reference
mkdir -p workspaces/strokmatic/pmo/projects/{code}/cache
```

Also update the default `organize_template.subfolders` to match the 03008 convention:

```
01-Desenhos, 02-Especificacoes, 03-Orcamentos, 04-Comunicacao, 05-Relatorios, 06-Administrativo, 07-Referencia
```

- [ ] **Step 4: Commit**

```bash
cd /home/teruel/JARVIS
git add .claude/skills/gdrive-setup/SKILL.md
git commit -m "refactor(gdrive-setup): update paths, scaffold skeleton, 03008 convention

Paths updated for projects/ nesting.
Scaffolds standard local skeleton on setup.
Drive subfolder template follows 03008 numbered convention."
```

---

### Task 7: Update /email-organizer and /email-analyze skill paths

**Files:**
- Modify: `.claude/skills/email-organizer/SKILL.md`
- Modify: `.claude/skills/email-analyze/SKILL.md`

- [ ] **Step 1: Read both files**

```bash
cat /home/teruel/JARVIS/.claude/skills/email-organizer/SKILL.md
cat /home/teruel/JARVIS/.claude/skills/email-analyze/SKILL.md
```

- [ ] **Step 2: Update email-organizer paths**

| Old | New |
|-----|-----|
| `config/project-codes.json` | `workspaces/strokmatic/pmo/config/project-codes.json` |
| `pmo/{code}/` | `pmo/projects/{code}/` |

- [ ] **Step 3: Update email-analyze paths**

Same replacements as email-organizer:

| Old | New |
|-----|-----|
| `config/project-codes.json` | `workspaces/strokmatic/pmo/config/project-codes.json` |
| `workspaces/strokmatic/pmo/{code}/` | `workspaces/strokmatic/pmo/projects/{code}/` |
| `pmo/{code}/` (relative) | `pmo/projects/{code}/` |

- [ ] **Step 4: Verify no old paths remain**

```bash
grep -n "pmo/{code}" /home/teruel/JARVIS/.claude/skills/email-organizer/SKILL.md | grep -v "projects/"
grep -n "pmo/{code}" /home/teruel/JARVIS/.claude/skills/email-analyze/SKILL.md | grep -v "projects/"
# Expected: no output for both
```

- [ ] **Step 5: Commit**

```bash
cd /home/teruel/JARVIS
git add .claude/skills/email-organizer/SKILL.md .claude/skills/email-analyze/SKILL.md
git commit -m "refactor(email): update PMO paths for projects/ nesting

Both email-organizer and email-analyze skills now reference
pmo/projects/{code}/ and pmo/config/project-codes.json."
```

---

### Task 8: Update MCP server consumers of project-codes.json

**Files:**
- Modify: `mcp-servers/email-analyzer/index.js` (if it hardcodes the path)
- Modify: `scripts/email-analyze.sh` (if it hardcodes the path)
- Modify: `scripts/gdrive-index.sh` (if it hardcodes the path)

- [ ] **Step 1: Find all hardcoded references to project-codes.json**

```bash
grep -rn "project-codes.json" /home/teruel/JARVIS/mcp-servers/ /home/teruel/JARVIS/scripts/ \
  --include='*.js' --include='*.mjs' --include='*.sh' | grep -v node_modules
```

- [ ] **Step 2: For each file found, update the path**

The symlink at `config/orchestrator/project-codes.json` means code using the old path will still work. However, any code that constructs the path relative to `ORCHESTRATOR_HOME` should be updated to prefer the new canonical path:

Old: `$ORCHESTRATOR_HOME/config/orchestrator/project-codes.json`
New: `$ORCHESTRATOR_HOME/workspaces/strokmatic/pmo/config/project-codes.json`

If a file reads via the symlink path and it works, mark it as "symlink-compatible — update later" with a comment. Only change paths that are broken or that would benefit from the direct reference.

- [ ] **Step 3: Verify symlink still resolves for unchanged consumers**

```bash
node -e "const d = JSON.parse(require('fs').readFileSync('/home/teruel/JARVIS/config/orchestrator/project-codes.json','utf-8')); console.log('OK:', Object.keys(d).length)"
# Expected: OK: ~22
```

- [ ] **Step 4: Commit if any changes were made**

```bash
cd /home/teruel/JARVIS
git add -u mcp-servers/ scripts/
git commit -m "refactor: update project-codes.json references to canonical PMO path

Updated direct references where beneficial.
Symlink at config/orchestrator/ preserves compatibility for remaining consumers."
```

---

### Task 9: Scaffold standard skeleton for existing projects

**Files:**
- Create directories in `workspaces/strokmatic/pmo/projects/*/`

- [ ] **Step 1: Scaffold missing directories for all projects**

```bash
cd /home/teruel/JARVIS/workspaces/strokmatic/pmo
for code in projects/[0-9][0-9][0-9][0-9][0-9]; do
  mkdir -p "$code/emails"
  mkdir -p "$code/meetings"
  mkdir -p "$code/reports/md"
  mkdir -p "$code/reports/pdf"
  mkdir -p "$code/reference"
  mkdir -p "$code/cache"
  # Add .gitkeep to empty dirs so git tracks them
  for subdir in emails meetings reports/md reports/pdf reference; do
    if [ -z "$(ls -A "$code/$subdir" 2>/dev/null)" ]; then
      touch "$code/$subdir/.gitkeep"
    fi
  done
done
```

- [ ] **Step 2: Verify skeleton was created**

```bash
ls /home/teruel/JARVIS/workspaces/strokmatic/pmo/projects/02001/
# Expected: cache/ drive-index.json emails/ meetings/ reference/ reports/

ls /home/teruel/JARVIS/workspaces/strokmatic/pmo/projects/03008/
# Expected: existing content + new empty dirs where missing
```

- [ ] **Step 3: Commit in PMO repo**

```bash
cd /home/teruel/JARVIS/workspaces/strokmatic/pmo
git add -A
git commit -m "feat: scaffold standard skeleton for all existing projects

Added emails/, meetings/, reports/md/, reports/pdf/, reference/
directories to all project folders. .gitkeep in empty dirs."
```

---

### Task 10: Verify everything works end-to-end

- [ ] **Step 1: Test /pmo skill loads correctly**

Invoke `/pmo 03008` and verify it loads from the new path `projects/03008/`.

- [ ] **Step 2: Test /gdrive skill reads project-codes.json**

Invoke `/gdrive 03008 status` and verify it finds the drive config.

- [ ] **Step 3: Test symlink is transparent**

```bash
# Verify MCP email-analyzer can still read project-codes.json via symlink
node -e "
const fs = require('fs');
const p = '/home/teruel/JARVIS/config/orchestrator/project-codes.json';
const d = JSON.parse(fs.readFileSync(p, 'utf-8'));
console.log('Symlink OK:', d['03008'].name);
"
# Expected: Symlink OK: Hyundai Piracicaba - Sealer
```

- [ ] **Step 4: Push PMO repo**

```bash
cd /home/teruel/JARVIS/workspaces/strokmatic/pmo
git push
```

- [ ] **Step 5: Push JARVIS repo**

```bash
cd /home/teruel/JARVIS
git push
```
