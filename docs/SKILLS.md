# Claude Orchestrator - MCP Server Skills

## backlog-manager
Manages per-workspace task backlogs backed by GitHub Issues (local JSON cache at `data/backlog-cache/`).

### Tools
| Tool | Description | Required Args |
|------|-------------|---------------|
| `list_backlog_tasks` | List open backlog GitHub issues for a workspace (cached) | `workspace` |
| `add_backlog_task` | Create a backlog GitHub issue (complexity + priority labels) via `gh` | `workspace`, `task`, `priority` |
| `complete_backlog_task` | Close a backlog issue by number or unique title substring via `gh` | `workspace`, `task_pattern` (issue # or title substring) |

### Data Format
Issues on GitHub with `backlog` label. Cache at `data/backlog-cache/<workspace>.json`, refreshed by `orchestrator.sh refresh-backlog-cache`.

---

## changelog-writer
Manages changelogs in Keep a Changelog format.

### Tools
| Tool | Description | Required Args |
|------|-------------|---------------|
| `add_changelog_entry` | Add entry under date/section | `workspace`, `section`, `entry` |
| `get_changelog` | Get full changelog content | `workspace` |
| `get_recent_changes` | Get recent entries across workspaces | _(none, optional: days, workspace)_ |

### Data Format
Changelogs at `changelogs/<workspace>-changelog.md`. Sections: Added, Changed, Fixed, Removed under date headers.

---

## workspace-analyzer
Analyzes workspace health and suggests improvements.

### Tools
| Tool | Description | Required Args |
|------|-------------|---------------|
| `analyze_workspace_health` | Check workspace for best practices | `workspace_path` |
| `suggest_tasks` | Generate task suggestions based on analysis | `workspace_path` |
| `get_workspace_stats` | Get file counts, git status, etc. | `workspace_path` |

---

## task-dispatcher
Dispatches tasks to workspaces with model selection.

### Tools
| Tool | Description | Required Args |
|------|-------------|---------------|
| `dispatch_task` | Dispatch a task with model auto-selection | `workspace`, `task` |
| `get_task_status` | Check status of a dispatch by ID | `task_id` |
| `list_dispatched_tasks` | List dispatches with optional filters | _(none, optional: workspace, status, limit)_ |

### Model Selection
- **simple** → claude-haiku-4-5 (formatting, typos, lint fixes)
- **medium** → claude-sonnet-4-5 (features, bug fixes)
- **complex** → claude-opus-4-6 (refactoring, architecture, security)

---

## report-generator
Generates activity reports from changelogs and dispatches.

### Tools
| Tool | Description | Required Args |
|------|-------------|---------------|
| `generate_daily_report` | Daily activity report across workspaces | _(optional: date)_ |
| `generate_weekly_report` | Weekly summary report | _(optional: week_ending)_ |
| `generate_workspace_report` | Detailed report for one workspace | `workspace` |

### Output
Reports saved to `reports/daily/` and `reports/weekly/`.
