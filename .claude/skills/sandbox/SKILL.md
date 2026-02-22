# Sandbox — Autonomous Claude Code in Docker

Launch autonomous Claude Code tasks in disposable Docker containers. Changes come back as git patches for review.

## Quick Reference

```bash
# Basic usage
./scripts/sandbox.sh --task "description" --spec path/to/spec.md [options]

# Build/rebuild base image
./scripts/sandbox.sh --build-image

# List running sandboxes
./scripts/sandbox.sh --list

# Attach to running sandbox
./scripts/sandbox.sh --attach <container-id>
```

## Key Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--task` | (required) | Short task description for Claude |
| `--spec` | (optional) | Spec file path **relative to repo root** |
| `--branch` | `sandbox/<timestamp>` | Git branch name inside container |
| `--base-branch` | `develop` | Branch to clone from and diff against |
| `--model` | `opus` | Claude model: opus, sonnet, haiku |
| `--network` | `full` | Network: full, lan, offline |
| `--memory` | `4g` | Container memory limit |
| `--cpus` | `2` | Container CPU limit |
| `--timeout` | `30m` | Max runtime before kill |
| `--mount-secret` | (none) | Mount a secret file read-only (repeatable) |
| `--interactive` | false | Attach TTY for interactive session |
| `--auto-apply` | false | Auto-apply patches if exit code 0 |

## Critical Rules (Learned the Hard Way)

### 1. Spec files MUST be committed to git

The sandbox does `git clone /repo-source` inside the container. **Untracked files are NOT included in a git clone.** If your spec file isn't committed, the entrypoint will print `WARNING: Spec file not found` and the agent gets no spec.

**Workflow:**
```bash
# 1. Write or copy spec to repo
cp /tmp/my-spec.md backlogs/orchestrator/my-task.md

# 2. Commit it to the base branch
git add backlogs/orchestrator/my-task.md
git commit -m "chore: add sandbox spec for my-task (temporary)"

# 3. Launch sandbox with --base-branch pointing to that branch
./scripts/sandbox.sh --task "..." --spec backlogs/orchestrator/my-task.md --base-branch feature/my-branch
```

### 2. Docker bridge networking is broken — all modes use host

The `get_network_flag()` function maps `full` and `lan` to `--network host` (not bridge). Bridge mode gives `HTTP 000` errors — Claude Code can't reach the API. This was fixed in commit `fdbd545`.

| Mode | Actual Docker network |
|------|--------------------|
| `full` | `host` |
| `lan` | `host` |
| `offline` | `none` |

### 3. Patch overlap when base branch differs from feature branch

The sandbox clones from `--base-branch` and creates a new branch. If your feature branch already has commits not on the base branch, the sandbox's `git format-patch` will produce patches for ALL commits since the base — including ones you already have.

**Solution:** Only apply the NEW patches. Check patch subjects against your existing commits:
```bash
# See what patches were produced
ls /tmp/jarvis-sandbox-*/
# Compare with your branch
git log --oneline feature/my-branch
# Apply only the new one(s)
git am /tmp/jarvis-sandbox-*/0003-*.patch
```

Or use `--base-branch` set to your feature branch so the diff is clean.

### 4. Sandbox output visibility is limited

Claude Code output is piped through `tee /output/claude.log`, but:
- `tee` buffers output — the log file may appear empty for minutes
- The log only appears on the host volume after data is flushed
- Docker logs (`docker logs <container>`) only show the entrypoint output, not Claude's work

**To monitor progress:**
```bash
# Check if container is still running
docker ps --filter "name=jarvis-sandbox"

# Check output directory for files (patches, REPORT.md)
ls -la /tmp/jarvis-sandbox-*/

# Tail the log (may have delayed output)
tail -f /tmp/jarvis-sandbox-*/claude.log

# Inspect inside the container
docker exec <container-name> bash -c 'ls -la /output/ && wc -l /output/claude.log'
```

### 5. Resource recommendations

| Task Type | Memory | CPUs | Timeout |
|-----------|--------|------|---------|
| Simple refactor / small fix | `4g` | `2` | `15m` |
| npm install + TypeScript build | `6g` | `4` | `30m` |
| Heavy build (Python ML, large deps) | `8g` | `4` | `45m` |
| Interactive exploration | `4g` | `2` | `60m` |

### 6. NEVER change permissions on ~/.claude or ~/.claude.json

The host's `~/.claude/` is bind-mounted read-only at `/home/sandbox/.claude-host:ro`, and `~/.claude.json` at `/home/sandbox/.claude.json.host:ro`. The entrypoint copies them into writable locations with `sudo cp -a && sudo chown`.

**Why read-only matters:** If you mount `~/.claude` read-write, the container's `chown` or `chmod` will change ownership/permissions on the **host** files. This breaks Claude Code on the host — it loses access to its own credentials and settings. The fix requires manually restoring permissions:
```bash
# If this happens, fix with:
sudo chown -R $(id -u):$(id -g) ~/.claude ~/.claude.json
```

**Never do any of these in sandbox scripts:**
- Mount `~/.claude` without `:ro`
- `chmod` or `chown` anything in `/home/sandbox/.claude-host/`
- Delete or overwrite `~/.claude.json` on the host

The entrypoint handles the read-only → writable copy correctly. Don't touch that logic.

### 7. The review report

After the sandbox completes, a review report is generated at:
```
reports/sandbox/{branch-name}.md
```
This includes: metadata, Claude's REPORT.md, safety audit (sensitive files, large additions), diff summary, and full diffs per patch.

## Workflow: Running a Sandbox Task

### Step 1: Write the spec

Write a detailed spec/prompt for the sandbox agent. Include:
- Exact file paths to read first
- Interfaces/types to implement
- Code patterns to follow (reference existing files)
- Test expectations
- What to commit and what NOT to commit

The more detailed the spec, the better the output. The agent works autonomously — it can't ask clarifying questions.

### Step 2: Commit the spec

```bash
git add backlogs/orchestrator/my-spec.md
git commit -m "chore: add sandbox spec (temporary)"
```

### Step 3: Launch

```bash
./scripts/sandbox.sh \
  --task "Short description of the task" \
  --spec backlogs/orchestrator/my-spec.md \
  --branch "sandbox/my-task" \
  --base-branch "feature/my-branch" \
  --model opus \
  --memory 6g \
  --cpus 4
```

### Step 4: Monitor

```bash
# Container status
docker ps --filter "name=jarvis-sandbox"

# Output files
ls -la /tmp/jarvis-sandbox-*/

# When done, review the report
cat reports/sandbox/sandbox-my-task.md
```

### Step 5: Review and apply

If running interactively (TTY), the launcher shows a menu: [V]iew, [A]pply, [D]iscard, [S]hell.

If non-interactive, apply manually:
```bash
git am /tmp/jarvis-sandbox-*/*.patch
```

### Step 6: Verify

```bash
cd mcp-servers/my-project && npm run build && npm test
```

## File Structure

```
scripts/
├── sandbox.sh               # Main launcher CLI (parse args, docker run, review)
└── sandbox/
    ├── Dockerfile            # Base image: Ubuntu 24.04 + Node 20 + Python 3 + Claude Code
    ├── entrypoint.sh         # Container setup: clone repo, build prompt, launch Claude
    └── prompt-template.md    # (unused — prompt is built inline in entrypoint.sh)
```

## Output Structure

```
/tmp/jarvis-sandbox-{timestamp}-{random}/
├── REPORT.md               # Claude's implementation report (mandatory)
├── META.json               # Machine-readable metadata (commits, patches, exit code)
├── claude.log              # Full Claude Code output (may be truncated/buffered)
└── 0001-*.patch            # Git format-patch files (one per commit)
```

## Known Issues / Backlog

- **Visibility**: Output buffering makes real-time monitoring difficult. Fix: add `stdbuf -oL` to the tee pipe, or write a progress heartbeat.
- **Spec path**: The "must be committed" requirement is friction. Could mount spec files directly via docker `-v` flag.
- **Network docs outdated**: The backlog spec says `full` → `bridge`, but the code uses `host`. The backlog spec should be updated.
- **Parallel sandboxes**: Multiple sandboxes can run simultaneously, but they share the host's Claude Code auth (rate limits apply).
