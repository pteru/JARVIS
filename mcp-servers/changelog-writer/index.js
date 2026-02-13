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

class ChangelogWriterServer {
  constructor() {
    this.server = new Server(
      {
        name: "changelog-writer",
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
          name: "add_changelog_entry",
          description:
            "Add an entry to a workspace changelog under the appropriate section",
          inputSchema: {
            type: "object",
            properties: {
              workspace: {
                type: "string",
                description: 'Workspace name (e.g., "api-backend")',
              },
              section: {
                type: "string",
                enum: ["Added", "Changed", "Fixed", "Removed"],
                description: "Changelog section",
              },
              entry: {
                type: "string",
                description: "Changelog entry text",
              },
            },
            required: ["workspace", "section", "entry"],
          },
        },
        {
          name: "get_changelog",
          description: "Get the full changelog for a workspace",
          inputSchema: {
            type: "object",
            properties: {
              workspace: {
                type: "string",
                description: "Workspace name",
              },
            },
            required: ["workspace"],
          },
        },
        {
          name: "get_recent_changes",
          description:
            "Get recent changelog entries across all workspaces for a given date range",
          inputSchema: {
            type: "object",
            properties: {
              days: {
                type: "number",
                description: "Number of days to look back (default: 7)",
              },
              workspace: {
                type: "string",
                description:
                  "Optional workspace filter; omit for all workspaces",
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
          case "add_changelog_entry":
            return await this.addChangelogEntry(
              args.workspace,
              args.section,
              args.entry,
            );

          case "get_changelog":
            return await this.getChangelog(args.workspace);

          case "get_recent_changes":
            return await this.getRecentChanges(args.days, args.workspace);

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

  getChangelogPath(workspace) {
    return path.join(
      ORCHESTRATOR_HOME,
      "changelogs",
      `${workspace}-changelog.md`,
    );
  }

  getTodayHeader() {
    return new Date().toISOString().split("T")[0];
  }

  async ensureChangelog(workspace) {
    const filePath = this.getChangelogPath(workspace);
    try {
      await fs.access(filePath);
    } catch {
      const initial = `# Changelog - ${workspace}\n\nAll notable changes to the ${workspace} workspace.\n\nFormat: [Keep a Changelog](https://keepachangelog.com/)\n`;
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, initial, "utf-8");
    }
    return filePath;
  }

  async addChangelogEntry(workspace, section, entry) {
    const filePath = await this.ensureChangelog(workspace);
    let content = await fs.readFile(filePath, "utf-8");

    const today = this.getTodayHeader();
    const dateHeader = `## ${today}`;
    const sectionHeader = `### ${section}`;
    const entryLine = `- ${entry}`;

    if (!content.includes(dateHeader)) {
      // Add new date section at top (after header block)
      const headerEnd = content.indexOf("\n\n", content.indexOf("\n\n") + 2);
      const before = content.slice(0, headerEnd + 2);
      const after = content.slice(headerEnd + 2);
      content = `${before}${dateHeader}\n\n${sectionHeader}\n${entryLine}\n\n${after}`;
    } else {
      // Date exists — find or create the section under it
      const dateIdx = content.indexOf(dateHeader);
      const nextDateIdx = content.indexOf("\n## ", dateIdx + dateHeader.length);
      const dateBlock =
        nextDateIdx === -1
          ? content.slice(dateIdx)
          : content.slice(dateIdx, nextDateIdx);

      if (dateBlock.includes(sectionHeader)) {
        // Append to existing section
        const sectionIdx =
          content.indexOf(sectionHeader, dateIdx) + sectionHeader.length;
        const insertIdx = content.indexOf("\n", sectionIdx) + 1;
        content =
          content.slice(0, insertIdx) +
          entryLine +
          "\n" +
          content.slice(insertIdx);
      } else {
        // Add new section at end of date block
        const insertIdx =
          nextDateIdx === -1 ? content.length : nextDateIdx;
        content =
          content.slice(0, insertIdx) +
          `${sectionHeader}\n${entryLine}\n\n` +
          content.slice(insertIdx);
      }
    }

    await fs.writeFile(filePath, content, "utf-8");

    // Also update workspace-local changelog if workspace path is configured
    await this.updateWorkspaceChangelog(workspace, section, entry);

    return {
      content: [
        {
          type: "text",
          text: `Added "${section}" entry to ${workspace} changelog: ${entry}`,
        },
      ],
    };
  }

  async updateWorkspaceChangelog(workspace, section, entry) {
    try {
      const configPath = path.join(
        ORCHESTRATOR_HOME,
        "config",
        "workspaces.json",
      );
      const config = JSON.parse(await fs.readFile(configPath, "utf-8"));
      const ws = config.workspaces?.[workspace];
      if (!ws?.path) return;

      const wsChangelogPath = path.join(ws.path, "CHANGELOG.md");
      let content;
      try {
        content = await fs.readFile(wsChangelogPath, "utf-8");
      } catch {
        content = `# Changelog\n\nAll notable changes to this project.\n\n`;
      }

      const today = this.getTodayHeader();
      const entryLine = `- ${entry}`;

      if (!content.includes(`## ${today}`)) {
        const insertIdx = content.indexOf("\n\n", content.indexOf("\n\n") + 2);
        if (insertIdx !== -1) {
          const before = content.slice(0, insertIdx + 2);
          const after = content.slice(insertIdx + 2);
          content = `${before}## ${today}\n\n### ${section}\n${entryLine}\n\n${after}`;
        }
      }

      await fs.writeFile(wsChangelogPath, content, "utf-8");
    } catch {
      // Silently skip if workspace config not found
    }
  }

  async getChangelog(workspace) {
    const filePath = await this.ensureChangelog(workspace);
    const content = await fs.readFile(filePath, "utf-8");

    return {
      content: [
        {
          type: "text",
          text: content,
        },
      ],
    };
  }

  async getRecentChanges(days = 7, workspace) {
    const changelogDir = path.join(ORCHESTRATOR_HOME, "changelogs");
    let files;

    try {
      files = await fs.readdir(changelogDir);
    } catch {
      return {
        content: [{ type: "text", text: "No changelogs directory found." }],
      };
    }

    if (workspace) {
      files = files.filter((f) => f.startsWith(workspace));
    }

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString().split("T")[0];

    const results = {};

    for (const file of files) {
      if (!file.endsWith("-changelog.md")) continue;
      const wsName = file.replace("-changelog.md", "");
      const content = await fs.readFile(
        path.join(changelogDir, file),
        "utf-8",
      );

      const sections = content.split("\n## ").slice(1);
      const recent = sections.filter((s) => {
        const dateMatch = s.match(/^(\d{4}-\d{2}-\d{2})/);
        return dateMatch && dateMatch[1] >= cutoffStr;
      });

      if (recent.length > 0) {
        results[wsName] = recent.map((s) => s.trim());
      }
    }

    return {
      content: [
        {
          type: "text",
          text:
            Object.keys(results).length > 0
              ? JSON.stringify(results, null, 2)
              : `No changes found in the last ${days} days.`,
        },
      ],
    };
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("Changelog Writer MCP server running on stdio");
  }
}

const server = new ChangelogWriterServer();
server.run().catch(console.error);
