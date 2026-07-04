import { google } from "googleapis";
import { withRetry, extractFileId, authModeParam, textResult } from "./helpers.js";

// ---------------------------------------------------------------------------
// Google Docs tools
// ---------------------------------------------------------------------------

export const toolDefinitions = [
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
];

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

export async function createDoc(ctx, args) {
  const auth = await ctx.authManager.getAuth(args.auth_mode);
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
    const requests = ctx.mdToDocs.convert(args.content);
    if (requests.length > 0) {
      await withRetry(() =>
        docs.documents.batchUpdate({
          documentId: docId,
          requestBody: { requests },
        }),
      );
    }
  }

  return textResult(
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

export async function readDoc(ctx, args) {
  const auth = await ctx.authManager.getAuth(args.auth_mode);
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
      const md = ctx.docsToMd.convert(tabDoc);
      if (md.trim()) {
        sections.push(tabs.length > 1 ? `# Tab: ${title}\n\n${md}` : md);
      }
    }

    if (requestedTab && sections.length === 0) {
      const available = tabs.map((t) => t.tabProperties?.title).join(", ");
      return textResult(`Tab "${args.tab}" not found. Available tabs: ${available}`);
    }

    return textResult(sections.join("\n\n---\n\n"));
  }

  // Fallback for documents without tabs
  const markdown = ctx.docsToMd.convert(res.data);
  return textResult(markdown);
}

export async function updateDoc(ctx, args) {
  const auth = await ctx.authManager.getAuth(args.auth_mode);
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
    const insertRequests = ctx.mdToDocs.convert(args.content);
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
    const mdRequests = ctx.mdToDocs.convert(args.content);
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
    const mdRequests = ctx.mdToDocs.convert(args.content);
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

  return textResult(`Document updated (mode: ${args.mode})`);
}

export async function listDocs(ctx, args) {
  const auth = await ctx.authManager.getAuth(args.auth_mode);
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

  return textResult(JSON.stringify(files, null, 2));
}
