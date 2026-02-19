# Claude Orchestrator - Master Guidelines

## Purpose
This is an automated orchestration system that dispatches coding tasks to Claude Code across multiple workspaces.

## Coding Principles
- Keep changes minimal and focused on the task at hand
- Follow existing code style and conventions in each workspace
- Write tests for new functionality when a test framework is present
- Never commit secrets, credentials, or environment-specific configuration

## Markdown Report Conventions
When writing PMO reports (in `workspaces/strokmatic/pmo/*/reports/md/`):
- Consecutive bold metadata lines in the header (e.g., `**Projeto:**`, `**Data:**`, `**Autor:**`) must end with `<br>` to preserve line breaks in HTML/PDF rendering. Without `<br>`, single newlines collapse into one line.
- Export to PDF using `md-to-pdf`: `PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome npx --yes md-to-pdf <file>.md`
- Never use pandoc/LaTeX for PDF export (poor typography).
- PMO report structure: `reports/md/` for markdown source, `reports/pdf/` for exported PDFs.

## Changelog Format
Use [Keep a Changelog](https://keepachangelog.com/) format:
- **Added** for new features
- **Changed** for changes in existing functionality
- **Fixed** for bug fixes
- **Removed** for removed features

Entries go under date headers (`## YYYY-MM-DD`) with section headers (`### Added`, etc.).

## Task Completion Checklist
Before marking any task as complete:
1. Code changes are implemented and working
2. Existing tests still pass
3. No linting or type errors introduced
4. Changelog entry added via the changelog-writer MCP tool
5. Backlog task marked complete via the backlog-manager MCP tool

## MCP Tools Available
- **backlog-manager**: Manage task backlogs per workspace
- **changelog-writer**: Record changes to workspace changelogs
- **workspace-analyzer**: Analyze workspace health and suggest tasks
- **task-dispatcher**: Dispatch tasks with model selection
- **report-generator**: Generate daily/weekly activity reports

## Session Directives
- At the end of each session, add meaningful lessons learned to the **Lessons Learned** section below (only if they do not conflict with existing directives)
- After each session, add any ideas for improving the orchestrator itself (new skills, features, integrations) to `backlogs/orchestrator/README.md`
- Always work within virtual environments (Python `venv`, Node local installs, etc.) — never install dependencies into the global system environment

## File Structure
- `backlogs/products/` - Per-workspace product task backlogs (`strokmatic.<product>.md`)
- `backlogs/plans/` - Detailed implementation plans per product (`strokmatic.<product>.md`)
- `backlogs/orchestrator/` - Orchestrator self-improvement specs and index
- `changelogs/` - Per-workspace changelogs (Keep a Changelog format)
- `reports/` - Generated daily and weekly reports
- `logs/` - Dispatch logs and cron output
- `config/` - Workspace, model, and schedule configuration

## Lessons Learned

### 2026-02-16 — Backlog Deep-Dive & Consolidation Session

- **Agent output extraction requires understanding JSONL structure.** When reading agent output files (`/tmp/claude-1000/.../tasks/*.output`), the implementation plan text lives inside `message.content[].text`, not at the top level of each JSON line. Agents that tried to read `obj.content` directly failed; the correct path is `obj.message.content`.

- **Rename files before consumers reference them.** We renamed backlog files to use the `strokmatic.*` prefix but didn't update the 6 consumers (MCP server, orchestrator.sh, hooks, dashboard) that expected the old naming pattern. Always audit all references before renaming — use `grep -r` across the codebase to find every path that constructs a filename from the old convention.

- **Avoid parallel directory structures for the same concept.** We had `backlog/` (orchestrator specs), `backlogs/` (product tasks), and `backlog.md` (index) — three locations with near-identical names serving different purposes. This caused the hooks' `BACKLOG_DIR` to point at the wrong directory entirely. Consolidate early into a single root with subdirectories (`products/`, `plans/`, `orchestrator/`).

- **Hook utils propagate path errors silently.** The `BACKLOG_DIR` variable in `lib/utils.sh` was set to `backlog/` (orchestrator specs dir) instead of `backlogs/` (product tasks). Every hook that sourced `utils.sh` inherited the wrong path. Since hooks fail silently by design (fail-open), this bug produced no errors — just silently skipped backlog syncing.

- **MCP servers that construct file paths need a single path-building function.** The backlog-manager had 4 separate `path.join(ORCHESTRATOR_HOME, "backlogs", ...)` calls across `syncBacklog`, `listBacklogTasks`, `addBacklogTask`, and `completeBacklogTask`. When the path changed, all 4 needed updating. A single `getBacklogPath(workspace)` helper would have made this a one-line fix.

- **Dashboard parser reads from workspace-local copies, not central backlogs.** The `dashboard/parsers/backlogs.js` reads `${ws.path}/.claude/backlog.md` (pushed copies in each workspace), not from the central `backlogs/` directory. This means the dashboard is only as current as the last `pushToWorkspace()` call. This is a design choice, not a bug, but it's important to understand when debugging stale dashboard data.

- **Implementation plan files are orphaned from the system.** The `*-implementation-plans.md` files (now in `backlogs/plans/`) are not referenced by any MCP server, hook, or script. They exist purely as human-readable reference docs. If we want them queryable (e.g., "what's the estimate for SEC-01?"), a future MCP tool should parse them.

- **File naming conventions must be established before generating content.** We generated 5 implementation plan files without the `strokmatic.*` prefix, then had to rename them. Establishing the naming pattern upfront in the agent prompt would have avoided the extra step.

### 2026-02-16 — Process Flow Edges & Viewer Dark Theme

- **Verify filesystem paths before coding — plan paths can drift.** The implementation plan referenced files under `charts/app_wizard/` but the actual path was `app_wizard/` (no `charts/` prefix). All initial file reads failed. Always verify paths with `find` or `glob` before committing to a plan's paths.

- **Data must flow through the same key at every layer.** The wizard stored edges in `state.topology.edges`, the serializer correctly read from `topology_data.get("edges", [])`, but the graph builder read from `state.get("edges", [])` (top-level). This mismatch meant edges were saved and exported correctly but never rendered in the viewer. When adding a new data field, trace its path through every consumer: store → API → serializer → graph builder → frontend component.

- **Graph builder edge format must match the source format.** The graph builder expected `e.get("source")` / `e.get("target")` (the YAML export format), but wizard state uses `source_station_id` / `target_station_id`. The serializer transforms between these formats, so the graph builder must read the pre-serialization format directly from wizard state.

- **Docker buildx permission issues from mixed sudo/non-sudo usage.** `/home/teruel/.docker/buildx/current` was owned by root (from a previous `sudo docker` invocation), blocking all non-sudo `docker compose` commands. Fix: `sudo chown teruel:teruel ~/.docker/buildx/current`. Avoid mixing `sudo docker` and `docker` — use consistent invocation.

- **Viewer components with hardcoded light-theme colors break visual consistency.** The wizard used CSS custom properties (`--color-bg-primary`, `--color-border`, etc.) from `main.css`, but all viewer components (`ViewerView`, `GraphControls`, `NodeDetailsPanel`, `CameraCoverageTab`, `MetricsTab`) used hardcoded `#fff`, `#f5f5f5`, `#ddd` values. When building new views, always use the existing CSS variable system — grep for `--color-` in `main.css` to find available tokens.

- **Cytoscape.js node styles need separate dark-theme treatment.** Cytoscape styles are defined in JS objects (`useCytoscape.ts`), not CSS, so they don't inherit from CSS variables. They must be manually updated to dark-friendly colors. This includes compound node backgrounds, text colors (the `color` property), edge colors, and highlight styles.

### 2026-02-16 — Repo Normalization, Submodule Renaming & Toolkit Analysis

- **Rename directories before updating .gitmodules.** When renaming submodule paths, the directory rename (`mv old new`) must happen before rewriting `.gitmodules`. Updating only the URLs in `.gitmodules` without renaming the actual directories leaves the repo in an inconsistent state where git can't find the submodules at their declared paths.

- **Typos in directory names propagate silently through the entire stack.** `camera-acquisiiton` (double 'i') existed in SpotFusion's directory structure, `.gitmodules`, docker-compose references, and CI configs. Nobody caught it because everything was copy-pasted from the original typo. When creating initial directory structures, double-check spelling — typos become permanent fixtures.

- **`git add` on directories containing `.git` stages all files, not just gitlinks.** Running `git add ds/ toolkit/` staged 33,014 regular files (models, CSVs, test data) alongside the intended submodule gitlinks. The fix was `git reset HEAD` followed by selectively staging only `.gitmodules` and the specific submodule directories. Always stage submodule gitlinks individually, never via parent directory globs.

- **`git checkout` fails with dirty tracked files — stash first.** Attempting `git checkout develop` with a modified `.gitmodules` was rejected. The workflow is: `git stash → git checkout <branch> → git checkout -b <new-branch> → git stash pop`. Watch for stash pop conflicts on files that were deleted/modified on the target branch.

- **`git fetch` on GSR (Google Source Repositories) can hang indefinitely.** Background fetch-all scripts timed out on GSR-hosted repos. When fetching across multiple remotes, set explicit timeouts and handle GSR repos separately from GitHub repos.

- **Shell loops using `cd` lose context between iterations.** A data collection script using `cd "$path"` inside a loop only returned 1 result because the working directory changed and never returned. Use `git -C "$path"` with absolute paths instead of `cd` in loops.

- **`gh repo rename` operates on the current directory's repo by default.** To rename a specific GitHub repo, use `gh repo rename <new-name> --repo owner/old-name`. Without `--repo`, it renames whatever repo the current directory points to.

- **Toolkit analysis must go inside multi-tool repos, not just list them.** Treating `spotfusion-toolkit` (12 tools inside) and `dataset-toolkit` (ML pipeline with 4 modules) as single entries missed the majority of consolidation opportunities. Always expand composite repos to their individual tools before analyzing overlaps.

- **Product-specific concerns must be documented alongside consolidation plans.** When merging tools from different products into an SDK repo, each product has different DB schemas, PLC brands, networking modes, and credential patterns. The SDK tool must use configurable adapters, not hardcoded assumptions from any single product.

- **Backlog tasks should describe the desired end-state, not just "refactor."** Vague tasks like "Document and improve toolkit utilities" are not actionable. Specific tasks like "Merge 5 PLC tools into sdk-plc-toolkit multi-page Streamlit app with configurable IO table JSONs" give enough context for autonomous execution.

### 2026-02-16 — Monorepo Initial Commit Session (diemaster & spotfusion)

- **Always scan for credentials before the first commit.** GCP service account keys (`smart-die-*.json`), `.env` files, TLS certs (`.pem`, `.key`) were scattered across both monorepos. A `find` for sensitive file patterns must be the first step before any `git add`, not an afterthought.

- **Embedded git repos must be registered as submodules, not committed directly.** Running `git add` on a directory containing a `.git` folder creates an embedded repo warning and produces broken references on clone. Always use `git submodule add <url> <path>` for directories that are independent repositories.

- **Check for nested repos-within-repos before adding submodules.** Spotfusion had deeply nested embedded repos (e.g., `services/plc-monitor-camera/utils/Iplc/utils/Ilog/utils/Icache` — 4 levels deep). Only the top-level repos should be registered as submodules; nested ones are internal to those repos and handled by their own `.gitignore`/`.gitmodules`.

- **Repos without a configured remote cannot be added as submodules.** `spotfusion-deploy-toolkit` had no `origin` remote set. The fix was to add the remote first (`git remote add origin <url>`) then run `git submodule add`. Always verify `git remote -v` before attempting submodule registration.

- **Large dataset directories should be excluded from git.** `toolkit/plant-data-parser/` contained 255MB of images and JSON files (32K+ files). This would bloat the repo and slow clones. Datasets belong in `.gitignore` and should be managed via LFS, DVC, or external storage.

- **Never delete `.git` directories to work around submodule issues.** The instinct to `rm -rf .git` on a repo to make it a plain directory destroys commit history. Instead, either add it as a proper submodule with a remote, or skip it temporarily.

### 2026-02-15 — VisionKing Architecture, Production Topology & Context Setup Session

- **Always verify the active git branch before committing.** Committed aio-pika migration directly to `develop` in image-saver instead of a feature branch. Had to create a new branch from the commit and reset develop back to origin. Always run `git branch --show-current` before any commit.

- **Force push is sometimes necessary after rebase but requires explicit user approval.** Database-writer's `feat/aio-pika` branch was rebased locally, making it diverge from the remote. Regular push was rejected. Force push was the correct solution but must always be confirmed with the user first.

- **Deeply nested Mermaid subgraphs cause unreadable layouts.** Wrapping every logical group (Redis, queues, services) in its own subgraph made the diagram too spread out. Flattening to essential groupings only (External Hardware, Processing, Post-Processing, Dashboard) produced much better results.

- **Mermaid TB (top-bottom) layout works better for multi-node deployments than LR.** Three side-by-side node subgraphs in LR layout rendered at 2400px width and were unreadable. Switching to TB with simplified per-node subgraphs fit within 1600px.

- **Production queue names may differ from documentation.** The codebase uses `defect-writer-queue` and `frame-writer-queue`, but production deployment 03002 uses `rc-sis-surface-queue` and `dw-sis-surface-queue`. Always cross-reference actual deployed configs against docs.

- **Production infrastructure is often non-standard.** KeyDB on port 4000 (not 6379), PostgreSQL on port 2345 (not 5432). Never assume standard ports — always check the actual container environment variables.

- **Architecture documentation must come from domain experts, not code alone.** Multiple rounds of corrections were needed: controller doesn't connect to PLC (it connects to a separate Controller Device), pixel-to-object reads from disk (not just from queue messages), defect-aggregator was legacy (not active). Code inspection alone would have produced an inaccurate architecture diagram.

- **sshpass is the simplest option for password-based SSH automation.** When SSH key auth isn't available, `sshpass -p "$PASSWORD"` with `read -s -p` for secure password input is the most straightforward approach for scripted SSH access.

- **Custom slash commands in Claude Code require the skills format, not plain .md files.** Files in `~/.claude/commands/*.md` don't work. The correct structure is `~/.claude/skills/<skill-name>/SKILL.md` with YAML frontmatter (`name`, `description`, `argument-hint`). Session restart is needed after creating new skills.

- **Symmetric multi-node deployments can have asymmetric issues.** vk01 disk at 81% while vk02 at 13% — same pipeline, same hardware, vastly different storage consumption. Always compare equivalent nodes to spot configuration drift (e.g., missing cleanup cron on one node).

- **The database-writer image serves multiple roles via configuration.** The same Docker image is deployed as both "Frame Writer" (consuming `dw-sis-surface-queue`, calling `insert_frames_pecas`) and "Defect Writer" (consuming `rc-sis-surface-queue`, calling `insert_defects_inpects`). This is a common pattern but must be clearly documented to avoid confusion.

### 2026-02-18 — PR Reviewer, Google Workspace MCP & Multi-Agent Deployment

- **`IFS='|||'` does not work as a multi-character delimiter.** Bash `IFS` treats each character individually — `IFS='|||'` splits on every `|`, not on the string `|||`. Use tab (`IFS=$'\t'`) or another single character as a field separator when piping structured data through `while read`.

- **`claude --print` cannot receive long prompts as CLI arguments.** Prompts containing special characters (`#`, `$`, backticks, heredoc content) break when passed as positional arguments. Pipe the prompt via stdin instead: `echo "$prompt" | claude --print --model ...`. This also avoids shell escaping issues.

- **`claude --print` inside a `while read` loop consumes stdin.** When running `claude` inside a `while IFS=... read` loop, the Claude process reads from the same stdin as the loop, causing it to consume remaining lines. Fix by either piping the prompt explicitly (`echo "$prompt" | claude --print`) or redirecting stdin from `/dev/null` and passing the prompt as an argument.

- **`claude --print` still enforces tool permissions.** Even in non-interactive mode, `claude --print` prompts for tool approval and blocks if not granted. Use `--allowedTools 'Bash(gh:*)'` to pre-approve specific commands. The syntax uses colon notation for patterns: `Bash(gh:*)`, not `Bash(gh *)`.

- **New scripts that bypass `task-dispatcher.sh` won't appear in the dashboard.** The dispatcher logs to `dispatches.log`/`dispatches.json`, which the dashboard reads. Any script that calls `claude` directly (like `review-pr.sh`) must add its own dispatch logging or the activity is invisible to the observability layer.

- **`ORCHESTRATOR_HOME` default drifts across scripts.** Some scripts default to `$HOME/claude-orchestrator` (the original name), others to `$HOME/JARVIS` (the current name). After renaming the project, audit all scripts with `grep -r 'claude-orchestrator'` to catch stale defaults. Same applies to `config/workspaces.json` vs `config/orchestrator/workspaces.json`.

- **Clean AI output before posting to external systems.** `claude --print` output often includes preamble ("I need to provide..."), permission complaints ("The restriction prevents me..."), and suggested shell commands to save files. Always strip this noise before posting to GitHub, Slack, or any external system. A dedicated cleaning script (`clean-review-for-github.sh`) prevents this from being forgotten.

- **Parallel agent deployment works well for independent deliverables.** Dispatching 3 agents simultaneously (MCP server, shell scripts, skills) cut total wall-clock time significantly. However, agents writing to paths outside their sandbox will fail silently — always verify target paths are within the agent's allowed scope, or handle the writes in the parent session.

- **PR review model selection by size is effective and cost-efficient.** Routing trivial PRs (<100 lines) to Haiku and complex PRs (>500 lines) to Opus produces quality reviews at minimal cost. The small docs PRs got instant Haiku approvals; the 180-file backend PR got a thorough Opus analysis that caught real security issues (plaintext credential logging, weak password generation).
