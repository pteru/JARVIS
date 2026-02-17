#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "fs/promises";
import path from "path";
import { verifyCriterion } from "./lib/verify-criteria.js";

const ORCHESTRATOR_HOME =
  process.env.ORCHESTRATOR_HOME ||
  path.join(process.env.HOME, "claude-orchestrator");

const VALID_TRANSITIONS = {
  pending: ["running", "failed"],
  running: ["verifying", "failed"],
  verifying: ["complete", "failed"],
  failed: ["pending"],
};

class TaskDispatcherServer {
  constructor() {
    this.server = new Server(
      {
        name: "task-dispatcher",
        version: "1.2.0",
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
      const dispatches = JSON.parse(content);
      // Migrate old records
      let migrated = false;
      for (const d of dispatches) {
        if (!("started_at" in d)) {
          d.started_at = null;
          d.completed_at = null;
          d.status_history = [
            {
              status: d.status || "pending",
              timestamp: d.created_at || new Date().toISOString(),
              note: "Migrated from legacy record",
            },
          ];
          d.error_message = null;
          d.verification_log = null;
          d.acceptance_criteria = [];
          d.universal_criteria = true;
          migrated = true;
        }
      }
      if (migrated) {
        await this.saveDispatches(dispatches);
      }
      return dispatches;
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

  async loadWorkspaceContext(workspacePath) {
    try {
      const contextPath = path.join(workspacePath, ".claude", "context.md");
      return await fs.readFile(contextPath, "utf-8");
    } catch {
      return null;
    }
  }

  async loadProductContext(product, workspacePath) {
    if (!product) return null;

    const productMonorepos = {
      visionking: "/home/teruel/JARVIS/workspaces/strokmatic/visionking",
      spotfusion: "/home/teruel/JARVIS/workspaces/strokmatic/spotfusion",
      diemaster: "/home/teruel/JARVIS/workspaces/strokmatic/diemaster",
    };

    const monorepoPath = productMonorepos[product];
    if (!monorepoPath || monorepoPath === workspacePath) return null;

    try {
      const contextPath = path.join(monorepoPath, ".claude", "context.md");
      return await fs.readFile(contextPath, "utf-8");
    } catch {
      return null;
    }
  }

  extractTaskKeywords(description) {
    const patterns = [
      /\barchitectur(e|al)\b/i, /\bdesign\b/i, /\brefactor(ing)?\b/i,
      /\bbug\b/i, /\bfix(es|ed|ing)?\b/i, /\btest(s|ing)?\b/i,
      /\bdoc(s|umentation)?\b/i, /\bapi\b/i, /\bdatabase\b/i,
      /\bperformance\b/i, /\bsecurity\b/i,
    ];
    const labels = [
      "architecture", "design", "refactor", "bug", "fix",
      "test", "docs", "api", "database", "performance", "security",
    ];
    const keywords = [];
    for (let i = 0; i < patterns.length; i++) {
      if (patterns[i].test(description)) keywords.push(labels[i]);
    }
    return [...new Set(keywords)];
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

  extractAcceptanceCriteria(task) {
    const criteria = [];

    // Look for file paths (e.g., src/foo.js, ./lib/bar.ts, /absolute/path.py)
    const filePathRegex =
      /(?:^|\s)((?:\.{0,2}\/)?(?:[\w-]+\/)*[\w-]+\.[\w]+)/g;
    let match;
    while ((match = filePathRegex.exec(task)) !== null) {
      const filePath = match[1];
      // Skip common non-file patterns
      if (!filePath.match(/^https?:\/\//)) {
        criteria.push({
          type: "file_exists",
          path: filePath,
          source: "extracted",
        });
      }
    }

    // Look for test mentions
    if (/\b(test|tests|spec|specs|jest|mocha|pytest|vitest)\b/i.test(task)) {
      criteria.push({
        type: "test_pass",
        command: null, // Will be resolved from universal criteria
        source: "extracted",
      });
    }

    // Look for "must contain" patterns
    const containRegex =
      /must contain\s+["']([^"']+)["']\s+(?:in\s+)?["']?([^\s"']+)["']?/gi;
    while ((match = containRegex.exec(task)) !== null) {
      criteria.push({
        type: "content_match",
        pattern: match[1],
        path: match[2],
        source: "extracted",
      });
    }

    // Look for command mentions (e.g., "run `npm build`", "execute `make`")
    const commandRegex = /(?:run|execute)\s+`([^`]+)`/gi;
    while ((match = commandRegex.exec(task)) !== null) {
      criteria.push({
        type: "command_success",
        command: match[1],
        source: "extracted",
      });
    }

    return criteria;
  }

  async generateUniversalCriteria(workspacePath) {
    const criteria = [];

    // Check for package.json
    try {
      const pkgContent = await fs.readFile(
        path.join(workspacePath, "package.json"),
        "utf-8",
      );
      const pkg = JSON.parse(pkgContent);
      if (pkg.scripts?.test && pkg.scripts.test !== 'echo "Error: no test specified" && exit 1') {
        criteria.push({
          type: "command_success",
          command: "npm test",
          source: "universal",
        });
      }
      if (pkg.scripts?.lint) {
        criteria.push({
          type: "command_success",
          command: "npm run lint",
          source: "universal",
        });
      }
    } catch {
      // No package.json
    }

    // Check for pyproject.toml
    try {
      const pyContent = await fs.readFile(
        path.join(workspacePath, "pyproject.toml"),
        "utf-8",
      );
      if (/pytest/i.test(pyContent)) {
        criteria.push({
          type: "command_success",
          command: "python -m pytest",
          source: "universal",
        });
      }
      if (/ruff|flake8|pylint/i.test(pyContent)) {
        const linter = pyContent.match(/ruff/i)
          ? "ruff check ."
          : pyContent.match(/flake8/i)
            ? "flake8"
            : "pylint";
        criteria.push({
          type: "command_success",
          command: linter,
          source: "universal",
        });
      }
    } catch {
      // No pyproject.toml
    }

    return criteria;
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
                enum: ["pending", "running", "verifying", "complete", "failed"],
                description: "Filter by status",
              },
              limit: {
                type: "number",
                description: "Max number of results (default: 20)",
              },
            },
          },
        },
        {
          name: "update_task_status",
          description:
            "Update the status of a dispatched task with lifecycle tracking",
          inputSchema: {
            type: "object",
            properties: {
              task_id: {
                type: "string",
                description: "Task dispatch ID",
              },
              status: {
                type: "string",
                enum: ["pending", "running", "verifying", "complete", "failed"],
                description: "New status",
              },
              note: {
                type: "string",
                description: "Optional note for this status change",
              },
              error_message: {
                type: "string",
                description:
                  "Error message (required when transitioning to failed)",
              },
              verification_log: {
                type: "string",
                description:
                  "Verification log (used when transitioning to verifying)",
              },
            },
            required: ["task_id", "status"],
          },
        },
        {
          name: "verify_task_completion",
          description:
            "Run acceptance and universal criteria checks for a dispatched task",
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
          name: "update_task_outcome",
          description:
            "Update a dispatched task with its outcome (success/failure/partial), execution time, and token usage.",
          inputSchema: {
            type: "object",
            properties: {
              task_id: {
                type: "string",
                description: "The dispatch ID to update",
              },
              outcome: {
                type: "string",
                enum: ["success", "failure", "partial"],
                description: "Task outcome",
              },
              execution_time_seconds: {
                type: "number",
                description: "How long the task took in seconds",
              },
              tokens_used: {
                type: "number",
                description: "Total tokens consumed",
              },
              notes: {
                type: "string",
                description: "Optional notes about the outcome",
              },
            },
            required: ["task_id", "outcome"],
          },
        },
        {
          name: "mark_task_complete_override",
          description:
            "Manually mark a task as complete, bypassing verification checks",
          inputSchema: {
            type: "object",
            properties: {
              task_id: {
                type: "string",
                description: "Task dispatch ID",
              },
              reason: {
                type: "string",
                description: "Reason for manual override",
              },
            },
            required: ["task_id", "reason"],
          },
        },
        {
          name: "dispatch_batch",
          description: "Dispatch tasks to multiple workspaces in parallel",
          inputSchema: {
            type: "object",
            properties: {
              tasks: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    workspace: { type: "string", description: "Target workspace name" },
                    task: { type: "string", description: "Task description" },
                    complexity: { type: "string", enum: ["simple", "medium", "complex"], description: "Task complexity (default: medium)" },
                    priority: { type: "string", enum: ["high", "medium", "low"], description: "Task priority (default: medium)" },
                  },
                  required: ["workspace", "task"],
                },
                description: "Array of tasks to dispatch",
              },
              max_parallel: {
                type: "number",
                description: "Maximum parallel workers (default: 4)",
              },
            },
            required: ["tasks"],
          },
        },
        {
          name: "get_batch_status",
          description: "Get status and progress of a batch dispatch",
          inputSchema: {
            type: "object",
            properties: {
              batch_id: {
                type: "string",
                description: "Batch dispatch ID",
              },
            },
            required: ["batch_id"],
          },
        },
        {
          name: "cancel_batch",
          description: "Cancel a running batch dispatch",
          inputSchema: {
            type: "object",
            properties: {
              batch_id: {
                type: "string",
                description: "Batch dispatch ID",
              },
            },
            required: ["batch_id"],
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

          case "update_task_status":
            return await this.updateTaskStatus(
              args.task_id,
              args.status,
              args.note,
              args.error_message,
              args.verification_log,
            );

          case "verify_task_completion":
            return await this.verifyTaskCompletion(args.task_id);

          case "update_task_outcome":
            return await this.updateTaskOutcome(args);

          case "mark_task_complete_override":
            return await this.markTaskCompleteOverride(
              args.task_id,
              args.reason,
            );

          case "dispatch_batch":
            return await this.dispatchBatch(args.tasks, args.max_parallel);

          case "get_batch_status":
            return await this.getBatchStatus(args.batch_id);

          case "cancel_batch":
            return await this.cancelBatch(args.batch_id);

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
    const now = new Date().toISOString();

    // Load and inject workspace context + product context
    const context = await this.loadWorkspaceContext(ws.path);
    const productContext = await this.loadProductContext(ws.product, ws.path);
    let augmentedTask = task;
    if (productContext) {
      augmentedTask = `<product-context product="${ws.product}">\n${productContext}\n</product-context>\n\n${augmentedTask}`;
    }
    if (context) {
      augmentedTask = `<workspace-context>\n${context}\n</workspace-context>\n\n${augmentedTask}`;
    }

    // Extract acceptance criteria from task description
    const extractedCriteria = this.extractAcceptanceCriteria(task);
    const universalCriteria = await this.generateUniversalCriteria(ws.path);

    const dispatch = {
      id: taskId,
      workspace,
      workspace_path: ws.path,
      task: augmentedTask,
      original_task: task,
      complexity,
      priority,
      model,
      has_context: !!context,
      has_product_context: !!productContext,
      task_keywords: this.extractTaskKeywords(task),
      status: "pending",
      created_at: now,
      updated_at: now,
      started_at: null,
      completed_at: null,
      status_history: [
        { status: "pending", timestamp: now, note: "Task dispatched" },
      ],
      error_message: null,
      verification_log: null,
      acceptance_criteria: [...extractedCriteria, ...universalCriteria],
      universal_criteria: true,
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
              context_injected: !!context,
              command: `claude --model ${model} --print "${augmentedTask}"`,
              acceptance_criteria_count: dispatch.acceptance_criteria.length,
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

    // Add duration_seconds computation
    const enriched = dispatches.map((d) => {
      const result = { ...d };
      if (d.started_at) {
        const end = d.completed_at || new Date().toISOString();
        result.duration_seconds = Math.round(
          (new Date(end) - new Date(d.started_at)) / 1000,
        );
      } else {
        result.duration_seconds = null;
      }
      return result;
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(enriched, null, 2),
        },
      ],
    };
  }

  async updateTaskStatus(
    taskId,
    newStatus,
    note,
    errorMessage,
    verificationLog,
  ) {
    const dispatches = await this.loadDispatches();
    const dispatch = dispatches.find((d) => d.id === taskId);

    if (!dispatch) {
      throw new Error(`Task "${taskId}" not found`);
    }

    const currentStatus = dispatch.status;
    const allowed = VALID_TRANSITIONS[currentStatus];
    if (!allowed || !allowed.includes(newStatus)) {
      throw new Error(
        `Invalid transition: ${currentStatus} -> ${newStatus}. Allowed: ${(allowed || []).join(", ")}`,
      );
    }

    const now = new Date().toISOString();
    dispatch.status = newStatus;
    dispatch.updated_at = now;

    if (newStatus === "running" && !dispatch.started_at) {
      dispatch.started_at = now;
    }

    if (newStatus === "complete" || newStatus === "failed") {
      dispatch.completed_at = now;
    }

    if (newStatus === "failed" && errorMessage) {
      dispatch.error_message = errorMessage;
    }

    if (newStatus === "verifying" && verificationLog) {
      dispatch.verification_log = verificationLog;
    }

    dispatch.status_history.push({
      status: newStatus,
      timestamp: now,
      note: note || `Status changed to ${newStatus}`,
    });

    await this.saveDispatches(dispatches);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              message: `Task ${taskId} status updated: ${currentStatus} -> ${newStatus}`,
              task_id: taskId,
              status: newStatus,
              status_history: dispatch.status_history,
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  async verifyTaskCompletion(taskId) {
    const dispatches = await this.loadDispatches();
    const dispatch = dispatches.find((d) => d.id === taskId);

    if (!dispatch) {
      throw new Error(`Task "${taskId}" not found`);
    }

    const criteria = dispatch.acceptance_criteria || [];
    if (criteria.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                message: "No acceptance criteria to verify",
                task_id: taskId,
                passed: true,
                results: [],
              },
              null,
              2,
            ),
          },
        ],
      };
    }

    const results = [];
    for (const criterion of criteria) {
      const result = await verifyCriterion(criterion, dispatch.workspace_path);
      results.push({ criterion, ...result });
    }

    const allPassed = results.every((r) => r.passed);
    const log = results
      .map(
        (r) =>
          `[${r.passed ? "PASS" : "FAIL"}] ${r.criterion.type}: ${r.message}`,
      )
      .join("\n");

    // Update dispatch with verification results
    const now = new Date().toISOString();
    dispatch.verification_log = log;
    dispatch.updated_at = now;
    dispatch.status_history.push({
      status: "verification_run",
      timestamp: now,
      note: `Verification: ${results.filter((r) => r.passed).length}/${results.length} passed`,
    });
    await this.saveDispatches(dispatches);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              message: allPassed
                ? "All criteria passed"
                : "Some criteria failed",
              task_id: taskId,
              passed: allPassed,
              summary: `${results.filter((r) => r.passed).length}/${results.length} passed`,
              results,
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  async updateTaskOutcome({ task_id, outcome, execution_time_seconds, tokens_used, notes }) {
    const dispatches = await this.loadDispatches();
    const dispatch = dispatches.find(
      (d) => d.id === task_id || d.dispatch_id === task_id,
    );
    if (!dispatch) {
      throw new Error(`Dispatch ${task_id} not found.`);
    }

    dispatch.outcome = outcome;
    dispatch.outcome_updated_at = new Date().toISOString();
    if (execution_time_seconds != null) {
      dispatch.execution_time_seconds = execution_time_seconds;
    }
    if (tokens_used != null) {
      dispatch.tokens_used = tokens_used;
    }
    if (notes) {
      dispatch.outcome_notes = notes;
    }

    // Ensure keywords are extracted if missing
    if (!dispatch.task_keywords) {
      dispatch.task_keywords = this.extractTaskKeywords(
        dispatch.task_description || dispatch.task || "",
      );
    }

    await this.saveDispatches(dispatches);

    return {
      content: [
        {
          type: "text",
          text: `Updated dispatch ${task_id}: outcome=${outcome}` +
            (execution_time_seconds != null ? `, time=${execution_time_seconds}s` : "") +
            (tokens_used != null ? `, tokens=${tokens_used}` : "") +
            (notes ? `\nNotes: ${notes}` : ""),
        },
      ],
    };
  }

  async markTaskCompleteOverride(taskId, reason) {
    const dispatches = await this.loadDispatches();
    const dispatch = dispatches.find((d) => d.id === taskId);

    if (!dispatch) {
      throw new Error(`Task "${taskId}" not found`);
    }

    const now = new Date().toISOString();
    dispatch.status = "complete";
    dispatch.updated_at = now;
    dispatch.completed_at = now;
    dispatch.status_history.push({
      status: "complete",
      timestamp: now,
      note: `Manual override: ${reason}`,
    });

    await this.saveDispatches(dispatches);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              message: `Task ${taskId} manually marked complete`,
              task_id: taskId,
              reason,
              status: "complete",
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  async dispatchBatch(tasks, maxParallel = 4) {
    // Validate all workspaces exist first (fail fast)
    const config = await this.loadWorkspaces();
    for (const t of tasks) {
      const ws = config.workspaces?.[t.workspace];
      if (!ws) {
        throw new Error(`Workspace "${t.workspace}" not found in workspaces.json`);
      }
    }

    const batchId = `batch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();
    const dispatchIds = [];
    const dispatches = await this.loadDispatches();

    for (const t of tasks) {
      const ws = config.workspaces[t.workspace];
      const complexity = t.complexity || "medium";
      const priority = t.priority || "medium";
      const model = await this.selectModel(complexity, t.task);
      const taskId = `dispatch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const context = await this.loadWorkspaceContext(ws.path);
      const productContext = await this.loadProductContext(ws.product, ws.path);
      let augmentedTask = t.task;
      if (productContext) {
        augmentedTask = `<product-context product="${ws.product}">\n${productContext}\n</product-context>\n\n${augmentedTask}`;
      }
      if (context) {
        augmentedTask = `<workspace-context>\n${context}\n</workspace-context>\n\n${augmentedTask}`;
      }

      const extractedCriteria = this.extractAcceptanceCriteria(t.task);
      const universalCriteria = await this.generateUniversalCriteria(ws.path);

      const dispatch = {
        id: taskId,
        batch_id: batchId,
        workspace: t.workspace,
        workspace_path: ws.path,
        task: augmentedTask,
        original_task: t.task,
        complexity,
        priority,
        model,
        has_context: !!context,
        has_product_context: !!productContext,
        task_keywords: this.extractTaskKeywords(t.task),
        status: "pending",
        created_at: now,
        updated_at: now,
        started_at: null,
        completed_at: null,
        status_history: [
          { status: "pending", timestamp: now, note: "Batch dispatched" },
        ],
        error_message: null,
        verification_log: null,
        acceptance_criteria: [...extractedCriteria, ...universalCriteria],
        universal_criteria: true,
      };

      dispatches.push(dispatch);
      dispatchIds.push(taskId);
    }

    // Create batch record
    const batchRecord = {
      id: batchId,
      type: "batch",
      status: "pending",
      created_at: now,
      max_parallel: maxParallel,
      task_count: tasks.length,
      tasks_completed: 0,
      tasks_failed: 0,
      tasks_pending: tasks.length,
      dispatches: dispatchIds,
    };

    dispatches.push(batchRecord);
    await this.saveDispatches(dispatches);

    const executeCommand = `node /home/teruel/JARVIS/scripts/execute-batch.mjs ${batchId}`;

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              message: `Batch dispatched with ${tasks.length} tasks`,
              batch_id: batchId,
              dispatch_ids: dispatchIds,
              max_parallel: maxParallel,
              command: executeCommand,
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  async getBatchStatus(batchId) {
    const dispatches = await this.loadDispatches();
    const batch = dispatches.find((d) => d.id === batchId && d.type === "batch");

    if (!batch) {
      throw new Error(`Batch "${batchId}" not found`);
    }

    // Recalculate counts from individual dispatches
    const batchDispatches = dispatches.filter(
      (d) => d.batch_id === batchId && d.type !== "batch",
    );

    const counts = {
      pending: 0,
      running: 0,
      verifying: 0,
      complete: 0,
      failed: 0,
    };

    for (const d of batchDispatches) {
      if (counts[d.status] !== undefined) {
        counts[d.status]++;
      }
    }

    batch.tasks_completed = counts.complete;
    batch.tasks_failed = counts.failed;
    batch.tasks_pending = counts.pending;

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              batch_id: batchId,
              status: batch.status,
              task_count: batch.task_count,
              ...counts,
              dispatches: batchDispatches.map((d) => ({
                id: d.id,
                workspace: d.workspace,
                status: d.status,
                model: d.model,
              })),
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  async cancelBatch(batchId) {
    const dispatches = await this.loadDispatches();
    const batch = dispatches.find((d) => d.id === batchId && d.type === "batch");

    if (!batch) {
      throw new Error(`Batch "${batchId}" not found`);
    }

    const now = new Date().toISOString();
    batch.status = "cancelled";

    // Cancel all pending dispatches in the batch
    let cancelledCount = 0;
    for (const d of dispatches) {
      if (d.batch_id === batchId && d.status === "pending") {
        d.status = "failed";
        d.error_message = "Batch cancelled";
        d.updated_at = now;
        d.completed_at = now;
        d.status_history.push({
          status: "failed",
          timestamp: now,
          note: "Batch cancelled",
        });
        cancelledCount++;
      }
    }

    await this.saveDispatches(dispatches);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              message: `Batch ${batchId} cancelled`,
              batch_id: batchId,
              tasks_cancelled: cancelledCount,
            },
            null,
            2,
          ),
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
