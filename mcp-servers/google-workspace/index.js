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
  path.join(process.env.HOME, "JARVIS");

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
        "https://www.googleapis.com/auth/gmail.readonly",
        "https://www.googleapis.com/auth/chat.spaces.readonly",
        "https://www.googleapis.com/auth/chat.messages.readonly",
        "https://www.googleapis.com/auth/chat.memberships.readonly",
        "https://www.googleapis.com/auth/chat.messages",
      ],
      clientOptions: {
        subject: "pedro@lumesolutions.com",
      },
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
              "https://www.googleapis.com/auth/gmail.readonly",
              "https://www.googleapis.com/auth/chat.spaces.readonly",
              "https://www.googleapis.com/auth/chat.messages.readonly",
              "https://www.googleapis.com/auth/chat.messages",
        "https://www.googleapis.com/auth/chat.memberships.readonly",
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
            "https://www.googleapis.com/auth/gmail.readonly",
            "https://www.googleapis.com/auth/chat.spaces.readonly",
            "https://www.googleapis.com/auth/chat.messages.readonly",
            "https://www.googleapis.com/auth/chat.messages",
        "https://www.googleapis.com/auth/chat.memberships.readonly",
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
// Helper: extract text/html body from Gmail MIME payload (recursive)
// ---------------------------------------------------------------------------

function extractEmailBody(payload) {
  let text = "", html = "";
  function walk(part) {
    if (part.mimeType === "text/plain" && part.body?.data) {
      text += Buffer.from(part.body.data, "base64url").toString("utf-8");
    } else if (part.mimeType === "text/html" && part.body?.data) {
      html += Buffer.from(part.body.data, "base64url").toString("utf-8");
    }
    if (part.parts) part.parts.forEach(walk);
  }
  walk(payload);
  // Handle single-part messages (no parts array)
  if (!text && !html && payload.body?.data) {
    const decoded = Buffer.from(payload.body.data, "base64url").toString("utf-8");
    if (payload.mimeType === "text/html") html = decoded;
    else text = decoded;
  }
  return { text, html };
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
        description: "Read a Google Doc and return its content as markdown. Supports multi-tab documents — returns all tabs by default, or a specific tab by name.",
        inputSchema: {
          type: "object",
          properties: {
            doc_id: {
              type: "string",
              description: "Document ID or URL",
            },
            tab: {
              type: "string",
              description: "Tab title to read (case-insensitive). If omitted, returns all tabs.",
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
        name: "list_folder",
        description: "List files and subfolders in a Google Drive folder",
        inputSchema: {
          type: "object",
          properties: {
            folder_id: { type: "string", description: "Folder ID or URL" },
            recursive: { type: "boolean", description: "Include subfolders recursively (default: false)" },
            max_results: { type: "number", description: "Max results per page (default: 100)" },
            page_token: { type: "string", description: "Pagination token for next page" },
            auth_mode: authModeParam,
          },
          required: ["folder_id"],
        },
      },
      {
        name: "get_file_metadata",
        description: "Get detailed metadata for a file in Google Drive (no download)",
        inputSchema: {
          type: "object",
          properties: {
            file_id: { type: "string", description: "File ID or URL" },
            auth_mode: authModeParam,
          },
          required: ["file_id"],
        },
      },
      {
        name: "download_file",
        description: "Download a file from Google Drive to a local path (use sparingly — prefer reading in-place)",
        inputSchema: {
          type: "object",
          properties: {
            file_id: { type: "string", description: "File ID or URL" },
            local_path: { type: "string", description: "Absolute local path to save the file" },
            export_format: {
              type: "string",
              enum: ["pdf", "docx", "xlsx", "pptx", "csv", "txt", "md"],
              description: "Export format for Google-native files (Docs→pdf/docx/md, Sheets→xlsx/csv, Slides→pptx/pdf)",
            },
            auth_mode: authModeParam,
          },
          required: ["file_id", "local_path"],
        },
      },
      {
        name: "upload_file",
        description: "Upload a local file to a Google Drive folder",
        inputSchema: {
          type: "object",
          properties: {
            local_path: { type: "string", description: "Absolute local path of file to upload" },
            folder_id: { type: "string", description: "Target Drive folder ID" },
            name: { type: "string", description: "Override filename in Drive (default: use local filename)" },
            convert: { type: "boolean", description: "Convert to Google-native format (docx→Doc, xlsx→Sheet)" },
            auth_mode: authModeParam,
          },
          required: ["local_path", "folder_id"],
        },
      },
      {
        name: "move_file",
        description: "Move a file to a different folder in Google Drive",
        inputSchema: {
          type: "object",
          properties: {
            file_id: { type: "string", description: "File ID or URL" },
            target_folder_id: { type: "string", description: "Destination folder ID" },
            new_name: { type: "string", description: "Optional: rename the file during move" },
            auth_mode: authModeParam,
          },
          required: ["file_id", "target_folder_id"],
        },
      },
      {
        name: "create_folder",
        description: "Create a folder in Google Drive",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string", description: "Folder name" },
            parent_id: { type: "string", description: "Parent folder ID (default: My Drive root)" },
            auth_mode: authModeParam,
          },
          required: ["name"],
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
      // --- Gmail tools ---
      {
        name: "list_emails",
        description: "List Gmail messages with optional query filter. Returns metadata.",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Gmail search query (e.g. 'from:user@example.com after:2026/01/01')" },
            max_results: { type: "number", description: "Max messages to return (default 20, max 100)" },
            page_token: { type: "string", description: "Pagination token from previous response" },
            auth_mode: authModeParam,
          },
        },
      },
      {
        name: "read_email",
        description: "Read a full Gmail message by ID. Returns headers, body text, and attachment metadata.",
        inputSchema: {
          type: "object",
          properties: {
            message_id: { type: "string", description: "Gmail message ID" },
            auth_mode: authModeParam,
          },
          required: ["message_id"],
        },
      },
      {
        name: "search_emails",
        description: "Search Gmail using full query syntax. Returns matching message list with metadata.",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Gmail search query" },
            max_results: { type: "number", description: "Max results (default 20, max 100)" },
            page_token: { type: "string", description: "Pagination token" },
            auth_mode: authModeParam,
          },
          required: ["query"],
        },
      },
      {
        name: "get_labels",
        description: "List all Gmail labels (system and custom)",
        inputSchema: {
          type: "object",
          properties: {
            auth_mode: authModeParam,
          },
        },
      },
      {
        name: "download_attachment",
        description: "Download a Gmail attachment by message ID and attachment ID to a local path",
        inputSchema: {
          type: "object",
          properties: {
            message_id: { type: "string", description: "Gmail message ID" },
            attachment_id: { type: "string", description: "Attachment ID" },
            filename: { type: "string", description: "Original filename" },
            local_path: { type: "string", description: "Absolute local path to save the file" },
            auth_mode: authModeParam,
          },
          required: ["message_id", "attachment_id", "local_path"],
        },
      },

      // --- Google Chat tools ---
      {
        name: "list_chat_spaces",
        description: "List all Google Chat spaces/rooms/DMs the user belongs to",
        inputSchema: {
          type: "object",
          properties: {
            filter: { type: "string", description: 'Filter expression (e.g. "spaceType = \\"SPACE\\"" or "spaceType = \\"GROUP_CHAT\\"")' },
            page_size: { type: "number", description: "Max results per page (default 100, max 1000)" },
            page_token: { type: "string", description: "Pagination token from previous response" },
            auth_mode: authModeParam,
          },
        },
      },
      {
        name: "get_chat_space",
        description: "Get details of a specific Google Chat space (name, type, member count)",
        inputSchema: {
          type: "object",
          properties: {
            space_name: { type: "string", description: 'Space resource name (format: spaces/{space})' },
            auth_mode: authModeParam,
          },
          required: ["space_name"],
        },
      },
      {
        name: "list_chat_members",
        description: "List members of a Google Chat space",
        inputSchema: {
          type: "object",
          properties: {
            space_name: { type: "string", description: 'Space resource name (format: spaces/{space})' },
            page_size: { type: "number", description: "Max results per page (default 100)" },
            page_token: { type: "string", description: "Pagination token from previous response" },
            auth_mode: authModeParam,
          },
          required: ["space_name"],
        },
      },
      {
        name: "list_chat_messages",
        description: "List messages in a Google Chat space with optional date filters",
        inputSchema: {
          type: "object",
          properties: {
            space_name: { type: "string", description: 'Space resource name (format: spaces/{space})' },
            filter: { type: "string", description: 'Filter expression (e.g. "createTime > \\"2026-01-01T00:00:00Z\\"")' },
            page_size: { type: "number", description: "Max results per page (default 100, max 1000)" },
            page_token: { type: "string", description: "Pagination token from previous response" },
            order_by: { type: "string", description: 'Sort order (e.g. "createTime ASC" or "createTime DESC")' },
            auth_mode: authModeParam,
          },
          required: ["space_name"],
        },
      },
      {
        name: "read_chat_message",
        description: "Get a single Google Chat message with full content",
        inputSchema: {
          type: "object",
          properties: {
            message_name: { type: "string", description: 'Message resource name (format: spaces/{space}/messages/{message})' },
            auth_mode: authModeParam,
          },
          required: ["message_name"],
        },
      },
      {
        name: "send_chat_message",
        description: "Send a text message to a Google Chat space or DM",
        inputSchema: {
          type: "object",
          properties: {
            space_name: { type: "string", description: 'Space resource name (format: spaces/{space})' },
            text: { type: "string", description: "Message text to send" },
            thread_name: { type: "string", description: 'Optional thread name to reply to (format: spaces/{space}/threads/{thread})' },
            auth_mode: authModeParam,
          },
          required: ["space_name", "text"],
        },
      },
      {
        name: "download_chat_attachment",
        description: "Download an attachment from a Google Chat message to a local path",
        inputSchema: {
          type: "object",
          properties: {
            attachment_name: { type: "string", description: 'Attachment resource name (format: spaces/{space}/messages/{message}/attachments/{attachment})' },
            local_path: { type: "string", description: "Absolute local path to save the file" },
            auth_mode: authModeParam,
          },
          required: ["attachment_name", "local_path"],
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
        const file = await drive.files.get({ fileId: docId, fields: "parents", supportsAllDrives: true });
        const previousParents = (file.data.parents || []).join(",");
        await drive.files.update({
          fileId: docId,
          addParents: args.folder_id,
          removeParents: previousParents,
          fields: "id, parents",
          supportsAllDrives: true,
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

    const res = await withRetry(() =>
      docs.documents.get({ documentId: docId, includeTabsContent: true }),
    );

    const tabs = res.data.tabs;
    if (tabs && tabs.length > 0) {
      // Multi-tab support
      const requestedTab = args.tab?.toLowerCase();
      const sections = [];

      for (const tab of tabs) {
        const title = tab.tabProperties?.title || "Untitled";
        if (requestedTab && title.toLowerCase() !== requestedTab) continue;

        // Build a pseudo-document object the converter expects
        const tabDoc = {
          body: tab.documentTab?.body,
          lists: tab.documentTab?.lists,
        };
        const md = this.docsToMd.convert(tabDoc);
        if (md.trim()) {
          sections.push(tabs.length > 1 ? `# Tab: ${title}\n\n${md}` : md);
        }
      }

      if (requestedTab && sections.length === 0) {
        const available = tabs.map((t) => t.tabProperties?.title).join(", ");
        return this.textResult(`Tab "${args.tab}" not found. Available tabs: ${available}`);
      }

      return this.textResult(sections.join("\n\n---\n\n"));
    }

    // Fallback for documents without tabs
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
        fields: "files(id, name, modifiedTime, webViewLink, owners, driveId)",
        orderBy: "modifiedTime desc",
        includeItemsFromAllDrives: true,
        supportsAllDrives: true,
        corpora: "allDrives",
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
          supportsAllDrives: true,
        });
        const previousParents = (file.data.parents || []).join(",");
        await drive.files.update({
          fileId: spreadsheetId,
          addParents: args.folder_id,
          removeParents: previousParents,
          fields: "id, parents",
          supportsAllDrives: true,
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
          supportsAllDrives: true,
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
        fields: "files(id, name, mimeType, modifiedTime, webViewLink, size, owners, driveId, parents)",
        orderBy: "modifiedTime desc",
        includeItemsFromAllDrives: true,
        supportsAllDrives: true,
        corpora: "allDrives",
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
      driveId: f.driveId || null,
      parents: f.parents || [],
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

  async listFolder(args) {
    const auth = await this.authManager.getAuth(args.auth_mode);
    const drive = google.drive({ version: "v3", auth });
    const folderId = extractFileId(args.folder_id);
    const maxResults = args.max_results || 100;

    const FIELDS = "files(id, name, mimeType, modifiedTime, size, md5Checksum, webViewLink, description), nextPageToken";
    const FOLDER_MIME = "application/vnd.google-apps.folder";

    const listPage = async (parentId, pageToken) => {
      const q = `'${parentId}' in parents and trashed=false`;
      return withRetry(() =>
        drive.files.list({
          q,
          pageSize: Math.min(maxResults, 1000),
          fields: FIELDS,
          orderBy: "folder,name",
          pageToken: pageToken || undefined,
          includeItemsFromAllDrives: true,
          supportsAllDrives: true,
        }),
      );
    };

    if (!args.recursive) {
      const res = await listPage(folderId, args.page_token);
      const items = res.data.files || [];
      const files = items.filter((f) => f.mimeType !== FOLDER_MIME).map((f) => ({
        id: f.id, name: f.name, mimeType: f.mimeType,
        modifiedTime: f.modifiedTime, size: f.size,
        md5Checksum: f.md5Checksum, webViewLink: f.webViewLink, description: f.description,
      }));
      const folders = items.filter((f) => f.mimeType === FOLDER_MIME).map((f) => ({
        id: f.id, name: f.name, webViewLink: f.webViewLink,
      }));

      return this.textResult(JSON.stringify({
        files, folders, nextPageToken: res.data.nextPageToken || null,
        totalCount: files.length + folders.length,
      }, null, 2));
    }

    // Recursive BFS
    const allFiles = [];
    const allFolders = [];
    const queue = [{ id: folderId, prefix: "" }];

    while (queue.length > 0 && allFiles.length + allFolders.length < maxResults) {
      const { id: currentId, prefix } = queue.shift();
      let pageToken = null;

      do {
        const res = await listPage(currentId, pageToken);
        const items = res.data.files || [];
        for (const f of items) {
          const itemPath = prefix ? `${prefix}/${f.name}` : f.name;
          if (f.mimeType === FOLDER_MIME) {
            allFolders.push({ id: f.id, name: f.name, path: itemPath + "/", webViewLink: f.webViewLink });
            queue.push({ id: f.id, prefix: itemPath });
          } else {
            allFiles.push({
              id: f.id, name: f.name, path: itemPath, mimeType: f.mimeType,
              modifiedTime: f.modifiedTime, size: f.size,
              md5Checksum: f.md5Checksum, webViewLink: f.webViewLink, description: f.description,
            });
          }
        }
        pageToken = res.data.nextPageToken;
      } while (pageToken && allFiles.length + allFolders.length < maxResults);
    }

    return this.textResult(JSON.stringify({
      files: allFiles, folders: allFolders,
      totalCount: allFiles.length + allFolders.length,
    }, null, 2));
  }

  async getFileMetadata(args) {
    const auth = await this.authManager.getAuth(args.auth_mode);
    const drive = google.drive({ version: "v3", auth });
    const fileId = extractFileId(args.file_id);

    const res = await withRetry(() =>
      drive.files.get({
        fileId,
        fields: "id, name, mimeType, size, modifiedTime, createdTime, owners, shared, parents, webViewLink, description, md5Checksum, lastModifyingUser, version, driveId",
        supportsAllDrives: true,
      }),
    );

    const f = res.data;
    return this.textResult(JSON.stringify({
      id: f.id, name: f.name, mimeType: f.mimeType, size: f.size,
      modifiedTime: f.modifiedTime, createdTime: f.createdTime,
      owners: (f.owners || []).map((o) => ({ name: o.displayName, email: o.emailAddress })),
      shared: f.shared, parents: f.parents,
      webViewLink: f.webViewLink, description: f.description,
      md5Checksum: f.md5Checksum,
      lastModifyingUser: f.lastModifyingUser
        ? { name: f.lastModifyingUser.displayName, email: f.lastModifyingUser.emailAddress }
        : null,
      version: f.version,
    }, null, 2));
  }

  async downloadFile(args) {
    const auth = await this.authManager.getAuth(args.auth_mode);
    const drive = google.drive({ version: "v3", auth });
    const fileId = extractFileId(args.file_id);
    const localPath = args.local_path;

    // Create parent directory
    await fs.mkdir(path.dirname(localPath), { recursive: true });

    // Get file metadata to determine type
    const meta = await withRetry(() =>
      drive.files.get({ fileId, fields: "mimeType, name, size, md5Checksum", supportsAllDrives: true }),
    );

    const mimeType = meta.data.mimeType;
    const GOOGLE_MIMES = {
      "application/vnd.google-apps.document": true,
      "application/vnd.google-apps.spreadsheet": true,
      "application/vnd.google-apps.presentation": true,
    };
    const EXPORT_MIMES = {
      pdf: "application/pdf",
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      csv: "text/csv",
      txt: "text/plain",
    };

    let writtenSize = 0;

    if (GOOGLE_MIMES[mimeType]) {
      // Google-native file: export
      let exportFormat = args.export_format || "pdf";
      if (mimeType.includes("spreadsheet") && !args.export_format) exportFormat = "xlsx";
      if (mimeType.includes("presentation") && !args.export_format) exportFormat = "pdf";

      if (exportFormat === "md" && mimeType.includes("document")) {
        // Special case: export Doc as Markdown using our converter
        const docs = google.docs({ version: "v1", auth });
        const docRes = await withRetry(() => docs.documents.get({ documentId: fileId }));
        const markdown = this.docsToMd.convert(docRes.data);
        await fs.writeFile(localPath, markdown, "utf-8");
        writtenSize = Buffer.byteLength(markdown);
      } else {
        const exportMime = EXPORT_MIMES[exportFormat] || EXPORT_MIMES.pdf;
        const res = await withRetry(() =>
          drive.files.export({ fileId, mimeType: exportMime, supportsAllDrives: true }, { responseType: "arraybuffer" }),
        );
        await fs.writeFile(localPath, Buffer.from(res.data));
        writtenSize = res.data.byteLength;
      }
    } else {
      // Binary file: direct download
      const res = await withRetry(() =>
        drive.files.get({ fileId, alt: "media", supportsAllDrives: true }, { responseType: "arraybuffer" }),
      );
      await fs.writeFile(localPath, Buffer.from(res.data));
      writtenSize = res.data.byteLength;
    }

    return this.textResult(JSON.stringify({
      path: localPath,
      name: meta.data.name,
      size: writtenSize,
      mimeType,
      md5Checksum: meta.data.md5Checksum || null,
    }, null, 2));
  }

  async uploadFile(args) {
    const auth = await this.authManager.getAuth(args.auth_mode);
    const drive = google.drive({ version: "v3", auth });
    const localPath = args.local_path;
    const fileName = args.name || path.basename(localPath);

    // Detect MIME type from extension
    const EXT_MIMES = {
      ".pdf": "application/pdf",
      ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      ".csv": "text/csv",
      ".txt": "text/plain",
      ".md": "text/markdown",
      ".json": "application/json",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".gif": "image/gif",
      ".svg": "image/svg+xml",
      ".html": "text/html",
      ".zip": "application/zip",
    };
    const ext = path.extname(localPath).toLowerCase();
    const detectedMime = EXT_MIMES[ext] || "application/octet-stream";

    const fileContent = await fs.readFile(localPath);
    const { Readable } = await import("stream");
    const stream = Readable.from(fileContent);

    const requestBody = {
      name: fileName,
      parents: [args.folder_id],
    };

    // Convert to Google-native format if requested
    if (args.convert) {
      const CONVERT_MAP = {
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "application/vnd.google-apps.document",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "application/vnd.google-apps.spreadsheet",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation": "application/vnd.google-apps.presentation",
        "text/csv": "application/vnd.google-apps.spreadsheet",
      };
      if (CONVERT_MAP[detectedMime]) {
        requestBody.mimeType = CONVERT_MAP[detectedMime];
      }
    }

    const res = await withRetry(() =>
      drive.files.create({
        requestBody,
        media: { mimeType: detectedMime, body: stream },
        fields: "id, name, mimeType, size, webViewLink",
        supportsAllDrives: true,
      }),
    );

    return this.textResult(JSON.stringify({
      fileId: res.data.id,
      name: res.data.name,
      url: res.data.webViewLink,
      mimeType: res.data.mimeType,
      size: res.data.size,
    }, null, 2));
  }

  async moveFile(args) {
    const auth = await this.authManager.getAuth(args.auth_mode);
    const drive = google.drive({ version: "v3", auth });
    const fileId = extractFileId(args.file_id);
    const targetFolderId = args.target_folder_id;

    // Get current parents
    const current = await withRetry(() =>
      drive.files.get({ fileId, fields: "parents, name", supportsAllDrives: true }),
    );
    const previousParents = (current.data.parents || []).join(",");

    const updateParams = {
      fileId,
      addParents: targetFolderId,
      removeParents: previousParents,
      fields: "id, name, parents, webViewLink",
      supportsAllDrives: true,
    };
    if (args.new_name) {
      updateParams.requestBody = { name: args.new_name };
    }

    const res = await withRetry(() => drive.files.update(updateParams));

    return this.textResult(JSON.stringify({
      fileId: res.data.id,
      name: res.data.name,
      newParent: targetFolderId,
      url: res.data.webViewLink,
    }, null, 2));
  }

  async createFolder(args) {
    const auth = await this.authManager.getAuth(args.auth_mode);
    const drive = google.drive({ version: "v3", auth });

    const requestBody = {
      name: args.name,
      mimeType: "application/vnd.google-apps.folder",
    };
    if (args.parent_id) {
      requestBody.parents = [args.parent_id];
    }

    const res = await withRetry(() =>
      drive.files.create({
        requestBody,
        fields: "id, name, webViewLink",
        supportsAllDrives: true,
      }),
    );

    return this.textResult(JSON.stringify({
      folderId: res.data.id,
      name: res.data.name,
      url: res.data.webViewLink,
    }, null, 2));
  }

  // ---------------------------------------------------------------------------
  // Gmail tools
  // ---------------------------------------------------------------------------

  async _fetchEmailList(query, maxResults, pageToken, auth) {
    const gmail = google.gmail({ version: "v1", auth });
    const max = Math.min(maxResults || 20, 100);

    const listRes = await withRetry(() =>
      gmail.users.messages.list({
        userId: "me",
        q: query || undefined,
        maxResults: max,
        pageToken: pageToken || undefined,
      }),
    );

    const messageIds = listRes.data.messages || [];
    if (messageIds.length === 0) {
      return {
        messages: [],
        nextPageToken: listRes.data.nextPageToken || null,
        resultSizeEstimate: listRes.data.resultSizeEstimate || 0,
      };
    }

    // Batch-fetch metadata for each message
    const messages = await Promise.all(
      messageIds.map(async (msg) => {
        const res = await withRetry(() =>
          gmail.users.messages.get({
            userId: "me",
            id: msg.id,
            format: "metadata",
            metadataHeaders: ["From", "To", "Subject", "Date"],
          }),
        );
        const headers = {};
        for (const h of res.data.payload?.headers || []) {
          headers[h.name.toLowerCase()] = h.value;
        }
        return {
          id: res.data.id,
          threadId: res.data.threadId,
          subject: headers.subject || "",
          from: headers.from || "",
          to: headers.to || "",
          date: headers.date || "",
          snippet: res.data.snippet || "",
          labelIds: res.data.labelIds || [],
        };
      }),
    );

    return {
      messages,
      nextPageToken: listRes.data.nextPageToken || null,
      resultSizeEstimate: listRes.data.resultSizeEstimate || 0,
    };
  }

  async listEmails(args) {
    const auth = await this.authManager.getAuth(args.auth_mode);
    const result = await this._fetchEmailList(args.query, args.max_results, args.page_token, auth);
    return this.textResult(JSON.stringify(result, null, 2));
  }

  async readEmail(args) {
    const auth = await this.authManager.getAuth(args.auth_mode);
    const gmail = google.gmail({ version: "v1", auth });

    const res = await withRetry(() =>
      gmail.users.messages.get({
        userId: "me",
        id: args.message_id,
        format: "full",
      }),
    );

    const payload = res.data.payload;
    const headers = {};
    for (const h of payload?.headers || []) {
      const key = h.name.toLowerCase();
      if (["from", "to", "cc", "subject", "date", "message-id"].includes(key)) {
        headers[h.name] = h.value;
      }
    }

    const body = extractEmailBody(payload);

    // Extract attachment metadata
    const attachments = [];
    function walkAttachments(part) {
      if (part.body?.attachmentId) {
        attachments.push({
          attachmentId: part.body.attachmentId,
          filename: part.filename || "unknown",
          mimeType: part.mimeType,
          size: part.body.size || 0,
        });
      }
      if (part.parts) part.parts.forEach(walkAttachments);
    }
    walkAttachments(payload);

    return this.textResult(JSON.stringify({
      id: res.data.id,
      threadId: res.data.threadId,
      headers,
      body,
      attachments,
      labelIds: res.data.labelIds || [],
      snippet: res.data.snippet || "",
    }, null, 2));
  }

  async searchEmails(args) {
    const auth = await this.authManager.getAuth(args.auth_mode);
    const result = await this._fetchEmailList(args.query, args.max_results, args.page_token, auth);
    return this.textResult(JSON.stringify(result, null, 2));
  }

  async getLabels(args) {
    const auth = await this.authManager.getAuth(args.auth_mode);
    const gmail = google.gmail({ version: "v1", auth });

    const res = await withRetry(() =>
      gmail.users.labels.list({ userId: "me" }),
    );

    const labels = (res.data.labels || [])
      .map((l) => ({
        id: l.id,
        name: l.name,
        type: l.type,
        messagesTotal: l.messagesTotal,
        messagesUnread: l.messagesUnread,
      }))
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""));

    return this.textResult(JSON.stringify(labels, null, 2));
  }

  async downloadAttachment(args) {
    const auth = await this.authManager.getAuth(args.auth_mode);
    const gmail = google.gmail({ version: "v1", auth });

    const res = await withRetry(() =>
      gmail.users.messages.attachments.get({
        userId: "me",
        messageId: args.message_id,
        id: args.attachment_id,
      }),
    );

    const buffer = Buffer.from(res.data.data, "base64url");
    await fs.mkdir(path.dirname(args.local_path), { recursive: true });
    await fs.writeFile(args.local_path, buffer);

    return this.textResult(JSON.stringify({
      path: args.local_path,
      filename: args.filename || path.basename(args.local_path),
      size: buffer.length,
    }, null, 2));
  }

  // ---------------------------------------------------------------------------
  // Google Chat read tools
  // ---------------------------------------------------------------------------

  async listChatSpaces(args) {
    const auth = await this.authManager.getAuth(args.auth_mode);
    const chat = google.chat({ version: "v1", auth });

    const res = await withRetry(() =>
      chat.spaces.list({
        filter: args.filter || undefined,
        pageSize: Math.min(args.page_size || 100, 1000),
        pageToken: args.page_token || undefined,
      }),
    );

    const spaces = (res.data.spaces || []).map((s) => ({
      name: s.name,
      displayName: s.displayName || "",
      type: s.type,
      spaceType: s.spaceType,
      singleUserBotDm: s.singleUserBotDm || false,
      threaded: s.spaceThreadingState === "THREADED_MESSAGES",
      membershipCount: s.membershipCount,
    }));

    return this.textResult(JSON.stringify({
      spaces,
      nextPageToken: res.data.nextPageToken || null,
    }, null, 2));
  }

  async getChatSpace(args) {
    const auth = await this.authManager.getAuth(args.auth_mode);
    const chat = google.chat({ version: "v1", auth });

    const res = await withRetry(() =>
      chat.spaces.get({ name: args.space_name }),
    );

    return this.textResult(JSON.stringify({
      name: res.data.name,
      displayName: res.data.displayName || "",
      type: res.data.type,
      spaceType: res.data.spaceType,
      singleUserBotDm: res.data.singleUserBotDm || false,
      threaded: res.data.spaceThreadingState === "THREADED_MESSAGES",
      membershipCount: res.data.membershipCount,
      spaceDetails: res.data.spaceDetails || null,
      createTime: res.data.createTime,
    }, null, 2));
  }

  async listChatMembers(args) {
    const auth = await this.authManager.getAuth(args.auth_mode);
    const chat = google.chat({ version: "v1", auth });

    const res = await withRetry(() =>
      chat.spaces.members.list({
        parent: args.space_name,
        pageSize: args.page_size || 100,
        pageToken: args.page_token || undefined,
      }),
    );

    const members = (res.data.memberships || []).map((m) => ({
      name: m.name,
      state: m.state,
      role: m.role,
      member: m.member ? {
        name: m.member.name,
        displayName: m.member.displayName,
        type: m.member.type,
        domainId: m.member.domainId,
      } : null,
      createTime: m.createTime,
    }));

    return this.textResult(JSON.stringify({
      members,
      nextPageToken: res.data.nextPageToken || null,
    }, null, 2));
  }

  async listChatMessages(args) {
    const auth = await this.authManager.getAuth(args.auth_mode);
    const chat = google.chat({ version: "v1", auth });

    const res = await withRetry(() =>
      chat.spaces.messages.list({
        parent: args.space_name,
        filter: args.filter || undefined,
        pageSize: Math.min(args.page_size || 100, 1000),
        pageToken: args.page_token || undefined,
        orderBy: args.order_by || undefined,
      }),
    );

    const messages = (res.data.messages || []).map((m) => ({
      name: m.name,
      sender: m.sender ? {
        name: m.sender.name,
        displayName: m.sender.displayName,
        type: m.sender.type,
      } : null,
      text: m.text || "",
      formattedText: m.formattedText || "",
      createTime: m.createTime,
      lastUpdateTime: m.lastUpdateTime,
      thread: m.thread ? { name: m.thread.name } : null,
      space: m.space ? { name: m.space.name } : null,
      argumentText: m.argumentText || undefined,
      attachmentCount: (m.attachment || []).length,
    }));

    return this.textResult(JSON.stringify({
      messages,
      nextPageToken: res.data.nextPageToken || null,
    }, null, 2));
  }

  async readChatMessage(args) {
    const auth = await this.authManager.getAuth(args.auth_mode);
    const chat = google.chat({ version: "v1", auth });

    const res = await withRetry(() =>
      chat.spaces.messages.get({ name: args.message_name }),
    );

    const m = res.data;
    return this.textResult(JSON.stringify({
      name: m.name,
      sender: m.sender ? {
        name: m.sender.name,
        displayName: m.sender.displayName,
        type: m.sender.type,
      } : null,
      text: m.text || "",
      formattedText: m.formattedText || "",
      createTime: m.createTime,
      lastUpdateTime: m.lastUpdateTime,
      thread: m.thread ? { name: m.thread.name, threadKey: m.thread.threadKey } : null,
      space: m.space ? { name: m.space.name } : null,
      annotations: m.annotations || [],
      attachment: (m.attachment || []).map((a) => ({
        name: a.name,
        contentName: a.contentName,
        contentType: a.contentType,
        driveDataRef: a.driveDataRef || null,
        thumbnailUri: a.thumbnailUri || null,
      })),
      emojiReactionSummaries: m.emojiReactionSummaries || [],
    }, null, 2));
  }

  async sendChatMessage(args) {
    const auth = await this.authManager.getAuth(args.auth_mode);
    const chat = google.chat({ version: "v1", auth });

    const requestBody = { text: args.text };
    if (args.thread_name) {
      requestBody.thread = { name: args.thread_name };
    }

    const params = {
      parent: args.space_name,
      requestBody,
    };
    if (args.thread_name) {
      params.messageReplyOption = "REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD";
    }

    const res = await withRetry(() => chat.spaces.messages.create(params));
    const m = res.data;

    return this.textResult(JSON.stringify({
      name: m.name,
      text: m.text || "",
      createTime: m.createTime,
      thread: m.thread ? { name: m.thread.name } : null,
      space: m.space ? { name: m.space.name } : null,
    }, null, 2));
  }

  async downloadChatAttachment(args) {
    const auth = await this.authManager.getAuth(args.auth_mode);
    const chat = google.chat({ version: "v1", auth });

    // Step 1: get attachment metadata to obtain the attachmentDataRef
    const attRes = await withRetry(() =>
      chat.spaces.messages.attachments.get({
        name: args.attachment_name,
      }),
    );

    const att = attRes.data;
    const resourceName = att.attachmentDataRef && att.attachmentDataRef.resourceName;
    if (!resourceName) {
      // If no data ref, the attachment may be a Drive file
      if (att.driveDataRef) {
        return this.textResult(JSON.stringify({
          error: "Attachment is a Drive file, use download_file instead",
          driveFileId: att.driveDataRef.driveFileId,
        }, null, 2));
      }
      throw new Error("Attachment has no downloadable data reference");
    }

    // Step 2: download via direct HTTP with auth token (media.download can
    // fail with Insufficient Permission for user-uploaded attachments when
    // using domain-wide delegation; the REST endpoint works)
    const client = await auth.getClient();
    const tokenRes = await client.getAccessToken();
    const accessToken = tokenRes.token || tokenRes;
    const url = `https://chat.googleapis.com/v1/media/${encodeURIComponent(resourceName)}?alt=media`;

    const fetchRes = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!fetchRes.ok) {
      const errText = await fetchRes.text();
      throw new Error(`Download failed (${fetchRes.status}): ${errText}`);
    }

    const buffer = Buffer.from(await fetchRes.arrayBuffer());
    await fs.mkdir(path.dirname(args.local_path), { recursive: true });
    await fs.writeFile(args.local_path, buffer);

    return this.textResult(JSON.stringify({
      path: args.local_path,
      filename: path.basename(args.local_path),
      size: buffer.length,
    }, null, 2));
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
          case "list_folder":
            return await this.listFolder(args);
          case "get_file_metadata":
            return await this.getFileMetadata(args);
          case "download_file":
            return await this.downloadFile(args);
          case "upload_file":
            return await this.uploadFile(args);
          case "move_file":
            return await this.moveFile(args);
          case "create_folder":
            return await this.createFolder(args);
          case "google_oauth_callback":
            return await this.oauthCallback(args);
          case "list_emails":
            return await this.listEmails(args);
          case "read_email":
            return await this.readEmail(args);
          case "search_emails":
            return await this.searchEmails(args);
          case "get_labels":
            return await this.getLabels(args);
          case "download_attachment":
            return await this.downloadAttachment(args);
          case "list_chat_spaces":
            return await this.listChatSpaces(args);
          case "get_chat_space":
            return await this.getChatSpace(args);
          case "list_chat_members":
            return await this.listChatMembers(args);
          case "list_chat_messages":
            return await this.listChatMessages(args);
          case "read_chat_message":
            return await this.readChatMessage(args);
          case "send_chat_message":
            return await this.sendChatMessage(args);
          case "download_chat_attachment":
            return await this.downloadChatAttachment(args);
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
