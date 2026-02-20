# Claude Orchestrator - MCP Server Skills

## backlog-manager
Manages per-workspace task backlogs in markdown format.

### Tools
| Tool | Description | Required Args |
|------|-------------|---------------|
| `list_backlog_tasks` | List tasks from a workspace backlog | `workspace` |
| `add_backlog_task` | Add a task with priority and complexity | `workspace`, `task`, `priority` |
| `complete_backlog_task` | Mark a task as complete by pattern match | `workspace`, `task_pattern` |

### Data Format
Backlogs stored at `backlogs/<workspace>-backlog.md` with `## High/Medium/Low Priority` sections.
Tasks: `- [ ] [COMPLEXITY] description`

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
