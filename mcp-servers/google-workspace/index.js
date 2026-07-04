#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { MarkdownToDocsConverter, DocsToMarkdownConverter } from "./lib/converters.js";
import { AuthManager, toolDefinitions as authToolDefinitions, oauthCallback } from "./lib/auth.js";
import { errorResult } from "./lib/helpers.js";
import * as docs from "./lib/docs.js";
import * as sheets from "./lib/sheets.js";
import * as slides from "./lib/slides.js";
import * as drive from "./lib/drive.js";
import * as gmail from "./lib/gmail.js";
import * as chat from "./lib/chat.js";

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

    // Shared context passed to every per-service handler function
    this.ctx = {
      authManager: new AuthManager(),
      mdToDocs: new MarkdownToDocsConverter(),
      docsToMd: new DocsToMarkdownConverter(),
    };

    this.setupToolHandlers();

    this.server.onerror = (error) => console.error("[MCP Error]", error);
    process.on("SIGINT", async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  // Assembled in the same order as the pre-split monolithic definition list.
  getToolDefinitions() {
    return [
      ...docs.toolDefinitions,
      ...sheets.toolDefinitions,
      ...slides.toolDefinitions,
      ...drive.toolDefinitions,
      ...authToolDefinitions,
      ...gmail.toolDefinitions,
      ...chat.toolDefinitions,
    ];
  }

  setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: this.getToolDefinitions(),
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case "create_doc":
            return await docs.createDoc(this.ctx, args);
          case "read_doc":
            return await docs.readDoc(this.ctx, args);
          case "update_doc":
            return await docs.updateDoc(this.ctx, args);
          case "list_docs":
            return await docs.listDocs(this.ctx, args);
          case "create_sheet":
            return await sheets.createSheet(this.ctx, args);
          case "read_sheet":
            return await sheets.readSheet(this.ctx, args);
          case "update_sheet":
            return await sheets.updateSheet(this.ctx, args);
          case "read_sheet_metadata":
            return await sheets.readSheetMetadata(this.ctx, args);
          case "create_presentation":
            return await slides.createPresentation(this.ctx, args);
          case "add_slide":
            return await slides.addSlide(this.ctx, args);
          case "read_presentation":
            return await slides.readPresentation(this.ctx, args);
          case "search_drive":
            return await drive.searchDrive(this.ctx, args);
          case "share_file":
            return await drive.shareFile(this.ctx, args);
          case "list_folder":
            return await drive.listFolder(this.ctx, args);
          case "get_file_metadata":
            return await drive.getFileMetadata(this.ctx, args);
          case "download_file":
            return await drive.downloadFile(this.ctx, args);
          case "upload_file":
            return await drive.uploadFile(this.ctx, args);
          case "move_file":
            return await drive.moveFile(this.ctx, args);
          case "create_folder":
            return await drive.createFolder(this.ctx, args);
          case "google_oauth_callback":
            return await oauthCallback(this.ctx, args);
          case "list_emails":
            return await gmail.listEmails(this.ctx, args);
          case "read_email":
            return await gmail.readEmail(this.ctx, args);
          case "search_emails":
            return await gmail.searchEmails(this.ctx, args);
          case "get_labels":
            return await gmail.getLabels(this.ctx, args);
          case "download_attachment":
            return await gmail.downloadAttachment(this.ctx, args);
          case "list_chat_spaces":
            return await chat.listChatSpaces(this.ctx, args);
          case "get_chat_space":
            return await chat.getChatSpace(this.ctx, args);
          case "list_chat_members":
            return await chat.listChatMembers(this.ctx, args);
          case "list_chat_messages":
            return await chat.listChatMessages(this.ctx, args);
          case "read_chat_message":
            return await chat.readChatMessage(this.ctx, args);
          case "send_chat_message":
            return await chat.sendChatMessage(this.ctx, args);
          case "download_chat_attachment":
            return await chat.downloadChatAttachment(this.ctx, args);
          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        return errorResult(error.message);
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
