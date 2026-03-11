#!/usr/bin/env node
// Build a PR inbox markdown report from the JSON inbox and review files.
// Adapted from scripts/helpers/build-pr-inbox.mjs for the remote PR review service.

import { readFileSync, readdirSync, existsSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';

const SERVICE_DIR = process.env.SERVICE_DIR || '/opt/jarvis-pr-review';
const INBOX_FILE = join(SERVICE_DIR, 'data', 'pr-inbox.json');
const REVIEWS_DIR = join(SERVICE_DIR, 'reviews');
const WORKSPACES_CONFIG = join(SERVICE_DIR, 'config', 'workspaces.json');
const OUTPUT_FILE = join(SERVICE_DIR, 'reports', 'pr-inbox.md');

// Load data
if (!existsSync(INBOX_FILE)) {
    console.error(`PR inbox not found: ${INBOX_FILE}`);
    process.exit(1);
}

const inbox = JSON.parse(readFileSync(INBOX_FILE, 'utf-8'));
const prs = inbox.pull_requests || [];

// Load workspaces to map repos to products
const workspacesConfig = existsSync(WORKSPACES_CONFIG)
    ? JSON.parse(readFileSync(WORKSPACES_CONFIG, 'utf-8'))
    : { workspaces: {} };

// Build repo -> product map from workspace remotes
const repoToProduct = {};
for (const [, ws] of Object.entries(workspacesConfig.workspaces || {})) {
    for (const url of Object.values(ws.remotes || {})) {
        const match = url.match(/[\/:]([^\/]+?)(?:\.git)?$/);
        if (match) {
            repoToProduct[match[1]] = ws.product || 'other';
        }
    }
}

// Load existing reviews
const reviewFiles = new Set();
if (existsSync(REVIEWS_DIR)) {
    for (const f of readdirSync(REVIEWS_DIR)) {
        if (f.endsWith('.md')) {
            reviewFiles.add(f.replace(/\.md$/, ''));
        }
    }
}

// Extract verdict from review file
function getReviewVerdict(repo, number) {
    const key = `${repo}-${number}`;
    if (!reviewFiles.has(key)) return null;
    try {
        const content = readFileSync(join(REVIEWS_DIR, `${key}.md`), 'utf-8');
        const verdictMatch = content.match(/## Verdict\s*\n+\**(APPROVE|APPROVE WITH COMMENTS|CHANGES REQUESTED)\**/i);
        return verdictMatch ? verdictMatch[1] : 'REVIEWED';
    } catch {
        return 'REVIEWED';
    }
}

// Check if a review is stale relative to PR's updated_at
function reviewIsStale(pr) {
    const prUpdated = new Date(pr.updated_at).getTime();
    const key = `${pr.repo}-${pr.number}`;
    if (reviewFiles.has(key)) {
        try {
            const mtime = statSync(join(REVIEWS_DIR, `${key}.md`)).mtimeMs;
            return prUpdated > mtime;
        } catch {
            return true;
        }
    }
    if (pr.review_decision && pr.review_decision !== '') {
        return true;
    }
    return false;
}

// Helpers
function daysAgo(dateStr) {
    const diff = Date.now() - new Date(dateStr).getTime();
    return Math.floor(diff / (1000 * 60 * 60 * 24));
}

function formatAge(dateStr) {
    const d = daysAgo(dateStr);
    if (d === 0) return 'today';
    if (d === 1) return '1d';
    return `${d}d`;
}

function formatSize(additions, deletions) {
    return `+${additions}/-${deletions}`;
}

function reviewStatus(pr) {
    const verdict = getReviewVerdict(pr.repo, pr.number);
    if (pr.is_draft) return 'DRAFT';
    if (verdict || pr.review_decision) {
        if (reviewIsStale(pr)) {
            const prev = verdict || pr.review_decision.replace('_', ' ');
            return `NEEDS RE-REVIEW (was: ${prev})`;
        }
        if (verdict) return verdict;
        if (pr.review_decision === 'APPROVED') return 'APPROVED';
        if (pr.review_decision === 'CHANGES_REQUESTED') return 'CHANGES REQUESTED';
    }
    return 'NEEDS REVIEW';
}

// Group by product
const productNames = {
    visionking: 'VisionKing',
    diemaster: 'DieMaster',
    spotfusion: 'SpotFusion',
    sdk: 'SDK',
    other: 'Other'
};

const grouped = {};
for (const pr of prs) {
    const product = repoToProduct[pr.repo] || 'other';
    if (!grouped[product]) grouped[product] = [];
    grouped[product].push(pr);
}

// Stats
const total = prs.length;
const drafts = prs.filter(pr => pr.is_draft).length;
const needsReview = prs.filter(pr => !pr.is_draft && reviewStatus(pr) === 'NEEDS REVIEW').length;
const needsReReview = prs.filter(pr => !pr.is_draft && reviewStatus(pr).startsWith('NEEDS RE-REVIEW')).length;
const changesRequested = prs.filter(pr => reviewStatus(pr) === 'CHANGES REQUESTED').length;
const stalePRs = prs.filter(pr => daysAgo(pr.updated_at) > 7);

// Build markdown
const lines = [];
lines.push('# PR Inbox');
lines.push('');
lines.push(`> Generated: ${inbox.fetched_at}`);
lines.push('');
lines.push('## Summary');
lines.push('');
lines.push('| Metric | Count |');
lines.push('|--------|-------|');
lines.push(`| Total open PRs | ${total} |`);
lines.push(`| Needs review | ${needsReview} |`);
lines.push(`| Needs re-review | ${needsReReview} |`);
lines.push(`| Draft | ${drafts} |`);
lines.push(`| Changes requested | ${changesRequested} |`);
lines.push(`| Stale (>7d) | ${stalePRs.length} |`);
lines.push('');

// PRs by product
const productOrder = ['visionking', 'diemaster', 'spotfusion', 'sdk', 'other'];
for (const product of productOrder) {
    const productPRs = grouped[product];
    if (!productPRs || productPRs.length === 0) continue;

    lines.push(`## ${productNames[product] || product}`);
    lines.push('');
    lines.push('| # | Repo | Title | Author | Age | Size | Status |');
    lines.push('|---|------|-------|--------|-----|------|--------|');

    for (const pr of productPRs.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))) {
        const status = reviewStatus(pr);
        const titleCell = `[${pr.title}](${pr.url})`;
        lines.push(`| ${pr.number} | ${pr.repo} | ${titleCell} | ${pr.author} | ${formatAge(pr.updated_at)} | ${formatSize(pr.additions, pr.deletions)} | ${status} |`);
    }
    lines.push('');
}

// Stale PRs section
if (stalePRs.length > 0) {
    lines.push('## Stale PRs (>7 days without activity)');
    lines.push('');
    lines.push('| # | Repo | Title | Author | Last Activity | Size |');
    lines.push('|---|------|-------|--------|---------------|------|');

    for (const pr of stalePRs.sort((a, b) => new Date(a.updated_at) - new Date(b.updated_at))) {
        lines.push(`| ${pr.number} | ${pr.repo} | [${pr.title}](${pr.url}) | ${pr.author} | ${formatAge(pr.updated_at)} ago | ${formatSize(pr.additions, pr.deletions)} |`);
    }
    lines.push('');
}

writeFileSync(OUTPUT_FILE, lines.join('\n'));
console.log(`PR inbox markdown written to ${OUTPUT_FILE}`);
console.log(`Total: ${total} PRs, ${needsReview} need review, ${needsReReview} need re-review, ${stalePRs.length} stale`);
