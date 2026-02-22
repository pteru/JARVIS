---
name: system-cleanup
description: Run JARVIS system health checks — detect stale paths, gitignore gaps, report accumulation, and more
---

# System Cleanup — JARVIS Health Check

Run the automated system health check and display the results:

```bash
bash /home/teruel/JARVIS/scripts/system-health-check.sh
```

The script runs 12 checks and produces a scored report (0-100):

| Check | What it verifies |
|-------|-----------------|
| CHECK_01 STALE_PATHS | No `claude-orchestrator` references in scripts/MCP/setup |
| CHECK_02 GITIGNORE_GAPS | `.gitignore` has all expected patterns (.venv, __pycache__, .env) |
| CHECK_03 REPORT_ACCUMULATION | VK health analysis files not exceeding 50 |
| CHECK_04 LOG_SIZES | No log files over 10 MB |
| CHECK_05 UNTRACKED_COUNT | Untracked files below 200 |
| CHECK_06 NODE_DEDUP | npm workspaces configured for MCP servers |
| CHECK_07 UNUSED_MCP | All MCP servers referenced by hooks/skills/scripts |
| CHECK_08 CONTEXT_STUBS | Less than 30% of context.md files are stubs |
| CHECK_09 WORKSPACE_TYPES | Less than 30% of workspace types are "unknown" |
| CHECK_10 MEMORY_HEALTH | CLAUDE.md under 100 lines |
| CHECK_11 CONSOLIDATION_LAG | VK consolidation is current (no files >7 days old) |
| CHECK_12 HOOK_MATCHERS | All hook matchers reference valid MCP servers |

## Reports

- Latest: `reports/system-health/latest.md`
- History: `reports/system-health/health-YYYY-MM-DD.md`
- Retention: 12 weeks

## Automated Schedule

Runs weekly via cron (Sundays at 21:00). To run manually:

```bash
# Interactive — prints report to stdout
bash /home/teruel/JARVIS/scripts/system-health-check.sh

# Quiet — prints only the report path (for scripting)
bash /home/teruel/JARVIS/scripts/system-health-check.sh --quiet
```

## After Running

Review the report. For any FAIL or WARN items, the report includes specific remediation commands. Common fixes:

- **Stale paths**: `grep -rl 'claude-orchestrator' scripts/ mcp-servers/` then update
- **Report accumulation**: `scripts/vk-health/cleanup-reports.sh`
- **Context stubs**: `node scripts/populate-workspace-metadata.mjs`
- **Workspace types**: `node scripts/populate-workspace-metadata.mjs`
- **CLAUDE.md bloat**: Extract to MEMORY.md and `docs/lessons-learned.md`
