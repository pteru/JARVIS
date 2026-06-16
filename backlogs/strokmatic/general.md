# General (Cross-Product) Backlog — RETIRED 2026-06-16

> **Superseded by GitHub Issues.** Source of truth:
> **[strokmatic/infra · open `backlog` issues](https://github.com/strokmatic/infra/issues?q=is%3Aopen+label%3Abacklog)**
>
> Do **not** add tasks here — open a GitHub issue in `strokmatic/infra` instead.
> This file is intentionally free of `- [ ]` lines so the `process_backlogs` dispatch loop
> and the dashboard summary treat it as empty.

## Migration record

5 open tasks were triaged on 2026-06-16 (full evidence: [`reports/backlog-reconciliation-2026-06-16.md`](../../reports/backlog-reconciliation-2026-06-16.md)):

| Task | Outcome | Detail |
|---|---|---|
| SYNC-REENABLE | **Migrated** → `strokmatic/infra` | ⚠️ Gated op — `syncClickUpToGitHub` stays DISABLED; needs careful testing before enabling |
| CICD-02 — lint+test in Cloud Build | **Migrated** → `strokmatic/infra` | |
| KH-MIGRATE — disable context-refresh cron | **Migrated** → `strokmatic/infra` | |
| SEC-CROSS-01 — credential scanning in CI | **Migrated** → `strokmatic/infra` | |
| CICD-01 — update Cloud Build links | **Obsolete** | Trigger config is GCP-Console admin, not in-repo |

(The three KH-DEPLOY / KH-INGEST / KH-DASHBOARD-ROUTE items were already complete.)

The full original task list is preserved in git history prior to this commit.
