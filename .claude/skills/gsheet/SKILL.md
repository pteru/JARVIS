---
name: gsheet
description: Create, read, or edit a Google Sheet via the google-workspace MCP server
argument-hint: "<url-or-title> [range] [action]"
---

# Google Sheets Skill

Interact with Google Sheets using the `google-workspace` MCP server tools.

## Available MCP Tools

- `create_sheet` — Create a new spreadsheet
- `read_sheet` — Read a sheet or range, returns JSON data
- `update_sheet` — Write data to a range (overwrite or append)
- `read_sheet_metadata` — Get sheet names, dimensions, named ranges

## How to Parse Arguments

1. **URL or Spreadsheet ID** (contains `sheets.google.com` or `spreadsheets/d/`):
   - Default action: call `read_sheet_metadata` first to show structure, then `read_sheet` for the first sheet
   - If followed by a range (e.g. `Sheet1!A1:D10`): call `read_sheet` with that range
   - If followed by `append <data>`: call `update_sheet` with mode "append"
   - If followed by `write <range> <data>`: call `update_sheet` with mode "overwrite"

2. **Plain title** (no URL pattern):
   - Call `create_sheet` with that title
   - If data is provided (CSV-like or JSON array), pass it as initial data

3. **"meta"** or **"info"** after a URL:
   - Call `read_sheet_metadata` and display sheet names, dimensions, named ranges

## Data Presentation

- Always present sheet data as **markdown tables**
- Use the first row as headers when available
- For large datasets (>50 rows), show first 20 rows and note the total count
- When writing data, accept:
  - JSON 2D arrays: `[["Name","Score"],["Alice",95]]`
  - CSV-like inline: `Name,Score\nAlice,95`

## Defaults

- `auth_mode`: `"service_account"`
- When reading without a range, read the first sheet up to the used range

## Examples

```
/gsheet "Q1 Budget Tracker"
→ Creates a new spreadsheet

/gsheet https://docs.google.com/spreadsheets/d/1abc.../edit
→ Shows metadata then reads first sheet as a table

/gsheet 1abc... Sheet1!A1:E20
→ Reads specific range and displays as markdown table

/gsheet 1abc... append [["2026-02-18", "Task X", "Done", 4.5]]
→ Appends a row to the sheet

/gsheet 1abc... meta
→ Shows all sheet names, dimensions, and named ranges
```
