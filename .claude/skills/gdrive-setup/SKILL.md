---
name: gdrive-setup
description: Configure Google Drive folder links for a PMO project
argument-hint: "<project-code>"
---

# Google Drive Setup Skill

Interactive wizard to link Google Drive shared folders to a PMO project.

## Workflow

1. **Validate project code:**
   - Read `config/project-codes.json`
   - Verify the project code exists
   - Show the project name and current Drive config (if any)

2. **Collect folder information:**
   - Ask the user for the Google Drive folder URL(s) they want to link
   - Extract the folder ID from each URL (pattern: `/folders/<FOLDER_ID>`)
   - Ask for a role for each folder: `customer`, `partner`, `internal`, or `archive`
   - Ask for a brief description of what's in each folder

3. **Verify access:**
   - For each folder, call `list_folder` with the folder ID
   - If access fails, instruct the user to share the folder with: `jarvis-workspace@strokmatic.iam.gserviceaccount.com`
   - Wait for the user to share, then retry

4. **Optional — Configure push folder:**
   - Ask if JARVIS should be able to upload reports to a Drive folder
   - If yes, collect the push folder URL and verify access

5. **Save configuration:**
   - Update `config/project-codes.json` with the new `drive` section:
     ```json
     "drive": {
       "folders": [
         {
           "id": "<extracted-folder-id>",
           "name": "<folder-name-from-drive>",
           "role": "<customer|partner|internal|archive>",
           "description": "<user-provided-description>"
         }
       ],
       "push_folder_id": "<optional-push-folder-id>",
       "organize_template": {
         "subfolders": ["01-Drawings", "02-Specs", "03-Quotes", "04-Correspondence", "05-Reports", "06-Admin", "07-Photos"]
       }
     }
     ```
   - The folder name should be auto-detected from the Drive API response (first item in `list_folder` result, or use `get_file_metadata` on the folder ID)

6. **Run initial index:**
   - Call `list_folder` with `recursive: true` for each folder
   - Build and save `drive-index.json` at `workspaces/strokmatic/pmo/{code}/drive-index.json`
   - Display summary: file count, total size, file type breakdown

7. **Confirm:**
   - Show the full configuration that was saved
   - Remind the user they can now use `/gdrive <code>` to browse and organize

## URL Parsing

Google Drive folder URLs come in these formats:
- `https://drive.google.com/drive/folders/1aBcDeFgHiJkLmNoPqRsTuVwXyZ`
- `https://drive.google.com/drive/folders/1aBcDeFgHiJkLmNoPqRsTuVwXyZ?usp=sharing`
- `https://drive.google.com/drive/u/0/folders/1aBcDeFgHiJkLmNoPqRsTuVwXyZ`

Extract the folder ID from the path segment after `/folders/`.

## Notes

- If the project already has a `drive` section, show existing config and ask if the user wants to add more folders or replace the config
- The `organize_template.subfolders` list uses the defaults from `config/orchestrator/drive-organize-rules.json` but can be customized per project
- Always verify access before saving — don't save folder IDs that can't be reached
