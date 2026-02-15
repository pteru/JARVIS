import fs from "fs/promises";
import path from "path";

/**
 * Analyze dispatch history for patterns in model usage, success rates,
 * durations, and task keywords.
 */
export async function analyzeDispatchPatterns(orchestratorHome) {
  const dispatchPath = path.join(orchestratorHome, "logs", "dispatches.json");

  let dispatches;
  try {
    const content = await fs.readFile(dispatchPath, "utf-8");
    dispatches = JSON.parse(content);
  } catch {
    return {
      total: 0,
      byModel: {},
      byComplexity: {},
      byWorkspace: {},
      topKeywords: [],
      insights: ["No dispatch history found. Run some tasks first."],
    };
  }

  if (!Array.isArray(dispatches) || dispatches.length === 0) {
    return {
      total: 0,
      byModel: {},
      byComplexity: {},
      byWorkspace: {},
      topKeywords: [],
      insights: ["Dispatch log is empty."],
    };
  }

  // Group by model
  const byModel = {};
  for (const d of dispatches) {
    const model = d.model || "unknown";
    if (!byModel[model]) {
      byModel[model] = { total: 0, completed: 0, failed: 0, durations: [], retries: 0 };
    }
    byModel[model].total++;
    if (d.status === "completed") byModel[model].completed++;
    if (d.status === "failed") byModel[model].failed++;
    if (d.duration_ms) byModel[model].durations.push(d.duration_ms);
    if (d.retry_count) byModel[model].retries += d.retry_count;
  }

  // Compute success rates and avg durations
  for (const model of Object.keys(byModel)) {
    const m = byModel[model];
    const decided = m.completed + m.failed;
    m.successRate = decided > 0 ? (m.completed / decided * 100).toFixed(1) + "%" : "N/A";
    m.avgDurationMs = m.durations.length > 0
      ? Math.round(m.durations.reduce((a, b) => a + b, 0) / m.durations.length)
      : null;
  }

  // Group by complexity
  const byComplexity = {};
  for (const d of dispatches) {
    const c = d.complexity || "medium";
    if (!byComplexity[c]) byComplexity[c] = { total: 0, completed: 0, failed: 0 };
    byComplexity[c].total++;
    if (d.status === "completed") byComplexity[c].completed++;
    if (d.status === "failed") byComplexity[c].failed++;
  }

  // Group by workspace
  const byWorkspace = {};
  for (const d of dispatches) {
    const w = d.workspace || "unknown";
    if (!byWorkspace[w]) byWorkspace[w] = { total: 0, completed: 0, failed: 0 };
    byWorkspace[w].total++;
    if (d.status === "completed") byWorkspace[w].completed++;
    if (d.status === "failed") byWorkspace[w].failed++;
  }

  // Extract keywords from task descriptions
  const keywordCounts = {};
  const stopWords = new Set([
    "the", "a", "an", "and", "or", "to", "in", "for", "of", "with", "on",
    "is", "it", "that", "this", "be", "as", "at", "by", "from", "not",
  ]);
  for (const d of dispatches) {
    if (!d.task) continue;
    const words = d.task.toLowerCase().match(/[a-z]{3,}/g) || [];
    for (const w of words) {
      if (stopWords.has(w)) continue;
      keywordCounts[w] = (keywordCounts[w] || 0) + 1;
    }
  }
  const topKeywords = Object.entries(keywordCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([word, count]) => ({ word, count }));

  // Generate insights
  const insights = [];
  for (const [model, stats] of Object.entries(byModel)) {
    if (stats.failed > 0 && stats.successRate !== "N/A") {
      insights.push(`Model ${model}: ${stats.successRate} success rate (${stats.failed} failures out of ${stats.completed + stats.failed} decided)`);
    }
    if (stats.retries > 0) {
      insights.push(`Model ${model}: ${stats.retries} total retries across ${stats.total} dispatches`);
    }
  }

  return {
    total: dispatches.length,
    byModel,
    byComplexity,
    byWorkspace,
    topKeywords,
    insights,
  };
}
