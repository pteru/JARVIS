#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { listTasks, addTask, completeTask } from "./issues.mjs";

class BacklogManagerServer {
  constructor() {
    this.server = new Server(
      {
        name: "backlog-manager",
        version: "1.1.0",
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

  textResult(text) {
    return { content: [{ type: "text", text }] };
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
                description: 'Workspace name or GitHub repo slug (e.g., "o/r")',
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
                description: "Workspace name or GitHub repo slug",
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
                description: "Workspace name or GitHub repo slug",
              },
              task_pattern: {
                type: "string",
                description: "Issue number (e.g. 5 or #5) or a title substring matching exactly one open issue",
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
            return this.textResult(JSON.stringify(await listTasks(args.workspace, args.priority ?? "all"), null, 2));

          case "add_backlog_task":
            return this.textResult(await addTask(args.workspace, args.task, args.priority, args.complexity));

          case "complete_backlog_task":
            return this.textResult(await completeTask(args.workspace, args.task_pattern));

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

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("Backlog Manager MCP server running on stdio");
  }
}

const server = new BacklogManagerServer();
server.run().catch(console.error);
