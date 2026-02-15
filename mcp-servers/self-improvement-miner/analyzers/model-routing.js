import fs from "fs/promises";
import path from "path";

/**
 * Cross-reference dispatch history with model routing rules to detect
 * misroutes and over-provisioning.
 */
export async function analyzeModelRouting(orchestratorHome) {
  const dispatchPath = path.join(orchestratorHome, "logs", "dispatches.json");
  const modelsPath = path.join(orchestratorHome, "config", "orchestrator", "models.json");

  let dispatches;
  try {
    dispatches = JSON.parse(await fs.readFile(dispatchPath, "utf-8"));
  } catch {
    return { proposals: [], misroutes: [], overProvisioned: [], insights: ["No dispatch history found."] };
  }

  let modelsConfig;
  try {
    modelsConfig = JSON.parse(await fs.readFile(modelsPath, "utf-8"));
  } catch {
    return { proposals: [], misroutes: [], overProvisioned: [], insights: ["No models.json config found."] };
  }

  if (!Array.isArray(dispatches) || dispatches.length === 0) {
    return { proposals: [], misroutes: [], overProvisioned: [], insights: ["No dispatches to analyze."] };
  }

  const haikuModel = modelsConfig.task_complexity?.simple?.model || "haiku";
  const sonnetModel = modelsConfig.task_complexity?.medium?.model || "sonnet";
  const opusModel = modelsConfig.task_complexity?.complex?.model || "opus";

  const misroutes = [];
  const overProvisioned = [];
  const proposals = [];

  for (const d of dispatches) {
    const model = (d.model || "").toLowerCase();
    const isHaiku = model.includes("haiku");
    const isSonnet = model.includes("sonnet");
    const isOpus = model.includes("opus");

    // Detect Haiku failures -> suggest upgrade to Sonnet
    if (isHaiku && d.status === "failed") {
      misroutes.push({
        dispatchId: d.id,
        workspace: d.workspace,
        task: d.task,
        currentModel: d.model,
        suggestedModel: sonnetModel,
        reason: "Haiku failed on this task; Sonnet may handle it better",
      });
    }

    // Detect Opus used for simple/quick tasks -> over-provisioning
    if (isOpus && d.complexity === "simple") {
      overProvisioned.push({
        dispatchId: d.id,
        workspace: d.workspace,
        task: d.task,
        currentModel: d.model,
        suggestedModel: sonnetModel,
        reason: "Opus used for simple-complexity task; Sonnet would suffice",
      });
    }

    // Detect Opus with very short duration -> over-provisioning
    if (isOpus && d.duration_ms && d.duration_ms < 30000) {
      overProvisioned.push({
        dispatchId: d.id,
        workspace: d.workspace,
        task: d.task,
        currentModel: d.model,
        suggestedModel: sonnetModel,
        reason: `Opus completed in ${(d.duration_ms / 1000).toFixed(1)}s; likely over-provisioned`,
      });
    }

    // Detect Sonnet failures on complex tasks -> suggest Opus
    if (isSonnet && d.status === "failed" && d.complexity === "complex") {
      misroutes.push({
        dispatchId: d.id,
        workspace: d.workspace,
        task: d.task,
        currentModel: d.model,
        suggestedModel: opusModel,
        reason: "Sonnet failed on complex task; Opus may be needed",
      });
    }
  }

  // Generate proposals from patterns
  const haikuFailures = misroutes.filter((m) => m.currentModel.includes("haiku")).length;
  const opusOverProvisions = overProvisioned.length;

  if (haikuFailures >= 2) {
    proposals.push({
      type: "rule_change",
      description: `${haikuFailures} Haiku failures detected. Consider upgrading default simple model to Sonnet or adding keyword rules.`,
      config_file: "config/orchestrator/models.json",
      change: { path: "task_complexity.simple.model", suggested: sonnetModel },
    });
  }

  if (opusOverProvisions >= 2) {
    proposals.push({
      type: "rule_change",
      description: `${opusOverProvisions} over-provisioned Opus dispatches. Consider adding complexity guards.`,
      config_file: "config/orchestrator/models.json",
      change: { path: "rules", suggested: "Add rule: if complexity=simple, never use opus" },
    });
  }

  const insights = [];
  if (misroutes.length > 0) insights.push(`Found ${misroutes.length} potential misroutes`);
  if (overProvisioned.length > 0) insights.push(`Found ${overProvisioned.length} over-provisioned dispatches`);
  if (proposals.length > 0) insights.push(`Generated ${proposals.length} upgrade proposals`);
  if (insights.length === 0) insights.push("Model routing looks healthy. No issues detected.");

  return { proposals, misroutes, overProvisioned, insights };
}
