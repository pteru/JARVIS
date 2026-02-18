---
name: gdoc
description: Create, read, or edit a Google Doc via the google-workspace MCP server
argument-hint: "<url-or-title> [action]"
---

# Google Docs Skill

Interact with Google Docs using the `google-workspace` MCP server tools.

## Available MCP Tools

- `create_doc` — Create a new Google Doc
- `read_doc` — Read a doc by ID or URL, returns markdown
- `update_doc` — Append, replace, or insert content
- `list_docs` — List recent docs, optionally filtered

## How to Parse Arguments

1. **URL or Doc ID** (contains `docs.google.com` or looks like an alphanumeric ID):
   - Default action: call `read_doc` with the ID, present content as formatted markdown
   - If followed by `append <content>`: call `update_doc` with mode "append"
   - If followed by `replace <content>`: call `update_doc` with mode "replace"
   - If followed by `insert <index> <content>`: call `update_doc` with mode "insert"

2. **Plain title** (no URL pattern):
   - Call `create_doc` with that title
   - Ask the user for initial content if none provided in the argument

3. **"list"** or **"search <query>"**:
   - Call `list_docs` with the optional query
   - Present results as a numbered list with titles, URLs, and last-modified dates

## Defaults

- `auth_mode`: `"service_account"` (override with `--oauth` flag in argument)
- When reading, always present content with proper markdown formatting
- When creating, confirm the doc URL back to the user

## Examples

```
/gdoc "Sprint Planning Notes"
→ Creates a new doc titled "Sprint Planning Notes"

/gdoc https://docs.google.com/document/d/1abc.../edit
→ Reads and displays the doc content

/gdoc 1abc... append "## Action Items\n- Review PR #42\n- Deploy staging"
→ Appends content to the doc

/gdoc list
→ Lists recent docs

/gdoc search "meeting notes"
→ Searches for docs matching "meeting notes"
```
