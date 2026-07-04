import { google } from "googleapis";
import { withRetry, extractFileId, authModeParam, textResult } from "./helpers.js";

// ---------------------------------------------------------------------------
// Google Sheets tools
// ---------------------------------------------------------------------------

export const toolDefinitions = [
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
];

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

export async function createSheet(ctx, args) {
  const auth = await ctx.authManager.getAuth(args.auth_mode);
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

  return textResult(
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

export async function readSheet(ctx, args) {
  const auth = await ctx.authManager.getAuth(args.auth_mode);
  const sheets = google.sheets({ version: "v4", auth });
  const spreadsheetId = extractFileId(args.spreadsheet_id);
  const range = args.range || "Sheet1";

  const res = await withRetry(() =>
    sheets.spreadsheets.values.get({ spreadsheetId, range }),
  );

  const values = res.data.values || [];
  if (values.length === 0) {
    return textResult(JSON.stringify([], null, 2));
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
    return textResult(JSON.stringify(objects, null, 2));
  }

  return textResult(JSON.stringify(values, null, 2));
}

export async function updateSheet(ctx, args) {
  const auth = await ctx.authManager.getAuth(args.auth_mode);
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

  return textResult(
    `Spreadsheet updated (${args.data.length} rows, mode: ${args.mode})`,
  );
}

export async function readSheetMetadata(ctx, args) {
  const auth = await ctx.authManager.getAuth(args.auth_mode);
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

  return textResult(JSON.stringify(metadata, null, 2));
}
