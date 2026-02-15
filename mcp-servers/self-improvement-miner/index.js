#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "fs/promises";
import path from "path";

import { analyzeDispatchPatterns } from "./analyzers/dispatch-patterns.js";
import { analyzeWorkspaceHealth } from "./analyzers/workspace-health.js";
import { analyzeModelRouting } from "./analyzers/model-routing.js";
import { generateMetaReport } from "./reporters/meta-report.js";

const ORCHESTRATOR_HOME =
  process.env.ORCHESTRATOR_HOME ||
  path.join(process.env.HOME, "claude-orchestrator");

class SelfImprovementMinerServer {
  constructor() {
    this.server = new Server(
      {
        name: "self-improvement-miner",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
        },
      },
    );

    this.setupToolHandlers();

    this.server.onerror = (error) => console.error("[MCP Error]", error);
    process.on("SIGINT", async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  async loadConfig() {
    const configPath = path.join(ORCHESTRATOR_HOME, "config", "self-improvement.json");
    try {
      const content = await fs.readFile(configPath, "utf-8");
      return JSON.parse(content);
    } catch {
      return { auto_apply: false, report_on_analyze: true, min_dispatches_for_proposals: 5 };
    }
  }

  async runAllAnalyzers() {
    const [patterns, health, routing] = await Promise.all([
      analyzeDispatchPatterns(ORCHESTRATOR_HOME),
      analyzeWorkspaceHealth(ORCHESTRATOR_HOME),
      analyzeModelRouting(ORCHESTRATOR_HOME),
    ]);
    return { patterns, health, routing };
  }

  setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: "analyze_patterns",
          description:
            "Run all analyzers (dispatch patterns, workspace health, model routing) and return insights and upgrade proposals",
          inputSchema: {
            type: "object",
            properties: {},
          },
        },
        {
          name: "generate_meta_report",
          description:
            "Generate a comprehensive markdown self-improvement report and save it to the reports directory",
          inputSchema: {
            type: "object",
            properties: {},
          },
        },
        {
          name: "apply_proposal",
          description:
            "Apply a specific upgrade proposal to the orchestrator configuration",
          inputSchema: {
            type: "object",
            properties: {
              proposal_index: {
                type: "number",
                description: "Index of the proposal to apply (from analyze_patterns results)",
              },
              dry_run: {
                type: "boolean",
                description: "If true, show what would change without applying (default: true)",
              },
            },
            required: ["proposal_index"],
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case "analyze_patterns":
            return await this.handleAnalyzePatterns();
          case "generate_meta_report":
            return await this.handleGenerateReport();
          case "apply_proposal":
            return await this.handleApplyProposal(
              args.proposal_index,
              args.dry_run !== false,
            );
          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error: ${error.message}`,
            },
          ],
        };
      }
    });
  }

  async handleAnalyzePatterns() {
    const analysis = await this.runAllAnalyzers();
    this._lastAnalysis = analysis;

    const summary = {
      dispatch_patterns: {
        total_dispatches: analysis.patterns.total,
        models: Object.keys(analysis.patterns.byModel),
        top_keywords: analysis.patterns.topKeywords.slice(0, 5),
        insights: analysis.patterns.insights,
      },
      workspace_health: Object.fromEntries(
        Object.entries(analysis.health).map(([name, data]) => [
          name,
          { score: data.healthScore, status: data.healthLabel },
        ]),
      ),
      model_routing: {
        misroutes: analysis.routing.misroutes.length,
        over_provisioned: analysis.routing.overProvisioned.length,
        proposals: analysis.routing.proposals,
        insights: analysis.routing.insights,
      },
    };

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(summary, null, 2),
        },
      ],
    };
  }

  async handleGenerateReport() {
    const analysis = this._lastAnalysis || (await this.runAllAnalyzers());
    const { reportPath, report } = await generateMetaReport(ORCHESTRATOR_HOME, analysis);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              message: "Meta-report generated successfully",
              report_path: reportPath,
              report_preview: report.slice(0, 500) + (report.length > 500 ? "\n..." : ""),
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  async handleApplyProposal(proposalIndex, dryRun = true) {
    const analysis = this._lastAnalysis || (await this.runAllAnalyzers());
    const proposals = analysis.routing.proposals;

    if (proposalIndex < 0 || proposalIndex >= proposals.length) {
      throw new Error(
        `Invalid proposal index ${proposalIndex}. Available proposals: 0-${proposals.length - 1}`,
      );
    }

    const proposal = proposals[proposalIndex];
    const configPath = path.join(ORCHESTRATOR_HOME, proposal.config_file);

    if (dryRun) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                mode: "dry_run",
                proposal,
                config_file: configPath,
                message: "No changes applied. Set dry_run=false to apply.",
              },
              null,
              2,
            ),
          },
        ],
      };
    }

    // Apply the change
    let config;
    try {
      config = JSON.parse(await fs.readFile(configPath, "utf-8"));
    } catch {
      throw new Error(`Cannot read config file: ${configPath}`);
    }

    const change = proposal.change;
    if (change && change.path && change.suggested) {
      // Navigate to the path and apply the change
      const parts = change.path.split(".");
      let obj = config;
      for (let i = 0; i < parts.length - 1; i++) {
        if (obj[parts[i]] === undefined) obj[parts[i]] = {};
        obj = obj[parts[i]];
      }
      const lastKey = parts[parts.length - 1];
      const oldValue = obj[lastKey];
      obj[lastKey] = change.suggested;

      await fs.writeFile(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                mode: "applied",
                proposal,
                config_file: configPath,
                old_value: oldValue,
                new_value: change.suggested,
                message: "Proposal applied successfully.",
              },
              null,
              2,
            ),
          },
        ],
      };
    }

    throw new Error("Proposal does not have an automatically applicable change.");
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("Self-Improvement Miner MCP server running on stdio");
  }
}

const server = new SelfImprovementMinerServer();
server.run().catch(console.error);
