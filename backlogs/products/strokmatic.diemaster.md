# DieMaster Backlog

## High Priority
- [ ] [complex] SEC-01: Remove hardcoded credentials from entire codebase — 10+ locations with `skm@@2022`, `SmartDie@@2022`. GCP JSON in repo root.
- [ ] [medium] SEC-02: Remove eval() usage in redis_handlers.py — Arbitrary code execution via Redis deserialization. Replace with json.loads/ast.literal_eval.
- [ ] [complex] FW-01: Test and stabilize firmware implementations — Both firmware branches marked "untested". Unhandled error in hub state machine (app.c:814).
- [ ] [complex] TEST-01: Add automated test suites across all services — Only backend has Jest (4 specs), database-writer has 1 parse test. Everything else: 0%.
- [ ] [medium] QUAL-01: Fix bare except clauses across legacy codebase — 5+ bare except:/except: pass in drawin_features, dashboard, sensor_config, smartdie-connect.
- [ ] [medium] QUAL-02: Deduplicate format.py across legacy services — Identical code in dashboard, enrichment, setup (3 copies). Extract to shared lib.
- [ ] [medium] GIT-01: Resolve unmerged feature branches and stale work — 8 unmerged legacy branches, 2 stalled firmware README branches.
- [ ] [complex] CICD-01: Complete CI/CD pipeline with testing and deployment — GitHub Actions for backend only. yarn/npm inconsistency. No deployment automation.
- [ ] [medium] DOC-01: Create architecture documentation — /architecture/ directory empty. No diagrams, no service interaction docs.
- [ ] [medium] DOC-02: Create deployment runbook and environment setup guide — /deployments/ and /scripts/ empty. No onboarding or setup instructions.

## Medium Priority
- [ ] [medium] INFRA-01: Implement database migration versioning — Raw SQL scripts, no Flyway/Alembic. No rollback procedures.
- [ ] [medium] INFRA-02: Add monitoring and centralized logging — No health endpoints, no centralized logs. Redis Insight only for cache.
- [ ] [medium] OPT-01: Optimize network scanning in smartdie-connect — ARP scanning full /24 every 5s with 2s timeout. ThreadPool max_workers=20.
- [ ] [medium] OPT-02: Fix cJSON O(n²) algorithm in firmware — cJSON.c:3145, noted as "horrible" in comments. Consider hash-based lookup.
- [ ] [medium] QUAL-03: Resolve all open TODOs (18 total) — Key: processing_consumer.py:49 (concentrador_id), gap_features.py:45 (Redis value).

## Product Features
- [ ] [complex] FEAT-01: Implement full data processing pipeline — End-to-end flow from sensor data ingestion through processing to database storage and API exposure.
- [ ] [complex] FEAT-02: Create mock data generator — Generate realistic sensor/die data for development and testing. Configurable profiles, batch sizes, anomaly injection.
- [ ] [complex] FEAT-03: Create integrated testing suite — Cross-service tests covering firmware → connect → processing → database → backend → frontend.

## Low Priority
- [ ] [simple] CLEAN-01: Clean up repository artifacts and organize submodules — __pycache__ tracked, empty scaffold dirs, submodule docs missing.
- [ ] [medium] TOOL-01: Refactor parse_mock_data — Add env-based config (.env file), complete parse_to_sql.py with infra-setup schema, add Click CLI (`seed_data redis|postgres|all`), add README with data model docs, add requirements.txt, remove hardcoded credentials.
- [ ] [medium] TOOL-02: Add sdk-plc-toolkit as submodule — After SDK TOOL-01 is done, add sdk-plc-toolkit to toolkit/ for PLC data recording/parsing/plotting alongside existing plc-monitor service.
