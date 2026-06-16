# Google Workspace

## Purpose
Comprehensive MCP server providing access to Google Workspace APIs: Google Docs, Sheets, Slides, Drive, Gmail, and Google Chat. Supports both service account authentication (with domain-wide delegation impersonating pedro@lumesolutions.com) and OAuth 2.0 for user-context operations. Includes a built-in MarkdownToDocsConverter for native Google Docs formatting.

## MCP Tools

### Google Docs
- **create_doc** — Create a new Google Doc with optional markdown content (converted to native Docs formatting)
- **read_doc** — Read the full content of a Google Doc
- **update_doc** — Append or replace content in a Google Doc
- **list_docs** — List Google Docs in a folder or shared drive

### Google Sheets
- **create_sheet** — Create a new spreadsheet with optional initial data
- **read_sheet** — Read data from a specific sheet range
- **update_sheet** — Write data to a sheet range
- **read_sheet_metadata** — Get spreadsheet metadata (sheet names, dimensions)

### Google Slides
- **create_presentation** — Create a new presentation
- **add_slide** — Add a slide with layout and placeholder content
- **read_presentation** — Read all slides and their content

### Google Drive
- **search_drive** — Search files by name, type, or query across Drive
- **share_file** — Share a file/folder with a user or domain
- **list_folder** — List contents of a Drive folder
- **get_file_metadata** — Get metadata for a file
- **download_file** — Download a file's content
- **upload_file** — Upload a file to Drive
- **move_file** — Move a file to a different folder
- **create_folder** — Create a new folder in Drive

### Gmail
- **list_emails** — List emails with optional label/query filter
- **read_email** — Read a specific email by ID
- **search_emails** — Search emails with Gmail query syntax
- **get_labels** — List Gmail labels
- **download_attachment** — Download an email attachment

### Google Chat
- **list_chat_spaces** — List Chat spaces the service account can access
- **get_chat_space** — Get details of a specific Chat space
- **list_chat_members** — List members of a Chat space
- **list_chat_messages** — List messages in a Chat space
- **read_chat_message** — Read a specific Chat message
- **send_chat_message** — Send a message to a Chat space
- **download_chat_attachment** — Download a Chat attachment

### Auth
- **google_oauth_callback** — Handle OAuth 2.0 callback for user authentication

## Tech Stack
- Node.js (ESM), @modelcontextprotocol/sdk, googleapis

## Configuration
- Service account key: `config/credentials/gcp-service-account.json`
- OAuth config: `config/credentials/google-oauth-config.json`
- OAuth tokens: `config/credentials/google-oauth-tokens.json`
- Impersonates: `pedro@lumesolutions.com` (configured in service account)
- Shared Drive ID: `0AC4RjZu6DAzcUk9PVA` (JARVIS Shared Drive)
- Domain-wide delegation scopes must match exactly in Google Admin Console

## Integration Points
- Meeting-assistant uses this server's Google Docs/Drive APIs for live notes
- Email-analyzer reads emails fetched through this server's Gmail tools
- Report generation exports to Google Drive via upload_file
- PMO reports written to Google Docs using the markdown converter

## Key Files
- `index.js` — Large single-file server (~2400 lines) with MarkdownToDocsConverter, auth management, and all tool implementations
