# JARVIS Repo — Structure & Functionality Audit

**Data:** 2026-07-03<br>
**Escopo:** full repo (`/home/teruel/JARVIS`, 176 GB on disk), 5 parallel subsystem audits + git/cron review<br>
**Método:** explorer agents over scripts/, mcp-servers/+tests/, config+docs+backlogs+reports, .claude/, disk/git hygiene

---

## Executive summary

The repo is functionally healthy — no credential leaks, cron jobs coherent, gitignore mostly right, the big trees (workspaces 157 GB, references 625 MB) correctly kept out of git. The improvement opportunities cluster into four themes:

1. **Broken/silently-degraded functionality** — a dead skill, two MCP servers that break without an env var, fail-open validation hooks, a dead matcher-validator, a stale cron template.
2. **Duplication** — legacy vk-health/sf-health trees (already being replaced), 6 copy-pasted Telegram senders, 2 divergent chat-bot stacks, forked office skills drifting from their plugin, googleapis installed twice (~232 MB).
3. **SSOT/structure drift** — dual plan/spec homes, spec bodies copied into backlogs, MCP wiring trapped in `~/.claude.json`, one-off spikes living inside production script dirs.
4. **Hygiene** — ~8 GB of un-ignored one-off dumps in `data/`, no log rotation, 10 stale git branches, 27 uncommitted files spread across 8 unrelated areas on a feature branch.

---

## P1 — Broken or risk-of-silent-failure (functionality)

| # | Finding | Evidence | Fix |
|---|---------|----------|-----|
| 1.1 | `email-organizer` skill is **dead**: entrypoint `scripts/email-sync.mjs` does not exist (incomplete `email-ingest`→`email-sync` rename; old script deleted 2026-06-15, cron line disabled) | `.claude/skills/email-organizer/SKILL.md:14-16,57,61` | Create `email-sync.mjs` or repoint the skill to `email-analyze.sh` / email-analyzer MCP; delete the skill if the flow is retired |
| 1.2 | `report-generator` and `workspace-analyzer` MCP servers have **no fallback** for `ORCHESTRATOR_HOME` — build `undefined/...` paths when launched without env | `report-generator/index.js:11`, `workspace-analyzer/index.js:14` | Import `mcp-servers/lib/config-loader.js` like the 5 compliant servers |
| 1.3 | **Fail-open validation hooks**: PreDispatchValidator silently allows all dispatches if `jq` missing or `workspaces.json` absent | `.claude/hooks/lib/utils.sh:16-22`, `PreDispatchValidator.hook.sh:13` | Emit a visible warning / fail closed for the PreToolUse validator |
| 1.4 | DashboardSummary's hook-matcher validator is **dead code** — regex `mcp__\(.*\)__[^_]*$` never matches real tool names (they contain `_`), so the check silently never fires | `.claude/hooks/DashboardSummary.hook.sh:52-80` | Split on first `__` after prefix; validate against `~/.claude.json` registered command paths |
| 1.5 | `config/cron/orchestrator.cron` is **stale** vs installed crontab — missing vk-health, morning-report, system-health, self-improvement jobs; would mis-provision a fresh host/FORGE release | `config/cron/orchestrator.cron` vs `crontab -l` | Regenerate template from live crontab; add a drift-check to system-health-check |
| 1.6 | Airflow plugin hook misfires on every VK/SF "deploy…pipeline" prompt (confirmed twice during this very audit) | plugin cache `data-engineering/0.1.0/.../airflow-skill-suggester.sh` — `deploy.*pipeline`, bare `dag`, `"af "` matchers | Disable the plugin's UserPromptSubmit hook (plugin-cache edits get overwritten on update) |
| 1.7 | `sf-health/collect.sh:53` falls back to `SF_RABBIT_PASSWORD="guest"` silently | `scripts/sf-health/collect.sh:53` | Fail closed (moot once sf-health is retired) |

## P2 — Duplication (maintenance cost)

| # | Finding | Evidence | Fix |
|---|---------|----------|-----|
| 2.1 | Legacy `vk-health/` + `sf-health/` (37 files, 85-95% duplicated; ssh.sh/telegram.sh byte-identical). sf-health is **not even cronned** — pure orphan | `scripts/{vk,sf}-health/` | Already in-flight: finish health-monitor unification Phases 3-5, then delete both trees |
| 2.2 | Telegram send copy-pasted 6×; `lib/telegram-router.sh` exists as canonical but is bypassed | `{vk,sf,health}/lib/telegram.sh`, `morning-report.sh:101`, `sg3-monitor/lib/notifier.mjs:39` | Route bash senders through `telegram-router.sh` |
| 2.3 | `jarvis-chat/` and `kb-chat/` are diverging near-clones (poll→answer→qa-log pattern) | `scripts/{jarvis-chat,kb-chat}/lib/` | Extract shared `scripts/lib/chat-bot/` |
| 2.4 | `docx/pptx/xlsx` skills are forks of the office-suite plugin; local `comments` feature (uncommitted) exists only here — plugin updates will drift silently; same-named skills shadow ambiguously | `.claude/skills/{docx,pptx,xlsx}/` vs `~/.claude/plugins/.../office-suite/` | Pick one owner: upstream `comments` into the plugin and delete local forks, or rename local to `*-local` and drop plugin |
| 2.5 | googleapis installed **twice in full** (~116 MB each): `meeting-assistant` is excluded from root npm workspaces; MCP SDK split ^0.5.0 vs ^1.0.0 blocks hoisting two more 6 MB copies | `mcp-servers/package.json` workspaces list | Add meeting-assistant to workspaces; align on one SDK major → ~200 MB reclaimed |
| 2.6 | Google auth hand-rolled in 5 places; shared `lib/google-auth.mjs` has **zero callers** (its doc-comment claims otherwise) | `google-workspace/index.js:322,351,405,431`, `sf-audit*.mjs:27` | Route all through `createGoogleAuth`, or delete the dead helper |
| 2.7 | Config/home resolution forked 4 ways across MCP servers, incl. a different env-var name (`JARVIS_HOME` in email-analyzer) | `email-analyzer/index.js:11`, `google-workspace/index.js:12`, `notifier/index.js:13` | Standardize on config-loader import |

## P3 — Structure / SSOT

| # | Finding | Evidence | Fix |
|---|---------|----------|-----|
| 3.1 | MCP wiring (12 local + 6 external servers) lives only in `~/.claude.json` — not versioned, not portable | no `.mcp.json` in repo | Commit a `.mcp.json` with repo-relative paths |
| 3.2 | Dual plan/spec homes: `docs/plans` + `docs/specs` (partly dated, partly not) alongside SSOT `docs/superpowers/{plans,specs}` | `docs/plans/*.md`, `docs/specs/spark-0*.md` | Migrate dated docs into superpowers; mark the rest as pre-SSOT archive |
| 3.3 | `backlogs/jarvis/specs/` holds 22 full spec bodies (pre-SSOT copies), violating "link, never copy"; 2 dead links in `backlogs/jarvis/README.md` (`voice-interface.md`, `cleanup-skill.md` missing `specs/` prefix) | `backlogs/jarvis/` | Convert duplicated specs to links; fix the 2 links |
| 3.4 | One-offs inside production dirs: `sg3-monitor/spike/`, `vk-hardening/`, orphan `launch-jarvis-mini.sh` (zero references), `deprecated/` leftovers | `scripts/` | Move spikes to `experiments/`, delete confirmed orphans |
| 3.5 | Hardcoded `/home/teruel/JARVIS`: worst is `helpers/build-access-matrix.mjs:96` (absolute output path); also `task-dispatcher/index.js:111-113,1063`, `morning-report.sh:42-53`, `sf-audit*.mjs` credential paths. Only 36 of 69 shell scripts source `lib/config.sh` | various | Fix build-access-matrix first; migrate the rest opportunistically |
| 3.6 | Giant single-file servers, zero tests: `google-workspace/index.js` 2 546 lines, `task-dispatcher` 1 197, `notifier` 913 — the three biggest/most external servers have no coverage (tests exist only for lib/ + backlog-manager issues) | `mcp-servers/`, `tests/mcp-servers/` | Split google-workspace per service; add tests to dispatcher + notifier first |
| 3.7 | Redundant capability stacks loaded per session: 2 Playwright MCPs + claude-in-chrome; officecli + excel-mcp + local office skills | `~/.claude.json` | Consolidate to one browser MCP, one office path |
| 3.8 | `tdd-pocock` skill overlaps plugin TDD skills (trigger contention); `sandbox` skill missing frontmatter | `.claude/skills/` | Consolidate/annotate |

## P4 — Hygiene (disk & git)

| # | Finding | Evidence | Fix |
|---|---------|----------|-----|
| 4.1 | `data/` gitignore gap: 7 un-ignored one-off dumps polluting `git status` — `03010-cads` **6.8 GB**, `vk-backups` **1.3 GB**, `03010-siemens`, `03010-automacao`, `drivers`, `vk-health-scan-*`, `vk01-forensics-*` | `git status --porcelain` | Archive/delete the big two; add ignore rules for all 7 patterns |
| 4.2 | `reports/vk-hardening/` neither tracked nor ignored (85 KB bench output) | `reports/vk-hardening/` | Add to `.gitignore` |
| 4.3 | No log rotation: `cron-daily.log` 7.7 MB, `cron-vk-health.log` 2.3 MB, `dispatches.log` 1.8 MB, monotonically growing; `crontab-backup-*.txt` un-ignored | `logs/` | logrotate/size-cap; ignore backups |
| 4.4 | Git state: `develop` 20 commits unpushed; current branch carries 27 modified files across 8 unrelated areas; 10 stale branches (5 untouched since Feb, `feat/health-monitor-unification` merged and deletable, `worktree-agent-a735114a` leftover); 1 stale stash | `git branch -vv`, `git status` | Push develop; commit/split the WIP; prune merged+dead branches; drop stash |
| 4.5 | workspaces/ (157 GB, 34 nested git repos — **correctly ignored**, contrary to first impression): 38 nested node_modules/venvs; no manifest of what's cloned | `workspaces/` | Periodic prune of node_modules/venvs + `git gc` sweep; optional `repos.txt` manifest for reproducibility |
| 4.6 | `workspace-analyzer/index.js.bak` (Feb, identical to HEAD) | `mcp-servers/workspace-analyzer/` | Delete |
| 4.7 | `reports/md` (16 MB) + `reports/pdf` (11 MB) unbounded on disk (ignored, so no git risk) | `reports/` | Retention/prune job |

**Verified clean:** no hardcoded secrets anywhere in scripts/ or mcp-servers/ (the 2026-06-17 scrub held); `config/credentials/` properly ignored; `references/` heavy clones ignored; `releases/FORGE` is a submodule pointer, not blobs; Telegram logic properly centralized in the notifier MCP; root node_modules justified (sg3-monitor).

---

## Suggested sequencing

1. **Quick wins (one sitting):** 1.2, 1.7, 4.1-4.3, 4.6, dead links (3.3), delete orphans (3.4), prune branches (4.4).
2. **Already in-flight:** health-monitor Phases 3-5 → retires 2.1 and half of 2.2.
3. **One focused PR each:** `.mcp.json` (3.1), npm-workspace/googleapis dedup (2.5), config-loader adoption (2.7 + 1.2), office-skill ownership decision (2.4), cron template regen (1.5).
4. **Larger refactors (backlog issues):** google-workspace split + tests (3.6), chat-bot shared lib (2.3), telegram-router consolidation (2.2), docs SSOT migration (3.2/3.3).
