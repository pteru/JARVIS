# Self-Improvement Miner

## Purpose
Runs analyzers on orchestrator operational data (dispatch logs, workspace health, model routing) to discover patterns, generate insights, and propose configuration upgrades. Produces comprehensive self-improvement reports and can apply approved proposals to orchestrator config files.

## MCP Tools
- **analyze_patterns** — Run all three analyzers (dispatch patterns, workspace health, model routing) and return insights, top keywords, misroutes, over-provisioned models, and upgrade proposals
- **generate_meta_report** — Generate a comprehensive markdown self-improvement report and save it to the reports directory
- **apply_proposal** — Apply a specific upgrade proposal to orchestrator configuration; supports dry-run mode to preview changes before applying

## Tech Stack
- Node.js (ESM), @modelcontextprotocol/sdk
- Uses `ORCHESTRATOR_HOME` from `../lib/config-loader.js`

## Configuration
- Self-improvement config: `config/self-improvement.json` (auto_apply, min_dispatches_for_proposals)
- Reads dispatch logs: `logs/dispatches.json`
- Reads workspace config: `config/orchestrator/workspaces.json`
- Reports output: `reports/self-improvement/`

## Integration Points
- Reads dispatch data written by task-dispatcher
- Analyzes workspace health across all configured workspaces
- Proposals modify orchestrator config files (models.json, workspaces.json)
- Model-learning-analyzer provides complementary per-model analysis

## Key Files
- `index.js` — Main server with tool handlers and analyzer orchestration
- `analyzers/dispatch-patterns.js` — Analyzes dispatch frequency, model usage, keyword distribution
- `analyzers/workspace-health.js` — Evaluates workspace health scores
- `analyzers/model-routing.js` — Identifies misroutes and over-provisioned model assignments
- `reporters/meta-report.js` — Generates the comprehensive markdown report
