#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "fs/promises";
import path from "path";

const ORCHESTRATOR_HOME =
  process.env.ORCHESTRATOR_HOME ||
  path.join(process.env.HOME, "claude-orchestrator");

class TaskDispatcherServer {
  constructor() {
    this.server = new Server(
      {
        name: "task-dispatcher",
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

  getDispatchLogPath() {
    return path.join(ORCHESTRATOR_HOME, "logs", "dispatches.json");
  }

  async loadDispatches() {
    try {
      const content = await fs.readFile(this.getDispatchLogPath(), "utf-8");
      return JSON.parse(content);
    } catch {
      return [];
    }
  }

  async saveDispatches(dispatches) {
    const logPath = this.getDispatchLogPath();
    await fs.mkdir(path.dirname(logPath), { recursive: true });
    await fs.writeFile(logPath, JSON.stringify(dispatches, null, 2), "utf-8");
  }

  async loadWorkspaces() {
    const configPath = path.join(
      ORCHESTRATOR_HOME,
      "config",
      "orchestrator",
      "workspaces.json",
    );
    const content = await fs.readFile(configPath, "utf-8");
    return JSON.parse(content);
  }

  async loadModels() {
    const modelsPath = path.join(
      ORCHESTRATOR_HOME,
      "config",
      "orchestrator",
      "models.json",
    );
    const content = await fs.readFile(modelsPath, "utf-8");
    return JSON.parse(content);
  }

  async selectModel(complexity, taskDescription) {
    let config;
    try {
      config = await this.loadModels();
    } catch {
      // Fallback if models.json unavailable
      const fallback = {
        simple: "claude-haiku-4-5-20251001",
        medium: "claude-sonnet-4-5-20250929",
        complex: "claude-opus-4-5-20251101",
      };
      return fallback[complexity] || fallback.medium;
    }

    const task = (taskDescription || "").toLowerCase();

    // Apply rules (keyword matching)
    if (task && Array.isArray(config.rules)) {
      for (const rule of config.rules) {
        const cond = rule.if.toLowerCase();
        const target = rule.use.toLowerCase();

        if (
          (cond.includes("architecture") || cond.includes("design")) &&
          (task.includes("architecture") || task.includes("design"))
        ) {
          return config.task_complexity.complex.model;
        }

        if (
          (cond.includes("documentation") || cond.includes("readme")) &&
          (task.includes("documentation") ||
            task.includes("readme") ||
            task.includes("docs"))
        ) {
          return config.task_complexity.simple.model;
        }
      }
    }

    return (
      config.task_complexity?.[complexity]?.model ||
      config.task_complexity?.medium?.model ||
      "claude-sonnet-4-5-20250929"
    );
  }

  setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: "dispatch_task",
          description:
            "Dispatch a task to a workspace with appropriate model selection",
          inputSchema: {
            type: "object",
            properties: {
              workspace: {
                type: "string",
                description: "Target workspace name",
              },
              task: {
                type: "string",
                description: "Task description / prompt to execute",
              },
              complexity: {
                type: "string",
                enum: ["simple", "medium", "complex"],
                description:
                  "Task complexity for model selection (default: medium)",
              },
              priority: {
                type: "string",
                enum: ["high", "medium", "low"],
                description: "Task priority (default: medium)",
              },
            },
            required: ["workspace", "task"],
          },
        },
        {
          name: "get_task_status",
          description: "Get status of a dispatched task by ID",
          inputSchema: {
            type: "object",
            properties: {
              task_id: {
                type: "string",
                description: "Task dispatch ID",
              },
            },
            required: ["task_id"],
          },
        },
        {
          name: "list_dispatched_tasks",
          description: "List all dispatched tasks, optionally filtered",
          inputSchema: {
            type: "object",
            properties: {
              workspace: {
                type: "string",
                description: "Filter by workspace",
              },
              status: {
                type: "string",
                enum: ["pending", "running", "completed", "failed"],
                description: "Filter by status",
              },
              limit: {
                type: "number",
                description: "Max number of results (default: 20)",
              },
            },
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case "dispatch_task":
            return await this.dispatchTask(
              args.workspace,
              args.task,
              args.complexity,
              args.priority,
            );

          case "get_task_status":
            return await this.getTaskStatus(args.task_id);

          case "list_dispatched_tasks":
            return await this.listDispatchedTasks(
              args.workspace,
              args.status,
              args.limit,
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

  async dispatchTask(
    workspace,
    task,
    complexity = "medium",
    priority = "medium",
  ) {
    // Validate workspace exists
    const config = await this.loadWorkspaces();
    const ws = config.workspaces?.[workspace];
    if (!ws) {
      throw new Error(
        `Workspace "${workspace}" not found in workspaces.json`,
      );
    }

    const model = await this.selectModel(complexity, task);
    const taskId = `dispatch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const dispatch = {
      id: taskId,
      workspace,
      workspace_path: ws.path,
      task,
      complexity,
      priority,
      model,
      status: "pending",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const dispatches = await this.loadDispatches();
    dispatches.push(dispatch);
    await this.saveDispatches(dispatches);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              message: `Task dispatched to ${workspace}`,
              task_id: taskId,
              model,
              workspace_path: ws.path,
              command: `claude --model ${model} --print "${task}"`,
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  async getTaskStatus(taskId) {
    const dispatches = await this.loadDispatches();
    const dispatch = dispatches.find((d) => d.id === taskId);

    if (!dispatch) {
      throw new Error(`Task "${taskId}" not found`);
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(dispatch, null, 2),
        },
      ],
    };
  }

  async listDispatchedTasks(workspace, status, limit = 20) {
    let dispatches = await this.loadDispatches();

    if (workspace) {
      dispatches = dispatches.filter((d) => d.workspace === workspace);
    }
    if (status) {
      dispatches = dispatches.filter((d) => d.status === status);
    }

    // Most recent first
    dispatches = dispatches.reverse().slice(0, limit);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(dispatches, null, 2),
        },
      ],
    };
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("Task Dispatcher MCP server running on stdio");
  }
}

const server = new TaskDispatcherServer();
server.run().catch(console.error);
