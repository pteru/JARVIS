import fs from "fs/promises";
import path from "path";
import { google } from "googleapis";
import { withRetry, extractFileId, authModeParam, textResult, errorResult } from "./helpers.js";

// ---------------------------------------------------------------------------
// Google Drive tools
// ---------------------------------------------------------------------------

export const toolDefinitions = [
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
];

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

export async function searchDrive(ctx, args) {
  const auth = await ctx.authManager.getAuth(args.auth_mode);
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

  return textResult(JSON.stringify(files, null, 2));
}

export async function shareFile(ctx, args) {
  const auth = await ctx.authManager.getAuth(args.auth_mode);
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
    return errorResult(
      "No sharing action specified. Provide email and/or link_sharing.",
    );
  }

  return textResult(results.join("\n"));
}

export async function listFolder(ctx, args) {
  const auth = await ctx.authManager.getAuth(args.auth_mode);
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

    return textResult(JSON.stringify({
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

  return textResult(JSON.stringify({
    files: allFiles, folders: allFolders,
    totalCount: allFiles.length + allFolders.length,
  }, null, 2));
}

export async function getFileMetadata(ctx, args) {
  const auth = await ctx.authManager.getAuth(args.auth_mode);
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
  return textResult(JSON.stringify({
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

export async function downloadFile(ctx, args) {
  const auth = await ctx.authManager.getAuth(args.auth_mode);
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
      const markdown = ctx.docsToMd.convert(docRes.data);
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

  return textResult(JSON.stringify({
    path: localPath,
    name: meta.data.name,
    size: writtenSize,
    mimeType,
    md5Checksum: meta.data.md5Checksum || null,
  }, null, 2));
}

export async function uploadFile(ctx, args) {
  const auth = await ctx.authManager.getAuth(args.auth_mode);
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

  return textResult(JSON.stringify({
    fileId: res.data.id,
    name: res.data.name,
    url: res.data.webViewLink,
    mimeType: res.data.mimeType,
    size: res.data.size,
  }, null, 2));
}

export async function moveFile(ctx, args) {
  const auth = await ctx.authManager.getAuth(args.auth_mode);
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

  return textResult(JSON.stringify({
    fileId: res.data.id,
    name: res.data.name,
    newParent: targetFolderId,
    url: res.data.webViewLink,
  }, null, 2));
}

export async function createFolder(ctx, args) {
  const auth = await ctx.authManager.getAuth(args.auth_mode);
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

  return textResult(JSON.stringify({
    folderId: res.data.id,
    name: res.data.name,
    url: res.data.webViewLink,
  }, null, 2));
}
