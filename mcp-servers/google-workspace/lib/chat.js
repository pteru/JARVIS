import fs from "fs/promises";
import path from "path";
import { google } from "googleapis";
import { withRetry, authModeParam, textResult } from "./helpers.js";

// ---------------------------------------------------------------------------
// Google Chat tools
// ---------------------------------------------------------------------------

export const toolDefinitions = [
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

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

export async function listChatSpaces(ctx, args) {
  const auth = await ctx.authManager.getAuth(args.auth_mode);
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

  return textResult(JSON.stringify({
    spaces,
    nextPageToken: res.data.nextPageToken || null,
  }, null, 2));
}

export async function getChatSpace(ctx, args) {
  const auth = await ctx.authManager.getAuth(args.auth_mode);
  const chat = google.chat({ version: "v1", auth });

  const res = await withRetry(() =>
    chat.spaces.get({ name: args.space_name }),
  );

  return textResult(JSON.stringify({
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

export async function listChatMembers(ctx, args) {
  const auth = await ctx.authManager.getAuth(args.auth_mode);
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

  return textResult(JSON.stringify({
    members,
    nextPageToken: res.data.nextPageToken || null,
  }, null, 2));
}

export async function listChatMessages(ctx, args) {
  const auth = await ctx.authManager.getAuth(args.auth_mode);
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

  return textResult(JSON.stringify({
    messages,
    nextPageToken: res.data.nextPageToken || null,
  }, null, 2));
}

export async function readChatMessage(ctx, args) {
  const auth = await ctx.authManager.getAuth(args.auth_mode);
  const chat = google.chat({ version: "v1", auth });

  const res = await withRetry(() =>
    chat.spaces.messages.get({ name: args.message_name }),
  );

  const m = res.data;
  return textResult(JSON.stringify({
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

export async function sendChatMessage(ctx, args) {
  const auth = await ctx.authManager.getAuth(args.auth_mode);
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

  return textResult(JSON.stringify({
    name: m.name,
    text: m.text || "",
    createTime: m.createTime,
    thread: m.thread ? { name: m.thread.name } : null,
    space: m.space ? { name: m.space.name } : null,
  }, null, 2));
}

export async function downloadChatAttachment(ctx, args) {
  const auth = await ctx.authManager.getAuth(args.auth_mode);
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
      return textResult(JSON.stringify({
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

  return textResult(JSON.stringify({
    path: args.local_path,
    filename: path.basename(args.local_path),
    size: buffer.length,
  }, null, 2));
}
