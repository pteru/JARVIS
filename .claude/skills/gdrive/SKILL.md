---
name: gdrive
description: Browse, read, and organize Google Drive folders for a PMO project
argument-hint: "<project-code> [browse|organize|upload|index|read|status]"
---

# Google Drive Integration Skill

Cloud-first interaction with Google Drive folders linked to PMO projects. Files live in Drive — read them in-place, organize them in the cloud. Only download when absolutely necessary for local processing.

## Setup

1. Read `config/project-codes.json` and find the project by its 5-digit code
2. Check if the project has a `drive` section configured
3. If no `drive` config exists, tell the user to run `/gdrive-setup <code>` first

## Available MCP Tools (google-workspace server)

**Browse/Read (cloud-first — use these by default):**
- `list_folder` — List files and subfolders in a Drive folder (supports recursive)
- `get_file_metadata` — Get detailed file metadata without downloading
- `read_doc` — Read a Google Doc as markdown (in-place)
- `read_sheet` — Read a Google Sheet as JSON (in-place)
- `read_presentation` — Read a Google Slides presentation (in-place)
- `search_drive` — Full-text search across Drive

**Organize (in-cloud operations):**
- `move_file` — Move a file to a different folder (with optional rename)
- `create_folder` — Create a subfolder
- `share_file` — Share a file with someone

**Transfer (use sparingly):**
- `upload_file` — Push a local file to Drive
- `download_file` — Download a Drive file locally (only when essential)

## Commands

### `browse` (default if no command given)

1. Load the project's Drive config from `config/project-codes.json`
2. For each configured folder, call `list_folder` with the folder ID
3. Present a clean tree view:
   - Folder name, role, and description
   - File count and total size
   - Last modified date
   - List of files with names, types, sizes, and Drive links
4. Allow the user to drill into subfolders or read specific files interactively

### `organize`

AI-assisted organization of Drive folders. Follow this workflow:

1. Load organization rules from `config/orchestrator/drive-organize-rules.json`
2. Call `list_folder` with `recursive: true` for each configured folder
3. Analyze each file:
   - Match against classification rules (extension + keywords)
   - For Google-native files, read content via `read_doc`/`read_sheet`/`read_presentation` to understand what they are
   - For binary files, use filename and metadata only
4. Generate an organization plan:
   - List of folders to create (from `folder_structure` in rules)
   - List of files to move (current location → proposed location)
   - List of files to rename (if naming conventions apply)
   - Flag duplicates or outdated versions
5. Present the plan to the user as a markdown table
6. **WAIT for explicit user approval before executing any changes**
7. Execute approved changes via `create_folder` and `move_file`
8. Report results

### `upload <local-path>`

1. Read the file at the local path
2. Upload to the project's `push_folder_id` via `upload_file`
3. If the push folder has organized subfolders, suggest the right one
4. Confirm the upload URL to the user

### `index`

Build or refresh the Drive index (`pmo/{code}/drive-index.json`):

1. Call `list_folder` with `recursive: true` for each configured folder
2. Build a tree structure with metadata (no content)
3. Compute stats: total files, total size, file types breakdown, newest/oldest
4. Save to `workspaces/strokmatic/pmo/{code}/drive-index.json`
5. Display the summary

### `read <file-id-or-name>`

Read a specific file from Drive:

1. If given a file ID or URL: use it directly
2. If given a filename: search within configured folders using `list_folder` or `search_drive`
3. Based on file type:
   - Google Doc → `read_doc` (returns markdown)
   - Google Sheet → `read_sheet` (returns JSON rows)
   - Google Slides → `read_presentation` (returns slide text)
   - PDF/binary → `get_file_metadata` only (inform user that content reading requires download)
4. Display the content

### `status`

1. Check if `drive-index.json` exists and show its age
2. Show file counts per configured folder
3. If index exists, compare `modifiedTime` of newest file in index vs current state (call `list_folder` shallow) to detect new files
4. Report: "X new files since last index" or "Index is up to date"

## Output Style

- Use the JARVIS persona if the `/jarvis` skill was loaded in this session
- Present Drive folder contents as clean markdown tables
- Always show Drive web links for files so the user can open them directly
- When listing large folders, summarize by file type instead of listing every file
- Use the project's preferred language from `project-codes.json`

## Important Notes

- **Never download files unless the user explicitly asks or a specific operation requires it**
- Google-native files (Docs, Sheets, Slides) can always be read in-place — prefer this over download
- Binary files (PDF, images, CAD) cannot be read in-place — only metadata is available without download
- The service account must have access to the shared folders. If access fails, tell the user to share the folder with `jarvis-workspace@strokmatic.iam.gserviceaccount.com`
