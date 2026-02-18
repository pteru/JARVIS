import fs from 'fs/promises';
import path from 'path';

const ORCHESTRATOR_HOME = process.env.ORCHESTRATOR_HOME || path.join(process.env.HOME, 'claude-orchestrator');

// Build repo -> product mapping from workspaces.json
async function buildRepoProductMap() {
  const map = {};
  try {
    const raw = await fs.readFile(path.join(ORCHESTRATOR_HOME, 'config', 'orchestrator', 'workspaces.json'), 'utf-8');
    const config = JSON.parse(raw);
    for (const ws of Object.values(config.workspaces || {})) {
      for (const remote of Object.values(ws.remotes || {})) {
        const repo = remote.split('/').pop().replace(/\.git$/, '');
        if (ws.product) map[repo] = ws.product;
      }
    }
  } catch { /* ignore */ }
  return map;
}

// Extract verdict from a review markdown file
async function extractVerdict(filePath) {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    // Look for verdict section
    const match = content.match(/##\s*\*?\*?Verdict[:\s]*\*?\*?\s*\n+\s*\*?\*?\*?(APPROVE(?:\s+WITH\s+COMMENTS)?|CHANGES\s+REQUESTED)\*?\*?\*?/i);
    if (match) {
      const v = match[1].toUpperCase().trim();
      if (v.startsWith('APPROVE')) return 'APPROVED';
      if (v.startsWith('CHANGES')) return 'CHANGES_REQUESTED';
    }
    // Fallback: line-by-line search
    const lines = content.split('\n');
    for (const line of lines) {
      if (/verdict/i.test(line) || /\*\*APPROVE/i.test(line) || /\*\*CHANGES/i.test(line)) {
        if (/CHANGES\s+REQUESTED/i.test(line)) return 'CHANGES_REQUESTED';
        if (/APPROVE/i.test(line)) return 'APPROVED';
      }
    }
  } catch { /* file doesn't exist or unreadable */ }
  return null;
}

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

export async function parsePrInbox() {
  const prInboxPath = path.join(ORCHESTRATOR_HOME, 'reports', 'pr-inbox.json');
  const reviewsDir = path.join(ORCHESTRATOR_HOME, 'reports', 'pr-reviews');

  let data;
  try {
    const raw = await fs.readFile(prInboxPath, 'utf-8');
    data = JSON.parse(raw);
  } catch {
    return emptyResult();
  }

  const pullRequests = data.pull_requests || [];
  if (pullRequests.length === 0) return emptyResult();

  const repoProductMap = await buildRepoProductMap();
  const now = Date.now();

  let needsReview = 0;
  let approved = 0;
  let changesRequested = 0;
  let draft = 0;
  let stale = 0;

  const byProduct = {};
  const prs = [];

  for (const pr of pullRequests) {
    const createdAt = new Date(pr.created_at).getTime();
    const ageDays = Math.floor((now - createdAt) / 86400000);
    const reviewFile = `${pr.repo}-${pr.number}.md`;
    const reviewFilePath = path.join(reviewsDir, reviewFile);

    let reviewFileExists = false;
    try {
      await fs.access(reviewFilePath);
      reviewFileExists = true;
    } catch { /* not found */ }

    const reviewVerdict = reviewFileExists ? await extractVerdict(reviewFilePath) : null;

    // Determine product
    const product = capitalize(repoProductMap[pr.repo]) || 'Other';

    // Count stats
    if (pr.is_draft) {
      draft++;
    } else if (reviewVerdict === 'APPROVED' || pr.review_decision === 'APPROVED') {
      approved++;
    } else if (reviewVerdict === 'CHANGES_REQUESTED' || pr.review_decision === 'CHANGES_REQUESTED') {
      changesRequested++;
    } else {
      needsReview++;
    }

    if (ageDays > 7) stale++;

    const entry = {
      repo: pr.repo,
      number: pr.number,
      title: pr.title,
      author: pr.author,
      age_days: ageDays,
      additions: pr.additions,
      deletions: pr.deletions,
      changed_files: pr.changed_files,
      url: pr.url,
      is_draft: pr.is_draft,
      review_decision: pr.review_decision,
      review_verdict: reviewVerdict,
      review_file_exists: reviewFileExists,
      product,
    };

    prs.push(entry);

    if (!byProduct[product]) byProduct[product] = [];
    byProduct[product].push(entry);
  }

  return {
    fetched_at: data.fetched_at,
    total: pullRequests.length,
    needsReview,
    approved,
    changesRequested,
    draft,
    stale,
    byProduct,
    prs,
  };
}

function emptyResult() {
  return {
    fetched_at: null,
    total: 0,
    needsReview: 0,
    approved: 0,
    changesRequested: 0,
    draft: 0,
    stale: 0,
    byProduct: {},
    prs: [],
  };
}
