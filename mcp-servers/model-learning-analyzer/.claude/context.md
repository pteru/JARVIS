# Model Learning Analyzer

## Purpose
Analyzes dispatch history to compute per-model performance metrics, generates data-driven suggestions for model configuration improvements, and applies approved changes to the model routing config. Implements a feedback loop: dispatches are analyzed for success rates by complexity and keyword, underperforming or over-provisioned models are flagged, and suggestions can be applied or rejected with full audit logging.

## MCP Tools
- **analyze_model_performance** — Analyze dispatches.json to compute per-model success rates, token usage, and execution times grouped by complexity and task keywords; writes results to model-learning.json
- **suggest_model_rules** — Read learning data and generate suggestions: underperforming models (upgrade), over-provisioned models (downgrade Opus to Sonnet), and missing keyword rules; returns a markdown report
- **apply_model_suggestion** — Apply a specific suggestion to models.json config (requires confidence >= 70%); creates a backup before modifying
- **reject_model_suggestion** — Mark a suggestion as rejected in model-learning.json with an optional reason

## Tech Stack
- Node.js (ESM), @modelcontextprotocol/sdk, crypto (for suggestion UUIDs)
- Uses `ORCHESTRATOR_HOME` from `../lib/config-loader.js`

## Configuration
- Dispatch log: `logs/dispatches.json` (source data)
- Learning data: `logs/model-learning.json` (analysis results and suggestions)
- Models config: `config/orchestrator/models.json` (target for applied suggestions)
- Change log: `logs/model-config-changes.log` (audit trail)

## Integration Points
- Reads dispatch records written by the task-dispatcher MCP server
- Modifies the same models.json that task-dispatcher uses for model selection
- Self-improvement-miner also analyzes model routing but at a higher level

## Key Files
- `index.js` — Single-file server with performance analysis, suggestion generation, and config modification logic
