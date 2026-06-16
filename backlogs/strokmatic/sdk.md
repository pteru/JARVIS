# SDK Backlog — RETIRED 2026-06-16

> **Superseded by GitHub Issues**, fanned out across the SDK-family repos.
> Primary source of truth: **[strokmatic/sdk · open `backlog` issues](https://github.com/strokmatic/sdk/issues?q=is%3Aopen+label%3Abacklog)**
>
> Do **not** add tasks here — open a GitHub issue in the relevant SDK repo instead.
> This file is intentionally free of `- [ ]` lines so the `process_backlogs` dispatch loop
> and the dashboard summary treat it as empty.

## Migration record

14 open tasks were triaged on 2026-06-16 (full evidence: [`reports/backlog-reconciliation-2026-06-16.md`](../../reports/backlog-reconciliation-2026-06-16.md)):

| Task | Outcome | Lands in |
|---|---|---|
| LIB-03, LIB-04, TOOL-01/02/03/04/06/07 (8 "new-repo" tasks) | **Migrated** (consolidated) | `strokmatic/sdk` **epic #1** |
| FEAT-01 — OpENer EIP connector | **Migrated** | `strokmatic/strokmatic-eip` #3 |
| FEAT-02 — advanced logging / observability | **Migrated** | `strokmatic/sdk-observability-stack` #1 |
| TOOL-05 — message poster consolidation | **Migrated** | `strokmatic/sdk-message-poster` #1 |
| LIB-01 — shared logging lib | **Done** | `strokmatic/sdk-lib-logging` (code complete; pending `git init` + push) |
| LIB-02 — shared RabbitMQ lib | **Done** | already published |
| INFRA-01 — branch protection on `develop` | **Op note** | GitHub org setting, not a code issue — configure directly |

The full original task list is preserved in git history prior to this commit.
