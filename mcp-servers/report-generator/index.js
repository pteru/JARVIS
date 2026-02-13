#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "fs/promises";
import path from "path";

const ORCHESTRATOR_HOME = process.env.ORCHESTRATOR_HOME;

class ReportGeneratorServer {
  constructor() {
    this.server = new Server(
      {
        name: "report-generator",
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

  setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: "generate_daily_report",
          description: "Generate daily activity report across all workspaces",
          inputSchema: {
            type: "object",
            properties: {
              date: {
                type: "string",
                description: "Date for report (YYYY-MM-DD), defaults to today",
              },
            },
          },
        },
        {
          name: "generate_weekly_report",
          description: "Generate weekly summary report",
          inputSchema: {
            type: "object",
            properties: {
              week_ending: {
                type: "string",
                description:
                  "Week ending date (YYYY-MM-DD), defaults to last Friday",
              },
            },
          },
        },
        {
          name: "generate_workspace_report",
          description: "Generate detailed report for a specific workspace",
          inputSchema: {
            type: "object",
            properties: {
              workspace: {
                type: "string",
                description: "Workspace name",
              },
              timeframe: {
                type: "string",
                enum: ["day", "week", "month"],
                description: "Timeframe for report",
              },
            },
            required: ["workspace"],
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case "generate_daily_report":
            return await this.generateDailyReport(args.date);

          case "generate_weekly_report":
            return await this.generateWeeklyReport(args.week_ending);

          case "generate_workspace_report":
            return await this.generateWorkspaceReport(
              args.workspace,
              args.timeframe,
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

  async generateDailyReport(dateStr) {
    const date = dateStr || new Date().toISOString().split("T")[0];

    const report = {
      title: `Daily Activity Report - ${date}`,
      date,
      workspaces: {},
    };

    // Read all workspace changelogs
    const changelogDir = path.join(ORCHESTRATOR_HOME, "changelogs");
    const files = await fs.readdir(changelogDir);

    for (const file of files) {
      if (file.endsWith(".md")) {
        const workspace = file.replace("-changelog.md", "");
        const content = await fs.readFile(
          path.join(changelogDir, file),
          "utf-8",
        );

        // Extract today's entries
        const entries = content
          .split("\n## ")
          .filter((entry) => entry.includes(date))
          .map((entry) => entry.trim());

        if (entries.length > 0) {
          report.workspaces[workspace] = {
            task_count: entries.length,
            entries,
          };
        }
      }
    }

    // Save report
    const reportPath = path.join(
      ORCHESTRATOR_HOME,
      "reports",
      `daily-${date}.md`,
    );

    const markdown = this.formatDailyReportMarkdown(report);
    await fs.writeFile(reportPath, markdown, "utf-8");

    return {
      content: [
        {
          type: "text",
          text: `Daily report generated: ${reportPath}\n\n${markdown}`,
        },
      ],
    };
  }

  async generateWeeklyReport(weekEnding) {
    // Implementation for weekly report
    const report = {
      title: "Weekly Activity Report",
      week_ending: weekEnding || this.getLastFriday(),
      summary: "Weekly summary",
    };

    const reportPath = path.join(
      ORCHESTRATOR_HOME,
      "reports",
      `weekly-${report.week_ending}.md`,
    );

    const markdown = this.formatWeeklyReportMarkdown(report);
    await fs.writeFile(reportPath, markdown, "utf-8");

    return {
      content: [
        {
          type: "text",
          text: `Weekly report generated: ${reportPath}`,
        },
      ],
    };
  }

  async generateWorkspaceReport(workspace, timeframe = "week") {
    // Implementation for workspace-specific report
    return {
      content: [
        {
          type: "text",
          text: `Workspace report for ${workspace} (${timeframe})`,
        },
      ],
    };
  }

  formatDailyReportMarkdown(report) {
    let md = `# ${report.title}\n\n`;

    const workspaceCount = Object.keys(report.workspaces).length;
    const totalTasks = Object.values(report.workspaces).reduce(
      (sum, ws) => sum + ws.task_count,
      0,
    );

    md += `## Summary\n\n`;
    md += `- Workspaces active: ${workspaceCount}\n`;
    md += `- Tasks completed: ${totalTasks}\n\n`;

    md += `## Activity by Workspace\n\n`;

    for (const [workspace, data] of Object.entries(report.workspaces)) {
      md += `### ${workspace}\n\n`;
      md += `Tasks completed: ${data.task_count}\n\n`;

      data.entries.forEach((entry) => {
        md += `${entry}\n\n`;
      });
    }

    return md;
  }

  formatWeeklyReportMarkdown(report) {
    return `# ${report.title}\n\nWeek ending: ${report.week_ending}\n\n${report.summary}`;
  }

  getLastFriday() {
    const today = new Date();
    const dayOfWeek = today.getDay();
    const daysToFriday = dayOfWeek >= 5 ? dayOfWeek - 5 : dayOfWeek + 2;
    const lastFriday = new Date(today);
    lastFriday.setDate(today.getDate() - daysToFriday);
    return lastFriday.toISOString().split("T")[0];
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("Report Generator MCP server running on stdio");
  }
}

const server = new ReportGeneratorServer();
server.run().catch(console.error);
