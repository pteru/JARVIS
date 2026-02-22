#!/usr/bin/env node
/**
 * Standalone self-improvement report generator.
 * Imports analyzers directly from the MCP server and writes the report.
 * Called by scripts/weekly-self-improvement.sh via cron.
 */
import path from "path";
import { analyzeDispatchPatterns } from "../mcp-servers/self-improvement-miner/analyzers/dispatch-patterns.js";
import { analyzeWorkspaceHealth } from "../mcp-servers/self-improvement-miner/analyzers/workspace-health.js";
import { analyzeModelRouting } from "../mcp-servers/self-improvement-miner/analyzers/model-routing.js";
import { generateMetaReport } from "../mcp-servers/self-improvement-miner/reporters/meta-report.js";

const ORCHESTRATOR_HOME = process.env.ORCHESTRATOR_HOME || path.join(process.env.HOME, "JARVIS");

async function main() {
  console.error("[self-improvement] Running analyzers...");

  const [patterns, health, routing] = await Promise.all([
    analyzeDispatchPatterns(ORCHESTRATOR_HOME),
    analyzeWorkspaceHealth(ORCHESTRATOR_HOME),
    analyzeModelRouting(ORCHESTRATOR_HOME),
  ]);

  console.error(`[self-improvement] Analysis complete — ${patterns.total} dispatches, ${Object.keys(health).length} workspaces`);

  const { reportPath } = await generateMetaReport(ORCHESTRATOR_HOME, { patterns, health, routing });
  console.error(`[self-improvement] Report saved: ${reportPath}`);
}

main().catch((err) => {
  console.error("[self-improvement] FATAL:", err.message);
  process.exit(1);
});
