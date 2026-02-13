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

class BacklogManagerServer {
  constructor() {
    this.server = new Server(
      {
        name: "backlog-manager",
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
          name: "list_backlog_tasks",
          description: "List all tasks from a workspace backlog",
          inputSchema: {
            type: "object",
            properties: {
              workspace: {
                type: "string",
                description: 'Workspace name (e.g., "api-backend")',
              },
              priority: {
                type: "string",
                enum: ["high", "medium", "low", "all"],
                description: "Filter by priority level",
              },
            },
            required: ["workspace"],
          },
        },
        {
          name: "add_backlog_task",
          description: "Add a new task to a workspace backlog",
          inputSchema: {
            type: "object",
            properties: {
              workspace: {
                type: "string",
                description: "Workspace name",
              },
              task: {
                type: "string",
                description: "Task description",
              },
              priority: {
                type: "string",
                enum: ["high", "medium", "low"],
                description: "Task priority",
              },
              complexity: {
                type: "string",
                enum: ["simple", "medium", "complex"],
                description: "Task complexity for model selection",
              },
            },
            required: ["workspace", "task", "priority"],
          },
        },
        {
          name: "complete_backlog_task",
          description: "Mark a task as complete in the backlog",
          inputSchema: {
            type: "object",
            properties: {
              workspace: {
                type: "string",
                description: "Workspace name",
              },
              task_pattern: {
                type: "string",
                description: "Pattern to match the task (substring)",
              },
            },
            required: ["workspace", "task_pattern"],
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case "list_backlog_tasks":
            return await this.listBacklogTasks(args.workspace, args.priority);

          case "add_backlog_task":
            return await this.addBacklogTask(
              args.workspace,
              args.task,
              args.priority,
              args.complexity,
            );

          case "complete_backlog_task":
            return await this.completeBacklogTask(
              args.workspace,
              args.task_pattern,
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

  async listBacklogTasks(workspace, priority = "all") {
    const backlogPath = path.join(
      ORCHESTRATOR_HOME,
      "backlogs",
      `${workspace}-backlog.md`,
    );

    const content = await fs.readFile(backlogPath, "utf-8");
    const lines = content.split("\n");

    let tasks = [];
    let currentPriority = null;

    for (const line of lines) {
      if (line.startsWith("## ")) {
        currentPriority = line.replace("## ", "").toLowerCase().split(" ")[0];
      } else if (line.startsWith("- [ ]")) {
        const taskMatch = line.match(/- \[ \] (?:\[(\w+)\] )?(.+)/);
        if (taskMatch) {
          const [, complexity, description] = taskMatch;
          if (priority === "all" || currentPriority === priority) {
            tasks.push({
              priority: currentPriority,
              complexity: complexity || "medium",
              description: description.trim(),
            });
          }
        }
      }
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(tasks, null, 2),
        },
      ],
    };
  }

  async addBacklogTask(workspace, task, priority, complexity = "medium") {
    const backlogPath = path.join(
      ORCHESTRATOR_HOME,
      "backlogs",
      `${workspace}-backlog.md`,
    );

    let content = await fs.readFile(backlogPath, "utf-8");
    const priorityHeader = `## ${priority.charAt(0).toUpperCase() + priority.slice(1)} Priority`;
    const taskLine = `- [ ] [${complexity.toUpperCase()}] ${task}`;

    // Find the priority section and add the task
    const sections = content.split("\n## ");
    let updated = false;

    for (let i = 0; i < sections.length; i++) {
      if (sections[i].startsWith(priorityHeader.replace("## ", ""))) {
        const lines = sections[i].split("\n");
        lines.splice(1, 0, taskLine);
        sections[i] = lines.join("\n");
        updated = true;
        break;
      }
    }

    if (updated) {
      content = sections.join("\n## ");
      await fs.writeFile(backlogPath, content, "utf-8");
    }

    return {
      content: [
        {
          type: "text",
          text: `Added task to ${workspace} backlog: ${task}`,
        },
      ],
    };
  }

  async completeBacklogTask(workspace, taskPattern) {
    const backlogPath = path.join(
      ORCHESTRATOR_HOME,
      "backlogs",
      `${workspace}-backlog.md`,
    );

    let content = await fs.readFile(backlogPath, "utf-8");
    const today = new Date().toISOString().split("T")[0];

    // Replace [ ] with [x] and add completion date
    const updated = content.replace(
      new RegExp(`(- \\[ \\].*${taskPattern}.*)`, "i"),
      `- [x] $1 (Completed: ${today})`,
    );

    if (updated !== content) {
      await fs.writeFile(backlogPath, updated, "utf-8");
      return {
        content: [
          {
            type: "text",
            text: `Marked task as complete in ${workspace} backlog`,
          },
        ],
      };
    } else {
      return {
        content: [
          {
            type: "text",
            text: `No matching task found for pattern: ${taskPattern}`,
          },
        ],
      };
    }
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("Backlog Manager MCP server running on stdio");
  }
}

const server = new BacklogManagerServer();
server.run().catch(console.error);
