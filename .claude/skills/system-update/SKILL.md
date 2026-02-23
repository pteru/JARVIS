---
name: system-update
description: Consolidated system update — refresh data, update libraries, rebuild Docker images
argument-hint: "[--full | --data | --libs | --docker | --ai | --dry-run | --skip TARGET | --only TARGET]"
---

# System Update — JARVIS Full Refresh

Run the consolidated system update script and present the results. Pass arguments directly:

```bash
bash /home/teruel/JARVIS/scripts/system-update.sh {ARGUMENTS}
```

If no arguments provided, run with default mode (data + libs groups).

## Targets Reference

The script organizes 19 update targets into 4 groups:

### data — Operational data refresh

| Target | What it does |
|--------|-------------|
| `fetch-remotes` | Git fetch all workspace remotes (30s timeout each) |
| `dirty-scan` | Scan all workspaces for uncommitted changes, sync status |
| `access-matrix` | Rebuild GitHub permission matrix for strokmatic org |
| `email-ingest` | Fetch new emails via IMAP, classify with AI |
| `fetch-prs` | Refresh open PR list across all repos |
| `context-update` | Update context.md files and workspace types in workspaces.json |
| `vk-health` | Run VK health pipeline for deployment 03002 |
| `system-health` | Run 12-check system health scan |

### libs — Package & library updates

| Target | What it does |
|--------|-------------|
| `apt` | `apt-get update && upgrade` (requires sudo) |
| `claude-cli` | Update Claude Code CLI (global npm) |
| `mcp-servers` | `npm update` in MCP workspace (12 servers) |
| `meeting-assistant` | `npm update` for standalone meeting-assistant |
| `dashboard` | `npm update` for orchestrator dashboard |
| `python-tools` | `pip install --upgrade` in tools/.venv |

### ai — AI-powered tasks (slow, uses Claude API credits)

| Target | What it does |
|--------|-------------|
| `pr-review` | AI review all open, non-draft PRs (parallel) |

### docker — Docker image rebuilds (slow)

| Target | What it does |
|--------|-------------|
| `sandbox` | Rebuild jarvis-sandbox:latest image |
| `pmo-dashboard` | Rebuild PMO dashboard with docker-compose |

## Usage Modes

```bash
# Default: data + libs
/system-update

# Everything
/system-update --full

# Just refresh data (no package updates)
/system-update --data

# Just update packages
/system-update --libs

# Preview what would run
/system-update --dry-run

# Skip slow targets
/system-update --skip apt --skip vk-health

# Run only specific targets
/system-update --only fetch-remotes --only mcp-servers --only claude-cli

# Combine groups
/system-update --data --docker
```

## After Running

1. Read `reports/system-update/latest.md` and present the summary table to the user.
2. If any targets failed, show the failure list and suggest checking the log file.
3. Call the `check_telegram_inbox` MCP tool to poll Telegram messages (this target cannot run from bash).
4. If `dirty-scan` ran, read `reports/workspace-git-analysis.md` and highlight any dirty repos.
5. If `system-health` ran, read `reports/system-health/latest.md` and report the health score.

## Reports

- Latest: `reports/system-update/latest.md`
- History: `reports/system-update/update-YYYY-MM-DD_HH-MM-SS.md`
- Logs: `logs/system-update-YYYY-MM-DD_HH-MM-SS.log`
