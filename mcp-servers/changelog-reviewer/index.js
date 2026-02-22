#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

import { ORCHESTRATOR_HOME } from "../lib/config-loader.js";

const CHANGELOGS_DIR = path.join(ORCHESTRATOR_HOME, "changelogs");
const LOGS_DIR = path.join(ORCHESTRATOR_HOME, "logs");
const PLANS_FILE = path.join(LOGS_DIR, "deployment-plans.json");
const CONFIG_PATH = path.join(
  ORCHESTRATOR_HOME,
  "config",
  "orchestrator",
  "workspaces.json",
);

class ChangelogReviewerServer {
  constructor() {
    this.server = new Server(
      {
        name: "changelog-reviewer",
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
          name: "review_changelog",
          description:
            "Review unreleased changelog entries for a workspace (or all workspaces)",
          inputSchema: {
            type: "object",
            properties: {
              workspace: {
                type: "string",
                description:
                  "Workspace name (optional — omit to review all workspaces)",
              },
            },
          },
        },
        {
          name: "propose_deployment_plan",
          description:
            "Analyze unreleased changelog entries and propose a deployment plan with branches and commits",
          inputSchema: {
            type: "object",
            properties: {
              workspace: {
                type: "string",
                description:
                  "Workspace name (optional — omit for all workspaces)",
              },
            },
          },
        },
        {
          name: "execute_deployment_plan",
          description:
            "Approve or reject a previously proposed deployment plan. If approved, returns git commands to run.",
          inputSchema: {
            type: "object",
            properties: {
              plan_id: {
                type: "string",
                description: "The ID of the previously proposed plan",
              },
              approved: {
                type: "boolean",
                description: "Whether to approve the plan",
              },
            },
            required: ["plan_id", "approved"],
          },
        },
        {
          name: "list_unreleased_changes",
          description:
            "Quick summary of unreleased changelog entry counts across workspaces",
          inputSchema: {
            type: "object",
            properties: {
              workspace: {
                type: "string",
                description: "Optional workspace filter",
              },
              limit: {
                type: "number",
                description: "Max number of workspaces to return",
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
          case "review_changelog":
            return await this.reviewChangelog(args?.workspace);
          case "propose_deployment_plan":
            return await this.proposeDeploymentPlan(args?.workspace);
          case "execute_deployment_plan":
            return await this.executeDeploymentPlan(
              args.plan_id,
              args.approved,
            );
          case "list_unreleased_changes":
            return await this.listUnreleasedChanges(
              args?.workspace,
              args?.limit,
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

  // --- Changelog Parsing ---

  /**
   * Parse a Keep a Changelog formatted file and return unreleased entries.
   * Unreleased = entries under `## Unreleased` or the most recent date header.
   */
  parseUnreleasedEntries(content) {
    const lines = content.split("\n");
    const sections = [];
    let currentDate = null;
    let currentSection = null;
    let foundFirst = false;

    for (const line of lines) {
      // Date header: ## YYYY-MM-DD or ## Unreleased
      const dateMatch = line.match(/^## (\d{4}-\d{2}-\d{2}|Unreleased)/);
      if (dateMatch) {
        if (foundFirst) break; // stop after the first date block
        currentDate = dateMatch[1];
        foundFirst = true;
        continue;
      }

      if (!foundFirst) continue;

      // Section header: ### Added, ### Changed, etc.
      const sectionMatch = line.match(/^### (Added|Changed|Fixed|Removed)/);
      if (sectionMatch) {
        currentSection = sectionMatch[1];
        continue;
      }

      // Another ## means next date block — stop
      if (line.startsWith("## ")) break;

      // Entry line
      const entryMatch = line.match(/^- (.+)/);
      if (entryMatch && currentSection) {
        sections.push({
          section: currentSection,
          text: entryMatch[1],
        });
      }
    }

    return { date: currentDate, entries: sections };
  }

  /**
   * Get all changelog file paths, optionally filtered to one workspace.
   */
  async getChangelogFiles(workspace) {
    const results = [];

    // Central changelogs
    try {
      const files = await fs.readdir(CHANGELOGS_DIR);
      for (const file of files) {
        if (!file.endsWith("-changelog.md")) continue;
        const wsName = file.replace("-changelog.md", "");
        if (workspace && wsName !== workspace) continue;
        results.push({ workspace: wsName, path: path.join(CHANGELOGS_DIR, file) });
      }
    } catch {
      // no changelogs dir
    }

    // Also check workspace-local CHANGELOG.md files
    if (workspace) {
      try {
        const config = JSON.parse(await fs.readFile(CONFIG_PATH, "utf-8"));
        const ws = config.workspaces?.[workspace];
        if (ws?.path) {
          const localPath = path.join(ws.path, "CHANGELOG.md");
          try {
            await fs.access(localPath);
            // Only add if not already covered by central
            if (!results.find((r) => r.workspace === workspace)) {
              results.push({ workspace, path: localPath });
            }
          } catch {
            // no local changelog
          }
        }
      } catch {
        // no config
      }
    }

    return results;
  }

  // --- Tool Implementations ---

  async reviewChangelog(workspace) {
    const files = await this.getChangelogFiles(workspace);
    if (files.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: workspace
              ? `No changelog found for workspace "${workspace}".`
              : "No changelog files found.",
          },
        ],
      };
    }

    const reviews = [];
    for (const { workspace: ws, path: filePath } of files) {
      const content = await fs.readFile(filePath, "utf-8");
      const { date, entries } = this.parseUnreleasedEntries(content);
      if (entries.length === 0) continue;

      // Group by section
      const grouped = {};
      for (const entry of entries) {
        if (!grouped[entry.section]) grouped[entry.section] = [];
        grouped[entry.section].push(entry.text);
      }

      reviews.push({
        workspace: ws,
        date,
        entry_count: entries.length,
        entries: grouped,
      });
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(reviews, null, 2),
        },
      ],
    };
  }

  async proposeDeploymentPlan(workspace) {
    const files = await this.getChangelogFiles(workspace);
    if (files.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: "No changelog files found to propose a deployment plan.",
          },
        ],
      };
    }

    const plans = [];

    for (const { workspace: ws, path: filePath } of files) {
      const content = await fs.readFile(filePath, "utf-8");
      const { date, entries } = this.parseUnreleasedEntries(content);
      if (entries.length === 0) continue;

      const branches = this.groupIntoBranches(entries, ws);
      const planId = crypto.randomUUID();

      const plan = {
        id: planId,
        workspace: ws,
        proposed_at: new Date().toISOString(),
        status: "proposed",
        date,
        branches,
        summary: `${branches.length} branch${branches.length !== 1 ? "es" : ""}, ${entries.length} entries`,
      };

      await this.savePlan(plan);
      plans.push(plan);
    }

    if (plans.length === 0) {
      return {
        content: [
          { type: "text", text: "No unreleased entries found to plan." },
        ],
      };
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(plans, null, 2),
        },
      ],
    };
  }

  async executeDeploymentPlan(planId, approved) {
    const plans = await this.loadPlans();
    const plan = plans.find((p) => p.id === planId);

    if (!plan) {
      return {
        content: [{ type: "text", text: `Plan not found: ${planId}` }],
      };
    }

    if (!approved) {
      plan.status = "rejected";
      await this.savePlans(plans);
      return {
        content: [
          {
            type: "text",
            text: `Plan ${planId} rejected. No actions will be taken.`,
          },
        ],
      };
    }

    plan.status = "approved";
    await this.savePlans(plans);

    // Generate git commands
    const commands = [];
    const wsPath = await this.getWorkspacePath(plan.workspace);
    const cdPrefix = wsPath ? `cd ${wsPath} && ` : "";

    for (const branch of plan.branches) {
      commands.push(`# Branch: ${branch.name}`);
      commands.push(`${cdPrefix}git checkout -b ${branch.name} ${branch.base}`);

      for (const commit of branch.commits) {
        if (commit.files_hint.length > 0) {
          commands.push(`${cdPrefix}git add ${commit.files_hint.join(" ")}`);
        }
        const escapedMsg = commit.message.replace(/'/g, "'\\''");
        commands.push(`${cdPrefix}git commit -m '${escapedMsg}'`);
      }

      commands.push(`${cdPrefix}git push -u origin ${branch.name}`);
      commands.push("");
    }

    return {
      content: [
        {
          type: "text",
          text: `Plan ${planId} approved. Git commands to execute:\n\n${commands.join("\n")}`,
        },
      ],
    };
  }

  async listUnreleasedChanges(workspace, limit) {
    const files = await this.getChangelogFiles(workspace);
    const workspaces = [];

    for (const { workspace: ws, path: filePath } of files) {
      const content = await fs.readFile(filePath, "utf-8");
      const { date, entries } = this.parseUnreleasedEntries(content);
      if (entries.length === 0) continue;

      workspaces.push({
        name: ws,
        unreleased_count: entries.length,
        last_entry_date: date,
      });
    }

    // Sort by count descending
    workspaces.sort((a, b) => b.unreleased_count - a.unreleased_count);

    const result = limit ? workspaces.slice(0, limit) : workspaces;

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ workspaces: result }, null, 2),
        },
      ],
    };
  }

  // --- Branch/Commit Grouping ---

  groupIntoBranches(entries, workspace) {
    // Group entries by section type
    const bySection = {};
    for (const entry of entries) {
      if (!bySection[entry.section]) bySection[entry.section] = [];
      bySection[entry.section].push(entry.text);
    }

    const sectionTypes = Object.keys(bySection);

    // If all entries are the same type, single branch
    // If mixed, check if they should be split
    if (sectionTypes.length === 1) {
      const section = sectionTypes[0];
      const prefix = this.branchPrefix(section);
      const slug = this.slugify(bySection[section][0]);
      return [
        {
          name: `${prefix}/${slug}`,
          base: "main",
          commits: this.buildCommits(bySection, workspace),
        },
      ];
    }

    // Mixed types: try grouping related entries, or use release/ branch
    // Heuristic: if there are features AND fixes, separate them
    const featureEntries = bySection["Added"] || [];
    const fixEntries = bySection["Fixed"] || [];
    const otherEntries = [
      ...(bySection["Changed"] || []),
      ...(bySection["Removed"] || []),
    ];

    const branches = [];

    if (featureEntries.length > 0) {
      const slug = this.slugify(featureEntries[0]);
      branches.push({
        name: `feature/${slug}`,
        base: "main",
        commits: this.buildCommitsForSection("Added", featureEntries, workspace),
      });
    }

    if (fixEntries.length > 0) {
      const slug = this.slugify(fixEntries[0]);
      branches.push({
        name: `fix/${slug}`,
        base: "main",
        commits: this.buildCommitsForSection("Fixed", fixEntries, workspace),
      });
    }

    if (otherEntries.length > 0) {
      const changeEntries = bySection["Changed"] || [];
      const removeEntries = bySection["Removed"] || [];
      const combined = {};
      if (changeEntries.length > 0) combined["Changed"] = changeEntries;
      if (removeEntries.length > 0) combined["Removed"] = removeEntries;
      const slug = this.slugify(otherEntries[0]);
      branches.push({
        name: `chore/${slug}`,
        base: "main",
        commits: this.buildCommits(combined, workspace),
      });
    }

    // If we ended up with no branches (shouldn't happen), fallback
    if (branches.length === 0) {
      return [
        {
          name: `release/${workspace}`,
          base: "main",
          commits: this.buildCommits(bySection, workspace),
        },
      ];
    }

    return branches;
  }

  buildCommits(bySection, workspace) {
    const commits = [];
    for (const [section, texts] of Object.entries(bySection)) {
      commits.push(...this.buildCommitsForSection(section, texts, workspace));
    }
    return commits;
  }

  buildCommitsForSection(section, texts, workspace) {
    const prefix = this.commitPrefix(section);

    // Group by module hint (text in parentheses like "Added (dashboard v1.1.0)")
    const byModule = {};
    for (const text of texts) {
      const moduleMatch = text.match(/^\*\*(.+?)\*\*/);
      const key = moduleMatch ? moduleMatch[1] : "_default";
      if (!byModule[key]) byModule[key] = [];
      byModule[key].push(text);
    }

    const commits = [];
    for (const [mod, modTexts] of Object.entries(byModule)) {
      const scope = mod !== "_default" ? `(${this.slugify(mod)})` : "";
      const summary =
        modTexts.length === 1
          ? modTexts[0].slice(0, 72)
          : `${modTexts.length} ${section.toLowerCase()} changes`;

      commits.push({
        message: `${prefix}${scope}: ${summary}`,
        files_hint: this.extractFileHints(modTexts, workspace),
        changelog_entries: modTexts.map((t) => `${section}: ${t}`),
      });
    }

    return commits;
  }

  extractFileHints(texts, workspace) {
    const hints = new Set();
    for (const text of texts) {
      // Look for file path patterns
      const pathMatches = text.matchAll(
        /[`"]?([a-zA-Z0-9_./-]+\.[a-zA-Z]{1,5})[`"]?/g,
      );
      for (const m of pathMatches) {
        hints.add(m[1]);
      }
      // Look for directory patterns
      const dirMatches = text.matchAll(
        /[`"]?([a-zA-Z0-9_-]+\/[a-zA-Z0-9_./-]+)[`"]?/g,
      );
      for (const m of dirMatches) {
        hints.add(m[1]);
      }
    }
    return [...hints];
  }

  branchPrefix(section) {
    switch (section) {
      case "Added":
        return "feature";
      case "Fixed":
        return "fix";
      case "Changed":
        return "chore";
      case "Removed":
        return "chore";
      default:
        return "release";
    }
  }

  commitPrefix(section) {
    switch (section) {
      case "Added":
        return "feat";
      case "Fixed":
        return "fix";
      case "Changed":
        return "refactor";
      case "Removed":
        return "chore";
      default:
        return "chore";
    }
  }

  slugify(text) {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40);
  }

  // --- Plan Storage ---

  async loadPlans() {
    try {
      const data = await fs.readFile(PLANS_FILE, "utf-8");
      return JSON.parse(data);
    } catch {
      return [];
    }
  }

  async savePlans(plans) {
    await fs.mkdir(LOGS_DIR, { recursive: true });
    await fs.writeFile(PLANS_FILE, JSON.stringify(plans, null, 2), "utf-8");
  }

  async savePlan(plan) {
    const plans = await this.loadPlans();
    plans.push(plan);
    await this.savePlans(plans);
  }

  async getWorkspacePath(workspace) {
    try {
      const config = JSON.parse(await fs.readFile(CONFIG_PATH, "utf-8"));
      return config.workspaces?.[workspace]?.path || null;
    } catch {
      return null;
    }
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("Changelog Reviewer MCP server running on stdio");
  }
}

const server = new ChangelogReviewerServer();
server.run().catch(console.error);
