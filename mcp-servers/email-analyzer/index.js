#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "fs/promises";
import path from "path";

const JARVIS_HOME =
  process.env.JARVIS_HOME || path.join(process.env.HOME, "JARVIS");

function getProjectCodesPath() {
  return path.join(JARVIS_HOME, "config", "project-codes.json");
}

function getPmoPath(code) {
  return path.join(JARVIS_HOME, "workspaces", "strokmatic", "pmo", code);
}

async function loadProjectCodes() {
  try {
    const data = await fs.readFile(getProjectCodesPath(), "utf-8");
    return JSON.parse(data);
  } catch {
    return {};
  }
}

async function loadParsedEmails(code) {
  const parsedDir = path.join(getPmoPath(code), "emails", "parsed");
  try {
    const files = await fs.readdir(parsedDir);
    const emails = [];
    for (const f of files.filter((f) => f.endsWith(".json"))) {
      const data = await fs.readFile(path.join(parsedDir, f), "utf-8");
      emails.push(JSON.parse(data));
    }
    return emails.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  } catch {
    return [];
  }
}

async function loadIndex(code) {
  const indexPath = path.join(getPmoPath(code), "emails", "index.json");
  try {
    return JSON.parse(await fs.readFile(indexPath, "utf-8"));
  } catch {
    return [];
  }
}

async function saveIndex(code, index) {
  const indexPath = path.join(getPmoPath(code), "emails", "index.json");
  await fs.mkdir(path.dirname(indexPath), { recursive: true });
  await fs.writeFile(indexPath, JSON.stringify(index, null, 2));
}

class EmailAnalyzerServer {
  constructor() {
    this.server = new Server(
      { name: "email-analyzer", version: "1.0.0" },
      { capabilities: { tools: {} } },
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
          name: "classify_email",
          description:
            "Classify an email into a project and category. Returns project code and category (technical/administrative/discussion/status). Use when the rule-based classifier couldn't determine the project or when category needs to be assigned.",
          inputSchema: {
            type: "object",
            properties: {
              email_hash: {
                type: "string",
                description: "Hash of the email to classify (from index.json)",
              },
              project_code: {
                type: "string",
                description:
                  "Project code to look up the email in. Required if email is already classified to a project.",
              },
              subject: { type: "string", description: "Email subject line" },
              sender: { type: "string", description: "Sender email address" },
              body_preview: {
                type: "string",
                description: "First 2000 chars of email body",
              },
            },
            required: ["subject", "sender", "body_preview"],
          },
        },
        {
          name: "extract_entities",
          description:
            "Extract structured entities from an email: dates, action items, participants, decisions, technical references. Updates the parsed JSON file with extracted data.",
          inputSchema: {
            type: "object",
            properties: {
              project_code: {
                type: "string",
                description: "Project code",
              },
              email_hash: {
                type: "string",
                description: "Email hash to extract from",
              },
              entities: {
                type: "object",
                description:
                  "Extracted entities object with keys: key_dates, action_items, decisions, technical_notes, participants, references",
                properties: {
                  key_dates: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        date: { type: "string" },
                        description: { type: "string" },
                        type: { type: "string", enum: ["deadline", "milestone", "meeting", "event"] },
                      },
                    },
                  },
                  action_items: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        item: { type: "string" },
                        assignee: { type: "string" },
                        due_date: { type: "string" },
                      },
                    },
                  },
                  decisions: { type: "array", items: { type: "string" } },
                  technical_notes: { type: "array", items: { type: "string" } },
                  references: { type: "array", items: { type: "string" } },
                },
              },
              category: {
                type: "string",
                enum: ["technical", "administrative", "discussion", "status"],
                description: "Email category",
              },
            },
            required: ["project_code", "email_hash", "entities", "category"],
          },
        },
        {
          name: "update_project_report",
          description:
            "Write or update the technical_report.md for a project. Provide the full markdown content for the report.",
          inputSchema: {
            type: "object",
            properties: {
              project_code: { type: "string", description: "Project code" },
              report_content: {
                type: "string",
                description: "Full markdown content for technical_report.md",
              },
            },
            required: ["project_code", "report_content"],
          },
        },
        {
          name: "extract_timeline",
          description:
            "Write the timeline.json for a project. Provide the array of timeline events.",
          inputSchema: {
            type: "object",
            properties: {
              project_code: { type: "string", description: "Project code" },
              events: {
                type: "array",
                description: "Timeline events sorted chronologically",
                items: {
                  type: "object",
                  properties: {
                    date: { type: "string", description: "ISO date" },
                    description: { type: "string" },
                    type: {
                      type: "string",
                      enum: ["deadline", "milestone", "meeting", "decision", "event"],
                    },
                    source_email: { type: "string", description: "Email hash or subject" },
                  },
                  required: ["date", "description", "type"],
                },
              },
            },
            required: ["project_code", "events"],
          },
        },
        {
          name: "get_project_emails",
          description:
            "Get all parsed emails for a project. Returns email metadata and body text for analysis.",
          inputSchema: {
            type: "object",
            properties: {
              project_code: { type: "string", description: "Project code" },
              include_body: {
                type: "boolean",
                description: "Include full body text (default: false, returns first 500 chars)",
                default: false,
              },
              unanalyzed_only: {
                type: "boolean",
                description: "Only return emails without a category set",
                default: false,
              },
            },
            required: ["project_code"],
          },
        },
        {
          name: "get_project_context",
          description:
            "Get current project context: existing report, timeline, and summary stats.",
          inputSchema: {
            type: "object",
            properties: {
              project_code: { type: "string", description: "Project code" },
            },
            required: ["project_code"],
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case "classify_email":
            return await this.classifyEmail(args);
          case "extract_entities":
            return await this.extractEntities(args);
          case "update_project_report":
            return await this.updateProjectReport(args);
          case "extract_timeline":
            return await this.extractTimeline(args);
          case "get_project_emails":
            return await this.getProjectEmails(args);
          case "get_project_context":
            return await this.getProjectContext(args);
          default:
            return {
              content: [{ type: "text", text: `Unknown tool: ${name}` }],
              isError: true,
            };
        }
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error: ${error.message}` }],
          isError: true,
        };
      }
    });
  }

  async classifyEmail(args) {
    const codes = await loadProjectCodes();
    const info = {
      subject: args.subject,
      sender: args.sender,
      body_preview: args.body_preview,
      available_projects: Object.entries(codes).map(([code, p]) => ({
        code,
        name: p.name,
        keywords: p.keywords,
      })),
    };

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(info, null, 2),
        },
      ],
    };
  }

  async extractEntities(args) {
    const { project_code, email_hash, entities, category } = args;
    const parsedDir = path.join(
      getPmoPath(project_code),
      "emails",
      "parsed",
    );

    // Find and update the parsed JSON file
    const files = await fs.readdir(parsedDir);
    let updated = false;
    for (const f of files.filter((f) => f.endsWith(".json"))) {
      const filePath = path.join(parsedDir, f);
      const data = JSON.parse(await fs.readFile(filePath, "utf-8"));
      if (data.hash === email_hash || data.hash?.startsWith(email_hash)) {
        data.entities = entities;
        data.category = category;
        await fs.writeFile(filePath, JSON.stringify(data, null, 2));
        updated = true;

        // Also update index
        const index = await loadIndex(project_code);
        const entry = index.find(
          (e) => e.hash === data.hash || e.hash?.startsWith(email_hash),
        );
        if (entry) {
          entry.category = category;
          entry.entities = entities;
          await saveIndex(project_code, index);
        }
        break;
      }
    }

    return {
      content: [
        {
          type: "text",
          text: updated
            ? `Updated entities and category for email ${email_hash} in project ${project_code}`
            : `Email ${email_hash} not found in project ${project_code}`,
        },
      ],
    };
  }

  async updateProjectReport(args) {
    const { project_code, report_content } = args;
    const reportPath = path.join(getPmoPath(project_code), "technical_report.md");

    // Backup existing report
    try {
      const existing = await fs.readFile(reportPath, "utf-8");
      const historyDir = path.join(getPmoPath(project_code), "history");
      await fs.mkdir(historyDir, { recursive: true });
      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      await fs.writeFile(
        path.join(historyDir, `technical_report_${ts}.md`),
        existing,
      );
    } catch {
      // No existing report
    }

    await fs.writeFile(reportPath, report_content);

    return {
      content: [
        {
          type: "text",
          text: `Updated technical_report.md for project ${project_code} (${report_content.length} chars)`,
        },
      ],
    };
  }

  async extractTimeline(args) {
    const { project_code, events } = args;
    const timelinePath = path.join(getPmoPath(project_code), "timeline.json");

    // Merge with existing timeline, dedup by (date, description)
    let existing = [];
    try {
      existing = JSON.parse(await fs.readFile(timelinePath, "utf-8"));
    } catch {
      // No existing timeline
    }

    const seen = new Set(existing.map((e) => `${e.date}|${e.description}`));
    for (const ev of events) {
      const key = `${ev.date}|${ev.description}`;
      if (!seen.has(key)) {
        existing.push(ev);
        seen.add(key);
      }
    }

    existing.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
    await fs.writeFile(timelinePath, JSON.stringify(existing, null, 2));

    return {
      content: [
        {
          type: "text",
          text: `Updated timeline.json for project ${project_code}: ${existing.length} events total`,
        },
      ],
    };
  }

  async getProjectEmails(args) {
    const { project_code, include_body, unanalyzed_only } = args;
    let emails = await loadParsedEmails(project_code);

    if (unanalyzed_only) {
      emails = emails.filter((e) => !e.category);
    }

    const result = emails.map((e) => ({
      hash: e.hash,
      subject: e.subject,
      sender_email: e.sender_email,
      date: e.date,
      category: e.category || null,
      attachments: (e.attachments || []).map((a) => a.filename),
      heuristics: e.heuristics || {},
      body_preview: include_body
        ? e.body_text
        : (e.body_text || "").slice(0, 500),
      entities: e.entities || null,
    }));

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            { project_code, email_count: result.length, emails: result },
            null,
            2,
          ),
        },
      ],
    };
  }

  async getProjectContext(args) {
    const { project_code } = args;
    const pmo = getPmoPath(project_code);
    const codes = await loadProjectCodes();
    const projectInfo = codes[project_code] || {};

    let report = null;
    try {
      report = await fs.readFile(path.join(pmo, "technical_report.md"), "utf-8");
    } catch {
      // no report yet
    }

    let timeline = [];
    try {
      timeline = JSON.parse(
        await fs.readFile(path.join(pmo, "timeline.json"), "utf-8"),
      );
    } catch {
      // no timeline yet
    }

    const index = await loadIndex(project_code);
    const stats = {
      total_emails: index.length,
      categorized: index.filter((e) => e.category).length,
      uncategorized: index.filter((e) => !e.category).length,
      by_category: {},
    };
    for (const e of index) {
      if (e.category) {
        stats.by_category[e.category] =
          (stats.by_category[e.category] || 0) + 1;
      }
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              project_code,
              name: projectInfo.name || "Unknown",
              stats,
              has_report: !!report,
              report_length: report ? report.length : 0,
              timeline_events: timeline.length,
              report_preview: report ? report.slice(0, 1000) : null,
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
    console.error("Email Analyzer MCP server running on stdio");
  }
}

const server = new EmailAnalyzerServer();
server.run().catch(console.error);
