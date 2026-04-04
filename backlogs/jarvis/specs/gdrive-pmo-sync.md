# Google Drive ↔ PMO Integration — Implementation Plan

**Status:** Planned
**Priority:** High
**Estimated complexity:** Medium
**Dependencies:** Google Workspace MCP server (Done), email-organizer (Done), project-codes.json (Done)

---

## Objective

Cloud-first integration between shared Google Drive folders and PMO projects. Each PMO project can be linked to one or more shared Drive folders (e.g., a customer shares a folder with drawings, specs, or correspondence). JARVIS should:

1. **Browse** Drive folders in-place — list, search, read file contents without downloading
2. **Read** Google-native files (Docs, Sheets, Slides) directly via existing MCP tools
3. **Organize** files in Drive — create subfolders, move/rename files, apply project structure
4. **Upload** local reports and documents to designated Drive folders
5. **Download** only when essential — specific files needed for local processing (AI analysis, PDF export, etc.)

### Design Principles

- **Cloud-first:** Files live in Google Drive. JARVIS reads them in-place via API. No bulk download.
- **Download is the exception, not the rule.** Only download when a file is needed locally (e.g., for `claude -p` analysis, PDF image embedding, offline reference).
- **Organization happens in Drive.** JARVIS proposes and executes folder structure, naming, and classification directly in the cloud.
- **PMO context is enriched, not mirrored.** Instead of syncing files locally, JARVIS builds an index of what's in Drive and uses that to enrich the PMO project context.

---

## Architecture

### Data Flow

```
Google Drive (shared folders)
  ↑↓ (google-workspace MCP tools — cloud operations)
  │
  ├── list_folder      → Browse folder contents
  ├── read_doc/sheet   → Read file content in-place
  ├── get_file_metadata → File details without download
  ├── move_file        → Organize within Drive
  ├── rename_file      → Clean up naming
  ├── create_folder    → Build project structure
  ├── upload_file      → Push local reports to Drive
  └── download_file    → Selective download (only when essential)
  │
  ↓
pmo/{code}/drive-index.json    ← Cloud index (file tree + metadata, no content)
pmo/{code}/.claude/context.md  ← Updated with Drive folder summary
```

### Mapping Config

Add a `drive` section to `config/project-codes.json` for each project:

```json
{
  "02008": {
    "name": "Nissan Smyrna Spot Fusion",
    "product": "spotfusion",
    "drive": {
      "folders": [
        {
          "id": "1aBcDeFgHiJkLmNoPqRsTuVwXyZ",
          "name": "Nissan Smyrna - Shared",
          "role": "customer",
          "description": "Customer-shared folder with drawings, specs, and correspondence"
        },
        {
          "id": "1xYzAbCdEfGhIjKlMnOpQrStUv",
          "name": "Comau Quotes",
          "role": "partner",
          "description": "Comau integration partner quotes and technical docs"
        }
      ],
      "push_folder_id": "1PuShFoLdErIdHeRe",
      "organize_template": {
        "subfolders": ["01-Drawings", "02-Specs", "03-Quotes", "04-Correspondence", "05-Reports", "06-Admin"]
      }
    }
  }
}
```

**Fields:**
- `folders[].id` — Google Drive folder ID (from the shared folder URL)
- `folders[].role` — Semantic role: `customer`, `partner`, `internal`, `archive`
- `folders[].description` — Human description for JARVIS context
- `push_folder_id` — Drive folder where JARVIS pushes generated reports
- `organize_template.subfolders` — Standard subfolder structure JARVIS should create/enforce

---

## Implementation Phases

### Phase 1: Extend Google Workspace MCP Server (Drive Tools)

Add 6 new Drive tools to `mcp-servers/google-workspace/index.js`. The existing tools (`search_drive`, `share_file`) remain unchanged.

#### 1.1 `list_folder`

List all files and subfolders in a Drive folder. The primary browse tool.

```js
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
      auth_mode: authModeParam
    },
    required: ["folder_id"]
  }
}
```

**Implementation:**
- Use `drive.files.list` with `q: "'<folder_id>' in parents and trashed=false"`
- Fields: `id, name, mimeType, modifiedTime, size, md5Checksum, webViewLink, description`
- For `recursive: true`: BFS traversal of subfolders, prefix names with relative path
- Return: `{ files: [...], folders: [...], nextPageToken, totalCount }`
- Separate files and folders in output for easier consumption

#### 1.2 `get_file_metadata`

Get detailed metadata for a single file (without downloading content).

```js
{
  name: "get_file_metadata",
  description: "Get detailed metadata for a file in Google Drive (no download)",
  inputSchema: {
    type: "object",
    properties: {
      file_id: { type: "string", description: "File ID or URL" },
      auth_mode: authModeParam
    },
    required: ["file_id"]
  }
}
```

**Return:** `{ id, name, mimeType, size, modifiedTime, createdTime, owners, shared, parents, webViewLink, description, md5Checksum, lastModifyingUser }`

Useful for JARVIS to inspect a file before deciding whether to read/download it.

#### 1.3 `download_file`

Download a file from Drive to local filesystem. **Use sparingly — only when local processing requires it.**

```js
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
        description: "Export format for Google-native files (Docs→pdf/docx/md, Sheets→xlsx/csv, Slides→pptx/pdf)"
      },
      auth_mode: authModeParam
    },
    required: ["file_id", "local_path"]
  }
}
```

**Implementation:**
- Google-native files (Docs, Sheets, Slides): Use `drive.files.export` with specified MIME type
- Binary files (PDF, images, etc.): Use `drive.files.get` with `alt: 'media'`
- For Docs with `export_format: "md"`: use existing `DocsToMarkdownConverter` then write to disk
- Create parent directories (`fs.mkdir(dir, { recursive: true })`)
- Return: `{ path, size, mimeType, md5Checksum }`
- Default exports: Docs→PDF, Sheets→XLSX, Slides→PDF

MIME type mapping:
```js
const EXPORT_MIMES = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  csv: "text/csv",
  txt: "text/plain",
  md: "text/plain"
};
```

#### 1.4 `upload_file`

Upload a local file to a Drive folder.

```js
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
      auth_mode: authModeParam
    },
    required: ["local_path", "folder_id"]
  }
}
```

**Implementation:**
- Use `drive.files.create` with `media: { body: fs.createReadStream(local_path) }`
- Set `parents: [folder_id]`
- Auto-detect MIME type from extension
- If `convert: true`, set target Google MIME type for conversion
- Return: `{ fileId, name, url, mimeType, size }`

#### 1.5 `move_file`

Move a file to a different folder within Drive. Essential for organization.

```js
{
  name: "move_file",
  description: "Move a file to a different folder in Google Drive",
  inputSchema: {
    type: "object",
    properties: {
      file_id: { type: "string", description: "File ID or URL" },
      target_folder_id: { type: "string", description: "Destination folder ID" },
      new_name: { type: "string", description: "Optional: rename the file during move" },
      auth_mode: authModeParam
    },
    required: ["file_id", "target_folder_id"]
  }
}
```

**Implementation:**
- Get current parents: `drive.files.get({ fileId, fields: 'parents' })`
- Move: `drive.files.update({ fileId, addParents: target, removeParents: current, fields: 'id, name, parents' })`
- If `new_name` provided: include `requestBody: { name: new_name }` in the update
- Return: `{ fileId, name, newParent, url }`

#### 1.6 `create_folder`

Create a folder in Drive (already in spec, not yet implemented).

```js
{
  name: "create_folder",
  description: "Create a folder in Google Drive",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Folder name" },
      parent_id: { type: "string", description: "Parent folder ID (default: My Drive root)" },
      auth_mode: authModeParam
    },
    required: ["name"]
  }
}
```

**Implementation:**
- `drive.files.create({ requestBody: { name, mimeType: 'application/vnd.google-apps.folder', parents: [parent_id] } })`
- Return: `{ folderId, name, url }`

---

### Phase 2: Drive Index (Cloud Inventory)

Instead of downloading files, build a lightweight index of what's in each Drive folder.

#### `drive-index.json` (per project)

Stored at `pmo/{code}/drive-index.json`:

```json
{
  "indexed_at": "2026-02-20T15:30:00Z",
  "folders": {
    "1aBcDeFgHiJkLmNoPqRsTuVwXyZ": {
      "name": "Nissan Smyrna - Shared",
      "role": "customer",
      "tree": [
        {
          "id": "1fIlEiD_aBC",
          "name": "Drawing Package Rev3.pdf",
          "mimeType": "application/pdf",
          "modifiedTime": "2026-02-19T10:00:00Z",
          "size": 4521984,
          "path": "Drawing Package Rev3.pdf",
          "webViewLink": "https://drive.google.com/..."
        },
        {
          "id": "1fOlDeR_xYz",
          "name": "Quotes",
          "mimeType": "application/vnd.google-apps.folder",
          "path": "Quotes/",
          "children": [
            {
              "id": "1qUoTe_123",
              "name": "Comau Quote Rev2.xlsx",
              "mimeType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
              "modifiedTime": "2026-02-18T14:00:00Z",
              "size": 158720,
              "path": "Quotes/Comau Quote Rev2.xlsx",
              "webViewLink": "https://drive.google.com/..."
            }
          ]
        }
      ],
      "stats": {
        "total_files": 47,
        "total_folders": 8,
        "total_size_bytes": 234567890,
        "file_types": { "pdf": 12, "xlsx": 5, "docx": 8, "pptx": 3, "image": 19 },
        "newest_file": "2026-02-19T10:00:00Z",
        "oldest_file": "2026-01-15T08:00:00Z"
      }
    }
  }
}
```

**Build process:**
1. Call `list_folder` with `recursive: true` for each configured folder
2. Build the tree structure from flat file list
3. Compute stats
4. Save to `drive-index.json`

**Refresh policy:**
- On-demand via `/gdrive` skill
- Auto-refresh when index is older than 24h (checked when loading PMO context)
- Always refresh before organization operations

The index enables JARVIS to answer questions like "what files did Nissan share?", "when was the last update?", "are there any new drawings?" — all without downloading anything.

---

### Phase 3: AI-Assisted Drive Organization

This is the core interactive feature. JARVIS browses Drive folders, reads contents where possible, and helps the user organize them.

#### Organization Workflow

1. **Scan:** JARVIS calls `list_folder` (recursive) to see everything
2. **Analyze:** For each file, JARVIS examines:
   - Filename and extension
   - Folder location
   - File metadata (size, dates, owner)
   - For Google-native files: read content directly via `read_doc` / `read_sheet` / `read_presentation`
   - For PDFs/images: metadata only (no content reading without download)
3. **Propose:** JARVIS generates an organization plan:
   - Create standard subfolders (from `organize_template`)
   - Move files into appropriate subfolders
   - Rename files with consistent naming convention (e.g., `YYYY-MM-DD_description.ext`)
   - Flag duplicates or outdated versions
   - Flag files that should be shared with other stakeholders
4. **Confirm:** Present the plan to the user with a summary table
5. **Execute:** Apply approved changes via `move_file`, `create_folder`, MCP tools

#### Organization Rules (configurable)

Default rules in `config/orchestrator/drive-organize-rules.json`:

```json
{
  "folder_structure": ["01-Drawings", "02-Specs", "03-Quotes", "04-Correspondence", "05-Reports", "06-Admin", "07-Photos"],
  "classification": {
    "01-Drawings": {
      "extensions": [".dwg", ".dxf", ".step", ".stp", ".iges", ".igs", ".stl"],
      "keywords": ["drawing", "layout", "assembly", "part", "model", "cad"]
    },
    "02-Specs": {
      "extensions": [".pdf", ".docx"],
      "keywords": ["spec", "specification", "datasheet", "requirement", "standard"]
    },
    "03-Quotes": {
      "extensions": [".xlsx", ".pdf", ".docx"],
      "keywords": ["quote", "rfq", "proposal", "budget", "price", "cost", "estimate"]
    },
    "04-Correspondence": {
      "extensions": [".eml", ".msg", ".pdf"],
      "keywords": ["email", "letter", "memo", "correspondence", "minutes"]
    },
    "05-Reports": {
      "extensions": [".pdf", ".docx", ".pptx", ".xlsx"],
      "keywords": ["report", "analysis", "review", "summary", "status"]
    },
    "06-Admin": {
      "extensions": [".pdf", ".docx"],
      "keywords": ["nda", "contract", "agreement", "po", "invoice", "sraq", "security"]
    },
    "07-Photos": {
      "extensions": [".jpg", ".jpeg", ".png", ".heic", ".mp4", ".mov"],
      "keywords": ["photo", "image", "picture", "visit", "site"]
    }
  },
  "naming": {
    "prefix_date": true,
    "separator": "_",
    "lowercase": false
  }
}
```

JARVIS uses these rules as guidelines but can override them with AI judgment based on file content. The user always approves the plan before execution.

---

### Phase 4: Claude Code Skills

#### `/gdrive` — Primary Drive interaction skill

```yaml
name: gdrive
description: Browse, read, and organize Google Drive folders for a PMO project
argument-hint: "<project-code> [browse|organize|upload|index|status]"
```

**Behaviors:**

- `/gdrive 02008 browse` or `/gdrive 02008`
  1. Load project Drive config from `project-codes.json`
  2. List all configured folders with file counts and latest activity
  3. Allow drilling into subfolders interactively
  4. Read Google-native file contents on request

- `/gdrive 02008 organize`
  1. Refresh the Drive index
  2. Scan all files, analyze names/types/content
  3. Propose organization plan (create folders, move files, rename)
  4. Execute after user approval

- `/gdrive 02008 upload <local-path>`
  1. Upload file to the project's `push_folder_id`
  2. Optionally organize into the right subfolder

- `/gdrive 02008 index`
  1. Force-refresh `drive-index.json`
  2. Display summary stats

- `/gdrive 02008 status`
  1. Show index age, file counts, recent changes since last index

- `/gdrive 02008 read <file-id-or-name>`
  1. For Google-native: read via `read_doc`/`read_sheet`/`read_presentation`
  2. For PDFs: download to temp, read if possible, clean up
  3. Display content or summary

#### `/gdrive-setup` — Link Drive folders to a project

```yaml
name: gdrive-setup
description: Configure Google Drive folder links for a PMO project
argument-hint: "<project-code>"
```

Interactive wizard:
1. Ask for Drive folder URL(s)
2. Extract folder IDs
3. Verify access (try `list_folder`)
4. Save to `project-codes.json`
5. Run initial index

---

### Phase 5: PMO Context Enrichment

When the `/pmo` skill loads a project, if Drive folders are configured:

1. Check if `drive-index.json` exists and is recent (<24h)
2. If stale, auto-refresh the index
3. Add a "## Google Drive" section to the context output:
   - Number of shared folders and their roles
   - Total files/size
   - Latest activity date
   - Top-level folder structure summary
4. This gives JARVIS awareness of what's in Drive without loading file contents

Update `pmo` skill to include Drive index in its output when available.

---

## Config Changes Required

### `config/project-codes.json`

Add `drive` section to projects as folders are shared. Initially only 02008 (Nissan). Structure supports multiple folders per project with semantic roles.

### `config/orchestrator/drive-organize-rules.json` (new)

Default organization rules. Can be overridden per-project in the Drive config.

### `.gitignore`

No changes needed — we're not downloading files. `drive-index.json` files are small metadata and should be committed (they help JARVIS load context quickly without API calls).

### MCP Server Config

Already fixed: `ORCHESTRATOR_HOME` default updated from `claude-orchestrator` to `JARVIS`.

---

## Verification Plan

1. **Phase 1 (MCP Tools):**
   - Create a test folder in Drive, add 5 files of different types
   - Share folder with service account
   - Verify `list_folder` returns all files with metadata
   - Verify `get_file_metadata` returns detailed info
   - Verify `move_file` moves a file between subfolders
   - Verify `create_folder` creates subfolders
   - Verify `upload_file` pushes a local PDF to Drive
   - Verify `download_file` works for both binary and Google-native files

2. **Phase 2 (Index):**
   - Configure 02008 with a real shared folder
   - Run index build, verify `drive-index.json` structure
   - Modify a file in Drive, re-index, verify `modifiedTime` updates

3. **Phase 3 (Organization):**
   - Create a messy test folder with 20+ files
   - Run `/gdrive 02008 organize`
   - Verify JARVIS proposes sensible folder structure
   - Approve plan, verify files moved correctly in Drive

4. **Phase 4 (Skills):**
   - `/gdrive 02008 browse` → navigate folder tree
   - `/gdrive 02008 read <doc-id>` → read a Google Doc in-place
   - `/gdrive 02008 status` → show index summary
   - `/gdrive-setup 02008` → link a new folder

5. **Phase 5 (Context):**
   - `/pmo 02008` → verify Drive section appears in context output

---

## Estimated Effort

| Phase | Effort | Dependencies |
|-------|--------|-------------|
| Phase 1: MCP tools (6 new Drive tools) | 2-3 hours | None |
| Phase 2: Drive index builder | 1-2 hours | Phase 1 |
| Phase 3: AI organization workflow | 2-3 hours | Phase 1, 2 |
| Phase 4: Claude Code skills (`/gdrive`, `/gdrive-setup`) | 1-2 hours | Phase 1, 2 |
| Phase 5: PMO context enrichment | 30 min | Phase 2, 4 |
| **Total** | **~7-10 hours** | |

---

## Risk Register

| Risk | Impact | Mitigation |
|------|--------|------------|
| Service account can't access shared folders | Can't list/read files | Folder must be explicitly shared with `jarvis-workspace@strokmatic.iam.gserviceaccount.com` |
| Google-native file content too large for context | Claude context overflow | Summarize large docs; read specific sections via range queries for Sheets |
| Binary files (PDF, images) can't be read in-place | Limited organization for non-Google files | Use filename/metadata for classification; download only when AI content analysis is needed |
| Google API rate limits | Browse/organize throttled | Existing `withRetry` handles 429s. Index caching reduces API calls. |
| User reorganizes Drive manually after indexing | Index stale | Always re-index before organization operations; index is cheap (metadata only) |
| Shared folder permissions change | Access lost | Graceful error handling; `/gdrive status` shows access health per folder |
| Large folders (1000+ files) | Slow listing, large index | Pagination in `list_folder`; shallow index by default, deep on request |

---

## Related Specs

- [google-workspace-connector.md](google-workspace-connector.md) — MCP server spec (Done)
- [pmo-dashboard.md](pmo-dashboard.md) — PMO Dashboard (Planned — will display Drive index data)
- [email-organizer](completed/email-organizer.md) — Email ingestion (Done — parallel data source)
