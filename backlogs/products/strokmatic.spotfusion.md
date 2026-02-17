# SpotFusion Backlog

## High Priority
- [ ] [complex] SEC-01: Remove all hardcoded credentials from codebase — 31+ occurrences of SparkEyes@@2022 in Redis clients; skm@@2022 in YAML configs.
- [ ] [complex] SEC-02: Replace all eval() calls with safe alternatives — 60+ eval() instances across all services. Arbitrary code execution risk.
- [ ] [complex] SEC-03: Fix bare except clauses across all services — 88 bare except: clauses, catches SystemExit/KeyboardInterrupt silently.
- [ ] [complex] TEST-01: Establish automated test framework and CI test gates — 6 ad-hoc test files, no pytest config, no CI test execution.
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

## Product Features
- [ ] [complex] FEAT-01: Finish and deploy config-wizard — Complete the configuration wizard app, test all flows, and deploy to production.
- [ ] [complex] FEAT-02: Automatically adjust WTC schedule during production — Implement adaptive weld timer controller scheduling that auto-adjusts weld parameters based on real-time production feedback.

## Toolkit Cleanup & SDK Migration
- [ ] [simple] TOOL-01: Archive plant-data-parser → sf/legacy/ — One-off script with hardcoded paths.
- [ ] [simple] TOOL-02: Delete spotfusion-toolkit/main_app — Minimal Flask stub, unused.
- [ ] [medium] TOOL-03: Migrate PLC tools to sdk-plc-toolkit — After SDK TOOL-01 is done, replace 5 PLC tools in spotfusion-toolkit (plc-recorder, plc-reader-class3, plc-log-parser, plc-record-cleaner, plc-record-plotter) with sdk-plc-toolkit submodule. Keep IO table JSONs and tag mappings as local config.
- [ ] [medium] TOOL-04: Migrate Redis tools to sdk-redis-toolkit — After SDK TOOL-04 is done, replace spotfusion-toolkit/redis-recorder + redis-saver with sdk-redis-toolkit submodule.
- [ ] [medium] TOOL-05: Migrate welding tools to sdk-welding-toolkit — After SDK TOOL-07 is done, replace view-r-extractor + raft_studies with sdk-welding-toolkit submodule.
- [ ] [medium] TOOL-06: Migrate image-analyzer to sdk-image-toolkit — After SDK TOOL-06 is done, replace spotfusion-toolkit/image-analyzer with sdk-image-toolkit submodule.
- [ ] [medium] TOOL-07: Migrate deploy-toolkit to sdk-deployment-toolkit — After SDK TOOL-02 is done, refactor spotfusion-deploy-toolkit Vue wizard to call sdk-deployment-toolkit core for generation/validation.

## Low Priority
- [ ] [simple] INFRA-03: Remove privileged container mode where unnecessary — Some services run privileged: true. Use --device instead.
- [ ] [simple] QUAL-04: Pin all Python dependency versions — requirements.txt files lack version pins. Add pip-audit to CI.
