# PR Inbox & Reviewer

## Summary

Automated system that fetches all open Pull Requests across all Strokmatic GitHub repositories 3 times daily, organizes them into an inbox report, and runs a code review on each PR's modifications.

## Schedule

| Time | Purpose |
|------|---------|
| 07:00 | Morning sync — catch overnight PRs |
| 12:00 | Midday sync — catch morning work |
| 16:00 | Afternoon sync — catch afternoon work before EOD |

## Implementation Plan

### Phase 1: PR Fetcher Script

**File**: `scripts/fetch-open-prs.sh`

1. Use `gh` CLI to query all open PRs across the org:
   ```bash
   gh api "orgs/strokmatic/repos" --paginate --jq '.[].name' | while read repo; do
       gh pr list --repo "strokmatic/$repo" --state open --json number,title,author,createdAt,updatedAt,headRefName,baseRefName,additions,deletions,changedFiles,url,isDraft,reviewDecision
   done
   ```

2. Collect into a structured JSON file: `reports/pr-inbox.json`
   ```json
   {
     "fetched_at": "2026-02-16T07:00:00",
     "pull_requests": [
       {
         "repo": "visionking-backend",
         "number": 42,
         "title": "feat: add batch endpoint",
         "author": "gui-strokmatic",
         "created_at": "2026-02-15T14:00:00",
         "updated_at": "2026-02-16T09:30:00",
         "head": "feat/batch-endpoint",
         "base": "develop",
         "additions": 120,
         "deletions": 15,
         "changed_files": 4,
         "url": "https://github.com/strokmatic/visionking-backend/pull/42",
         "is_draft": false,
         "review_decision": "REVIEW_REQUIRED",
         "review_status": "pending|reviewed|changes_requested",
         "review_file": "reports/pr-reviews/visionking-backend-42.md"
       }
     ]
   }
   ```

### Phase 2: PR Review Engine

**File**: `scripts/review-pr.sh`

For each open PR, dispatch a review task via the **existing `task-dispatcher.sh`**:

1. Map the GitHub repo name to a workspace name in `workspaces.json`

2. Determine complexity from PR size:
   ```bash
   if [[ $CHANGED_FILES -gt 10 || $TOTAL_CHANGES -gt 500 ]]; then
       COMPLEXITY="complex"    # → opus
   elif [[ $TOTAL_CHANGES -lt 100 && $CHANGED_FILES -lt 5 ]]; then
       COMPLEXITY="simple"     # → haiku
   else
       COMPLEXITY="medium"     # → sonnet
   fi
   ```

3. Call the task dispatcher:
   ```bash
   REPORT_PATH="$ORCHESTRATOR_HOME/reports/pr-reviews/${REPO}-${PR_NUMBER}.md"

   TASK="Review PR #${PR_NUMBER} in this repository.
   Title: ${PR_TITLE}
   Author: ${PR_AUTHOR}
   Branch: ${HEAD_REF} → ${BASE_REF}
   URL: ${PR_URL}

   Run 'gh pr diff ${PR_NUMBER}' to see the changes.
   Run 'gh pr view ${PR_NUMBER}' to see the description and comments.

   Write a review report to: ${REPORT_PATH}

   Review checklist:
   - Correctness: does the code do what the PR title says?
   - Security: OWASP basics (injection, XSS, secrets)
   - Standards: naming, logging, project structure per CLAUDE.md
   - Tests: are new/changed paths covered?
   - Suggestions: specific file:line improvements

   End with a verdict: APPROVE / APPROVE WITH COMMENTS / CHANGES REQUESTED"

   "$ORCHESTRATOR_HOME/scripts/task-dispatcher.sh" "$WORKSPACE_NAME" "$TASK" "$COMPLEXITY"
   ```

4. This reuses everything already built:
   - **task-dispatcher.sh** handles model selection, workspace resolution, prompt templating, and logging
   - Claude Code runs locally in the workspace directory — reads `.claude/CLAUDE.md` automatically
   - Claude has full repo context and can run `gh` commands to inspect the PR
   - Dispatch is logged to `logs/dispatches.log` like any other task

5. Output a review report per PR:

   **File**: `reports/pr-reviews/<repo>-<pr_number>.md`
   ```markdown
   # PR Review: <repo>#<pr_number>
   > <title>
   > Author: <author> | Base: <base> ← <head>
   > Files: <N> | +<additions> -<deletions>

   ## Summary
   One-paragraph summary of what the PR does.

   ## Review

   ### Correctness
   - ...

   ### Security
   - ...

   ### Standards Compliance
   - Naming: ✅/⚠️
   - Logging: ✅/⚠️
   - Tests: ✅/⚠️/❌ missing

   ### Suggestions
   - file.ts:42 — consider using ...

   ## Verdict
   ✅ APPROVE / ⚠️ APPROVE WITH COMMENTS / ❌ CHANGES REQUESTED
   ```

### Phase 3: Inbox Report Generator

**File**: `scripts/helpers/build-pr-inbox.mjs`

Generates a consolidated markdown inbox:

**File**: `reports/pr-inbox.md`
```markdown
# PR Inbox — 2026-02-16 07:00

## Summary
- Open PRs: 12
- Needs review: 8
- Draft: 2
- Changes requested: 2

## By Product

### VisionKing (5 PRs)
| # | Repo | Title | Author | Age | Size | Review |
|---|------|-------|--------|-----|------|--------|
| 42 | visionking-backend | feat: batch endpoint | gui | 1d | +120/-15 | ⚠️ |

### SmartDie (3 PRs)
...

### SpotFusion (4 PRs)
...

## Stale PRs (>7 days without activity)
...
```

### Phase 4: Integration

1. **New orchestrator mode**: `orchestrator.sh pr-inbox`
   - Runs fetch → review → generate inbox report

2. **Cron entries** (3x daily):
   ```cron
   0 7 * * *  orchestrator.sh pr-inbox >> logs/cron-pr-inbox.log 2>&1
   0 12 * * * orchestrator.sh pr-inbox >> logs/cron-pr-inbox.log 2>&1
   0 16 * * * orchestrator.sh pr-inbox >> logs/cron-pr-inbox.log 2>&1
   ```

3. **Dashboard integration**: Add PR inbox widget to the dashboard
   - New API endpoint: `/api/pr-inbox`
   - Shows open PR count, stale PRs, review status

4. **Telegram notification**: Send digest after each sync
   - "📋 PR Inbox: 12 open, 3 need review, 2 stale"
   - Link to full report

### Phase 5: Smart Features (future)

- **Skip already-reviewed PRs**: Track review timestamps, only re-review if PR has new commits since last review
- **Auto-comment on GitHub**: Optionally post the review summary as a PR comment (requires explicit opt-in per repo)
- **Priority scoring**: Rank PRs by: age, size, author, target branch (master PRs = high priority)
- **Review assignment**: Suggest reviewers based on file ownership patterns

## Dependencies

- `gh` CLI (authenticated)
- `scripts/task-dispatcher.sh` (existing — dispatches to local Claude Code sessions)
- MCP servers: notifier (for Telegram digest)
- Node.js (for report building)
- Workspace paths configured in `config/orchestrator/workspaces.json`
- Repo-to-workspace mapping (new: `config/orchestrator/repo-workspace-map.json` or derived from workspaces.json remotes)

## Model Selection

Passed via `claude --model` flag based on PR size:

| PR Size | Model | Rationale |
|---------|-------|-----------|
| <100 lines, <5 files | haiku | Quick scan, low cost |
| 100-500 lines, 5-10 files | sonnet | Standard review depth |
| >500 lines or >10 files | opus | Complex changes need deeper analysis |

## Execution Notes

- Each review is dispatched via `task-dispatcher.sh` — same pipeline as backlog tasks
- Claude Code reads the repo's `.claude/CLAUDE.md` automatically — no need to inject standards
- Reviews run sequentially (not parallel) to avoid overwhelming the machine
- Could use `execute-batch.mjs` for parallel reviews if needed (respects workspace locking)
- Timeout: 5 minutes per PR review (kill if stuck)

## Estimated Cost per Run

- ~96 repos × API calls for PR list: ~100 API calls (free, gh CLI)
- ~10 open PRs avg × Claude Code session: depends on model selection
- 3 runs/day
