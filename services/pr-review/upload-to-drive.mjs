#!/usr/bin/env node
// Upload PR reviews and inbox markdown to Google Drive.
// Creates/updates files in "PR Reviews" folder on JARVIS Shared Drive.
// Uses service account auth with domain-wide delegation.

import { readFileSync, readdirSync, existsSync, statSync, writeFileSync } from 'fs';
import { join, basename } from 'path';
import { google } from 'googleapis';

const SERVICE_DIR = process.env.SERVICE_DIR || '/opt/jarvis-pr-review';
const REVIEWS_DIR = join(SERVICE_DIR, 'reviews');
const REPORTS_DIR = join(SERVICE_DIR, 'reports');
const DATA_DIR = join(SERVICE_DIR, 'data');
const CREDENTIALS_FILE = join(SERVICE_DIR, 'credentials', 'gcp-service-account.json');
const STATE_FILE = join(DATA_DIR, 'upload-state.json');

// JARVIS Shared Drive ID
const SHARED_DRIVE_ID = '0AC4RjZu6DAzcUk9PVA';
const FOLDER_NAME = 'PR Reviews';

// ─── Auth ────────────────────────────────────────────────────────────────────

async function getAuth() {
    const keyContent = readFileSync(CREDENTIALS_FILE, 'utf-8');
    const key = JSON.parse(keyContent);

    const auth = new google.auth.GoogleAuth({
        credentials: key,
        scopes: ['https://www.googleapis.com/auth/drive'],
        clientOptions: {
            subject: 'pedro@lumesolutions.com',
        },
    });

    return auth;
}

// ─── Drive helpers ───────────────────────────────────────────────────────────

async function findOrCreateFolder(drive) {
    // Search for existing "PR Reviews" folder in shared drive
    const res = await drive.files.list({
        q: `name = '${FOLDER_NAME}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
        driveId: SHARED_DRIVE_ID,
        corpora: 'drive',
        includeItemsFromAllDrives: true,
        supportsAllDrives: true,
        fields: 'files(id, name)',
    });

    if (res.data.files && res.data.files.length > 0) {
        return res.data.files[0].id;
    }

    // Create folder
    const folder = await drive.files.create({
        requestBody: {
            name: FOLDER_NAME,
            mimeType: 'application/vnd.google-apps.folder',
            parents: [SHARED_DRIVE_ID],
        },
        supportsAllDrives: true,
        fields: 'id',
    });

    console.log(`Created folder "${FOLDER_NAME}" → ${folder.data.id}`);
    return folder.data.id;
}

async function upsertFile(drive, folderId, fileName, content, mimeType = 'text/markdown') {
    // Search for existing file by name in folder
    const res = await drive.files.list({
        q: `name = '${fileName}' and '${folderId}' in parents and trashed = false`,
        driveId: SHARED_DRIVE_ID,
        corpora: 'drive',
        includeItemsFromAllDrives: true,
        supportsAllDrives: true,
        fields: 'files(id, name)',
    });

    const media = {
        mimeType,
        body: content,
    };

    if (res.data.files && res.data.files.length > 0) {
        // Update existing file
        const fileId = res.data.files[0].id;
        await drive.files.update({
            fileId,
            media,
            supportsAllDrives: true,
        });
        return { id: fileId, action: 'updated' };
    } else {
        // Create new file
        const file = await drive.files.create({
            requestBody: {
                name: fileName,
                parents: [folderId],
            },
            media,
            supportsAllDrives: true,
            fields: 'id, webViewLink',
        });
        return { id: file.data.id, action: 'created', link: file.data.webViewLink };
    }
}

// ─── State management ────────────────────────────────────────────────────────

function loadState() {
    if (existsSync(STATE_FILE)) {
        return JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
    }
    return { last_upload: null, uploaded_files: {} };
}

function saveState(state) {
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
    if (!existsSync(CREDENTIALS_FILE)) {
        console.error(`Credentials not found: ${CREDENTIALS_FILE}`);
        process.exit(1);
    }

    const auth = await getAuth();
    const drive = google.drive({ version: 'v3', auth });

    const folderId = await findOrCreateFolder(drive);
    console.log(`Using folder: ${folderId}`);

    const state = loadState();
    const lastUploadTime = state.last_upload ? new Date(state.last_upload).getTime() : 0;

    let uploaded = 0;
    let skipped = 0;
    const uploadedReviews = [];

    // Upload review files (only modified since last upload)
    if (existsSync(REVIEWS_DIR)) {
        const files = readdirSync(REVIEWS_DIR).filter(f => f.endsWith('.md'));

        for (const file of files) {
            const filePath = join(REVIEWS_DIR, file);
            const mtime = statSync(filePath).mtimeMs;

            if (mtime <= lastUploadTime) {
                skipped++;
                continue;
            }

            const content = readFileSync(filePath, 'utf-8');
            const result = await upsertFile(drive, folderId, file, content);
            console.log(`  ${result.action}: ${file} → ${result.id}`);
            state.uploaded_files[file] = { id: result.id, uploaded_at: new Date().toISOString() };
            uploadedReviews.push(file);
            uploaded++;
        }
    }

    // Upload inbox markdown report
    const inboxMd = join(REPORTS_DIR, 'pr-inbox.md');
    if (existsSync(inboxMd)) {
        const mtime = statSync(inboxMd).mtimeMs;
        if (mtime > lastUploadTime) {
            const content = readFileSync(inboxMd, 'utf-8');
            const result = await upsertFile(drive, folderId, 'pr-inbox.md', content);
            console.log(`  ${result.action}: pr-inbox.md → ${result.id}`);
            uploaded++;
        }
    }

    // Save state
    state.last_upload = new Date().toISOString();
    state.folder_id = folderId;
    saveState(state);

    console.log(`Upload complete: ${uploaded} uploaded, ${skipped} unchanged`);

    // Output uploaded review filenames for downstream scripts (Chat notification)
    if (uploadedReviews.length > 0) {
        const uploadedListFile = join(DATA_DIR, 'last-uploaded-reviews.json');
        writeFileSync(uploadedListFile, JSON.stringify({ reviews: uploadedReviews, folder_id: folderId }, null, 2));
    }
}

main().catch(err => {
    console.error('Upload failed:', err.message);
    process.exit(1);
});
