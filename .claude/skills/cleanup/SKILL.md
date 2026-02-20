---
name: cleanup
description: Post-task cleanup — check worktree, stage changes, run checks, and commit
argument-hint: "[workspace-name] (optional — defaults to current directory)"
---

# Cleanup — Post-Task Commit Ritual

Run this after completing a task to check git state, review changes, detect dangerous files, and prepare a clean commit.

## Workflow

Work through the following steps sequentially. Present each section as a markdown header with results inline. Pause for user input only where explicitly indicated.

---

### Step 1 — Git Status Check

Run these commands and display results:

```bash
git branch --show-current
git status --short
git log --oneline @{u}..HEAD 2>/dev/null || echo "(no upstream)"
git rev-list --left-right --count @{u}...HEAD 2>/dev/null || echo "(no upstream)"
```

Display:
- **Branch**: current branch name. If it is `main`, `master`, or `develop`, warn the user — they are likely on the wrong branch for feature work.
- **Remote tracking**: how many commits ahead/behind the upstream.
- **Modified files** (staged and unstaged): list with status prefix (`M`, `A`, `D`, `??`).
- **Untracked files**: list separately.

If the worktree is completely clean (nothing to commit, nothing untracked), say so and stop — there is nothing to do.

---

### Step 2 — Change Review

Run:

```bash
git diff --stat HEAD
git diff --cached --stat
```

Display:
- Summary line: `N files changed, +X insertions, -Y deletions`
- List of changed files with their line deltas

**Dangerous file detection** — flag any of the following and do NOT stage them automatically:
- `.env`, `.env.*`, `*.env`
- `*.pem`, `*.key`, `*.p12`, `*.pfx`
- Service account JSON files (filename contains `service-account`, `sa-key`, `credentials`, `gcp-key`)
- `secrets.*`, `*_secret.*`
- Directories: `node_modules/`, `__pycache__/`, `*.egg-info/`, `dist/`, `build/`, `.venv/`
- Binary blobs > 1MB (check with `git diff --stat` — size shown in output)

If dangerous files are found, list them with a ⚠️ warning and exclude them from staging.

---

### Step 3 — Project Type Detection

Check for the following indicator files in the current directory (and one level up if not found):

| Indicator | Project Type | Linter | Tests |
|-----------|-------------|--------|-------|
| `pyproject.toml` or `setup.py` | Python | `ruff check .` (if ruff installed) | `pytest` (if installed) |
| `package.json` | Node.js | `npm run lint` (if script exists in package.json) | `npm test` (if script exists) |
| `Cargo.toml` | Rust | `cargo clippy` | `cargo test` |
| `go.mod` | Go | `golangci-lint run` (if installed) | `go test ./...` |
| `platformio.ini` | Firmware | `pio check` | `pio test` |

If no indicator found: skip checks and note "No project type detected — skipping lint and tests."

---

### Step 4 — Run Checks

For each detected tool:
1. Run the command.
2. Show pass/fail status with a one-line summary.
3. If it fails, show the relevant error output (truncated to 30 lines if long).

Do not abort on failure — report the result and continue. The user decides whether to fix before committing.

If a tool is not installed (command not found), skip it and note it as unavailable.

---

### Step 5 — Commit Preparation

**Stage files**, excluding:
- Any dangerous files identified in Step 2
- Files matching: `*.pyc`, `__pycache__/`, `node_modules/`, `.DS_Store`, `*.egg-info/`

Run:
```bash
git add -A
git reset HEAD <dangerous-file-1> <dangerous-file-2> ...   # unstage flagged files
git status --short                                          # confirm what is staged
```

**Draft a commit message** based on the staged diff. Follow these rules:
- First line: imperative mood, max 72 characters, conventional commit prefix (`feat:`, `fix:`, `refactor:`, `docs:`, `chore:`, `test:`)
- If changes span multiple concerns, suggest separate commits and ask the user which grouping they prefer.
- Append the Co-Authored-By trailer:
  ```
  Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
  ```

Present the staged file list and proposed commit message. **Ask: "Proceed with commit? [y/n/edit]"**

- **y**: commit using `git commit -m "$(cat <<'EOF'\n...\nEOF\n)"` heredoc form
- **n**: unstage everything and exit
- **edit**: let the user provide the commit message, then commit

---

### Step 6 — Post-Commit Summary

After a successful commit:

```bash
git log --oneline -3
git status
```

Display:
- The last 3 commits (to confirm the new one appears)
- Whether the worktree is clean
- If the branch is ahead of its upstream: remind the user to push (`git push`)
- If the branch has no upstream yet: suggest `git push -u origin <branch-name>`
- If the branch looks like a feature branch (not `main`/`master`/`develop`): suggest opening a PR with `gh pr create`

---

## Argument Handling

- **No argument**: operate on the current working directory.
- **With workspace name** (e.g., `/cleanup strokmatic.visionking.services.backend`): read `/workspace/config/orchestrator/workspaces.json`, find the workspace whose key matches the argument, navigate to its `path`, and run the workflow there.

## Git Commit Conventions (from CLAUDE.md)

- Always use heredoc form for commit messages to handle special characters safely.
- Never use `--amend` unless the user explicitly requests it.
- Never use `--no-verify`.
- Stage specific files by name; avoid `git add .` when dangerous files are present.
- Co-Authored-By trailer is always required: `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>`

## Example Output

```
## Git Status
- Branch: feat/add-consumer-tests  ✓
- Remote: 2 commits ahead of origin/feat/add-consumer-tests
- Modified (unstaged):
    M  src/consumer.py
    M  src/writer.py
- Untracked:
    ?? tests/test_consumer.py
    ?? tests/test_writer.py

## Change Review
- 4 files changed, +229 insertions, -23 deletions
- No dangerous files detected

## Checks (Python)
- ruff check: ✓ PASSED (0 errors)
- pytest: ✓ PASSED (8 tests in 1.2s)

## Staged Files
  M src/consumer.py
  M src/writer.py
  A tests/test_consumer.py
  A tests/test_writer.py

## Proposed Commit Message
  feat: add unit tests for consumer and writer modules

  Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>

Proceed with commit? [y/n/edit]
```
