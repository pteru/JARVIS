# General Backlog (Cross-Product)

## High Priority
- [ ] [COMPLEX] CICD-02: Add Cloud Build validation steps (lint+test) to all services — Prepend ruff lint + pytest steps to Python, npm lint+test+build to NestJS/Angular. Apply across DM, SF, VK. Skip C++ services. Spec: `plans/general-cloudbuild.md`

## Medium Priority
- [ ] [medium] CICD-01: Update Cloud Build links for migrated GitHub repos — After GSR→GitHub migration, cloudbuild.yaml files still reference old repo URLs. Update across VK, SF, DM.
- [ ] [medium] SEC-CROSS-01: Implement credential scanning in CI — Add pre-commit hook or Cloud Build step to detect hardcoded passwords before they reach git. All 3 products affected (180+ files currently).
