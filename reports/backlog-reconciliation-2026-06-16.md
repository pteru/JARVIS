# Backlog Reconciliation — Pre-Migration Triage

> **Date:** 2026-06-16
> **Purpose:** Before migrating the per-product backlogs to GitHub Issues, verify every open `- [ ]` task against the current codebase, git history, and existing GitHub issues. **Report-only — nothing was created, modified, or deleted.**
> **Method:** 6 parallel agents, one per backlog, deep-reading the relevant monorepo/repos (code + commits) and cross-checking open issues.

## Executive summary

| Backlog | Open | ✅ Done | 🗑️ Obsolete | 🔁 Dup | ✅→ Migrate | ❓ Call |
|---|---:|---:|---:|---:|---:|---:|
| VisionKing | 35 | 5 | 1 | 1 | 28 | 0 |
| SpotFusion | 16 | 1 | 0 | 3 | 11 | 1 |
| DieMaster | 18 | 4 | 2 | 1 | 11 | 0 |
| SDK | 14 | 2 | 0 | 0 | 11 | 1 |
| General + Workflow | 22 | 9 | 2 | 0 | 6 | 5 |
| JARVIS | 23 | 11 | 0 | 0 | 9 | 3 |
| **TOTAL** | **128** | **32** | **5** | **5** | **76** | **10** |

**Key findings**
- **JARVIS is 48% already-shipped** (11/23): PMO Dashboard, Sandbox, `/cleanup`, GDrive↔PMO, Gmail API migration, Document Templates plugin, PR-inbox widget, knowledge-hub `works_at`, Blender toolkit, FORGE distribution, gws-CLI eval — all done, never checked off.
- **VK FIX-01 (a P0 "fix immediately") is a phantom** — the merge conflict is a *local worktree artifact*; committed `develop` is clean. Action = abort the dangling `MERGE_HEAD` in the controller submodule, not "fix."
- **Unmerged "done" work**: VK DISPLAY-01 (on `feat/display-01`), VK SEALER-05, DM FW-02 (`feat/gap-ping-pong-buffer`) — implemented but awaiting merge.
- **Duplicates already have issues**: VK SEC-01→#85; SF SEC-01/02/CICD→#59/#60/#61/#62; DM SEC-01→#208/#213. Close in backlog, don't recreate.
- **SDK migration is NOT a simple "create issues"**: 8 of its valid tasks target **repos that don't exist yet** (sdk-lib-redis, sdk-lib-config, sdk-plc-toolkit, sdk-deployment-toolkit, sdk-defect-toolkit, sdk-redis-toolkit, sdk-image-toolkit, sdk-welding-toolkit). Repo-creation decision needed.
- **workflow.md is mostly superseded** — it lives inside a *design doc's* §9 roadmap (not the tracked backlog); 9 done, 5 are external ClickUp/Google/team-admin actions (no code). Recommend resolving in-place, migrating only the 2 real plugin tasks.

---

## VisionKing (35 open)

| ID | Task | Verdict | Evidence | Migrate? |
|---|---|---|---|---|
| FIX-01 | Resolve controller.cpp merge conflicts | 🗑️ OBSOLETE | Local worktree artifact; committed HEAD `e51a482` has 0 markers; `git log --all -S'<<<<<<<'` empty. Abort dangling `MERGE_HEAD a01d4e8` | No |
| SEALER-02 | image-saver 3D .ply storage | ✅→ VALID | No 3D/.ply detection in image-saver | Yes |
| SEALER-03 | sealer-bead-measurement service | ✅ DONE | Submodule on develop (`bf91be39`/`ef89f8b7`) | No |
| SEALER-04 | 3D inference training pipeline | ✅→ VALID (re-scope) | No sealer/depth profile; spec pivoted to per-frame | Yes |
| SEALER-05 | database-writer sealer mode | ✅→ VALID (near-done) | Only on unmerged `feat/sealer-db-writer-topology` | Yes |
| SEALER-06 | sealer-inspection NestJS module | ✅→ VALID | backend-ds is generic scaffold; spec exists | Yes |
| SEALER-07 | sealer-visualization Angular module | ✅→ VALID | frontend-ds generic; no Three.js viewer | Yes |
| SEALER-08 | camera-acquisition 3D mode | ✅→ VALID | Zero 3D/MV3D refs across 10 branches; "quase finalizado" false | Yes |
| SEALER-09 | 3D sealer integration tests | ✅→ VALID | Spec exists; no sealer E2E | Yes |
| SEALER-10 | 3D camera calibration tool | ✅→ VALID | No calibration CLI | Yes |
| SPARK-01 | wifi-camera-acquisition service | ✅ DONE | Submodule on develop (`b2150b93`) | No |
| SPARK-02 | spark-test-controller service | ✅ DONE | Submodule on develop (`b2150b93`) | No |
| SPARK-03 | inference spark classification | ✅→ VALID | No spark profile | Yes |
| SPARK-04 | backend-sparktest NestJS API | ✅→ VALID | No service exists | Yes |
| SPARK-05 | frontend-sparktest Angular PWA | ✅→ VALID | No service exists | Yes |
| SPARK-07 | database-writer spark mode | ✅ DONE | `src/sparktest/consumer.py` merged (`68c92fb`) | No |
| SCHEMA-MIGRATE-STEEL-TO-COMMON | Steel→common schema | ✅→ VALID | Phase-2 epic, blocked on 03008 | Yes |
| RESULT-SERVICE-GENERALIZE | Merge result+sealer-result | ✅→ VALID | No sealer-result yet; Phase-2 blocked | Yes |
| SEC-01 | Remove hardcoded credentials | 🔁 DUP #85 | Creds live in `.env.example`; #85/#88/#89 cover it | No |
| TEST-02 | C++ test infrastructure | ✅→ VALID | camera-acquisition/plc-monitor lack gtest | Yes |
| GIT-01 | Resolve submodule changes | ✅→ VALID | ~18 submodules modified | Yes |
| CICD-01 | Cloud Build to 5 services | ✅→ VALID | None of the 5 have cloudbuild.yaml | Yes |
| HEALTH-01 | Docker healthchecks | ✅→ VALID | Only 1 healthcheck block | Yes |
| MONITOR-01 | Prometheus metrics | ✅→ VALID | No /metrics anywhere | Yes |
| DISPLAY-01 | Android TV kiosk app | ✅ DONE (unmerged) | `apps/display-tv` on `feat/display-01` (`12eb0c6a`) | No (merge) |
| CLEAN-01 | Remove large artifacts | ✅→ VALID | 286 MB zip in repo root | Yes |
| CLEAN-02 | Model artifact mgmt (DVC/GCS) | ✅→ VALID | Models still in git | Yes |
| INFRA-01 | Centralized logging | ✅→ VALID | None | Yes |
| INFRA-02 | Standardize network config | ✅→ VALID | Mixed host/bridge | Yes |
| OPT-01 | RabbitMQ DLX + batching | ✅→ VALID | No global DLX | Yes |
| OPT-02 | Resource monitoring/scaling | ✅→ VALID | None | Yes |
| QUAL-01 | Standardize error handling | ✅→ VALID | Mixed logging | Yes |
| TOOL-01 | DS pipeline into CI/CD | ✅→ VALID | ds/ isolated | Yes |
| TOOL-02 | Complete cloud pipeline toolkit | ✅→ VALID | Unstarted | Yes |
| DOC-03 | Developer onboarding guide | ✅→ VALID | None | Yes |

## SpotFusion (16 open)

| ID | Task | Verdict | Evidence | Migrate? |
|---|---|---|---|---|
| SEC-01 | Remove hardcoded credentials | 🔁 DUP #59 | 111 files w/ creds; #59 open same scope | No |
| SEC-02 | Replace eval() calls | 🔁 DUP #60 | ~165 py eval; #60 open (note: #60 framed TS/JS, scope is Python) | No |
| SEC-03 | Fix bare except clauses | ✅→ VALID | 103 `except:` in services | Yes |
| QUAL-01 | Consolidate duplicated utils | ✅→ VALID | 22×Ilog, 43×Icache copies | Yes |
| GIT-01 | Fix upstream tracking | ✅ DONE | develop tracks origin; symptom resolved | No |
| CICD-01 | Tests/scans in Cloud Build | 🔁 DUP #61/#62 | cloudbuild build-only; #61/#62 cover gates+scan | No |
| OPT-01 | Clean repo (venvs/pycache) | ✅→ VALID | 38GB, 45k pyc, 6 venvs | Yes |
| OPT-02 | Async I/O | ✅→ VALID | 132 sleep vs 12 async | Yes |
| INFRA-01 | Docker healthchecks + deps | ✅→ VALID | Only 3 healthchecks; PING_PLC stub | Yes |
| INFRA-02 | Centralized logging/monitoring | ✅→ VALID | Ilog→Redis; no prom/otel | Yes |
| INFRA-03 | Remove privileged mode | ✅→ VALID | `privileged: true` in 10+ services | Yes |
| INFRA-04 | Dockerfiles for all services | ✅→ VALID | Only 1 Dockerfile; 20+ missing | Yes |
| QUAL-03 | Input validation | ✅→ VALID | No pydantic/jsonschema | Yes |
| QUAL-05 | requirements.txt pinning | ✅→ VALID | Only 1 service pinned | Yes |
| TOOL-01 | Document toolkit utilities | ✅→ VALID (partial) | 5/9 toolkit dirs lack README | Yes |
| DS-01 | Resolve DS TODOs | ❓ NEEDS-CALL (likely OBSOLETE) | TODOs only in gitignored `legacy/`; active ds/ clean | Decide |

## DieMaster (18 open)

| ID | Task | Verdict | Evidence | Migrate? |
|---|---|---|---|---|
| FEAT-04 | inference async ML worker | ✅ DONE | `services/inference` submodule (`379e554`), tests, cloudbuild | No |
| SEC-01 | Remove hardcoded credentials | 🔁 DUP #208/#213 | GCP JSON never committed; creds in 26 files; #208/#213 open | No |
| FW-01 | Stabilize firmware | 🗑️ OBSOLETE | `app.c:814` clean; HEAD added watchdog/MQTT/cold-boot | No |
| FW-02 | Extend gap-sensor window | ✅ DONE (unmerged) | Ping-pong buffer on origin/develop (`fff0113`) + `feat/gap-ping-pong-buffer` | No (merge) |
| QUAL-01 | Fix bare except | ✅→ VALID (rescope) | 1 confirmed (`smartdie-connect.py:67`); others gone | Yes |
| QUAL-02 | Deduplicate format.py | 🗑️ OBSOLETE | No `format.py` anywhere | No |
| QUAL-03 | Resolve TODOs (18) | ✅ DONE (mostly) | Only 2 remain in parse_mock_data | No |
| QUAL-04 | .req → pinned requirements | ✅→ VALID | 10 unpinned .req files | Yes |
| GIT-01 | Resolve unmerged branches | ✅→ VALID (rescope) | hub 7, switch 5, backend 31, frontend 41 | Yes |
| CICD-01 | Complete CI/CD | ✅→ VALID (rescope) | cloudbuild widespread; deploy automation missing | Yes |
| INFRA-01 | DB migration versioning | ✅→ VALID | No Alembic/Flyway | Yes |
| INFRA-02 | Monitoring + logging | ✅→ VALID | 0 /health endpoints | Yes |
| OPT-01 | Optimize connect scanning | ✅→ VALID (rescope) | Now env-configurable, defaults unchanged | Yes |
| OPT-02 | Fix cJSON O(n²) | ✅→ VALID (low) | `cJSON.c:3145` TODO still there | Yes |
| FEAT-02 | Mock data generator | ✅→ VALID | Only parser stubs | Yes |
| CLEAN-01 | Clean repo artifacts | ✅ DONE (mostly) | No tracked pycache; only `.gitkeep` | No |
| TOOL-01 | Refactor parse_mock_data | ✅→ VALID | Hardcoded stub, creds, no CLI | Yes |
| TOOL-02 | Add sdk-plc-toolkit submodule | ✅→ VALID (blocked) | Not in .gitmodules; blocked by TOOL-01 | Yes |

## SDK (14 open) — ⚠️ many targets are repos that don't exist yet

| Task | Target repo | Verdict | Evidence | Migrate? |
|---|---|---|---|---|
| FEAT-01: OpENer EIP connector | strokmatic-eip | ✅→ VALID (in-progress) | Full OpENer adapter, 12+ commits, top-priority per memory | Yes |
| FEAT-02: Advanced logging in observability-stack | sdk-observability-stack | ✅→ VALID | Has Prom/Grafana, no Loki/alerting | Yes |
| LIB-01: Publish shared logging lib | sdk-lib-logging | ✅ DONE | Fully implemented; local-only, needs push | No (push+close) |
| LIB-02: Publish shared RabbitMQ lib | sdk-lib-rabbit-client | ✅ DONE | Full RabbitClient, pushed, cloudbuild | No |
| LIB-03: Shared Redis client lib | **sdk-lib-redis (new)** | ✅→ VALID | Repo doesn't exist | Yes (create repo) |
| LIB-04: Shared config loader lib | **sdk-lib-config (new)** | ✅→ VALID | Repo doesn't exist | Yes (create repo) |
| TOOL-01: PLC tools → sdk-plc-toolkit | **sdk-plc-toolkit (new)** | ✅→ VALID | Repo absent | Yes (create repo) |
| TOOL-02: Deployment → sdk-deployment-toolkit | **sdk-deployment-toolkit (new)** | ✅→ VALID | Repo absent | Yes (create repo) |
| TOOL-03: Defect viz → sdk-defect-toolkit | **sdk-defect-toolkit (new)** | ✅→ VALID | Still standalone visualizer | Yes (create repo) |
| TOOL-04: Redis tools → sdk-redis-toolkit | **sdk-redis-toolkit (new)** | ✅→ VALID | Standalone monitor only | Yes (create repo) |
| TOOL-05: Message posting → sdk-message-poster | sdk-message-poster | ✅→ VALID (partial) | Repo exists, template-only, DB-replay half missing | Yes |
| TOOL-06: Image toolkit → sdk-image-toolkit | **sdk-image-toolkit (new)** | ✅→ VALID | Repo absent | Yes (create repo) |
| TOOL-07: Welding toolkit → sdk-welding-toolkit | **sdk-welding-toolkit (new)** | ✅→ VALID | Repo absent | Yes (create repo) |
| INFRA-01: Branch protection on develop | GitHub org config | ❓ NEEDS-CALL | Not code-verifiable; org setting | Decide |

## General + Workflow (22 open)

**general.md (5):**

| Task | Target | Verdict | Evidence | Migrate? |
|---|---|---|---|---|
| SYNC-REENABLE: clickup→github sync | infra | ✅→ VALID (gated op) | Built; `SYNC_CU_TO_GH=true` to enable; gated on approval | Yes/op-note |
| CICD-02: lint+test in Cloud Build | infra | ✅→ VALID | 0/~50 services have lint+test | Yes |
| KH-MIGRATE: disable context-refresh cron | infra | ✅→ VALID | context-refresh still running; KH deployed | Yes |
| CICD-01: update Cloud Build links | infra | 🗑️ OBSOLETE | Trigger config is GCP-Console admin, not in-repo | No |
| SEC-CROSS-01: credential scanning in CI | infra | ✅→ VALID | No gitleaks/trufflehog anywhere | Yes |

**workflow.md (17 — inside a design doc's §9 roadmap):** DONE 9 · OBSOLETE 1 · VALID 2 (build + publish `project-management` marketplace plugin) · NEEDS-CALL 5 (external ClickUp/Google-Workspace/team-admin actions: ClickUp↔Drive integration, ClickUp PR-automations, Markdown Viewer add-on, Drive-Folder field back-fill, team training). **Recommendation:** resolve the 9 done + 1 obsolete in-place; the 5 external actions are not code (track as ops checklist); migrate only the 2 plugin tasks (→ sdk-agent-standards).

## JARVIS (23 open)

| Task | Verdict | Evidence | Migrate? |
|---|---|---|---|
| Sandbox Dev Environment | ✅ DONE | `scripts/sandbox.sh` + skill | No |
| PR review skip by commit SHA | ✅→ VALID | review-pr still mtime-based | Yes |
| PR inbox dashboard widget | ✅ DONE | orchestrator-dashboard PR Inbox widget | No |
| Knowledge-hub person→company | ✅ DONE | `knowledge-hub/.../emails.mjs:86-97` works_at | No |
| PMO Dashboard | ✅ DONE | `tools/pmo-dashboard/` | No |
| Dashboard Modular Sidenav | ✅→ VALID | Single-page, no modular sidenav | Yes |
| `/cleanup` Skill | ✅ DONE | `.claude/skills/cleanup/` | No |
| Google Drive ↔ PMO | ✅ DONE | google-workspace MCP drive tools + skills | No |
| Meeting Minutes Cron (GDrive) | ✅→ VALID | No calendar/minutes cron | Yes |
| GWorkspace Tools Package | ❓ NEEDS-CALL | Subsumed by FORGE dist; standalone artifact still wanted? | Decide |
| SDK Monorepo Reorganization | ❓ NEEDS-CALL | External SDK exists; internal scope unclear | Decide |
| Gmail API Migration | ✅ DONE | google-workspace gmail tools; IMAP deprecated | No |
| Telegram Command Intake | ✅→ VALID | No NLP intent router | Yes |
| PR Review Service v2 | ❓ NEEDS-CALL | Partially shipped (skip/clean/auto-post); SHA-skip/labels/build-checks left | Decide |
| JARVIS Restructuring + Marketplace | ❓→split | Marketplace done; shared-libs cleanup ongoing | Partial |
| Document Templates Plugin | ✅ DONE | Installed marketplace plugin | No |
| Blender Python (bpy) toolkit | ✅ DONE | `sdk-blender-tools` repo | No |
| NX Open API investigation | ✅→ VALID | No artifact | Yes |
| JARVIS Voice Interface | ✅→ VALID | Untracked scaffolding only | Yes |
| JARVIS Distribution — Strokmatic | ✅ DONE | `releases/FORGE/` via build-forge.sh | No |
| JARVIS Distribution — Generic | ✅→ VALID | FORGE is Strokmatic-only | Yes |
| Multi-User Network Interface | ✅→ VALID | Spec only | Yes |
| Android JARVIS App | ✅→ VALID | Spec only | Yes |
| Voice Interface — Session Tracker | ✅→ VALID | Depends on unshipped voice | Yes |
| Evaluate `gws` CLI | ✅ DONE | Decided in jarvis-restructuring plan | No |

---

## Decisions needed from Pedro (the 10 NEEDS-CALL + 2 structural)

1. **SF DS-01** — TODOs only in gitignored legacy; active ds/ clean → mark **OBSOLETE**? (recommended)
2. **SDK INFRA-01** — branch protection on develop is a GitHub org setting, not code. Configure directly + drop from backlog?
3. **JARVIS GWorkspace Tools Package** — subsumed by FORGE dist; keep the standalone-artifact idea or drop?
4. **JARVIS SDK Monorepo Reorganization** — external SDK repo exists; is the internal consolidation still wanted?
5. **JARVIS PR Review Service v2 / Restructuring** — partially shipped; close done sub-parts, migrate the remainder?
6. **Workflow §9 (5 external actions)** — ClickUp↔Drive, PR-automations, Markdown Viewer, Drive-field back-fill, team training — track as an ops checklist (not GitHub issues)?
7. **SDK repo creation** — 8 valid SDK tasks target repos that don't exist (sdk-lib-redis, -config, -plc-toolkit, -deployment-toolkit, -defect-toolkit, -redis-toolkit, -image-toolkit, -welding-toolkit). Create the repos now, or file the issues somewhere central (e.g. sdk-agent-standards) until the repos exist?

## Proposed cleanup actions (on approval — nothing done yet)

- Mark the **32 DONE** complete (`[X]`) in the local backlogs, with the merge-tracking note for the 3 unmerged ones (VK DISPLAY-01, VK SEALER-05, DM FW-02).
- Remove the **5 OBSOLETE** (incl. abort VK FIX-01's dangling `MERGE_HEAD`).
- Close the **5 DUPLICATE** in the backlog, linking the existing issues (#85, #59, #60, #61/#62, #208/#213).
- Resolve the **10 NEEDS-CALL** per your answers above.
- The remaining **~76 VALID** become the Phase-1 GitHub-issue migration set.
