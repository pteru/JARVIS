import fs from "fs/promises";
import path from "path";

/**
 * Generate a markdown meta-report from analysis results.
 */
export async function generateMetaReport(orchestratorHome, analysis) {
  const { patterns, health, routing } = analysis;

  const lines = [];
  const now = new Date().toISOString().split("T")[0];

  lines.push(`# Self-Improvement Report - ${now}`);
  lines.push("");

  // Executive Summary
  lines.push("## Executive Summary");
  lines.push("");
  lines.push(`- **Total dispatches analyzed**: ${patterns.total}`);
  lines.push(`- **Workspaces tracked**: ${Object.keys(health).length}`);
  lines.push(`- **Misroutes detected**: ${routing.misroutes.length}`);
  lines.push(`- **Over-provisioned dispatches**: ${routing.overProvisioned.length}`);
  lines.push(`- **Upgrade proposals**: ${routing.proposals.length}`);
  lines.push("");

  // Key Insights
  lines.push("## Key Insights");
  lines.push("");
  const allInsights = [
    ...patterns.insights,
    ...routing.insights,
  ];
  if (allInsights.length === 0) {
    lines.push("No significant insights at this time.");
  } else {
    for (const insight of allInsights) {
      lines.push(`- ${insight}`);
    }
  }
  lines.push("");

  // Model Usage
  if (Object.keys(patterns.byModel).length > 0) {
    lines.push("## Model Usage");
    lines.push("");
    lines.push("| Model | Total | Success Rate | Avg Duration | Retries |");
    lines.push("|-------|-------|-------------|-------------|---------|");
    for (const [model, stats] of Object.entries(patterns.byModel)) {
      const shortModel = model.length > 30 ? model.slice(0, 27) + "..." : model;
      const dur = stats.avgDurationMs ? `${(stats.avgDurationMs / 1000).toFixed(1)}s` : "N/A";
      lines.push(`| ${shortModel} | ${stats.total} | ${stats.successRate} | ${dur} | ${stats.retries} |`);
    }
    lines.push("");
  }

  // Workspace Health
  if (Object.keys(health).length > 0) {
    lines.push("## Workspace Health");
    lines.push("");
    lines.push("| Workspace | Score | Status | Pending | Completed | Recent Activity |");
    lines.push("|-----------|-------|--------|---------|-----------|----------------|");
    for (const [name, data] of Object.entries(health)) {
      lines.push(`| ${name} | ${data.healthScore}/100 | ${data.healthLabel} | ${data.backlogPending || 0} | ${data.backlogCompleted || 0} | ${data.changelogRecentDays || 0} days |`);
    }
    lines.push("");
  }

  // Top Keywords
  if (patterns.topKeywords.length > 0) {
    lines.push("## Top Task Keywords");
    lines.push("");
    for (const kw of patterns.topKeywords) {
      lines.push(`- **${kw.word}**: ${kw.count} occurrences`);
    }
    lines.push("");
  }

  // Upgrade Proposals
  lines.push("## Upgrade Proposals");
  lines.push("");
  if (routing.proposals.length === 0) {
    lines.push("No proposals at this time. Model routing is performing well.");
  } else {
    for (let i = 0; i < routing.proposals.length; i++) {
      const p = routing.proposals[i];
      lines.push(`### Proposal ${i + 1}: ${p.type}`);
      lines.push("");
      lines.push(p.description);
      lines.push("");
      if (p.config_file) lines.push(`- **Config file**: ${p.config_file}`);
      if (p.change) lines.push(`- **Suggested change**: \`${JSON.stringify(p.change)}\``);
      lines.push("");
    }
  }

  // Recommended Actions
  lines.push("## Recommended Actions");
  lines.push("");
  const actions = [];
  if (routing.misroutes.length > 0) {
    actions.push("Review misrouted dispatches and consider updating model routing rules");
  }
  if (routing.overProvisioned.length > 0) {
    actions.push("Add complexity guards to prevent over-provisioning expensive models");
  }
  const needsAttention = Object.entries(health).filter(([, d]) => d.healthLabel === "needs-attention");
  if (needsAttention.length > 0) {
    actions.push(`Address workspaces needing attention: ${needsAttention.map(([n]) => n).join(", ")}`);
  }
  if (patterns.total === 0) {
    actions.push("Start dispatching tasks to build up analysis data");
  }
  if (actions.length === 0) {
    actions.push("System is operating well. Continue monitoring.");
  }
  for (const action of actions) {
    lines.push(`- [ ] ${action}`);
  }
  lines.push("");

  const report = lines.join("\n");

  // Write report to file
  const reportsDir = path.join(orchestratorHome, "reports", "self-improvement");
  await fs.mkdir(reportsDir, { recursive: true });
  const reportPath = path.join(reportsDir, `report-${now}.md`);
  await fs.writeFile(reportPath, report, "utf-8");

  return { reportPath, report };
}
