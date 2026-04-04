# SpotFusion Backlog

## High Priority
- [ ] [complex] SEC-01: Remove all hardcoded credentials from codebase — 169 files affected. `<sparkeyes-password>` in Redis clients; `<skm-password>` in YAML configs. Rotate and use env vars.
- [ ] [complex] SEC-02: Replace all eval() calls with safe alternatives — 15 services with eval() in Ilog/log.py:26. Arbitrary code execution risk. Replace with json.loads().
- [ ] [complex] SEC-03: Fix bare except clauses across all services — 98 bare except: clauses. Catches SystemExit/KeyboardInterrupt silently.
- [ ] [complex] QUAL-01: Consolidate duplicated utility modules into shared SDK library — Ilog/ (15 copies), Icache/ (60+ copies), Ibroker/ (4 copies), pylogix (4 copies). ~2,000+ redundant lines.
- [ ] [medium] GIT-01: Fix upstream tracking and establish branch strategy — origin/master upstream gone. Only 2 commits on some submodules. 23 untracked dirs.
- [ ] [medium] CICD-01: Add testing and security scanning to Cloud Build — Build only does build, tag, push. No tests, no bandit/trivy scans.

## Medium Priority
- [ ] [medium] OPT-01: Clean repository (venvs, pycache, large artifacts) — 42 GB repo. 45,365 pyc/pycache entries. Target: less than 2 GB.
- [ ] [medium] OPT-02: Replace blocking I/O with async patterns — All services use sync I/O with sleep() waits. No connection pooling.
- [ ] [medium] INFRA-01: Add Docker healthchecks and service dependencies — No healthchecks. plc_connector.py:122 always returns True (TODO).
- [ ] [medium] INFRA-02: Implement centralized logging and monitoring — Custom Ilog writes to Redis. No aggregation, no metrics, no tracing.
- [ ] [medium] INFRA-04: Create Dockerfiles for all services — Only 1 service (image-server) has a Dockerfile. 20+ services missing.
- [ ] [medium] QUAL-03: Add input validation for PLC and camera parameters — PLC tags, camera settings, Redis data accepted without validation.
- [ ] [medium] QUAL-05: Add requirements.txt with version pinning to all services — Only get-data has requirements.txt. 22 services missing. Risk of dependency drift.
- [ ] [complex] DS-01: Resolve data science TODOs and stabilize training — 11 TODOs in search_model.py: config errors, bugs, missing augmentation.

## Low Priority
- [ ] [simple] TOOL-01: Document and improve toolkit utilities — 5 toolkit dirs lack READMEs and input validation.
- [ ] [simple] INFRA-03: Remove privileged container mode where unnecessary — Some services run privileged: true. Use --device instead.

## Completed
- [x] TEST-01: Establish automated test framework and CI test gates — E2E infrastructure merged (2026-02-26)
- [x] QUAL-02: Fix directory naming typo (camera-acquisiiton) — Confirmed fixed: `camera-acquisition/` correctly spelled
- [x] QUAL-04: Pin all Python dependency versions — Moved to QUAL-05 (requirements.txt creation is prerequisite)
- [x] DOC-01: Create architecture documentation — Knowledge base `produtos/spotfusion/arquitetura.md` (2026-04-03)
- [x] DOC-02: Create deployment and onboarding documentation — Knowledge base `operacoes/` runbooks (2026-04-03)
- [x] CICD-02: Cloud Build validation steps — Moved to `general.md` as cross-product task
