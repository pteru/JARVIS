#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

const ORCHESTRATOR_HOME =
  process.env.ORCHESTRATOR_HOME ||
  path.join(process.env.HOME, "claude-orchestrator");

class ModelLearningAnalyzerServer {
  constructor() {
    this.server = new Server(
      { name: "model-learning-analyzer", version: "1.0.0" },
      { capabilities: { tools: {} } },
    );

    this.setupToolHandlers();

    this.server.onerror = (error) => console.error("[MCP Error]", error);
    process.on("SIGINT", async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  // --- File helpers ---

  getDispatchesPath() {
    return path.join(ORCHESTRATOR_HOME, "logs", "dispatches.json");
  }

  getLearningPath() {
    return path.join(ORCHESTRATOR_HOME, "logs", "model-learning.json");
  }

  getModelsConfigPath() {
    return path.join(ORCHESTRATOR_HOME, "config", "orchestrator", "models.json");
  }

  getChangeLogPath() {
    return path.join(ORCHESTRATOR_HOME, "logs", "model-config-changes.log");
  }

  async readJson(filePath) {
    try {
      const content = await fs.readFile(filePath, "utf-8");
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  async writeJson(filePath, data) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
  }

  // --- Tool registration ---

  setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: "analyze_model_performance",
          description:
            "Analyze dispatches.json to compute per-model performance metrics grouped by complexity and task keywords. Writes results to model-learning.json.",
          inputSchema: {
            type: "object",
            properties: {
              min_sample_size: {
                type: "number",
                description: "Minimum samples to include a group (default 1)",
              },
              since_date: {
                type: "string",
                description:
                  "Only include dispatches on or after this ISO date",
              },
            },
          },
        },
        {
          name: "suggest_model_rules",
          description:
            "Read model-learning.json and generate suggestions for model configuration improvements. Returns markdown report.",
          inputSchema: {
            type: "object",
            properties: {
              min_confidence: {
                type: "number",
                description:
                  "Minimum confidence to include a suggestion (default 0.5)",
              },
            },
          },
        },
        {
          name: "apply_model_suggestion",
          description:
            "Apply a suggestion from model-learning.json to models.json config. Requires confidence >= 0.70. Creates a backup before modifying.",
          inputSchema: {
            type: "object",
            properties: {
              suggestion_id: {
                type: "string",
                description: "The suggestion ID to apply",
              },
            },
            required: ["suggestion_id"],
          },
        },
        {
          name: "reject_model_suggestion",
          description: "Mark a suggestion as rejected in model-learning.json.",
          inputSchema: {
            type: "object",
            properties: {
              suggestion_id: {
                type: "string",
                description: "The suggestion ID to reject",
              },
              reason: {
                type: "string",
                description: "Optional reason for rejection",
              },
            },
            required: ["suggestion_id"],
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      try {
        switch (name) {
          case "analyze_model_performance":
            return await this.analyzeModelPerformance(args || {});
          case "suggest_model_rules":
            return await this.suggestModelRules(args || {});
          case "apply_model_suggestion":
            return await this.applyModelSuggestion(args);
          case "reject_model_suggestion":
            return await this.rejectModelSuggestion(args);
          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error: ${error.message}` }],
          isError: true,
        };
      }
    });
  }

  // --- analyze_model_performance ---

  async analyzeModelPerformance({ min_sample_size = 1, since_date } = {}) {
    const dispatches = (await this.readJson(this.getDispatchesPath())) || [];

    let completed = dispatches.filter((d) => d.outcome != null);
    if (since_date) {
      const cutoff = new Date(since_date);
      completed = completed.filter(
        (d) => new Date(d.dispatched_at || d.timestamp || 0) >= cutoff,
      );
    }

    if (completed.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: "No completed dispatches with outcomes found.",
          },
        ],
      };
    }

    const complexityGroups = {};
    const keywordGroups = {};

    for (const d of completed) {
      const model = d.model || "unknown";
      const complexity = d.complexity || "unknown";
      const keywords = d.task_keywords || [];
      const success = d.outcome === "success" ? 1 : 0;
      const tokens = d.tokens_used || 0;
      const execTime = d.execution_time_seconds || 0;

      // Complexity group
      const cKey = `${complexity}::${model}`;
      if (!complexityGroups[cKey]) {
        complexityGroups[cKey] = {
          complexity,
          model,
          successes: 0,
          total: 0,
          total_tokens: 0,
          total_exec_time: 0,
        };
      }
      const cg = complexityGroups[cKey];
      cg.total++;
      cg.successes += success;
      cg.total_tokens += tokens;
      cg.total_exec_time += execTime;

      // Keyword groups
      for (const kw of keywords) {
        const kwKey = `${kw}::${model}`;
        if (!keywordGroups[kwKey]) {
          keywordGroups[kwKey] = {
            keyword: kw,
            model,
            successes: 0,
            total: 0,
            total_tokens: 0,
            total_exec_time: 0,
          };
        }
        const kg = keywordGroups[kwKey];
        kg.total++;
        kg.successes += success;
        kg.total_tokens += tokens;
        kg.total_exec_time += execTime;
      }
    }

    const computeMetrics = (group) => ({
      ...group,
      success_rate: group.total > 0 ? group.successes / group.total : 0,
      avg_tokens:
        group.total > 0 ? Math.round(group.total_tokens / group.total) : 0,
      avg_execution_time:
        group.total > 0
          ? Math.round((group.total_exec_time / group.total) * 100) / 100
          : 0,
      sample_size: group.total,
      confidence: Math.min(group.total / 20, 1.0),
    });

    const byComplexity = Object.values(complexityGroups)
      .filter((g) => g.total >= min_sample_size)
      .map(computeMetrics);

    const byKeyword = Object.values(keywordGroups)
      .filter((g) => g.total >= min_sample_size)
      .map(computeMetrics);

    // Preserve existing suggestions when re-analyzing
    const existing = (await this.readJson(this.getLearningPath())) || {};

    const learningData = {
      ...existing,
      last_analyzed: new Date().toISOString(),
      total_dispatches_analyzed: completed.length,
      by_complexity: byComplexity,
      by_keyword: byKeyword,
    };

    await this.writeJson(this.getLearningPath(), learningData);

    const summary = [
      `Analyzed ${completed.length} completed dispatches.`,
      `Complexity groups: ${byComplexity.length}`,
      `Keyword groups: ${byKeyword.length}`,
      `Results written to ${this.getLearningPath()}`,
    ].join("\n");

    return { content: [{ type: "text", text: summary }] };
  }

  // --- suggest_model_rules ---

  async suggestModelRules({ min_confidence = 0.5 } = {}) {
    const learning = await this.readJson(this.getLearningPath());
    if (!learning || (!learning.by_complexity && !learning.by_keyword)) {
      return {
        content: [
          {
            type: "text",
            text: "No learning data found. Run analyze_model_performance first.",
          },
        ],
      };
    }

    const suggestions = [];
    const allGroups = [
      ...(learning.by_complexity || []),
      ...(learning.by_keyword || []),
    ];

    // 1. Underperforming models: success_rate < 0.70, sample >= 8
    for (const g of allGroups) {
      if (g.success_rate < 0.7 && g.sample_size >= 8) {
        const label = g.complexity
          ? `complexity=${g.complexity}`
          : `keyword=${g.keyword}`;
        suggestions.push({
          id: crypto.randomUUID(),
          type: "underperforming",
          description: `Model "${g.model}" underperforms for ${label}: ${(g.success_rate * 100).toFixed(0)}% success rate (n=${g.sample_size})`,
          current_model: g.model,
          suggested_action: "upgrade_model",
          group_label: label,
          success_rate: g.success_rate,
          sample_size: g.sample_size,
          confidence: g.confidence,
        });
      }
    }

    // 2. Over-provisioned: Opus used where Sonnet has comparable success
    const complexityGroups = learning.by_complexity || [];
    const byComplexity = {};
    for (const g of complexityGroups) {
      if (!byComplexity[g.complexity]) byComplexity[g.complexity] = {};
      byComplexity[g.complexity][g.model] = g;
    }
    for (const [complexity, models] of Object.entries(byComplexity)) {
      const opusEntry = Object.entries(models).find(([m]) =>
        m.toLowerCase().includes("opus"),
      );
      const sonnetEntry = Object.entries(models).find(([m]) =>
        m.toLowerCase().includes("sonnet"),
      );
      if (opusEntry && sonnetEntry) {
        const [opusModel, opusStats] = opusEntry;
        const [sonnetModel, sonnetStats] = sonnetEntry;
        if (
          sonnetStats.success_rate >= opusStats.success_rate - 0.05 &&
          sonnetStats.sample_size >= 5 &&
          opusStats.sample_size >= 5
        ) {
          const conf = Math.min(opusStats.confidence, sonnetStats.confidence);
          suggestions.push({
            id: crypto.randomUUID(),
            type: "over_provisioned",
            description: `Opus (${(opusStats.success_rate * 100).toFixed(0)}%) can be replaced by Sonnet (${(sonnetStats.success_rate * 100).toFixed(0)}%) for complexity="${complexity}"`,
            current_model: opusModel,
            suggested_model: sonnetModel,
            suggested_action: "downgrade_model",
            complexity,
            confidence: conf,
          });
        }
      }
    }

    // 3. Missing rules: keywords with data but no dedicated model config
    const modelsConfig = await this.readJson(this.getModelsConfigPath());
    if (modelsConfig) {
      const configuredKeywords = new Set();
      const rules = modelsConfig.keyword_rules || modelsConfig.rules || {};
      if (Array.isArray(rules)) {
        for (const r of rules) {
          const kw = typeof r === "string" ? r : r.keyword;
          if (kw) configuredKeywords.add(kw.toLowerCase());
        }
      } else {
        for (const k of Object.keys(rules)) {
          configuredKeywords.add(k.toLowerCase());
        }
      }
      for (const g of learning.by_keyword || []) {
        if (
          g.sample_size >= 5 &&
          !configuredKeywords.has(g.keyword.toLowerCase())
        ) {
          suggestions.push({
            id: crypto.randomUUID(),
            type: "missing_rule",
            description: `No model rule for keyword "${g.keyword}" (best model: ${g.model}, ${(g.success_rate * 100).toFixed(0)}% success, n=${g.sample_size})`,
            keyword: g.keyword,
            suggested_model: g.model,
            suggested_action: "add_keyword_rule",
            confidence: g.confidence,
          });
        }
      }
    }

    // Filter by min_confidence
    const filtered = suggestions.filter((s) => s.confidence >= min_confidence);

    // Persist suggestions
    const learningData = (await this.readJson(this.getLearningPath())) || {};
    learningData.suggestions = filtered;
    learningData.suggestions_generated_at = new Date().toISOString();
    await this.writeJson(this.getLearningPath(), learningData);

    // Format markdown report
    if (filtered.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: "# Model Suggestions\n\nNo suggestions meet the confidence threshold.",
          },
        ],
      };
    }

    let md = "# Model Configuration Suggestions\n\n";
    md += `Generated: ${new Date().toISOString()}\n\n`;
    md += `| # | Type | Description | Confidence |\n`;
    md += `|---|------|-------------|------------|\n`;
    for (let i = 0; i < filtered.length; i++) {
      const s = filtered[i];
      md += `| ${i + 1} | ${s.type} | ${s.description} | ${(s.confidence * 100).toFixed(0)}% |\n`;
    }
    md += `\n## Suggestion IDs\n\n`;
    for (const s of filtered) {
      md += `- \`${s.id}\` -- ${s.type}: ${s.description}\n`;
    }

    return { content: [{ type: "text", text: md }] };
  }

  // --- apply_model_suggestion ---

  async applyModelSuggestion({ suggestion_id }) {
    const learningData = await this.readJson(this.getLearningPath());
    if (!learningData || !learningData.suggestions) {
      throw new Error("No suggestions found. Run suggest_model_rules first.");
    }

    const suggestion = learningData.suggestions.find(
      (s) => s.id === suggestion_id,
    );
    if (!suggestion) {
      throw new Error(`Suggestion ${suggestion_id} not found.`);
    }
    if (suggestion.status === "applied") {
      throw new Error("Suggestion already applied.");
    }
    if (suggestion.status === "rejected") {
      throw new Error("Suggestion was previously rejected.");
    }
    if (suggestion.confidence < 0.7) {
      throw new Error(
        `Confidence ${(suggestion.confidence * 100).toFixed(0)}% is below the 70% threshold.`,
      );
    }

    // Backup models.json
    const modelsPath = this.getModelsConfigPath();
    const modelsConfig = await this.readJson(modelsPath);
    if (!modelsConfig) {
      throw new Error("Cannot read models.json config.");
    }

    const timestamp = Date.now();
    const backupPath = `${modelsPath}.bak.${timestamp}`;
    await fs.writeFile(
      backupPath,
      JSON.stringify(modelsConfig, null, 2),
      "utf-8",
    );

    // Apply the change
    let changeDescription = "";

    if (
      suggestion.suggested_action === "downgrade_model" &&
      suggestion.complexity
    ) {
      if (!modelsConfig.complexity_rules) modelsConfig.complexity_rules = {};
      modelsConfig.complexity_rules[suggestion.complexity] =
        suggestion.suggested_model;
      changeDescription = `Changed model for complexity="${suggestion.complexity}" from ${suggestion.current_model} to ${suggestion.suggested_model}`;
    } else if (
      suggestion.suggested_action === "upgrade_model" &&
      suggestion.current_model
    ) {
      const upgradeMap = { haiku: "sonnet", sonnet: "opus" };
      const currentLower = suggestion.current_model.toLowerCase();
      let newModel = suggestion.current_model;
      for (const [from, to] of Object.entries(upgradeMap)) {
        if (currentLower.includes(from)) {
          newModel = suggestion.current_model.replace(
            new RegExp(from, "i"),
            to,
          );
          break;
        }
      }
      if (suggestion.group_label?.startsWith("complexity=")) {
        const complexity = suggestion.group_label.replace("complexity=", "");
        if (!modelsConfig.complexity_rules) modelsConfig.complexity_rules = {};
        modelsConfig.complexity_rules[complexity] = newModel;
        changeDescription = `Upgraded model for ${suggestion.group_label} from ${suggestion.current_model} to ${newModel}`;
      } else if (suggestion.group_label?.startsWith("keyword=")) {
        const keyword = suggestion.group_label.replace("keyword=", "");
        if (!modelsConfig.keyword_rules) modelsConfig.keyword_rules = {};
        modelsConfig.keyword_rules[keyword] = newModel;
        changeDescription = `Upgraded model for ${suggestion.group_label} from ${suggestion.current_model} to ${newModel}`;
      }
    } else if (
      suggestion.suggested_action === "add_keyword_rule" &&
      suggestion.keyword
    ) {
      if (!modelsConfig.keyword_rules) modelsConfig.keyword_rules = {};
      modelsConfig.keyword_rules[suggestion.keyword] =
        suggestion.suggested_model;
      changeDescription = `Added keyword rule: "${suggestion.keyword}" -> ${suggestion.suggested_model}`;
    }

    if (!changeDescription) {
      throw new Error("Could not determine how to apply this suggestion.");
    }

    await this.writeJson(modelsPath, modelsConfig);

    // Mark applied
    suggestion.status = "applied";
    suggestion.applied_at = new Date().toISOString();
    await this.writeJson(this.getLearningPath(), learningData);

    // Append to change log
    const logLine = `[${new Date().toISOString()}] APPLIED ${suggestion_id}: ${changeDescription} (confidence: ${(suggestion.confidence * 100).toFixed(0)}%, backup: ${backupPath})\n`;
    await fs.mkdir(path.dirname(this.getChangeLogPath()), { recursive: true });
    await fs.appendFile(this.getChangeLogPath(), logLine, "utf-8");

    return {
      content: [
        {
          type: "text",
          text: `Applied suggestion ${suggestion_id}.\n\n${changeDescription}\n\nBackup saved to: ${backupPath}`,
        },
      ],
    };
  }

  // --- reject_model_suggestion ---

  async rejectModelSuggestion({ suggestion_id, reason }) {
    const learningData = await this.readJson(this.getLearningPath());
    if (!learningData || !learningData.suggestions) {
      throw new Error("No suggestions found.");
    }

    const suggestion = learningData.suggestions.find(
      (s) => s.id === suggestion_id,
    );
    if (!suggestion) {
      throw new Error(`Suggestion ${suggestion_id} not found.`);
    }

    suggestion.status = "rejected";
    suggestion.rejected_at = new Date().toISOString();
    if (reason) suggestion.rejection_reason = reason;

    await this.writeJson(this.getLearningPath(), learningData);

    return {
      content: [
        {
          type: "text",
          text: `Rejected suggestion ${suggestion_id}.${reason ? ` Reason: ${reason}` : ""}`,
        },
      ],
    };
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("Model Learning Analyzer MCP server running on stdio");
  }
}

const server = new ModelLearningAnalyzerServer();
server.run().catch(console.error);
