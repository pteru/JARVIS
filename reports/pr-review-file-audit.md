# PR Review — File Audit (Local + Drive)

**Date:** 2026-04-22
**Server:** `strokmatic@192.168.15.2:/opt/jarvis-pr-review/`
**Shared Drive:** `0AC4RjZu6DAzcUk9PVA` (JARVIS Shared Drive) — parent folder `"PR Reviews"` at id `1cHmd-JJIPy7KdoIALWWHE3Z8D-5Efoot`.

---

## 1. Local filesystem (`/opt/jarvis-pr-review/`)

### Scripts
All run by `run.sh` in an 11-step pipeline (see `logs/run-{date}.log`):
- `fetch-open-prs.sh` — writes `data/pr-inbox.json`
- `review-pr.sh` — per-PR Claude call, writes `reviews/{repo}-{n}.md` + `.meta.json`
- `post-review.sh` — idempotent GitHub comment post (md5 hash dedup)
- `label-prs.sh`, `build-inbox.mjs`, `build-check.sh`
- `upload-to-drive.mjs` — ships everything to Drive
- `archive-reviews.sh` — handles closed/merged PRs (local + Drive)
- `notify-chat.mjs`, `notify.sh` — Telegram + Google Chat fanout

### `data/` (state)
| File | Size | Purpose |
|---|---|---|
| `pr-inbox.json` | 71 B (currently empty — see incident) | Open-PR roster consumed by dashboard |
| `pr-inbox.prev.json` | 71 B | Previous snapshot for change-detection |
| `state.json` | 326 B | Pipeline health — last_run / last_status / counts |
| `notify-state.json` | 93 B | Telegram / Chat cooldown timestamps |
| `upload-state.json` | 1.7 KB | Drive file ID cache to avoid re-creating on each run |

### `reviews/` (current, 5 PRs)
One `.md` + one `.meta.json` per currently-open PR:

```
diemaster-29.md                        diemaster-29.meta.json
sdk-connector-bosch-1.md               sdk-connector-bosch-1.meta.json
visionking-9.md                        visionking-9.meta.json
visionking-camera-acquisition-76.md    visionking-camera-acquisition-76.meta.json
visionking-image-saver-65.md           visionking-image-saver-65.meta.json
```

`.meta.json` schema (from `diemaster-29`):
```json
{
  "versions": [{ "version": 1, "reviewed_at": "...", "head_sha": "..." }],
  "current_version": 1,
  "current_head_sha": "bfc5fb7...",
  "current_reviewed_at": "2026-04-06T14:56:55-03:00",
  "posted_to_github": {
    "comment_id": 4194019120,
    "posted_at": "...",
    "review_hash": "1fc64b0..."   // md5 of cleaned review body
  },
  "labels_applied": ["size/M", "ai-review/changes-requested", "security-concern"]
}
```

### `reviews/archive/` (closed/merged PRs)
- **158 flat files** (= 79 archived PRs, each as `.md` + `.meta.json`)
- **36 subdirs** (per-PR version history — e.g. `archive/diemaster-13/v1.md`, `v2.md`, …)

Populated by `archive-reviews.sh` when a PR closes. Archive also clears the corresponding `upload-state.json` entry.

### `reports/`
Single file: `pr-inbox.md` (230 B right now, dropped with the empty inbox). Rendered by `build-inbox.mjs` — human-readable markdown version of `data/pr-inbox.json`.

### `logs/`
Rolling per-day logs plus `cron.log`. `cron.log` is 5.3 MB today — the detailed per-step trace is in `run-YYYY-MM-DD.log`.

---

## 2. Google Drive layout

All inside `"PR Reviews"` (parent `1cHmd-JJIPy7KdoIALWWHE3Z8D-5Efoot`), on Shared Drive `0AC4RjZu6DAzcUk9PVA`:

```
PR Reviews/                                    ← 1cHmd-JJIPy7KdoIALWWHE3Z8D-5Efoot
├── pr-inbox.json                              (structured snapshot)
├── markdown/                                  ← 1nbo1Zrc54VJJl-KtmBz-gQWBUHZPaauF
│   ├── pr-inbox.md                            (= 1yGBK3JjdRqSv0MKIXafMV5IaJrkt1EY9)
│   ├── diemaster-29.md                        (= 1YDqr1wU48m9no9t30NOQ_Ku7QqA9m3yG)
│   ├── sdk-connector-bosch-1.md               (= 146m6I2T34StXheT_e8vLttG3SueFunQc)
│   ├── visionking-9.md                        (= 1aSOgrZRsEO49SNYbx-HkZDffmwB_MJTJ)
│   ├── visionking-camera-acquisition-76.md    (= 1FDmcBhJRTTv7W9OnGyx_3rRg5XcHx-cH)
│   ├── visionking-image-saver-65.md           (= 11XEvqhyD_rKU3sMLF0GaVIMU8EWhHaiR)
│   └── archive/                               (auto-created on first archive event)
│       └── <closed PRs move here>
└── docs/                                      ← 1cKPwYwNZhLgSiNdrP0rvE1fuheB7OXhf
    ├── diemaster-29.md                        (Google Doc = 1Mjc-BaEdXww…)
    ├── sdk-connector-bosch-1.md               (Google Doc = 1fOf4NgWUb3…)
    ├── visionking-9.md                        (Google Doc = 1xqCcPFjR1b…)
    ├── visionking-camera-acquisition-76.md    (Google Doc = 1NL2k6GW70P…)
    ├── visionking-image-saver-65.md           (Google Doc = 1ntS5kUiXGL…)
    └── archive/
        └── <closed PRs move here>
```

Note the `docs/` copies are **actual Google Docs** (MIME `application/vnd.google-apps.document`), converted from the markdown on upload so reviewers can comment inline in Docs.

`upload-state.json` caches both sets of Drive file IDs so re-runs use `files.update` (versioned replace) instead of `files.create` (duplicates).

---

## 3. Flow of a review through the system

```
GitHub PR opens/updates
        │
        ▼
fetch-open-prs.sh ──► data/pr-inbox.json
        │
        ▼
review-pr.sh  (claude --print)  ──►  reviews/{repo}-{n}.md + .meta.json
        │
        ▼
post-review.sh ─── GitHub comment (dedup by md5 hash in meta)
        │
        ▼
label-prs.sh   ─── size/* + ai-review/* + flag labels
        │
        ▼
build-inbox.mjs ──► reports/pr-inbox.md  (human-readable roster)
        │
        ▼
upload-to-drive.mjs ──► Drive "PR Reviews":
                           markdown/{repo}-{n}.md            (text/markdown)
                           docs/{repo}-{n}.md                (Google Doc)
                           markdown/pr-inbox.md
                           pr-inbox.json
        │
        ▼
notify-chat.mjs / notify.sh ─── Google Chat DM + Telegram summary
        │
        ▼
archive-reviews.sh (closed PRs)  ─── moves both local and Drive to archive/ subfolders
```

Dashboard (`http://reviews.strokmatic.local/`, FastAPI + Vue SPA) reads **both** Drive (first) and local (fallback) via `drive_client.read_inbox_json()` / `read_review_markdown()`.

---

## 4. Observations from this audit

1. **`archive/` subfolders in Drive are mentioned in `archive-reviews.sh` but created lazily.** The script calls `findOrCreateFolder(mdFolderId, 'archive')` only when it has something to archive, so a new tenant might not see those subfolders until the first PR closes.
2. **5 open PRs on GitHub, 5 review files locally, 5 Drive uploads** — those match. The dashboard being empty is entirely a function of `pr-inbox.json` being empty, not reviews going missing.
3. **`.meta.json` + `.md` stay paired everywhere.** Archive moves both together.
4. **Upload-state.json is the source of truth for "what's in Drive"** — there's no server-side list-and-diff. If it's ever deleted, next run duplicates every file.
5. **`pr-inbox.prev.json` and `pr-inbox.json` are both currently 71 bytes** — the empty-inbox bug propagated through rotation. Once the fail-closed fix (PR #28) lands, the empty file cannot replace a good one.
6. **Archive contains 79 PRs** spanning months of activity — healthy history, nothing obviously orphaned.
7. **No central registry** mapping "which Drive file / Doc belongs to which GitHub PR" outside `upload-state.json`. If investigating a specific Drive file, search by filename (`{repo}-{n}.md`) rather than by ID.

## 5. Knobs + paths worth bookmarking

| Need | Where |
|---|---|
| Token used by cron | `~/.secrets/gh-token` via `gh auth status` under `strokmatic` |
| Bypass Drive, read local only | `settings.data_dir` / `settings.reviews_dir` / `settings.archive_dir` in dashboard `config.py` |
| Change Drive parent folder | `FOLDER_NAME`, `SHARED_DRIVE_ID` in `upload-to-drive.mjs` |
| Change per-repo error threshold for fetch | `FETCH_MAX_ERROR_FRACTION` env var (after PR #28 lands) |
| Force a re-review regardless of hash | delete the PR's `.meta.json` (or bump version manually) |
| Reset Drive state (full re-upload) | `data/upload-state.json` → `{}` |
