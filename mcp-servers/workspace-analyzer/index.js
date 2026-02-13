#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";

const execAsync = promisify(exec);
const ORCHESTRATOR_HOME = process.env.ORCHESTRATOR_HOME;

class WorkspaceAnalyzerServer {
  constructor() {
    this.server = new Server(
      {
        name: "workspace-analyzer",
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
          name: "analyze_workspace_health",
          description:
            "Analyze workspace code quality, test coverage, and dependencies",
          inputSchema: {
            type: "object",
            properties: {
              workspace_path: {
                type: "string",
                description: "Path to workspace root",
              },
            },
            required: ["workspace_path"],
          },
        },
        {
          name: "suggest_tasks",
          description: "Analyze workspace and suggest improvement tasks",
          inputSchema: {
            type: "object",
            properties: {
              workspace_path: {
                type: "string",
                description: "Path to workspace root",
              },
              focus_areas: {
                type: "array",
                items: { type: "string" },
                description:
                  "Areas to focus on: tests, docs, security, performance, refactoring",
              },
            },
            required: ["workspace_path"],
          },
        },
        {
          name: "get_workspace_stats",
          description: "Get code statistics for a workspace",
          inputSchema: {
            type: "object",
            properties: {
              workspace_path: {
                type: "string",
                description: "Path to workspace root",
              },
            },
            required: ["workspace_path"],
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case "analyze_workspace_health":
            return await this.analyzeWorkspaceHealth(args.workspace_path);

          case "suggest_tasks":
            return await this.suggestTasks(
              args.workspace_path,
              args.focus_areas,
            );

          case "get_workspace_stats":
            return await this.getWorkspaceStats(args.workspace_path);

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

  async analyzeWorkspaceHealth(workspacePath) {
    const analysis = {
      path: workspacePath,
      timestamp: new Date().toISOString(),
      checks: {},
    };

    try {
      // Check for package.json
      const packageJsonPath = path.join(workspacePath, "package.json");
      try {
        const packageJson = JSON.parse(
          await fs.readFile(packageJsonPath, "utf-8"),
        );
        analysis.checks.package_json = {
          status: "ok",
          has_tests: !!packageJson.scripts?.test,
          has_lint: !!packageJson.scripts?.lint,
          dependency_count: Object.keys(packageJson.dependencies || {}).length,
        };
      } catch {
        analysis.checks.package_json = { status: "missing" };
      }

      // Check for README
      analysis.checks.readme = {
        status: (await this.fileExists(path.join(workspacePath, "README.md")))
          ? "ok"
          : "missing",
      };

      // Check for CLAUDE.md
      analysis.checks.claude_md = {
        status: (await this.fileExists(path.join(workspacePath, "CLAUDE.md")))
          ? "ok"
          : "missing",
      };

      // Check for tests directory
      const testDirs = ["test", "tests", "__tests__", "spec"];
      analysis.checks.tests = {
        status: "missing",
      };
      for (const dir of testDirs) {
        if (await this.fileExists(path.join(workspacePath, dir))) {
          analysis.checks.tests.status = "ok";
          analysis.checks.tests.directory = dir;
          break;
        }
      }

      // Check git status
      try {
        const { stdout: gitStatus } = await execAsync(
          "git status --porcelain",
          {
            cwd: workspacePath,
          },
        );
        analysis.checks.git = {
          status: "ok",
          uncommitted_changes: gitStatus.trim().split("\n").filter(Boolean)
            .length,
        };
      } catch {
        analysis.checks.git = { status: "not_a_repo" };
      }
    } catch (error) {
      analysis.error = error.message;
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(analysis, null, 2),
        },
      ],
    };
  }

  async suggestTasks(workspacePath, focusAreas = []) {
    const health = await this.analyzeWorkspaceHealth(workspacePath);
    const healthData = JSON.parse(health.content[0].text);

    const suggestions = [];

    // Check each focus area
    if (healthData.checks.readme?.status === "missing") {
      suggestions.push({
        priority: "high",
        complexity: "simple",
        task: "Create README.md with project documentation",
        reason: "Missing project documentation",
      });
    }

    if (healthData.checks.claude_md?.status === "missing") {
      suggestions.push({
        priority: "medium",
        complexity: "simple",
        task: "Create CLAUDE.md with development guidelines",
        reason: "No Claude Code context file present",
      });
    }

    if (healthData.checks.tests?.status === "missing") {
      suggestions.push({
        priority: "high",
        complexity: "medium",
        task: "Set up testing framework and write initial tests",
        reason: "No test directory found",
      });
    }

    if (!healthData.checks.package_json?.has_lint) {
      suggestions.push({
        priority: "medium",
        complexity: "simple",
        task: "Add linting configuration (ESLint/Prettier)",
        reason: "No lint script found in package.json",
      });
    }

    if (healthData.checks.git?.uncommitted_changes > 10) {
      suggestions.push({
        priority: "low",
        complexity: "simple",
        task: "Review and commit uncommitted changes",
        reason: `${healthData.checks.git.uncommitted_changes} uncommitted changes detected`,
      });
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(suggestions, null, 2),
        },
      ],
    };
  }

  async getWorkspaceStats(workspacePath) {
    const stats = {
      path: workspacePath,
      timestamp: new Date().toISOString(),
    };

    try {
      // Count files by extension
      const { stdout } = await execAsync(
        `find . -type f -name "*.js" -o -name "*.ts" -o -name "*.jsx" -o -name "*.tsx" | wc -l`,
        { cwd: workspacePath },
      );
      stats.code_files = parseInt(stdout.trim());

      // Get lines of code (approximation)
      try {
        const { stdout: locOutput } = await execAsync(
          `find . -name "*.js" -o -name "*.ts" -o -name "*.jsx" -o -name "*.tsx" | xargs wc -l | tail -1`,
          { cwd: workspacePath },
        );
        stats.lines_of_code = parseInt(locOutput.trim().split(/\s+/)[0]);
      } catch {
        stats.lines_of_code = "unknown";
      }

      // Get git commit count
      try {
        const { stdout: commitCount } = await execAsync(
          "git rev-list --count HEAD",
          {
            cwd: workspacePath,
          },
        );
        stats.total_commits = parseInt(commitCount.trim());
      } catch {
        stats.total_commits = "unknown";
      }
    } catch (error) {
      stats.error = error.message;
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(stats, null, 2),
        },
      ],
    };
  }

  async fileExists(filepath) {
    try {
      await fs.access(filepath);
      return true;
    } catch {
      return false;
    }
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("Workspace Analyzer MCP server running on stdio");
  }
}

const server = new WorkspaceAnalyzerServer();
server.run().catch(console.error);
