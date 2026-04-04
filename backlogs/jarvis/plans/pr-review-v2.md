# Plan: PR Review Service v2 — Smart Re-Review, Auto-Post, Labels, Dashboard, Build Checks

## Context

The PR review service is deployed and running on 192.168.15.2 (`/opt/jarvis-pr-review/`), polling every 5 minutes via cron. It fetches open PRs, reviews them with Claude, uploads to Google Drive, and sends notifications. This plan adds 5 major enhancements to make the pipeline more useful to the team.

## Enhancement Summary

| # | Enhancement | Impact | Effort |
|---|------------|--------|--------|
| 1 | Contextual re-review (detect commits/comments, update review) | Very High | Medium |
| 2 | Auto-post review as GitHub comment | High | Low |
| 3 | Auto-label PRs on GitHub | High | Low |
| 4 | GUI Dashboard with actions (post, merge, labels) | Very High | High |
| 5 | Clone + build/test checks (Tier 1) | High | Medium |

Built into the dashboard: quality scoring + analytics.

## Execution Strategy

Each phase will be implemented via **sandbox dispatch** (`scripts/sandbox.sh`). Specs committed to a feature branch, sandbox builds in isolation, patches applied back.

---

## Phase 1: Review Metadata Infrastructure (Foundation)

Everything downstream depends on structured metadata alongside each review. Currently reviews are plain `.md` files with no sidecar data — staleness is checked via mtime only.

### Task 1.1: Enrich `fetch-open-prs.sh` with new fields

**File:** `workspaces/strokmatic/infra/services/pr-review/fetch-open-prs.sh`

Add to `gh pr list --json` fields: `headRefOid`, `labels`, `comments`

Map in the Node.js transform block:
```javascript
head_sha: pr.headRefOid || '',
labels: (pr.labels || []).map(l => l.name),
comments_count: (pr.comments || []).length,
```

### Task 1.2: Create review metadata sidecar library

**New file:** `workspaces/strokmatic/infra/services/pr-review/lib/review-metadata.sh`

Two shell functions that manage `reviews/{repo}-{number}.meta.json`:

```json
{
  "current_version": 2,
  "current_head_sha": "abc1234",
  "current_reviewed_at": "2026-03-12T10:00:00Z",
  "versions": [
    { "version": 1, "reviewed_at": "...", "head_sha": "..." },
    { "version": 2, "reviewed_at": "...", "head_sha": "..." }
  ],
  "posted_to_github": { "comment_id": 123, "posted_at": "...", "review_hash": "..." },
  "labels_applied": ["size/M", "ai-review/approve"]
}
```

Functions: `write_review_metadata()`, `read_review_metadata()`.

### Task 1.3: Refactor `review_is_current()` to use commit SHA

**File:** `workspaces/strokmatic/infra/services/pr-review/review-pr.sh`

Replace mtime-based check with SHA comparison:
1. Read `current_head_sha` from `.meta.json`
2. Compare with `head_sha` from `pr-inbox.json`
3. If same → current. If different → stale (re-review needed)
4. Fallback to mtime for reviews without metadata (backward compat)

After successful review, call `write_review_metadata` with the PR's head SHA.

### Task 1.4: Backfill metadata for existing reviews

**New file:** `workspaces/strokmatic/infra/services/pr-review/scripts/backfill-metadata.sh` (one-time migration)

Iterate `reviews/*.md`, create `.meta.json` with `reviewed_at` from file mtime and empty `head_sha`.

### Task 1.5: Add `config/service.json` feature flags

**New file:** `workspaces/strokmatic/infra/services/pr-review/config/service.json`

```json
{
  "auto_post_github": false,
  "auto_label_prs": false,
  "build_check_enabled": false,
  "build_check_repos": [],
  "re_review_include_previous": true,
  "archive_review_versions": true
}
```

All new features default to `false` (opt-in). Add `SERVICE_CONFIG` to `lib/config.sh`.

**Verification:** Run `fetch-open-prs.sh` → confirm `head_sha`, `labels`, `comments_count` in inbox JSON. Run a review → confirm `.meta.json` created alongside `.md`.

---

## Phase 2: Contextual Re-Review

Currently re-reviews start from scratch. This phase makes Claude aware of its previous review, new commits, and developer comments.

### Task 2.1: Create PR context fetcher

**New file:** `workspaces/strokmatic/infra/services/pr-review/lib/pr-context.sh`

```bash
fetch_pr_comments() {
    # gh pr view $number --repo strokmatic/$repo --json comments
    # Format: "**author** (date): body"
}

fetch_commits_since() {
    # gh pr view $number --repo strokmatic/$repo --json commits
    # Filter to commits after $since_sha
    # Format: "- abc1234 commit message headline"
}
```

### Task 2.2: Build contextual re-review prompt

**File:** `workspaces/strokmatic/infra/services/pr-review/review-pr.sh` — modify `review_single_pr()`

When a previous review exists AND is stale:

```
## Previous Review (v{N}, reviewed {date})
{previous review content}

## Changes Since Previous Review

### New Commits (since {sha})
{commit list}

### PR Comments
{all comments}

---

You are RE-REVIEWING PR #{number} in strokmatic/{repo}.
Focus on NEW CHANGES since commit {previous_sha}.
Acknowledge previously-raised findings that have been addressed.
Note any findings from the previous review that remain unresolved.

Output the review in EXACTLY this format:
# PR Review: {repo}#{number}
...same structured format...

## Delta from Previous Review
### Addressed Findings
### Unresolved Findings
### New Findings
```

Uses full diff (not incremental) so Claude has complete context, but instructions focus attention on new changes.

### Task 2.3: Archive review versions

**File:** `workspaces/strokmatic/infra/services/pr-review/review-pr.sh`

Before overwriting a review file, copy the old version to `reviews/archive/{repo}-{number}/v{N}.md`. This enables the dashboard to show review history.

```bash
if [[ -f "$review_file" ]]; then
    local version=$(read current_version from meta)
    mkdir -p "$REVIEWS_DIR/archive/${repo}-${number}"
    cp "$review_file" "$REVIEWS_DIR/archive/${repo}-${number}/v${version}.md"
fi
```

**Verification:** Find a PR with commits after its last review. Run `review-pr.sh --repo X --pr N`. Confirm:
- New review references the previous review
- Has "Delta from Previous Review" section
- Old version archived in `reviews/archive/`
- `.meta.json` version incremented

---

## Phase 3: Auto-Post Review to GitHub

Post reviews as PR comments (not formal reviews). Phase 2 of the graduated rollout — developers see the comment but it doesn't block merge.

### Task 3.1: Create `post-review.sh`

**New file:** `workspaces/strokmatic/infra/services/pr-review/post-review.sh`

```bash
# Usage: post-review.sh --all | --repo <repo> --pr <number>
# For each review:
# 1. Check if already posted (compare md5 hash of cleaned content vs posted hash in meta)
# 2. Clean via clean-review.sh
# 3. Prepend banner: "> **JARVIS AI Review** (v{version}, {model}) — auto-generated"
# 4. Post: gh pr comment $number --repo strokmatic/$repo --body "$CLEANED"
# 5. Store { comment_id, posted_at, review_hash } in .meta.json
```

Only re-posts if review content changed (hash comparison). Skips draft PRs.

### Task 3.2: Integrate into `run.sh`

Insert after Step 3 (Review), gated by `auto_post_github` config flag:

```bash
if [[ "$AUTO_POST" == "true" && "$NEW_REVIEWS" -gt 0 ]]; then
    "$SCRIPT_DIR/post-review.sh" --all
fi
```

**Verification:** Set `auto_post_github: true`, run pipeline with `--force`. Confirm GitHub comments appear with JARVIS banner. Re-run → confirm no duplicate comments posted.

---

## Phase 4: Auto-Label PRs

Apply labels based on review analysis. Quick win — high visibility for developers.

### Task 4.1: Create `label-prs.sh`

**New file:** `workspaces/strokmatic/infra/services/pr-review/label-prs.sh`

Labels applied:
- **Size**: `size/S` (simple), `size/M` (medium), `size/L` (complex) — from complexity calculation
- **Verdict**: `ai-review/approve`, `ai-review/changes-requested` — from review verdict
- **Flags**: `needs-tests` (if review mentions missing tests), `security-concern` (if critical security findings)

Logic:
1. Ensure labels exist in repo (`gh label create` — idempotent, fails silently if exists)
2. Parse review for verdict and findings keywords
3. Compare with `labels_applied` in `.meta.json` to avoid redundant API calls
4. Apply via `gh pr edit --add-label "label1,label2"`
5. Remove stale labels (e.g., remove `ai-review/changes-requested` if new verdict is APPROVE)
6. Update `.meta.json` with `labels_applied`

### Task 4.2: Integrate into `run.sh`

After post-review step, gated by `auto_label_prs` config flag. Same pattern as Phase 3.

**Verification:** Enable labeling, run pipeline. Confirm labels appear on GitHub PRs. Trigger a re-review with changed verdict → confirm label updated.

---

## Phase 5: GUI Dashboard

Docker container running FastAPI + Vue 3 + PrimeVue, same stack as the PMO Dashboard (`tools/pmo-dashboard/`). Runs on 192.168.15.2:8091 alongside the service.

### Task 5.1: Scaffold project

**New directory:** `tools/pr-review-dashboard/`

```
tools/pr-review-dashboard/
├── Dockerfile              # Multi-stage: Node 20 alpine → Python 3.12-slim + gh CLI
├── docker-compose.yml      # Port 8091, mounts /opt/jarvis-pr-review:/data/service:ro
├── .dockerignore
├── dev.sh                  # Local dev: uvicorn + vite
├── backend/
│   ├── requirements.txt    # fastapi, uvicorn, aiofiles, pydantic
│   └── app/
│       ├── main.py         # FastAPI app, SPA fallback, CORS
│       ├── config.py       # Settings (SERVICE_DATA_DIR, AUTH_TOKEN, PORT)
│       ├── schemas.py      # Pydantic response models
│       └── routers/
│           ├── inbox.py    # GET /api/inbox
│           ├── reviews.py  # GET /api/reviews/{repo}/{number}[/history][/version/{v}]
│           ├── pipeline.py # GET /api/pipeline/status, /logs
│           ├── actions.py  # POST /api/actions/{post,merge,labels}
│           └── analytics.py# GET /api/analytics
└── frontend/
    ├── package.json        # vue, vue-router, primevue, primeicons, marked, highlight.js
    ├── vite.config.js      # Proxy /api to backend
    ├── index.html
    └── src/
        ├── main.js         # PrimeVue Aura dark theme
        ├── App.vue         # Navbar + router-view
        ├── router.js       # Routes: /, /reviews/:repo/:number, /pipeline, /analytics
        ├── api.js          # Axios client
        ├── assets/theme.css# Dark theme CSS vars (same palette as PMO)
        ├── views/
        │   ├── InboxView.vue          # PR table with filters, badges, actions
        │   ├── ReviewDetailView.vue   # Rendered markdown + action buttons + version selector
        │   ├── PipelineView.vue       # Status card + log viewer
        │   └── AnalyticsView.vue      # Charts (verdict dist, reviews/day, size trends)
        └── components/
            ├── ReviewTimeline.vue     # Version history timeline (PrimeVue Timeline)
            ├── VerdictBadge.vue       # Colored verdict indicator
            └── ConfirmDialog.vue      # Merge/post confirmation
```

### Task 5.2: Backend — Read-only endpoints

**Files:** `routers/inbox.py`, `routers/reviews.py`, `routers/pipeline.py`, `routers/analytics.py`

- `GET /api/inbox` → reads `data/pr-inbox.json`, enriches with review status from `reviews/` dir
- `GET /api/reviews/{repo}/{number}` → reads `.md` + `.meta.json`, parses verdict/summary/findings
- `GET /api/reviews/{repo}/{number}/history` → reads `.meta.json` versions + archive files
- `GET /api/pipeline/status` → reads `data/state.json`
- `GET /api/pipeline/logs?lines=100` → tails today's log file
- `GET /api/analytics` → scans reviews + metadata, computes stats (verdict distribution, size trends, per-author, per-product, reviews/day)

### Task 5.3: Backend — Action endpoints

**File:** `routers/actions.py`

- `POST /api/actions/reviews/{repo}/{number}/post` → runs `clean-review.sh` + `gh pr comment`
- `POST /api/actions/prs/{repo}/{number}/merge` → runs `gh pr merge --squash` (requires `confirm: true` param)
- `POST /api/actions/prs/{repo}/{number}/labels` → runs `gh pr edit --add-label`

Docker container needs `gh` CLI installed. Auth via mounted `~/.config/gh/` or `GITHUB_TOKEN` env var.

### Task 5.4: Frontend — Inbox view

PrimeVue DataTable with columns: #, Repo, Title, Author, Age, Size, Status, Verdict, Actions. Filter chips by product. Colored status badges. Auto-refresh every 60s.

### Task 5.5: Frontend — Review detail view

Two-column layout: metadata card (left) + rendered markdown (right). Uses `marked` + `highlight.js` for rendering. Action buttons: Post to GitHub, Apply Labels, Merge (squash). Version selector dropdown. Findings summary cards (critical/warning/suggestion counts).

### Task 5.6: Frontend — Timeline, pipeline, analytics views

- ReviewTimeline: PrimeVue Timeline showing review versions, commits, comments
- PipelineView: Status card + scrollable log viewer
- AnalyticsView: Charts via Chart.js — verdict pie, reviews/day bar, size distribution, time-to-review

### Task 5.7: Docker config and deploy integration

- `docker-compose.yml`: port 8091, mounts service data dir read-only + gh config
- Update `scripts/deploy-pr-review.sh` to include dashboard deployment (scp, docker-compose build, docker-compose up -d)
- Smoke test: `curl http://localhost:8091/api/pipeline/status`

**Verification:** `docker-compose up` → access http://192.168.15.2:8091 → see inbox table with live data → click review → see rendered markdown → post a review to GitHub via button → merge a PR via button.

---

## Phase 6: Build/Test Checks (Tier 1)

Clone the PR branch and run basic compile + unit test checks. Results appended to the review.

### Task 6.1: Create `build-check.sh`

**New file:** `workspaces/strokmatic/infra/services/pr-review/build-check.sh`

```bash
# Usage: build-check.sh --repo <repo> --branch <branch> --pr <number>
# 1. git clone --depth 1 --branch $head strokmatic/$repo into temp dir
# 2. Detect project type (package.json → Node.js, requirements.txt → Python)
# 3. npm install && npm run build && npm test (with 5-min timeout)
# 4. Append "## Build & Test Results" section to review file
# 5. Clean up temp directory
```

Gated by `build_check_enabled` and `build_check_repos` in `service.json`. Only runs for repos explicitly listed.

### Task 6.2: Integrate into `run.sh`

After review step, before inbox build. Runs sequentially per PR (not parallel — disk/CPU constraint).

**Verification:** Enable for one repo. Run pipeline. Confirm review has "Build & Test Results" section with build output.

---

## Phase 7: Deploy Script Updates

### Task 7.1: Update `scripts/deploy-pr-review.sh`

Add to existing deployment:
1. `chmod +x` for new scripts: `post-review.sh`, `label-prs.sh`, `build-check.sh`, `scripts/backfill-metadata.sh`
2. Rsync `lib/review-metadata.sh`, `lib/pr-context.sh`
3. Rsync `config/service.json`
4. Create `reviews/archive/` directory on remote
5. New step: Deploy dashboard — scp `tools/pr-review-dashboard/`, build + start container
6. Dashboard smoke test

---

## Sandbox Dispatch Plan

| Sandbox | Phase | Spec Focus | Estimated Time |
|---------|-------|-----------|----------------|
| 1 | Phase 1 | Metadata infrastructure + enriched fetch + service config | ~2h |
| 2 | Phase 2 | Contextual re-review + version archiving | ~2h |
| 3 | Phase 3 + 4 | Auto-post + auto-label (GitHub integration) | ~2h |
| 4 | Phase 5 (backend) | Dashboard scaffold + all API endpoints | ~3h |
| 5 | Phase 5 (frontend) | Dashboard UI + Docker config | ~3h |
| 6 | Phase 6 + 7 | Build checks + deploy script updates | ~2h |

Each sandbox gets a committed spec file and runs against the `workspaces/strokmatic/infra/services/pr-review/` or `tools/pr-review-dashboard/` directory.

## Key Files Modified

| File | Changes |
|------|---------|
| `workspaces/strokmatic/infra/services/pr-review/fetch-open-prs.sh` | Add headRefOid, labels, comments fields |
| `workspaces/strokmatic/infra/services/pr-review/review-pr.sh` | SHA-based staleness, contextual re-review prompt, version archiving, metadata writes |
| `workspaces/strokmatic/infra/services/pr-review/run.sh` | New pipeline steps: post-review, label, build-check |
| `workspaces/strokmatic/infra/services/pr-review/lib/config.sh` | Add SERVICE_CONFIG, ARCHIVE_DIR paths |
| `workspaces/strokmatic/infra/services/pr-review/clean-review.sh` | No changes (reused by post-review.sh) |

## New Files

| File | Purpose |
|------|---------|
| `workspaces/strokmatic/infra/services/pr-review/lib/review-metadata.sh` | Sidecar JSON read/write functions |
| `workspaces/strokmatic/infra/services/pr-review/lib/pr-context.sh` | Fetch PR comments + commits since SHA |
| `workspaces/strokmatic/infra/services/pr-review/post-review.sh` | Post reviews as GitHub comments |
| `workspaces/strokmatic/infra/services/pr-review/label-prs.sh` | Apply labels based on review analysis |
| `workspaces/strokmatic/infra/services/pr-review/build-check.sh` | Clone + build + test (Tier 1) |
| `workspaces/strokmatic/infra/services/pr-review/config/service.json` | Feature flags (all default false) |
| `workspaces/strokmatic/infra/services/pr-review/scripts/backfill-metadata.sh` | One-time metadata migration |
| `tools/pr-review-dashboard/` | Full dashboard project (FastAPI + Vue 3 + PrimeVue) |
