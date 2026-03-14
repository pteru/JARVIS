#!/usr/bin/env node
// Send Google Chat DM to PR authors with their review summary.
// Uses service account with domain-wide delegation to impersonate pedro@lumesolutions.com.
// Requires chat.messages scope in Admin Console delegation.

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { google } from 'googleapis';

const SERVICE_DIR = process.env.SERVICE_DIR || '/opt/jarvis-pr-review';
const CREDENTIALS_FILE = join(SERVICE_DIR, 'credentials', 'gcp-service-account.json');
const TEAM_MEMBERS_FILE = join(SERVICE_DIR, 'config', 'team-members.json');
const INBOX_FILE = join(SERVICE_DIR, 'data', 'pr-inbox.json');
const REVIEWS_DIR = join(SERVICE_DIR, 'reviews');
const UPLOADED_REVIEWS_FILE = join(SERVICE_DIR, 'data', 'last-uploaded-reviews.json');

// ─── Auth ────────────────────────────────────────────────────────────────────

async function getAuth() {
    const keyContent = readFileSync(CREDENTIALS_FILE, 'utf-8');
    const key = JSON.parse(keyContent);

    const auth = new google.auth.GoogleAuth({
        credentials: key,
        scopes: [
            'https://www.googleapis.com/auth/chat.messages',
            'https://www.googleapis.com/auth/chat.spaces',
        ],
        clientOptions: {
            subject: 'pedro@lumesolutions.com',
        },
    });

    return auth;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function loadTeamMembers() {
    if (!existsSync(TEAM_MEMBERS_FILE)) return [];
    return JSON.parse(readFileSync(TEAM_MEMBERS_FILE, 'utf-8')).members || [];
}

function getGitHubToEmailMap() {
    const members = loadTeamMembers();
    const map = new Map();
    for (const m of members) {
        map.set(m.github, m.email);
    }
    return map;
}

function extractVerdict(reviewContent) {
    const match = reviewContent.match(/## Verdict\s*\n+\**(APPROVE|APPROVE WITH COMMENTS|CHANGES REQUESTED)\**/i);
    return match ? match[1] : 'REVIEWED';
}

function extractSummary(reviewContent) {
    const match = reviewContent.match(/## Summary\s*\n+([\s\S]*?)(?=\n## )/);
    return match ? match[1].trim().split('\n')[0] : '';
}

function extractBlockingIssue(reviewContent) {
    const criticalSection = reviewContent.match(/### Critical\s*\n+([\s\S]*?)(?=\n### )/);
    if (criticalSection) {
        const text = criticalSection[1].trim();
        if (text.toLowerCase() !== 'none') {
            // Get first bullet point
            const firstBullet = text.match(/^[-*]\s*(.+)/m);
            return firstBullet ? firstBullet[1] : text.split('\n')[0];
        }
    }
    return null;
}

// ─── Chat DM ─────────────────────────────────────────────────────────────────

async function findOrCreateDmSpace(chat, userEmail) {
    // Use spaces.setup to find or create a DM space
    try {
        const res = await chat.spaces.setup({
            requestBody: {
                space: {
                    spaceType: 'DIRECT_MESSAGE',
                },
                memberships: [
                    { member: { name: `users/${userEmail}`, type: 'HUMAN' } },
                ],
            },
        });
        return res.data.name;
    } catch (err) {
        console.error(`  Failed to find/create DM with ${userEmail}: ${err.message}`);
        return null;
    }
}

async function sendChatMessage(chat, spaceName, text) {
    try {
        await chat.spaces.messages.create({
            parent: spaceName,
            requestBody: { text },
        });
        return true;
    } catch (err) {
        console.error(`  Failed to send message to ${spaceName}: ${err.message}`);
        return false;
    }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
    // Check what was just uploaded
    if (!existsSync(UPLOADED_REVIEWS_FILE)) {
        console.log('No recently uploaded reviews to notify about.');
        process.exit(0);
    }

    const uploaded = JSON.parse(readFileSync(UPLOADED_REVIEWS_FILE, 'utf-8'));
    const reviewFileNames = uploaded.reviews || [];
    const docIds = uploaded.doc_ids || {};
    const fileIds = uploaded.file_ids || {};

    if (reviewFileNames.length === 0) {
        console.log('No new reviews to notify about.');
        process.exit(0);
    }

    // Load inbox to get PR author info
    if (!existsSync(INBOX_FILE)) {
        console.error('Inbox file not found, cannot resolve PR authors.');
        process.exit(1);
    }

    const inbox = JSON.parse(readFileSync(INBOX_FILE, 'utf-8'));
    const prMap = new Map();
    for (const pr of inbox.pull_requests || []) {
        prMap.set(`${pr.repo}-${pr.number}.md`, pr);
    }

    // Build folder URL as fallback
    const folderUrl = uploaded.folder_id
        ? `https://drive.google.com/drive/folders/${uploaded.folder_id}`
        : '';

    const ghToEmail = getGitHubToEmailMap();

    if (!existsSync(CREDENTIALS_FILE)) {
        console.error('Credentials not found, skipping Chat notifications.');
        process.exit(0);
    }

    const auth = await getAuth();
    const chat = google.chat({ version: 'v1', auth });

    let sent = 0;
    let skippedNoMapping = 0;
    let failed = 0;

    for (const fileName of reviewFileNames) {
        const pr = prMap.get(fileName);
        if (!pr) {
            console.log(`  Skipping ${fileName}: not found in inbox`);
            continue;
        }

        const authorEmail = ghToEmail.get(pr.author);
        if (!authorEmail) {
            console.log(`  Skipping ${fileName}: no email mapping for GitHub user "${pr.author}"`);
            skippedNoMapping++;
            continue;
        }

        // Read review to extract verdict and summary
        const reviewPath = join(REVIEWS_DIR, fileName);
        if (!existsSync(reviewPath)) {
            console.log(`  Skipping ${fileName}: review file not found`);
            continue;
        }

        const reviewContent = readFileSync(reviewPath, 'utf-8');
        const verdict = extractVerdict(reviewContent);
        const summary = extractSummary(reviewContent);
        const blocking = extractBlockingIssue(reviewContent);

        // Build message
        let message = `*PR Review: ${pr.repo}#${pr.number}*\n`;
        message += `*Verdict: ${verdict}*\n\n`;
        if (blocking) {
            message += `\u26a0\ufe0f Blocking: ${blocking}\n\n`;
        }
        if (summary) {
            message += `${summary}\n\n`;
        }
        // PR link on GitHub
        if (pr.url) {
            message += `PR: ${pr.url}\n`;
        }
        // Direct link to the Google Doc review (fall back to raw file, then folder)
        const docId = docIds[fileName];
        const fileId = fileIds[fileName];
        if (docId) {
            message += `Review: https://docs.google.com/document/d/${docId}/edit`;
        } else if (fileId) {
            message += `Review: https://drive.google.com/file/d/${fileId}/view`;
        } else if (folderUrl) {
            message += `Review: ${folderUrl}`;
        }

        // Send DM
        const spaceName = await findOrCreateDmSpace(chat, authorEmail);
        if (!spaceName) {
            failed++;
            continue;
        }

        if (await sendChatMessage(chat, spaceName, message)) {
            console.log(`  Sent DM to ${authorEmail} for ${pr.repo}#${pr.number}`);
            sent++;
        } else {
            failed++;
        }
    }

    console.log(`Chat notifications: ${sent} sent, ${skippedNoMapping} no mapping, ${failed} failed`);
}

main().catch(err => {
    console.error('Chat notification failed:', err.message);
    // Non-fatal — don't exit with error code
    process.exit(0);
});
