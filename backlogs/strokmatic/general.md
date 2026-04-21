# General Backlog (Cross-Product)

## High Priority
- [x] [simple] KH-DEPLOY: Deploy knowledge-hub to server (192.168.15.2). Done 2026-04-21. Port 8093 (8091+8092 taken), systemd via nvm. Health endpoint returns ok. (strokmatic/infra#11, #19)
- [x] [simple] KH-INGEST: Initial knowledge-hub ingestion. Done 2026-04-21 — 140 chunks, 23 entities (10 emails, 5 meetings, 22 drive indexes). Cron `5 * * * *` active.
- [x] [simple] KH-DASHBOARD-ROUTE: Expose knowledge-hub dashboard via nginx. Done 2026-04-21 — added `knowledge.strokmatic.local` server block to /etc/nginx/sites-enabled/jarvis-gateway. To use: add `192.168.15.2 knowledge.strokmatic.local kh.strokmatic.local` to local /etc/hosts. Test with `curl -H "Host: knowledge.strokmatic.local" http://192.168.15.2/health`.
- [ ] [simple] SYNC-REENABLE: Re-enable github-clickup-sync cron on server. **Gated on user approval.** syncClickUpToGitHub stays DISABLED. Only syncGitHubToClickUp + comment sync.
- [ ] [COMPLEX] CICD-02: Add Cloud Build validation steps (lint+test) to all services — Prepend ruff lint + pytest steps to Python, npm lint+test+build to NestJS/Angular. Apply across DM, SF, VK. Skip C++ services. Spec: `plans/general-cloudbuild.md`

## Medium Priority
- [ ] [simple] KH-MIGRATE: Disable context-refresh cron after knowledge-hub E2E validation. Remove cron entries on server. Knowledge-hub replaces context-refresh.
- [ ] [medium] CICD-01: Update Cloud Build links for migrated GitHub repos — After GSR→GitHub migration, cloudbuild.yaml files still reference old repo URLs. Update across VK, SF, DM.
- [ ] [medium] SEC-CROSS-01: Implement credential scanning in CI — Add pre-commit hook or Cloud Build step to detect hardcoded passwords before they reach git. All 3 products affected (180+ files currently).
