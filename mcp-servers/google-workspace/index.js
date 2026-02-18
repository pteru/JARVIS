#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "fs/promises";
import path from "path";
import { google } from "googleapis";

const ORCHESTRATOR_HOME =
  process.env.ORCHESTRATOR_HOME ||
  path.join(process.env.HOME, "claude-orchestrator");

const CREDENTIALS_DIR = path.join(ORCHESTRATOR_HOME, "config", "credentials");
const SERVICE_ACCOUNT_PATH = path.join(CREDENTIALS_DIR, "gcp-service-account.json");
const OAUTH_CONFIG_PATH = path.join(CREDENTIALS_DIR, "google-oauth-config.json");
const OAUTH_TOKENS_PATH = path.join(CREDENTIALS_DIR, "google-oauth-tokens.json");

// ---------------------------------------------------------------------------
// Markdown <-> Google Docs conversion utilities
// ---------------------------------------------------------------------------

class MarkdownToDocsConverter {
  convert(markdown) {
    if (!markdown) return [];
    const lines = markdown.split("\n");
    const requests = [];
    let index = 1; // Docs content starts at index 1

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const { text, style, isBullet, isNumbered, runs } = this.parseLine(line);

      if (text === null) continue;

      const insertText = text + "\n";
      requests.push({
        insertText: {
          location: { index },
          text: insertText,
        },
      });

      // Apply paragraph style
      if (style) {
        requests.push({
          updateParagraphStyle: {
            range: { startIndex: index, endIndex: index + insertText.length },
            paragraphStyle: { namedStyleType: style },
            fields: "namedStyleType",
          },
        });
      }

      // Apply bullet/numbered list
      if (isBullet || isNumbered) {
        requests.push({
          createParagraphBullets: {
            range: { startIndex: index, endIndex: index + insertText.length },
            bulletPreset: isNumbered
              ? "NUMBERED_DECIMAL_NESTED"
              : "BULLET_DISC_CIRCLE_SQUARE",
          },
        });
      }

      // Apply text formatting runs (bold, italic, links)
      if (runs && runs.length > 0) {
        for (const run of runs) {
          const startIdx = index + run.start;
          const endIdx = index + run.end;
          if (run.bold) {
            requests.push({
              updateTextStyle: {
                range: { startIndex: startIdx, endIndex: endIdx },
                textStyle: { bold: true },
                fields: "bold",
              },
            });
          }
          if (run.italic) {
            requests.push({
              updateTextStyle: {
                range: { startIndex: startIdx, endIndex: endIdx },
                textStyle: { italic: true },
                fields: "italic",
              },
            });
          }
          if (run.link) {
            requests.push({
              updateTextStyle: {
                range: { startIndex: startIdx, endIndex: endIdx },
                textStyle: { link: { url: run.link } },
                fields: "link",
              },
            });
          }
        }
      }

      index += insertText.length;
    }

    return requests;
  }

  parseLine(line) {
    // Headings
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const rawText = headingMatch[2];
      const { plainText, runs } = this.parseInlineFormatting(rawText);
      return {
        text: plainText,
        style: `HEADING_${level}`,
        isBullet: false,
        isNumbered: false,
        runs,
      };
    }

    // Bullet lists
    const bulletMatch = line.match(/^[\-\*]\s+(.+)/);
    if (bulletMatch) {
      const { plainText, runs } = this.parseInlineFormatting(bulletMatch[1]);
      return {
        text: plainText,
        style: null,
        isBullet: true,
        isNumbered: false,
        runs,
      };
    }

    // Numbered lists
    const numberedMatch = line.match(/^\d+\.\s+(.+)/);
    if (numberedMatch) {
      const { plainText, runs } = this.parseInlineFormatting(numberedMatch[1]);
      return {
        text: plainText,
        style: null,
        isBullet: false,
        isNumbered: true,
        runs,
      };
    }

    // Empty lines
    if (line.trim() === "") {
      return { text: "", style: "NORMAL_TEXT", isBullet: false, isNumbered: false, runs: null };
    }

    // Normal paragraph
    const { plainText, runs } = this.parseInlineFormatting(line);
    return {
      text: plainText,
      style: "NORMAL_TEXT",
      isBullet: false,
      isNumbered: false,
      runs,
    };
  }

  parseInlineFormatting(text) {
    const runs = [];
    let plainText = "";
    let i = 0;
    const src = text;

    while (i < src.length) {
      // Links: [text](url)
      const linkMatch = src.slice(i).match(/^\[([^\]]+)\]\(([^)]+)\)/);
      if (linkMatch) {
        const start = plainText.length;
        plainText += linkMatch[1];
        runs.push({ start, end: plainText.length, link: linkMatch[2] });
        i += linkMatch[0].length;
        continue;
      }

      // Bold+Italic: ***text*** or ___text___
      const boldItalicMatch = src.slice(i).match(/^(\*{3}|_{3})(.+?)\1/);
      if (boldItalicMatch) {
        const start = plainText.length;
        plainText += boldItalicMatch[2];
        runs.push({ start, end: plainText.length, bold: true, italic: true });
        i += boldItalicMatch[0].length;
        continue;
      }

      // Bold: **text** or __text__
      const boldMatch = src.slice(i).match(/^(\*{2}|_{2})(.+?)\1/);
      if (boldMatch) {
        const start = plainText.length;
        plainText += boldMatch[2];
        runs.push({ start, end: plainText.length, bold: true });
        i += boldMatch[0].length;
        continue;
      }

      // Italic: *text* or _text_
      const italicMatch = src.slice(i).match(/^(\*|_)(.+?)\1/);
      if (italicMatch) {
        const start = plainText.length;
        plainText += italicMatch[2];
        runs.push({ start, end: plainText.length, italic: true });
        i += italicMatch[0].length;
        continue;
      }

      plainText += src[i];
      i++;
    }

    return { plainText, runs };
  }
}

class DocsToMarkdownConverter {
  convert(document) {
    if (!document || !document.body || !document.body.content) return "";
    const elements = document.body.content;
    const lines = [];
    const listInfo = document.lists || {};

    for (const element of elements) {
      if (!element.paragraph) continue;

      const para = element.paragraph;
      const style = para.paragraphStyle?.namedStyleType || "NORMAL_TEXT";
      const bullet = para.bullet;

      let lineText = this.extractParagraphText(para);

      // Apply heading prefix
      const headingMatch = style.match(/^HEADING_(\d)$/);
      if (headingMatch) {
        const level = parseInt(headingMatch[1]);
        lineText = "#".repeat(level) + " " + lineText;
      } else if (bullet) {
        const listId = bullet.listId;
        const nestingLevel = bullet.nestingLevel || 0;
        const indent = "  ".repeat(nestingLevel);
        const listProps = listInfo[listId];
        const glyphType =
          listProps?.listProperties?.nestingLevels?.[nestingLevel]?.glyphType;
        if (
          glyphType &&
          (glyphType.includes("DECIMAL") || glyphType.includes("ALPHA"))
        ) {
          lineText = indent + "1. " + lineText;
        } else {
          lineText = indent + "- " + lineText;
        }
      }

      lines.push(lineText);
    }

    return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  extractParagraphText(para) {
    if (!para.elements) return "";
    let text = "";

    for (const elem of para.elements) {
      if (!elem.textRun) continue;
      let content = elem.textRun.content || "";
      // Remove trailing newline that Docs API adds per paragraph
      content = content.replace(/\n$/, "");

      const ts = elem.textRun.textStyle || {};
      const isBold = ts.bold === true;
      const isItalic = ts.italic === true;
      const link = ts.link?.url;

      if (link) {
        content = `[${content}](${link})`;
      } else if (isBold && isItalic) {
        content = `***${content}***`;
      } else if (isBold) {
        content = `**${content}**`;
      } else if (isItalic) {
        content = `*${content}*`;
      }

      text += content;
    }

    return text;
  }
}

// ---------------------------------------------------------------------------
// Auth Manager — dual-mode authentication
// ---------------------------------------------------------------------------

class AuthManager {
  constructor() {
    this._serviceAccountAuth = null;
    this._oauth2Client = null;
  }

  async getAuth(mode = "service_account") {
    if (mode === "oauth2") {
      return await this.getOAuth2Client();
    }
    return await this.getServiceAccountAuth();
  }

  async getServiceAccountAuth() {
    if (this._serviceAccountAuth) return this._serviceAccountAuth;

    const keyContent = await fs.readFile(SERVICE_ACCOUNT_PATH, "utf-8");
    const key = JSON.parse(keyContent);

    const auth = new google.auth.GoogleAuth({
      credentials: key,
      scopes: [
        "https://www.googleapis.com/auth/documents",
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/presentations",
        "https://www.googleapis.com/auth/drive",
      ],
    });

    this._serviceAccountAuth = auth;
    return auth;
  }

  async getOAuth2Client() {
    if (this._oauth2Client) return this._oauth2Client;

    const configContent = await fs.readFile(OAUTH_CONFIG_PATH, "utf-8");
    const config = JSON.parse(configContent);
    const { client_id, client_secret, redirect_uri } = config;

    const client = new google.auth.OAuth2(client_id, client_secret, redirect_uri);

    // Try to load stored tokens
    try {
      const tokensContent = await fs.readFile(OAUTH_TOKENS_PATH, "utf-8");
      const tokens = JSON.parse(tokensContent);
      client.setCredentials(tokens);

      // Set up automatic token refresh persistence
      client.on("tokens", async (newTokens) => {
        try {
          let existing = tokens;
          if (newTokens.refresh_token) {
            existing.refresh_token = newTokens.refresh_token;
          }
          existing.access_token = newTokens.access_token;
          existing.expiry_date = newTokens.expiry_date;
          await fs.writeFile(OAUTH_TOKENS_PATH, JSON.stringify(existing, null, 2), "utf-8");
        } catch {
          // Silently ignore token persistence errors
        }
      });
    } catch {
      // No tokens stored — caller must use google_oauth_callback flow
      throw new Error(
        "No OAuth2 tokens found. Please authorize first. Visit this URL:\n" +
          client.generateAuthUrl({
            access_type: "offline",
            prompt: "consent",
            scope: [
              "https://www.googleapis.com/auth/documents",
              "https://www.googleapis.com/auth/spreadsheets",
              "https://www.googleapis.com/auth/presentations",
              "https://www.googleapis.com/auth/drive",
            ],
          }),
      );
    }

    this._oauth2Client = client;
    return client;
  }

  getOAuth2AuthUrl() {
    // Build a client without tokens just to generate the URL
    return fs
      .readFile(OAUTH_CONFIG_PATH, "utf-8")
      .then((content) => {
        const config = JSON.parse(content);
        const client = new google.auth.OAuth2(
          config.client_id,
          config.client_secret,
          config.redirect_uri,
        );
        return client.generateAuthUrl({
          access_type: "offline",
          prompt: "consent",
          scope: [
            "https://www.googleapis.com/auth/documents",
            "https://www.googleapis.com/auth/spreadsheets",
            "https://www.googleapis.com/auth/presentations",
            "https://www.googleapis.com/auth/drive",
          ],
        });
      });
  }

  async exchangeCode(code) {
    const configContent = await fs.readFile(OAUTH_CONFIG_PATH, "utf-8");
    const config = JSON.parse(configContent);
    const client = new google.auth.OAuth2(
      config.client_id,
      config.client_secret,
      config.redirect_uri,
    );

    const { tokens } = await client.getToken(code);
    await fs.mkdir(path.dirname(OAUTH_TOKENS_PATH), { recursive: true });
    await fs.writeFile(OAUTH_TOKENS_PATH, JSON.stringify(tokens, null, 2), "utf-8");

    client.setCredentials(tokens);
    this._oauth2Client = client;

    return tokens;
  }

  clearCache() {
    this._serviceAccountAuth = null;
    this._oauth2Client = null;
  }
}

// ---------------------------------------------------------------------------
// Retry wrapper for Google API calls
// ---------------------------------------------------------------------------

async function withRetry(fn, maxAttempts = 3, delayMs = 1000) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const status = error?.response?.status || error?.code;
      const isRateLimit = status === 429 || status === 503;
      if (isRateLimit && attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, delayMs * attempt));
        continue;
      }
      throw error;
    }
  }
}

// ---------------------------------------------------------------------------
// Helper: extract doc/spreadsheet/presentation ID from URL or raw ID
// ---------------------------------------------------------------------------

function extractFileId(input) {
  if (!input) return input;
  // Match Google Docs/Sheets/Slides URL patterns
  const urlMatch = input.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (urlMatch) return urlMatch[1];
  // If it looks like a raw ID already
  return input.trim();
}

// ---------------------------------------------------------------------------
// Google Workspace MCP Server
// ---------------------------------------------------------------------------

class GoogleWorkspaceServer {
  constructor() {
    this.server = new Server(
      {
        name: "google-workspace",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
        },
      },
    );

    this.authManager = new AuthManager();
    this.mdToDocs = new MarkdownToDocsConverter();
    this.docsToMd = new DocsToMarkdownConverter();

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

  errorResult(message) {
    return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
  }

  // ---------------------------------------------------------------------------
  // Tool definitions
  // ---------------------------------------------------------------------------

  getToolDefinitions() {
    const authModeParam = {
      type: "string",
      enum: ["service_account", "oauth2"],
      description: "Authentication mode (default: service_account)",
    };

    return [
      {
        name: "create_doc",
        description: "Create a Google Doc, optionally with markdown content",
        inputSchema: {
          type: "object",
          properties: {
            title: { type: "string", description: "Document title" },
            content: {
              type: "string",
              description: "Optional markdown content for the document",
            },
            folder_id: {
              type: "string",
              description: "Optional Drive folder ID to create the doc in",
            },
            auth_mode: authModeParam,
          },
          required: ["title"],
        },
      },
      {
        name: "read_doc",
        description: "Read a Google Doc and return its content as markdown",
        inputSchema: {
          type: "object",
          properties: {
            doc_id: {
              type: "string",
              description: "Document ID or URL",
            },
            auth_mode: authModeParam,
          },
          required: ["doc_id"],
        },
      },
      {
        name: "update_doc",
        description: "Update a Google Doc with markdown content",
        inputSchema: {
          type: "object",
          properties: {
            doc_id: { type: "string", description: "Document ID or URL" },
            content: { type: "string", description: "Markdown content" },
            mode: {
              type: "string",
              enum: ["append", "replace", "insert"],
              description: "Update mode",
            },
            index: {
              type: "number",
              description: "Insert position (for insert mode)",
            },
            auth_mode: authModeParam,
          },
          required: ["doc_id", "content", "mode"],
        },
      },
      {
        name: "list_docs",
        description: "List Google Docs via Drive API",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query" },
            folder_id: { type: "string", description: "Folder ID to search in" },
            max_results: {
              type: "number",
              description: "Maximum results (default 20)",
            },
            auth_mode: authModeParam,
          },
          required: [],
        },
      },
      {
        name: "create_sheet",
        description: "Create a Google Spreadsheet",
        inputSchema: {
          type: "object",
          properties: {
            title: { type: "string", description: "Spreadsheet title" },
            data: {
              type: "array",
              items: { type: "array" },
              description: "Optional 2D array of initial data",
            },
            folder_id: { type: "string", description: "Optional folder ID" },
            auth_mode: authModeParam,
          },
          required: ["title"],
        },
      },
      {
        name: "read_sheet",
        description: "Read data from a Google Spreadsheet",
        inputSchema: {
          type: "object",
          properties: {
            spreadsheet_id: {
              type: "string",
              description: "Spreadsheet ID or URL",
            },
            range: {
              type: "string",
              description: 'Range to read (e.g. "Sheet1!A1:D10")',
            },
            auth_mode: authModeParam,
          },
          required: ["spreadsheet_id"],
        },
      },
      {
        name: "update_sheet",
        description: "Write data to a Google Spreadsheet",
        inputSchema: {
          type: "object",
          properties: {
            spreadsheet_id: { type: "string", description: "Spreadsheet ID or URL" },
            range: { type: "string", description: "Target range" },
            data: {
              type: "array",
              items: { type: "array" },
              description: "2D array of data to write",
            },
            mode: {
              type: "string",
              enum: ["overwrite", "append"],
              description: "Write mode",
            },
            auth_mode: authModeParam,
          },
          required: ["spreadsheet_id", "range", "data", "mode"],
        },
      },
      {
        name: "read_sheet_metadata",
        description: "Read spreadsheet metadata (sheet names, dimensions, named ranges)",
        inputSchema: {
          type: "object",
          properties: {
            spreadsheet_id: { type: "string", description: "Spreadsheet ID or URL" },
            auth_mode: authModeParam,
          },
          required: ["spreadsheet_id"],
        },
      },
      {
        name: "create_presentation",
        description: "Create a Google Slides presentation",
        inputSchema: {
          type: "object",
          properties: {
            title: { type: "string", description: "Presentation title" },
            template_id: {
              type: "string",
              description: "Optional template presentation ID to copy from",
            },
            auth_mode: authModeParam,
          },
          required: ["title"],
        },
      },
      {
        name: "add_slide",
        description: "Add a slide to a Google Slides presentation",
        inputSchema: {
          type: "object",
          properties: {
            presentation_id: {
              type: "string",
              description: "Presentation ID or URL",
            },
            layout: {
              type: "string",
              description: 'Slide layout (e.g. "TITLE_AND_BODY", "TITLE_ONLY", "BLANK")',
            },
            title: { type: "string", description: "Slide title text" },
            body: { type: "string", description: "Slide body text" },
            auth_mode: authModeParam,
          },
          required: ["presentation_id", "layout"],
        },
      },
      {
        name: "read_presentation",
        description: "Read a Google Slides presentation structure and text",
        inputSchema: {
          type: "object",
          properties: {
            presentation_id: {
              type: "string",
              description: "Presentation ID or URL",
            },
            auth_mode: authModeParam,
          },
          required: ["presentation_id"],
        },
      },
      {
        name: "search_drive",
        description: "Search Google Drive for files",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query" },
            type: {
              type: "string",
              enum: ["document", "spreadsheet", "presentation", "folder", "pdf", "image"],
              description: "Filter by file type",
            },
            folder_id: { type: "string", description: "Search within folder" },
            max_results: { type: "number", description: "Max results (default 20)" },
            auth_mode: authModeParam,
          },
          required: ["query"],
        },
      },
      {
        name: "share_file",
        description: "Share a Google Drive file",
        inputSchema: {
          type: "object",
          properties: {
            file_id: { type: "string", description: "File ID or URL" },
            email: { type: "string", description: "Email to share with" },
            role: {
              type: "string",
              enum: ["reader", "writer", "commenter"],
              description: "Permission role",
            },
            link_sharing: {
              type: "boolean",
              description: "Enable link sharing (anyone with link)",
            },
            auth_mode: authModeParam,
          },
          required: ["file_id", "role"],
        },
      },
      {
        name: "google_oauth_callback",
        description: "Exchange an OAuth2 authorization code for tokens",
        inputSchema: {
          type: "object",
          properties: {
            code: { type: "string", description: "Authorization code from OAuth flow" },
          },
          required: ["code"],
        },
      },
    ];
  }

  // ---------------------------------------------------------------------------
  // Tool implementations
  // ---------------------------------------------------------------------------

  async createDoc(args) {
    const auth = await this.authManager.getAuth(args.auth_mode);
    const docs = google.docs({ version: "v1", auth });
    const drive = google.drive({ version: "v3", auth });

    // Create the document
    const createRes = await withRetry(() =>
      docs.documents.create({ requestBody: { title: args.title } }),
    );
    const docId = createRes.data.documentId;

    // Move to folder if specified
    if (args.folder_id) {
      await withRetry(async () => {
        const file = await drive.files.get({ fileId: docId, fields: "parents" });
        const previousParents = (file.data.parents || []).join(",");
        await drive.files.update({
          fileId: docId,
          addParents: args.folder_id,
          removeParents: previousParents,
          fields: "id, parents",
        });
      });
    }

    // Add content if provided
    if (args.content) {
      const requests = this.mdToDocs.convert(args.content);
      if (requests.length > 0) {
        await withRetry(() =>
          docs.documents.batchUpdate({
            documentId: docId,
            requestBody: { requests },
          }),
        );
      }
    }

    return this.textResult(
      JSON.stringify(
        {
          documentId: docId,
          url: `https://docs.google.com/document/d/${docId}/edit`,
          title: args.title,
        },
        null,
        2,
      ),
    );
  }

  async readDoc(args) {
    const auth = await this.authManager.getAuth(args.auth_mode);
    const docs = google.docs({ version: "v1", auth });
    const docId = extractFileId(args.doc_id);

    const res = await withRetry(() => docs.documents.get({ documentId: docId }));
    const markdown = this.docsToMd.convert(res.data);

    return this.textResult(markdown);
  }

  async updateDoc(args) {
    const auth = await this.authManager.getAuth(args.auth_mode);
    const docs = google.docs({ version: "v1", auth });
    const docId = extractFileId(args.doc_id);

    if (args.mode === "replace") {
      // Get current document to find content length
      const currentDoc = await withRetry(() =>
        docs.documents.get({ documentId: docId }),
      );
      const body = currentDoc.data.body;
      const endIndex =
        body.content[body.content.length - 1]?.endIndex || 1;

      const requests = [];
      // Delete all existing content (leave the trailing newline at index 1)
      if (endIndex > 2) {
        requests.push({
          deleteContentRange: {
            range: { startIndex: 1, endIndex: endIndex - 1 },
          },
        });
      }

      // Insert new content
      const insertRequests = this.mdToDocs.convert(args.content);
      requests.push(...insertRequests);

      if (requests.length > 0) {
        await withRetry(() =>
          docs.documents.batchUpdate({
            documentId: docId,
            requestBody: { requests },
          }),
        );
      }
    } else if (args.mode === "append") {
      // Get document to find end index
      const currentDoc = await withRetry(() =>
        docs.documents.get({ documentId: docId }),
      );
      const body = currentDoc.data.body;
      const endIndex =
        body.content[body.content.length - 1]?.endIndex || 1;

      // Build requests that insert at the end
      const mdRequests = this.mdToDocs.convert(args.content);
      // Shift all indices to the end of document
      const offset = endIndex - 2; // -1 for trailing newline, -1 for 0-based
      const shiftedRequests = mdRequests.map((req) => {
        const shifted = JSON.parse(JSON.stringify(req));
        if (shifted.insertText?.location?.index !== undefined) {
          shifted.insertText.location.index += offset;
        }
        if (shifted.updateParagraphStyle?.range) {
          shifted.updateParagraphStyle.range.startIndex += offset;
          shifted.updateParagraphStyle.range.endIndex += offset;
        }
        if (shifted.createParagraphBullets?.range) {
          shifted.createParagraphBullets.range.startIndex += offset;
          shifted.createParagraphBullets.range.endIndex += offset;
        }
        if (shifted.updateTextStyle?.range) {
          shifted.updateTextStyle.range.startIndex += offset;
          shifted.updateTextStyle.range.endIndex += offset;
        }
        return shifted;
      });

      if (shiftedRequests.length > 0) {
        await withRetry(() =>
          docs.documents.batchUpdate({
            documentId: docId,
            requestBody: { requests: shiftedRequests },
          }),
        );
      }
    } else if (args.mode === "insert") {
      const insertIndex = args.index || 1;
      const mdRequests = this.mdToDocs.convert(args.content);
      const offset = insertIndex - 1;
      const shiftedRequests = mdRequests.map((req) => {
        const shifted = JSON.parse(JSON.stringify(req));
        if (shifted.insertText?.location?.index !== undefined) {
          shifted.insertText.location.index += offset;
        }
        if (shifted.updateParagraphStyle?.range) {
          shifted.updateParagraphStyle.range.startIndex += offset;
          shifted.updateParagraphStyle.range.endIndex += offset;
        }
        if (shifted.createParagraphBullets?.range) {
          shifted.createParagraphBullets.range.startIndex += offset;
          shifted.createParagraphBullets.range.endIndex += offset;
        }
        if (shifted.updateTextStyle?.range) {
          shifted.updateTextStyle.range.startIndex += offset;
          shifted.updateTextStyle.range.endIndex += offset;
        }
        return shifted;
      });

      if (shiftedRequests.length > 0) {
        await withRetry(() =>
          docs.documents.batchUpdate({
            documentId: docId,
            requestBody: { requests: shiftedRequests },
          }),
        );
      }
    }

    return this.textResult(`Document updated (mode: ${args.mode})`);
  }

  async listDocs(args) {
    const auth = await this.authManager.getAuth(args.auth_mode);
    const drive = google.drive({ version: "v3", auth });

    let q = "mimeType='application/vnd.google-apps.document' and trashed=false";
    if (args.query) {
      q += ` and fullText contains '${args.query.replace(/'/g, "\\'")}'`;
    }
    if (args.folder_id) {
      q += ` and '${args.folder_id}' in parents`;
    }

    const res = await withRetry(() =>
      drive.files.list({
        q,
        pageSize: args.max_results || 20,
        fields: "files(id, name, modifiedTime, webViewLink, owners)",
        orderBy: "modifiedTime desc",
      }),
    );

    const files = (res.data.files || []).map((f) => ({
      id: f.id,
      name: f.name,
      modifiedTime: f.modifiedTime,
      url: f.webViewLink,
      owner: f.owners?.[0]?.emailAddress,
    }));

    return this.textResult(JSON.stringify(files, null, 2));
  }

  async createSheet(args) {
    const auth = await this.authManager.getAuth(args.auth_mode);
    const sheets = google.sheets({ version: "v4", auth });
    const drive = google.drive({ version: "v3", auth });

    const createRes = await withRetry(() =>
      sheets.spreadsheets.create({
        requestBody: {
          properties: { title: args.title },
        },
      }),
    );

    const spreadsheetId = createRes.data.spreadsheetId;

    // Move to folder if specified
    if (args.folder_id) {
      await withRetry(async () => {
        const file = await drive.files.get({
          fileId: spreadsheetId,
          fields: "parents",
        });
        const previousParents = (file.data.parents || []).join(",");
        await drive.files.update({
          fileId: spreadsheetId,
          addParents: args.folder_id,
          removeParents: previousParents,
          fields: "id, parents",
        });
      });
    }

    // Write initial data if provided
    if (args.data && args.data.length > 0) {
      await withRetry(() =>
        sheets.spreadsheets.values.update({
          spreadsheetId,
          range: "Sheet1",
          valueInputOption: "USER_ENTERED",
          requestBody: { values: args.data },
        }),
      );
    }

    return this.textResult(
      JSON.stringify(
        {
          spreadsheetId,
          url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
          title: args.title,
        },
        null,
        2,
      ),
    );
  }

  async readSheet(args) {
    const auth = await this.authManager.getAuth(args.auth_mode);
    const sheets = google.sheets({ version: "v4", auth });
    const spreadsheetId = extractFileId(args.spreadsheet_id);
    const range = args.range || "Sheet1";

    const res = await withRetry(() =>
      sheets.spreadsheets.values.get({ spreadsheetId, range }),
    );

    const values = res.data.values || [];
    if (values.length === 0) {
      return this.textResult(JSON.stringify([], null, 2));
    }

    // Try to use first row as headers
    const headers = values[0];
    const hasHeaders =
      headers.length > 0 && headers.every((h) => typeof h === "string" && h.trim());

    if (hasHeaders && values.length > 1) {
      const objects = values.slice(1).map((row) => {
        const obj = {};
        headers.forEach((header, i) => {
          obj[header] = row[i] !== undefined ? row[i] : null;
        });
        return obj;
      });
      return this.textResult(JSON.stringify(objects, null, 2));
    }

    return this.textResult(JSON.stringify(values, null, 2));
  }

  async updateSheet(args) {
    const auth = await this.authManager.getAuth(args.auth_mode);
    const sheets = google.sheets({ version: "v4", auth });
    const spreadsheetId = extractFileId(args.spreadsheet_id);

    if (args.mode === "append") {
      await withRetry(() =>
        sheets.spreadsheets.values.append({
          spreadsheetId,
          range: args.range,
          valueInputOption: "USER_ENTERED",
          insertDataOption: "INSERT_ROWS",
          requestBody: { values: args.data },
        }),
      );
    } else {
      await withRetry(() =>
        sheets.spreadsheets.values.update({
          spreadsheetId,
          range: args.range,
          valueInputOption: "USER_ENTERED",
          requestBody: { values: args.data },
        }),
      );
    }

    return this.textResult(
      `Spreadsheet updated (${args.data.length} rows, mode: ${args.mode})`,
    );
  }

  async readSheetMetadata(args) {
    const auth = await this.authManager.getAuth(args.auth_mode);
    const sheets = google.sheets({ version: "v4", auth });
    const spreadsheetId = extractFileId(args.spreadsheet_id);

    const res = await withRetry(() =>
      sheets.spreadsheets.get({
        spreadsheetId,
        fields:
          "properties.title,sheets.properties,namedRanges",
      }),
    );

    const metadata = {
      title: res.data.properties?.title,
      sheets: (res.data.sheets || []).map((s) => ({
        title: s.properties?.title,
        sheetId: s.properties?.sheetId,
        rowCount: s.properties?.gridProperties?.rowCount,
        columnCount: s.properties?.gridProperties?.columnCount,
      })),
      namedRanges: (res.data.namedRanges || []).map((nr) => ({
        name: nr.name,
        range: nr.range,
      })),
    };

    return this.textResult(JSON.stringify(metadata, null, 2));
  }

  async createPresentation(args) {
    const auth = await this.authManager.getAuth(args.auth_mode);
    const drive = google.drive({ version: "v3", auth });
    const slides = google.slides({ version: "v1", auth });

    let presentationId;

    if (args.template_id) {
      // Copy template
      const templateId = extractFileId(args.template_id);
      const copyRes = await withRetry(() =>
        drive.files.copy({
          fileId: templateId,
          requestBody: { name: args.title },
        }),
      );
      presentationId = copyRes.data.id;
    } else {
      const createRes = await withRetry(() =>
        slides.presentations.create({
          requestBody: { title: args.title },
        }),
      );
      presentationId = createRes.data.presentationId;
    }

    return this.textResult(
      JSON.stringify(
        {
          presentationId,
          url: `https://docs.google.com/presentation/d/${presentationId}/edit`,
          title: args.title,
        },
        null,
        2,
      ),
    );
  }

  async addSlide(args) {
    const auth = await this.authManager.getAuth(args.auth_mode);
    const slides = google.slides({ version: "v1", auth });
    const presentationId = extractFileId(args.presentation_id);

    // Generate a unique object ID for the new slide
    const slideId = "slide_" + Date.now().toString(36);

    const requests = [
      {
        createSlide: {
          objectId: slideId,
          slideLayoutReference: {
            predefinedLayout: args.layout || "BLANK",
          },
        },
      },
    ];

    // Create the slide first
    const createRes = await withRetry(() =>
      slides.presentations.batchUpdate({
        presentationId,
        requestBody: { requests },
      }),
    );

    // Now read the slide to find placeholder shape IDs
    if (args.title || args.body) {
      const pres = await withRetry(() =>
        slides.presentations.get({ presentationId }),
      );

      const newSlide = pres.data.slides?.find((s) => s.objectId === slideId);
      if (newSlide) {
        const textRequests = [];
        for (const element of newSlide.pageElements || []) {
          const placeholder = element.shape?.placeholder;
          if (!placeholder) continue;

          if (placeholder.type === "TITLE" || placeholder.type === "CENTERED_TITLE") {
            if (args.title) {
              textRequests.push({
                insertText: {
                  objectId: element.objectId,
                  text: args.title,
                  insertionIndex: 0,
                },
              });
            }
          } else if (
            placeholder.type === "BODY" ||
            placeholder.type === "SUBTITLE"
          ) {
            if (args.body) {
              textRequests.push({
                insertText: {
                  objectId: element.objectId,
                  text: args.body,
                  insertionIndex: 0,
                },
              });
            }
          }
        }

        if (textRequests.length > 0) {
          await withRetry(() =>
            slides.presentations.batchUpdate({
              presentationId,
              requestBody: { requests: textRequests },
            }),
          );
        }
      }
    }

    return this.textResult(
      JSON.stringify({ slideId, presentationId, layout: args.layout }, null, 2),
    );
  }

  async readPresentation(args) {
    const auth = await this.authManager.getAuth(args.auth_mode);
    const slides = google.slides({ version: "v1", auth });
    const presentationId = extractFileId(args.presentation_id);

    const res = await withRetry(() =>
      slides.presentations.get({ presentationId }),
    );

    const presentation = {
      title: res.data.title,
      slideCount: res.data.slides?.length || 0,
      slides: (res.data.slides || []).map((slide, idx) => {
        const texts = [];
        for (const element of slide.pageElements || []) {
          if (element.shape?.text?.textElements) {
            let slideText = "";
            for (const te of element.shape.text.textElements) {
              if (te.textRun?.content) {
                slideText += te.textRun.content;
              }
            }
            if (slideText.trim()) {
              const placeholder = element.shape?.placeholder?.type || "TEXT";
              texts.push({ type: placeholder, content: slideText.trim() });
            }
          }
        }
        return {
          slideNumber: idx + 1,
          objectId: slide.objectId,
          texts,
        };
      }),
    };

    return this.textResult(JSON.stringify(presentation, null, 2));
  }

  async searchDrive(args) {
    const auth = await this.authManager.getAuth(args.auth_mode);
    const drive = google.drive({ version: "v3", auth });

    const mimeTypes = {
      document: "application/vnd.google-apps.document",
      spreadsheet: "application/vnd.google-apps.spreadsheet",
      presentation: "application/vnd.google-apps.presentation",
      folder: "application/vnd.google-apps.folder",
      pdf: "application/pdf",
      image: "image/",
    };

    let q = `fullText contains '${args.query.replace(/'/g, "\\'")}' and trashed=false`;
    if (args.type && mimeTypes[args.type]) {
      if (args.type === "image") {
        q += ` and mimeType contains 'image/'`;
      } else {
        q += ` and mimeType='${mimeTypes[args.type]}'`;
      }
    }
    if (args.folder_id) {
      q += ` and '${args.folder_id}' in parents`;
    }

    const res = await withRetry(() =>
      drive.files.list({
        q,
        pageSize: args.max_results || 20,
        fields: "files(id, name, mimeType, modifiedTime, webViewLink, size, owners)",
        orderBy: "modifiedTime desc",
      }),
    );

    const files = (res.data.files || []).map((f) => ({
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      modifiedTime: f.modifiedTime,
      url: f.webViewLink,
      size: f.size,
      owner: f.owners?.[0]?.emailAddress,
    }));

    return this.textResult(JSON.stringify(files, null, 2));
  }

  async shareFile(args) {
    const auth = await this.authManager.getAuth(args.auth_mode);
    const drive = google.drive({ version: "v3", auth });
    const fileId = extractFileId(args.file_id);

    const results = [];

    // Share with specific email
    if (args.email) {
      await withRetry(() =>
        drive.permissions.create({
          fileId,
          requestBody: {
            type: "user",
            role: args.role,
            emailAddress: args.email,
          },
          sendNotificationEmail: true,
        }),
      );
      results.push(`Shared with ${args.email} as ${args.role}`);
    }

    // Enable link sharing
    if (args.link_sharing) {
      await withRetry(() =>
        drive.permissions.create({
          fileId,
          requestBody: {
            type: "anyone",
            role: args.role,
          },
        }),
      );
      results.push(`Link sharing enabled (${args.role})`);
    }

    if (results.length === 0) {
      return this.errorResult(
        "No sharing action specified. Provide email and/or link_sharing.",
      );
    }

    return this.textResult(results.join("\n"));
  }

  async oauthCallback(args) {
    try {
      const tokens = await this.authManager.exchangeCode(args.code);
      return this.textResult(
        JSON.stringify(
          {
            success: true,
            message: "OAuth2 tokens stored successfully",
            has_refresh_token: !!tokens.refresh_token,
            expiry_date: tokens.expiry_date,
          },
          null,
          2,
        ),
      );
    } catch (error) {
      return this.errorResult(`OAuth2 token exchange failed: ${error.message}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Handler setup
  // ---------------------------------------------------------------------------

  setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: this.getToolDefinitions(),
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case "create_doc":
            return await this.createDoc(args);
          case "read_doc":
            return await this.readDoc(args);
          case "update_doc":
            return await this.updateDoc(args);
          case "list_docs":
            return await this.listDocs(args);
          case "create_sheet":
            return await this.createSheet(args);
          case "read_sheet":
            return await this.readSheet(args);
          case "update_sheet":
            return await this.updateSheet(args);
          case "read_sheet_metadata":
            return await this.readSheetMetadata(args);
          case "create_presentation":
            return await this.createPresentation(args);
          case "add_slide":
            return await this.addSlide(args);
          case "read_presentation":
            return await this.readPresentation(args);
          case "search_drive":
            return await this.searchDrive(args);
          case "share_file":
            return await this.shareFile(args);
          case "google_oauth_callback":
            return await this.oauthCallback(args);
          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        return this.errorResult(error.message);
      }
    });
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("Google Workspace MCP server running on stdio");
  }
}

const server = new GoogleWorkspaceServer();
server.run().catch(console.error);
