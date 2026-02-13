# Claude Orchestrator - Self-Improvement Backlog

Ideas for new features, skills, and integrations. Full specs live in `backlog/`.

---

## New Skills / MCP Servers

| Item | Status | Spec |
|------|--------|------|
| ClickUp Connector | Idea | [backlog/clickup-connector.md](backlog/clickup-connector.md) |
| Changelog Reviewer | Idea | [backlog/changelog-reviewer.md](backlog/changelog-reviewer.md) |
| Orchestrator Dashboard | Idea | [backlog/orchestrator-dashboard.md](backlog/orchestrator-dashboard.md) |

---

## Improvements

| Item | Status | Notes |
|------|--------|-------|
| Backlog pull/reconcile | Idea | When a collaborator edits `<workspace>/.claude/backlog.md` directly (e.g. via a PR), pull those changes back into the central orchestrator backlog. Needs a merge/conflict strategy. Could run as a step at the start of each daily orchestrator run, or as a manual `sync_backlog` tool in the backlog-manager MCP. |
