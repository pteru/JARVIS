import fs from "fs/promises";
import path from "path";
import { google } from "googleapis";
import { withRetry, authModeParam, textResult } from "./helpers.js";

// ---------------------------------------------------------------------------
// Gmail tools
// ---------------------------------------------------------------------------

export const toolDefinitions = [
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
];

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
// Tool implementations
// ---------------------------------------------------------------------------

async function _fetchEmailList(query, maxResults, pageToken, auth) {
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

export async function listEmails(ctx, args) {
  const auth = await ctx.authManager.getAuth(args.auth_mode);
  const result = await _fetchEmailList(args.query, args.max_results, args.page_token, auth);
  return textResult(JSON.stringify(result, null, 2));
}

export async function readEmail(ctx, args) {
  const auth = await ctx.authManager.getAuth(args.auth_mode);
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

  return textResult(JSON.stringify({
    id: res.data.id,
    threadId: res.data.threadId,
    headers,
    body,
    attachments,
    labelIds: res.data.labelIds || [],
    snippet: res.data.snippet || "",
  }, null, 2));
}

export async function searchEmails(ctx, args) {
  const auth = await ctx.authManager.getAuth(args.auth_mode);
  const result = await _fetchEmailList(args.query, args.max_results, args.page_token, auth);
  return textResult(JSON.stringify(result, null, 2));
}

export async function getLabels(ctx, args) {
  const auth = await ctx.authManager.getAuth(args.auth_mode);
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

  return textResult(JSON.stringify(labels, null, 2));
}

export async function downloadAttachment(ctx, args) {
  const auth = await ctx.authManager.getAuth(args.auth_mode);
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

  return textResult(JSON.stringify({
    path: args.local_path,
    filename: args.filename || path.basename(args.local_path),
    size: buffer.length,
  }, null, 2));
}
