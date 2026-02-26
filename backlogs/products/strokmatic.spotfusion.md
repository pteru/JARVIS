# SpotFusion Backlog

## High Priority
- [ ] [complex] SEC-01: Remove all hardcoded credentials from codebase — 31+ occurrences of SparkEyes@@2022 in Redis clients; skm@@2022 in YAML configs.
- [ ] [complex] SEC-02: Replace all eval() calls with safe alternatives — 60+ eval() instances across all services. Arbitrary code execution risk.
- [ ] [complex] SEC-03: Fix bare except clauses across all services — 88 bare except: clauses, catches SystemExit/KeyboardInterrupt silently.
- [x] - [ ] [complex] TEST-01: Establish automated test framework and CI test gates — 6 ad-hoc test files, no pytest config, no CI test execution. (Completed: 2026-02-26)
- [ ] [complex] QUAL-01: Consolidate duplicated utility modules into shared library — Ilog/, Icache/, Ibroker/, Ineural/ copied in 8+ services. ~2,000+ redundant lines.
- [ ] [simple] QUAL-02: Fix directory naming typo (camera-acquisiiton) — Double 'i' in directory name. Update all references in docker-compose, CI, docs.
- [ ] [medium] GIT-01: Fix upstream tracking and establish branch strategy — origin/master upstream gone. Only 2 commits. 23 untracked dirs with submodules.
- [ ] [medium] CICD-01: Add testing and security scanning to Cloud Build — Build only does build, tag, push. No tests, no bandit/trivy scans.
- [ ] [medium] DOC-01: Create root-level README and architecture documentation — No README, /architecture/ unused. Need system diagram + message flow docs.
- [ ] [medium] DOC-02: Create deployment and onboarding documentation — No setup guide. ZeroTier VPN docs scattered. No troubleshooting guide.

## Medium Priority
- [ ] [medium] OPT-01: Clean repository (venvs, pycache, large artifacts) — 42 GB repo. 45,365 pyc/pycache entries. Target: less than 2 GB.
- [ ] [medium] OPT-02: Replace blocking I/O with async patterns — All services use sync I/O with sleep() waits. No connection pooling.
- [ ] [medium] INFRA-01: Add Docker healthchecks and service dependencies — No healthchecks. plc_connector.py:122 always returns True (TODO).
- [ ] [medium] INFRA-02: Implement centralized logging and monitoring — Custom Ilog writes to Redis. No aggregation, no metrics, no tracing.
- [ ] [medium] QUAL-03: Add input validation for PLC and camera parameters — PLC tags, camera settings, Redis data accepted without validation.
- [ ] [complex] DS-01: Resolve data science TODOs and stabilize training — 11 TODOs in search_model.py: config errors, bugs, missing augmentation.

## Low Priority
- [ ] [simple] TOOL-01: Document and improve toolkit utilities — 5 toolkit dirs lack READMEs and input validation.
- [ ] [simple] INFRA-03: Remove privileged container mode where unnecessary — Some services run privileged: true. Use --device instead.
- [ ] [simple] QUAL-04: Pin all Python dependency versions — requirements.txt files lack version pins. Add pip-audit to CI.
