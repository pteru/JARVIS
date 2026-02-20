# Sandbox Development Environment — Autonomous Task Execution

## Summary

A Docker-based sandboxed development environment that allows Claude Code to work autonomously on backlog tasks without per-command permission prompts and without risk to the host system. Uses a pre-built base image (cached) with per-task disposable containers. Changes are extracted as git patches for host-side review before applying.

## Problem Statement

Claude Code's permission system requires user approval for every Bash command, file write, and tool invocation. This is appropriate for interactive work on the host machine, but creates friction for well-defined tasks (backlog items with full specs) where the user wants autonomous execution.

Current options are insufficient:
- **`--dangerouslySkipPermissions` on host** — Removes the safety net entirely; any mistake affects the real system
- **Permanent permission grants** — Over-broad; grants access beyond the current task's needs
- **Interactive approval** — Correct but slow; a 30-minute task may require 50+ approvals

The sandbox provides the missing middle ground: full autonomy inside a disposable container, with review before changes reach the host.

## Architecture

### Two-Layer Strategy

```
┌─ Base Image (built once, cached) ──────────────────────────────┐
│  Ubuntu 22.04                                                   │
│  Node.js 20 LTS + npm                                          │
│  Python 3.11 + pip + venv                                      │
│  Claude Code CLI (@anthropic-ai/claude-code)                   │
│  Git, build-essential, curl, jq                                │
│  Chrome (for md-to-pdf if needed)                              │
│  Docker CLI (for docker-in-docker testing, optional)           │
└─────────────────────────────────────────────────────────────────┘
        │
        ▼ docker run (per task, ~5s setup)
┌─ Task Container (disposable) ──────────────────────────────────┐
│  /repo-source  ← bind mount of host JARVIS repo (READ-ONLY)   │
│  /workspace    ← local git clone from /repo-source             │
│  $ANTHROPIC_API_KEY ← passed via env var                       │
│                                                                 │
│  claude --dangerouslySkipPermissions                           │
│    → reads spec file from /workspace/backlogs/...              │
│    → works autonomously (edit, test, commit)                   │
│    → commits to feature branch inside container                │
│                                                                 │
│  On exit: git format-patch → /output/                          │
└─────────────────────────────────────────────────────────────────┘
        │
        ▼ Review + Apply
┌─ Host ─────────────────────────────────────────────────────────┐
│  Launcher shows diff summary                                    │
│  User: [V]iew / [A]pply / [D]iscard                            │
│  If apply: git am patches → host repo                          │
│  Container destroyed either way                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Network Modes

| Mode | Flag | Use case |
|------|------|----------|
| `full` (default) | `--network=bridge` | npm/pip install, Google APIs, GitHub |
| `lan` | `--network=host` | SSH to production nodes, LAN services |
| `offline` | `--network=none` | Pure refactoring, maximum isolation |

### Resource Limits

Default per container:
- `--memory=4g` (configurable)
- `--cpus=2` (configurable)
- No privileged mode
- No host PID/IPC namespace

### Credential Handling

| Credential | How passed | When needed |
|------------|-----------|-------------|
| `ANTHROPIC_API_KEY` | `--env` from host env | Always |
| SSH keys | `--mount type=bind,src=~/.secrets/X,dst=/secrets/X,ro` | LAN tasks only |
| GCP service account | `--mount` specific file only | Google API tasks only |
| Git config | Injected via env vars (`GIT_AUTHOR_NAME`, etc.) | Always |

Credentials are bind-mounted read-only and only when explicitly requested via `--mount-secret` flag.

## File Structure

```
scripts/
├── sandbox.sh               # Main launcher CLI
├── sandbox/
│   ├── Dockerfile            # Base image definition
│   ├── entrypoint.sh         # Container entrypoint (clone repo, setup env)
│   ├── prompt-template.md    # Task prompt injected into Claude
│   └── review.sh             # Post-task diff review + apply/discard
```

## CLI Interface

```bash
# Basic usage
./scripts/sandbox.sh --task "Implement /cleanup skill" \
                     --spec backlogs/orchestrator/cleanup-skill.md

# With options
./scripts/sandbox.sh \
  --task "Add watermark toggle to defect-visualizer" \
  --spec backlogs/orchestrator/cleanup-skill.md \
  --branch feat/cleanup-skill \
  --network full \
  --memory 4g \
  --cpus 2 \
  --mount-secret ~/.secrets/vk-ssh-password \
  --model opus \
  --interactive   # Attach TTY for interactive mode (vs fully autonomous)

# Build/rebuild base image
./scripts/sandbox.sh --build-image

# List running sandboxes
./scripts/sandbox.sh --list

# Attach to running sandbox
./scripts/sandbox.sh --attach <container-id>
```

### Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--task` | (required) | Short task description |
| `--spec` | (optional) | Path to spec file (injected into prompt) |
| `--branch` | `sandbox/<timestamp>` | Git branch name inside container |
| `--network` | `full` | Network mode: `full`, `lan`, `offline` |
| `--memory` | `4g` | Container memory limit |
| `--cpus` | `2` | Container CPU limit |
| `--mount-secret` | (none) | Additional secret files to mount (repeatable) |
| `--model` | `opus` | Claude model to use |
| `--interactive` | false | Attach TTY for interactive Claude session |
| `--auto-apply` | false | Skip review, auto-apply if tests pass |
| `--timeout` | `30m` | Max container lifetime |
| `--build-image` | — | Build/rebuild the base image |

## Prompt Template

The task prompt injected into Claude inside the container:

```markdown
# Autonomous Task Execution

You are running inside an isolated sandbox container. You have full permissions
to execute any command, edit any file, and install any package. Work autonomously
until the task is complete.

## Task
{task_description}

## Specification
{spec_file_contents}

## Working Directory
/workspace (a fresh clone of the JARVIS repository)

## Guidelines
1. Create a feature branch: `git checkout -b {branch_name}`
2. Follow existing code conventions (read CLAUDE.md)
3. Run tests after implementing changes
4. Run linters if available
5. Commit your changes with descriptive messages
6. When done, verify with `git log --oneline` and `git diff --stat {base_branch}`

## Constraints
- Do not push to any remote
- Do not modify files outside /workspace
- Commit all meaningful changes before exiting
- If you encounter blockers, document them in a file at /workspace/SANDBOX-NOTES.md
```

## Complexity Analysis

| Aspect | Rating | Notes |
|--------|--------|-------|
| **Scope** | Small-Medium | Dockerfile + shell script + prompt template |
| **Risk** | Low | Container isolation is well-understood; worst case = discard |
| **Dependencies** | Docker | Already installed and used (PMO dashboard, etc.) |
| **Testing** | Medium | Test with a simple backlog task end-to-end |
| **Maintenance** | Low | Base image rebuilt occasionally for tool updates |

**Overall Complexity: Medium (~4-6 hours)**

## Development Phases

### Phase 1 — Base Image + Launcher
**Estimate: 2-3 hours**

1. Create `Dockerfile` with Ubuntu + Node.js + Python + Claude Code
2. Create `entrypoint.sh` (clone repo, set up git config, launch Claude)
3. Create `sandbox.sh` launcher (parse args, docker run, handle lifecycle)
4. Create `prompt-template.md`
5. Test: run a simple task (create a file, commit it)

### Phase 2 — Review + Apply Workflow
**Estimate: 1-2 hours**

1. Create `review.sh` (extract patches, show diff summary, prompt for action)
2. Implement apply flow (git am on host)
3. Implement discard flow (docker rm)
4. Add timeout handling (kill container after --timeout)
5. Test: full cycle with a real backlog item

### Phase 3 — Polish
**Estimate: 1-2 hours**

1. Add `--list` and `--attach` commands
2. Add `--mount-secret` support
3. Add network mode selection
4. Add `--interactive` mode (TTY attachment)
5. Add SANDBOX-NOTES.md extraction (show blockers if task incomplete)
6. Color-coded output and progress indicators

## Estimates Summary

| Phase | Hours | Dependencies |
|-------|-------|-------------|
| Phase 1 — Image + launcher | 2-3h | Docker installed |
| Phase 2 — Review workflow | 1-2h | Phase 1 |
| Phase 3 — Polish | 1-2h | Phase 2 |
| **Total** | **4-6h** | |

## References

- Claude Code `--dangerouslySkipPermissions`: designed for CI/CD, safe inside containers
- Docker resource limits: `--memory`, `--cpus`, `--network`
- `git format-patch` / `git am`: standard patch exchange workflow
- Existing Docker usage: PMO Dashboard (`tools/pmo-dashboard/docker-compose.yml`)
