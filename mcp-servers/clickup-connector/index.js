#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "fs/promises";
import path from "path";
import { ORCHESTRATOR_HOME } from "../lib/config-loader.js";

const CONFIG_PATH = path.join(
  ORCHESTRATOR_HOME,
  "config",
  "orchestrator",
  "clickup.json",
);

const STATUS_MAP = {
  pending: "to do",
  running: "in progress",
  verifying: "in review",
  complete: "complete",
  failed: "to do",
};

const REVERSE_STATUS_MAP = Object.fromEntries(
  Object.entries(STATUS_MAP).map(([k, v]) => [v, k]),
);

// ---------------------------------------------------------------------------
// Simple translation helper — marks text for translation by the calling
// Claude instance. Applies basic pattern replacement for common PT-BR
// technical terms but primarily delegates real translation.
// ---------------------------------------------------------------------------
function translateText(text, from, to) {
  if (!text) return text;

  if (from === "pt-BR" && to === "en") {
    const replacements = {
      tarefa: "task",
      descrição: "description",
      prioridade: "priority",
      requisitos: "requirements",
      implementação: "implementation",
      correção: "fix",
      melhoria: "improvement",
      funcionalidade: "feature",
      documentação: "documentation",
      configuração: "configuration",
      desenvolvimento: "development",
      produção: "production",
      ambiente: "environment",
      servidor: "server",
      "banco de dados": "database",
      integração: "integration",
      teste: "test",
      testes: "tests",
    };

    let result = text;
    for (const [ptBr, en] of Object.entries(replacements)) {
      result = result.replace(new RegExp(ptBr, "gi"), en);
    }
    return `[Translation needed] ${result}`;
  }

  if (from === "en" && to === "pt-BR") {
    const replacements = {
      task: "tarefa",
      description: "descrição",
      priority: "prioridade",
      requirements: "requisitos",
      implementation: "implementação",
      fix: "correção",
      improvement: "melhoria",
      feature: "funcionalidade",
      documentation: "documentação",
      configuration: "configuração",
      development: "desenvolvimento",
      production: "produção",
      environment: "ambiente",
      server: "servidor",
      database: "banco de dados",
      integration: "integração",
      test: "teste",
      tests: "testes",
    };

    let result = text;
    for (const [en, ptBr] of Object.entries(replacements)) {
      result = result.replace(new RegExp(`\\b${en}\\b`, "gi"), ptBr);
    }
    return `[Tradução necessária] ${result}`;
  }

  return text;
}

// ---------------------------------------------------------------------------
// ClickUp API client
// ---------------------------------------------------------------------------
class ClickUpClient {
  constructor(apiToken) {
    if (!apiToken) {
      throw new Error(
        "ClickUp API token not configured. Set the CLICKUP_API_TOKEN environment variable.",
      );
    }
    this.apiToken = apiToken;
    this.baseUrl = "https://api.clickup.com/api/v2";
  }

  async request(method, urlPath, body) {
    const url = `${this.baseUrl}${urlPath}`;
    const options = {
      method,
      headers: {
        Authorization: this.apiToken,
        "Content-Type": "application/json",
      },
    };
    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);
    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `ClickUp API error ${response.status} ${method} ${urlPath}: ${text}`,
      );
    }
    return response.json();
  }

  async getTeams() {
    return this.request("GET", "/team");
  }

  async getSpaces(teamId) {
    return this.request("GET", `/team/${teamId}/space`);
  }

  async getFolders(spaceId) {
    return this.request("GET", `/space/${spaceId}/folder`);
  }

  async getLists(folderId) {
    return this.request("GET", `/folder/${folderId}/list`);
  }

  async getFolderlessLists(spaceId) {
    return this.request("GET", `/space/${spaceId}/list`);
  }

  async getTask(taskId) {
    return this.request("GET", `/task/${taskId}`);
  }

  async createTask(listId, taskData) {
    return this.request("POST", `/list/${listId}/task`, taskData);
  }

  async updateTask(taskId, taskData) {
    return this.request("PUT", `/task/${taskId}`, taskData);
  }

  async addComment(taskId, commentText) {
    return this.request("POST", `/task/${taskId}/comment`, {
      comment_text: commentText,
    });
  }

  async getListTasks(listId) {
    return this.request("GET", `/list/${listId}/task`);
  }
}

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------
class ClickUpConnectorServer {
  constructor() {
    this.server = new Server(
      {
        name: "clickup-connector",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
        },
      },
    );

    this.config = null;
    this.client = null;

    this.setupToolHandlers();

    this.server.onerror = (error) => console.error("[MCP Error]", error);
    process.on("SIGINT", async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  async loadConfig() {
    if (this.config) return this.config;
    const raw = await fs.readFile(CONFIG_PATH, "utf-8");
    this.config = JSON.parse(raw);
    return this.config;
  }

  async saveConfig(config) {
    await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", "utf-8");
    this.config = config;
  }

  async getClient() {
    if (this.client) return this.client;
    const config = await this.loadConfig();
    const token = process.env[config.api_token_env];
    if (!token) {
      throw new Error(
        `ClickUp API token not found. Set the ${config.api_token_env} environment variable.`,
      );
    }
    this.client = new ClickUpClient(token);
    return this.client;
  }

  textResult(text) {
    return { content: [{ type: "text", text }] };
  }

  // ---------------------------------------------------------------------------
  // Tool: discover_clickup_structure
  // ---------------------------------------------------------------------------
  async discoverStructure() {
    const client = await this.getClient();
    const config = await this.loadConfig();

    const teamsResp = await client.getTeams();
    const teams = teamsResp.teams || [];
    if (teams.length === 0) {
      return this.textResult("No teams found in ClickUp account.");
    }

    const team = teams[0];
    config.team_id = team.id;

    const spacesResp = await client.getSpaces(team.id);
    const spaces = spacesResp.spaces || [];

    const structure = {
      team: { id: team.id, name: team.name },
      spaces: [],
    };

    for (const space of spaces) {
      // Update config space IDs if they match known spaces
      for (const [key, spaceConf] of Object.entries(config.spaces)) {
        if (
          space.name.toUpperCase().includes(spaceConf.name.toUpperCase()) ||
          spaceConf.name.toUpperCase().includes(space.name.toUpperCase())
        ) {
          config.spaces[key].id = space.id;
        }
      }

      const spaceEntry = { id: space.id, name: space.name, folders: [], lists: [] };

      // Get folders
      const foldersResp = await client.getFolders(space.id);
      for (const folder of foldersResp.folders || []) {
        const folderEntry = { id: folder.id, name: folder.name, lists: [] };
        const listsResp = await client.getLists(folder.id);
        for (const list of listsResp.lists || []) {
          folderEntry.lists.push({ id: list.id, name: list.name });
        }
        spaceEntry.folders.push(folderEntry);
      }

      // Get folderless lists
      const folderlessResp = await client.getFolderlessLists(space.id);
      for (const list of folderlessResp.lists || []) {
        spaceEntry.lists.push({ id: list.id, name: list.name });
      }

      structure.spaces.push(spaceEntry);
    }

    await this.saveConfig(config);

    return this.textResult(JSON.stringify(structure, null, 2));
  }

  // ---------------------------------------------------------------------------
  // Tool: fetch_clickup_task
  // ---------------------------------------------------------------------------
  async fetchTask(taskId) {
    const client = await this.getClient();
    const task = await client.getTask(taskId);

    const result = {
      id: task.id,
      name: task.name,
      description: task.description || "",
      description_original: task.description || "",
      description_translated: translateText(
        task.description || "",
        "pt-BR",
        "en",
      ),
      status: task.status?.status || null,
      assignees: (task.assignees || []).map((a) => ({
        id: a.id,
        username: a.username,
        email: a.email,
      })),
      priority: task.priority?.priority || null,
      list: task.list ? { id: task.list.id, name: task.list.name } : null,
      folder: task.folder ? { id: task.folder.id, name: task.folder.name } : null,
      space: task.space ? { id: task.space.id } : null,
      tags: (task.tags || []).map((t) => t.name),
      url: task.url || `https://app.clickup.com/t/${task.id}`,
    };

    return this.textResult(JSON.stringify(result, null, 2));
  }

  // ---------------------------------------------------------------------------
  // Tool: push_task_to_clickup
  // ---------------------------------------------------------------------------
  async pushTask({ workspace, task_title, task_description, product, priority, assignees }) {
    const client = await this.getClient();
    const config = await this.loadConfig();

    const productConf = config.product_mapping[product];
    if (!productConf) {
      throw new Error(
        `Unknown product "${product}". Known products: ${Object.keys(config.product_mapping).join(", ")}`,
      );
    }

    // Find the TECNICO space
    const tecnicoConf = config.spaces.tecnico;
    if (!tecnicoConf?.id) {
      throw new Error(
        "TECNICO space ID not configured. Run discover_clickup_structure first.",
      );
    }

    // Find the matching folder
    const foldersResp = await client.getFolders(tecnicoConf.id);
    const folder = (foldersResp.folders || []).find((f) =>
      f.name.startsWith(productConf.folder_prefix),
    );
    if (!folder) {
      throw new Error(
        `No folder found matching prefix "${productConf.folder_prefix}" in TECNICO space.`,
      );
    }

    // Find the first regular list in the folder
    const listsResp = await client.getLists(folder.id);
    const lists = listsResp.lists || [];
    const targetList = lists.find((l) =>
      l.name.startsWith(productConf.list_prefix),
    );
    if (!targetList) {
      throw new Error(
        `No list found matching prefix "${productConf.list_prefix}" in folder "${folder.name}".`,
      );
    }

    // Translate title and description to PT-BR
    const translatedTitle = translateText(task_title, "en", "pt-BR");
    const translatedDesc = translateText(task_description, "en", "pt-BR");

    const taskData = {
      name: translatedTitle,
      description: translatedDesc,
    };

    if (priority) {
      // ClickUp priority: 1=urgent, 2=high, 3=normal, 4=low
      const priorityMap = { urgent: 1, high: 2, normal: 3, low: 4 };
      taskData.priority = priorityMap[priority] || 3;
    }

    if (assignees && assignees.length > 0) {
      taskData.assignees = assignees.map(Number).filter((n) => !isNaN(n));
    }

    const created = await client.createTask(targetList.id, taskData);

    const result = {
      task_id: created.id,
      url: created.url || `https://app.clickup.com/t/${created.id}`,
      list: targetList.name,
      folder: folder.name,
    };

    return this.textResult(JSON.stringify(result, null, 2));
  }

  // ---------------------------------------------------------------------------
  // Tool: sync_task_status
  // ---------------------------------------------------------------------------
  async syncStatus(taskId, localStatus) {
    const client = await this.getClient();

    if (localStatus) {
      const clickupStatus = STATUS_MAP[localStatus];
      if (!clickupStatus) {
        throw new Error(
          `Unknown local status "${localStatus}". Valid: ${Object.keys(STATUS_MAP).join(", ")}`,
        );
      }
      await client.updateTask(taskId, { status: clickupStatus });
      return this.textResult(
        `Updated ClickUp task ${taskId} status to "${clickupStatus}" (from local "${localStatus}").`,
      );
    }

    // Fetch status from ClickUp
    const task = await client.getTask(taskId);
    const clickupStatus = task.status?.status?.toLowerCase() || "unknown";
    const mapped = REVERSE_STATUS_MAP[clickupStatus] || "pending";

    return this.textResult(
      JSON.stringify(
        {
          task_id: taskId,
          clickup_status: clickupStatus,
          local_status: mapped,
        },
        null,
        2,
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Tool: post_progress_update
  // ---------------------------------------------------------------------------
  async postProgress(taskId, message) {
    const client = await this.getClient();
    const commentText = `[Orchestrator] ${message}`;
    const result = await client.addComment(taskId, commentText);
    return this.textResult(
      JSON.stringify({ comment_id: result.id, task_id: taskId }, null, 2),
    );
  }

  // ---------------------------------------------------------------------------
  // Tool: update_task_description
  // ---------------------------------------------------------------------------
  async updateDescription(taskId, description) {
    const client = await this.getClient();
    const translated = translateText(description, "en", "pt-BR");
    await client.updateTask(taskId, { description: translated });
    return this.textResult(
      `Updated description for ClickUp task ${taskId} (marked for PT-BR translation).`,
    );
  }

  // ---------------------------------------------------------------------------
  // Tool: link_backlog_to_clickup
  // ---------------------------------------------------------------------------
  async linkBacklog(workspace, backlogTaskId, clickupTaskId) {
    const backlogPath = path.join(
      ORCHESTRATOR_HOME,
      "backlogs",
      `${workspace}-backlog.md`,
    );

    let content;
    try {
      content = await fs.readFile(backlogPath, "utf-8");
    } catch {
      throw new Error(`Backlog file not found for workspace "${workspace}".`);
    }

    const link = `**ClickUp:** [#${clickupTaskId}](https://app.clickup.com/t/${clickupTaskId})`;

    // Find the task line by backlog task ID pattern and append the link
    const lines = content.split("\n");
    let found = false;

    for (let i = 0; i < lines.length; i++) {
      if (
        lines[i].includes(backlogTaskId) &&
        lines[i].startsWith("- [")
      ) {
        // Remove existing ClickUp link if present
        lines[i] = lines[i].replace(/\s*\*\*ClickUp:\*\*\s*\[.*?\]\(.*?\)/, "");
        lines[i] = `${lines[i]} ${link}`;
        found = true;
        break;
      }
    }

    if (!found) {
      throw new Error(
        `Task matching "${backlogTaskId}" not found in ${workspace} backlog.`,
      );
    }

    await fs.writeFile(backlogPath, lines.join("\n"), "utf-8");
    return this.textResult(
      `Linked backlog task "${backlogTaskId}" to ClickUp #${clickupTaskId} in ${workspace} backlog.`,
    );
  }

  // ---------------------------------------------------------------------------
  // Tool handler setup
  // ---------------------------------------------------------------------------
  setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: "discover_clickup_structure",
          description:
            "Discover the full ClickUp workspace hierarchy (team -> spaces -> folders -> lists) and update config with discovered IDs.",
          inputSchema: {
            type: "object",
            properties: {},
          },
        },
        {
          name: "fetch_clickup_task",
          description:
            "Fetch full task details from ClickUp, including translated description (PT-BR -> English).",
          inputSchema: {
            type: "object",
            properties: {
              task_id: {
                type: "string",
                description: "The ClickUp task ID",
              },
            },
            required: ["task_id"],
          },
        },
        {
          name: "push_task_to_clickup",
          description:
            "Create a new task in ClickUp from a local backlog entry. Translates English to PT-BR and places it in the correct Space/Folder/List.",
          inputSchema: {
            type: "object",
            properties: {
              workspace: {
                type: "string",
                description: "Orchestrator workspace name",
              },
              task_title: {
                type: "string",
                description: "Task title in English",
              },
              task_description: {
                type: "string",
                description: "Task description in English",
              },
              product: {
                type: "string",
                enum: ["smart-die", "spot-fusion", "vision-king"],
                description: "Product for folder/list mapping",
              },
              priority: {
                type: "string",
                enum: ["urgent", "high", "normal", "low"],
                description: "Task priority",
              },
              assignees: {
                type: "array",
                items: { type: "string" },
                description: "ClickUp user IDs to assign",
              },
            },
            required: ["workspace", "task_title", "task_description", "product"],
          },
        },
        {
          name: "sync_task_status",
          description:
            "Sync task status between local orchestrator and ClickUp. Provide local_status to push, or omit to pull from ClickUp.",
          inputSchema: {
            type: "object",
            properties: {
              task_id: {
                type: "string",
                description: "The ClickUp task ID",
              },
              local_status: {
                type: "string",
                enum: ["pending", "running", "verifying", "complete", "failed"],
                description:
                  "Local status to push to ClickUp. Omit to pull status from ClickUp.",
              },
            },
            required: ["task_id"],
          },
        },
        {
          name: "post_progress_update",
          description:
            "Post a progress comment to a ClickUp task prefixed with [Orchestrator].",
          inputSchema: {
            type: "object",
            properties: {
              task_id: {
                type: "string",
                description: "The ClickUp task ID",
              },
              message: {
                type: "string",
                description: "Progress message to post",
              },
            },
            required: ["task_id", "message"],
          },
        },
        {
          name: "update_task_description",
          description:
            "Update a ClickUp task description, translating from English to PT-BR.",
          inputSchema: {
            type: "object",
            properties: {
              task_id: {
                type: "string",
                description: "The ClickUp task ID",
              },
              description: {
                type: "string",
                description: "New description in English",
              },
            },
            required: ["task_id", "description"],
          },
        },
        {
          name: "link_backlog_to_clickup",
          description:
            "Add a ClickUp cross-reference link to a local backlog task entry.",
          inputSchema: {
            type: "object",
            properties: {
              workspace: {
                type: "string",
                description: "Workspace name",
              },
              backlog_task_id: {
                type: "string",
                description:
                  "Pattern or substring to identify the task in the backlog",
              },
              clickup_task_id: {
                type: "string",
                description: "ClickUp task ID to link",
              },
            },
            required: ["workspace", "backlog_task_id", "clickup_task_id"],
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case "discover_clickup_structure":
            return await this.discoverStructure();

          case "fetch_clickup_task":
            return await this.fetchTask(args.task_id);

          case "push_task_to_clickup":
            return await this.pushTask(args);

          case "sync_task_status":
            return await this.syncStatus(args.task_id, args.local_status);

          case "post_progress_update":
            return await this.postProgress(args.task_id, args.message);

          case "update_task_description":
            return await this.updateDescription(args.task_id, args.description);

          case "link_backlog_to_clickup":
            return await this.linkBacklog(
              args.workspace,
              args.backlog_task_id,
              args.clickup_task_id,
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

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("ClickUp Connector MCP server running on stdio");
  }
}

const server = new ClickUpConnectorServer();
server.run().catch(console.error);
