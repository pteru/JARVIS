import fs from "fs/promises";
import path from "path";

/**
 * Analyze workspace health by examining backlogs and changelogs.
 * Returns a health score per workspace.
 */
export async function analyzeWorkspaceHealth(orchestratorHome) {
  const backlogsDir = path.join(orchestratorHome, "backlogs");
  const changelogsDir = path.join(orchestratorHome, "changelogs");

  const workspaces = {};

  // Parse backlogs - count unchecked (pending) vs checked (done) items
  try {
    const backlogFiles = await fs.readdir(backlogsDir);
    for (const file of backlogFiles) {
      if (!file.endsWith(".md")) continue;
      const name = file.replace(/\.md$/, "");
      const content = await fs.readFile(path.join(backlogsDir, file), "utf-8");

      const unchecked = (content.match(/^- \[ \]/gm) || []).length;
      const checked = (content.match(/^- \[x\]/gim) || []).length;

      if (!workspaces[name]) workspaces[name] = {};
      workspaces[name].backlogPending = unchecked;
      workspaces[name].backlogCompleted = checked;
    }
  } catch {
    // backlogs dir may not exist
  }

  // Parse changelogs - count entries in the last 7 days
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  try {
    const changelogFiles = await fs.readdir(changelogsDir);
    for (const file of changelogFiles) {
      if (!file.endsWith(".md")) continue;
      const name = file.replace(/\.md$/, "");
      const content = await fs.readFile(path.join(changelogsDir, file), "utf-8");

      // Count date headers and entries
      const dateHeaders = content.match(/^## \d{4}-\d{2}-\d{2}/gm) || [];
      let recentEntries = 0;

      for (const header of dateHeaders) {
        const dateStr = header.replace("## ", "");
        const date = new Date(dateStr);
        if (date >= sevenDaysAgo) {
          recentEntries++;
        }
      }

      // Count total change entries (lines starting with -)
      const totalEntries = (content.match(/^- .+/gm) || []).length;

      if (!workspaces[name]) workspaces[name] = {};
      workspaces[name].changelogRecentDays = recentEntries;
      workspaces[name].changelogTotalEntries = totalEntries;
    }
  } catch {
    // changelogs dir may not exist
  }

  // Compute health score per workspace (0-100)
  const results = {};
  for (const [name, data] of Object.entries(workspaces)) {
    let score = 50; // baseline

    const pending = data.backlogPending || 0;
    const completed = data.backlogCompleted || 0;
    const recentDays = data.changelogRecentDays || 0;
    const totalEntries = data.changelogTotalEntries || 0;

    // Backlog completion ratio boosts score
    if (pending + completed > 0) {
      const ratio = completed / (pending + completed);
      score += Math.round(ratio * 20); // up to +20
    }

    // Large pending backlog penalizes
    if (pending > 10) score -= 15;
    else if (pending > 5) score -= 5;

    // Recent changelog activity boosts score
    if (recentDays >= 3) score += 15;
    else if (recentDays >= 1) score += 10;
    else score -= 10; // no recent activity is a concern

    // Total entries show maturity
    if (totalEntries >= 20) score += 10;
    else if (totalEntries >= 5) score += 5;

    score = Math.max(0, Math.min(100, score));

    results[name] = {
      ...data,
      healthScore: score,
      healthLabel: score >= 75 ? "healthy" : score >= 50 ? "moderate" : "needs-attention",
    };
  }

  return results;
}
