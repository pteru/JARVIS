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

  // Returns the workspace's local path from workspaces.json, or null if not found.
  async getWorkspacePath(workspace) {
    try {
      const configPath = path.join(
        ORCHESTRATOR_HOME,
        "config",
        "orchestrator",
        "workspaces.json",
      );
      const config = JSON.parse(await fs.readFile(configPath, "utf-8"));
      return config.workspaces?.[workspace]?.path || null;
    } catch {
      return null;
    }
  }

  // Pushes backlog content to <workspace-path>/.claude/backlog.md and writes a
  // baseline copy for future three-way reconciliation.
  // Silently skips if the workspace path is not configured or not accessible.
  async pushToWorkspace(workspace, content) {
    const wsPath = await this.getWorkspacePath(workspace);
    if (!wsPath) return;

    try {
      const targetDir = path.join(wsPath, ".claude");
      await fs.mkdir(targetDir, { recursive: true });
      await fs.writeFile(path.join(targetDir, "backlog.md"), content, "utf-8");
      await fs.writeFile(
        path.join(targetDir, "backlog.md.baseline"),
        content,
        "utf-8",
      );

      // Ensure baseline is git-ignored
      const gitignorePath = path.join(targetDir, ".gitignore");
      let gitignoreContent = "";
      try {
        gitignoreContent = await fs.readFile(gitignorePath, "utf-8");
      } catch {
        // File doesn't exist yet
      }
      if (!gitignoreContent.includes("backlog.md.baseline")) {
        const nl = gitignoreContent.length && !gitignoreContent.endsWith("\n") ? "\n" : "";
        await fs.writeFile(
          gitignorePath,
          gitignoreContent + nl + "backlog.md.baseline\n",
          "utf-8",
        );
      }
    } catch {
      // Workspace path may not be mounted on this machine — silently skip.
    }
  }

  // ---------------------------------------------------------------------------
  // Backlog parser — returns an array of structured task objects.
  // ---------------------------------------------------------------------------
  parseBacklog(content) {
    if (!content) return [];
    const lines = content.split("\n");
    const tasks = [];
    let currentPriority = null;

    for (const line of lines) {
      if (line.startsWith("## ")) {
        currentPriority = line.replace("## ", "").toLowerCase().split(" ")[0];
      } else if (line.startsWith("- [")) {
        const taskMatch = line.match(/- \[([ x])\] (?:\[(\w+)\] )?(.+)/);
        if (taskMatch) {
          const [, checked, complexity, description] = taskMatch;
          tasks.push({
            priority: currentPriority,
            complexity: complexity || "medium",
            description: description.trim(),
            completed: checked === "x",
            originalLine: line,
          });
        }
      }
    }
    return tasks;
  }

  // ---------------------------------------------------------------------------
  // Three-way merge at the task-line level.
  // Returns { merged: Task[], conflicts: Conflict[] }.
  // ---------------------------------------------------------------------------
  mergeTasks(baselineTasks, centralTasks, workspaceTasks) {
    const merged = [];
    const conflicts = [];

    const baselineMap = new Map(baselineTasks.map((t) => [t.description, t]));
    const centralMap = new Map(centralTasks.map((t) => [t.description, t]));
    const workspaceMap = new Map(workspaceTasks.map((t) => [t.description, t]));

    const allDescriptions = new Set([
      ...baselineMap.keys(),
      ...centralMap.keys(),
      ...workspaceMap.keys(),
    ]);

    for (const desc of allDescriptions) {
      const baseline = baselineMap.get(desc);
      const central = centralMap.get(desc);
      const workspace = workspaceMap.get(desc);

      if (!baseline && central && !workspace) {
        // Central added
        merged.push(central);
      } else if (!baseline && !central && workspace) {
        // Workspace added
        merged.push(workspace);
      } else if (baseline && !central && !workspace) {
        // Both deleted — omit
        continue;
      } else if (baseline && central && workspace) {
        const centralSame = central.originalLine === baseline.originalLine;
        const workspaceSame = workspace.originalLine === baseline.originalLine;

        if (centralSame && workspaceSame) {
          merged.push(central);
        } else if (centralSame && !workspaceSame) {
          merged.push(workspace);
        } else if (!centralSame && workspaceSame) {
          merged.push(central);
        } else {
          conflicts.push({ central, workspace });
        }
      } else if (baseline && central && !workspace) {
        if (central.originalLine !== baseline.originalLine) {
          conflicts.push({ central, workspace: null });
        }
        // else: accept workspace deletion
      } else if (baseline && !central && workspace) {
        if (workspace.originalLine !== baseline.originalLine) {
          conflicts.push({ central: null, workspace });
        }
        // else: accept central deletion
      } else if (!baseline && central && workspace) {
        if (central.originalLine === workspace.originalLine) {
          merged.push(central);
        } else {
          conflicts.push({ central, workspace });
        }
      }
    }

    return { merged, conflicts };
  }

  // ---------------------------------------------------------------------------
  // Reconstruct a backlog markdown file from merged tasks + conflicts.
  // Preserves the original header from the central backlog when possible.
  // ---------------------------------------------------------------------------
  reconstructBacklog(header, tasks, conflicts) {
    const sections = { high: [], medium: [], low: [] };

    for (const task of tasks) {
      const priority = task.priority || "medium";
      if (sections[priority]) {
        sections[priority].push(task.originalLine);
      }
    }

    for (const conflict of conflicts) {
      const priority =
        conflict.central?.priority || conflict.workspace?.priority || "medium";
      sections[priority].push(
        "<!-- CONFLICT: Central vs. Workspace -->",
        conflict.central
          ? conflict.central.originalLine + " (Central)"
          : "<!-- Deleted in Central -->",
        "<!-- vs. -->",
        conflict.workspace
          ? conflict.workspace.originalLine + " (Workspace)"
          : "<!-- Deleted in Workspace -->",
        "<!-- END CONFLICT -->",
      );
    }

    let md = header ? header.trimEnd() + "\n\n" : "";
    md += "## High Priority\n" + sections.high.join("\n") + "\n\n";
    md += "## Medium Priority\n" + sections.medium.join("\n") + "\n\n";
    md += "## Low Priority\n" + sections.low.join("\n") + "\n";
    return md;
  }

  // Extract the header block (everything before the first ## section).
  extractHeader(content) {
    if (!content) return "";
    const idx = content.indexOf("\n## ");
    return idx === -1 ? "" : content.slice(0, idx);
  }

  // ---------------------------------------------------------------------------
  // sync_backlog — pull workspace changes and three-way merge with central.
  // ---------------------------------------------------------------------------
  async syncBacklog(workspace) {
    const wsPath = await this.getWorkspacePath(workspace);
    if (!wsPath) {
      return this.textResult(
        `Workspace "${workspace}" not found in config`,
      );
    }

    const centralPath = path.join(
      ORCHESTRATOR_HOME,
      "backlogs",
      `${workspace}-backlog.md`,
    );
    const workspacePath = path.join(wsPath, ".claude", "backlog.md");
    const baselinePath = path.join(wsPath, ".claude", "backlog.md.baseline");

    let centralContent, workspaceContent, baselineContent;

    try {
      centralContent = await fs.readFile(centralPath, "utf-8");
    } catch {
      return this.textResult(
        `Central backlog not found for "${workspace}"`,
      );
    }

    try {
      workspaceContent = await fs.readFile(workspacePath, "utf-8");
    } catch {
      return this.textResult(
        `No workspace backlog found for "${workspace}" — nothing to sync`,
      );
    }

    try {
      baselineContent = await fs.readFile(baselinePath, "utf-8");
    } catch {
      // First sync — use central as implicit baseline
      baselineContent = centralContent;
    }

    // Fast path: nothing changed in workspace
    if (workspaceContent === baselineContent) {
      return this.textResult(
        `No workspace changes detected for "${workspace}"`,
      );
    }

    const baselineTasks = this.parseBacklog(baselineContent);
    const centralTasks = this.parseBacklog(centralContent);
    const workspaceTasks = this.parseBacklog(workspaceContent);

    const { merged, conflicts } = this.mergeTasks(
      baselineTasks,
      centralTasks,
      workspaceTasks,
    );

    const header = this.extractHeader(centralContent);
    const reconciled = this.reconstructBacklog(header, merged, conflicts);

    await fs.writeFile(centralPath, reconciled, "utf-8");
    await this.pushToWorkspace(workspace, reconciled);

    if (conflicts.length > 0) {
      return this.textResult(
        `Synced "${workspace}" with ${conflicts.length} conflict(s) — review conflict markers in the backlog.`,
      );
    }
    return this.textResult(
      `Synced "${workspace}" — ${merged.length} task(s) reconciled, no conflicts.`,
    );
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
        {
          name: "sync_backlog",
          description:
            "Pull changes from a workspace backlog and reconcile with the central backlog using three-way merge. Returns a conflict report if any.",
          inputSchema: {
            type: "object",
            properties: {
              workspace: {
                type: "string",
                description: "Workspace name to sync",
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

          case "sync_backlog":
            return await this.syncBacklog(args.workspace);

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
      await this.pushToWorkspace(workspace, content);
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
      await this.pushToWorkspace(workspace, updated);
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
