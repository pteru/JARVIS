# DieMaster Backlog

## High Priority
- [ ] [COMPLEX] FEAT-04: Develop diemaster-inference async ML worker (SENAI CT067/26) — New repo `strokmatic/diemaster-inference`, submodule in `diemaster/services/inference`. Async worker consuming from `inference-queue`, 4-stage pipeline (extract→preprocess→infer→result), Model Adapter pattern with 3 swap mechanisms (GenericAdapter JSON, plugin .py, built-in), 4 backends (PyTorch/TF/ONNX/TensorRT), Redis hot-reload, GPU support, 66+ tests. Spec: `plans/diemaster-inference-spec.md`
- [ ] [complex] SEC-01: Remove hardcoded credentials from entire codebase — 10+ locations with `<skm-password>`, `<smartdie-password>`. GCP JSON in repo root. Rotate and use env vars or GCP Secret Manager.
- [ ] [complex] FW-01: Test and stabilize firmware implementations — Both firmware branches marked "untested". Unhandled error in hub state machine (app.c:814).
- [ ] [medium] QUAL-01: Fix bare except clauses across legacy codebase — 5+ bare except:/except: pass in drawin_features, dashboard, sensor_config, smartdie-connect.
- [ ] [medium] QUAL-02: Deduplicate format.py across legacy services — Identical code in dashboard, enrichment, setup (3 copies). Extract to shared lib.
- [ ] [medium] QUAL-04: Migrate .req files to requirements.txt with version pinning — 8 services use .req format with no version constraints. Risk of dependency drift and vulnerabilities.
- [ ] [medium] GIT-01: Resolve unmerged feature branches and stale work — 8 unmerged legacy branches, 2 stalled firmware README branches.
- [ ] [complex] CICD-01: Complete CI/CD pipeline with testing and deployment — GitHub Actions for backend only. yarn/npm inconsistency. No deployment automation.

## Medium Priority
- [ ] [medium] INFRA-01: Implement database migration versioning — Raw SQL scripts, no Flyway/Alembic. No rollback procedures.
- [ ] [medium] INFRA-02: Add monitoring and centralized logging — No health endpoints, no centralized logs. Redis Insight only for cache.
- [ ] [medium] OPT-01: Optimize network scanning in smartdie-connect — ARP scanning full /24 every 5s with 2s timeout. ThreadPool max_workers=20.
- [ ] [medium] OPT-02: Fix cJSON O(n²) algorithm in firmware — cJSON.c:3145, noted as "horrible" in comments. Consider hash-based lookup.
- [ ] [medium] QUAL-03: Resolve all open TODOs (18 total) — Key: processing_consumer.py:49 (concentrador_id), gap_features.py:45 (Redis value).

## Product Features
- [ ] [complex] FEAT-02: Create mock data generator — Generate realistic sensor/die data for development and testing. Configurable profiles, batch sizes, anomaly injection.

## Low Priority
- [ ] [simple] CLEAN-01: Clean up repository artifacts and organize submodules — __pycache__ tracked, empty scaffold dirs, submodule docs missing.
- [ ] [medium] TOOL-01: Refactor parse_mock_data — Add env-based config, complete parse_to_sql.py, add Click CLI, add requirements.txt, remove hardcoded credentials.
- [ ] [medium] TOOL-02: Add sdk-plc-toolkit as submodule — After SDK TOOL-01 is done, add to toolkit/ for PLC data recording/parsing/plotting.

## Completed
- [x] TEST-01: Add automated test suites across all services — E2E test infrastructure merged (2026-02-26)
- [x] FEAT-03: Create integrated testing suite — Cross-service E2E tests (2026-02-26)
- [x] FEAT-01: Implement full data processing pipeline — data-processing service operational in production
- [x] SEC-02: Remove eval() usage — DM codebase confirmed no eval() calls (SF/VK issue, not DM)
- [x] DOC-01: Create architecture documentation — Knowledge base `produtos/diemaster/arquitetura.md` (2026-04-03)
- [x] DOC-02: Create deployment runbook — Knowledge base `operacoes/` + `deploys/gm-sjc-01001.md` (2026-04-03)
- [x] CICD-02: Cloud Build validation steps — Moved to `general.md` as cross-product task
