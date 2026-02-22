import fs from 'fs/promises';
import path from 'path';
import { ORCHESTRATOR_HOME } from '../../../mcp-servers/lib/config-loader.js';

export async function parseChangelogs() {
  const changelogsDir = path.join(ORCHESTRATOR_HOME, 'changelogs');
  let files = [];
  try {
    files = await fs.readdir(changelogsDir);
  } catch {
    return { changelogs: [], recentEntries: [] };
  }

  const changelogs = [];
  const allEntries = [];

  for (const file of files) {
    if (!file.endsWith('.md')) continue;
    const workspace = file.replace(/-changelog\.md$/, '').replace(/\.md$/, '');
    try {
      const content = await fs.readFile(path.join(changelogsDir, file), 'utf-8');
      const entries = parseChangelogEntries(content, workspace);
      changelogs.push({ workspace, entryCount: entries.length, latestDate: entries[0]?.date || null });
      allEntries.push(...entries);
    } catch {
      // skip unreadable files
    }
  }

  allEntries.sort((a, b) => b.date.localeCompare(a.date));

  return {
    changelogs,
    recentEntries: allEntries.slice(0, 30)
  };
}

function parseChangelogEntries(content, workspace) {
  const entries = [];
  const lines = content.split('\n');
  let currentDate = null;
  let currentSection = null;
  let currentItems = [];

  for (const line of lines) {
    const dateMatch = line.match(/^##\s+(\d{4}-\d{2}-\d{2})/);
    if (dateMatch) {
      if (currentDate && currentItems.length > 0) {
        entries.push({ date: currentDate, workspace, section: currentSection, items: [...currentItems] });
        currentItems = [];
      }
      currentDate = dateMatch[1];
      currentSection = null;
      continue;
    }

    const sectionMatch = line.match(/^###\s+(Added|Changed|Fixed|Removed)/i);
    if (sectionMatch) {
      if (currentDate && currentSection && currentItems.length > 0) {
        entries.push({ date: currentDate, workspace, section: currentSection, items: [...currentItems] });
        currentItems = [];
      }
      currentSection = sectionMatch[1];
      continue;
    }

    const itemMatch = line.match(/^[-*]\s+(.*)/);
    if (itemMatch && currentDate && currentSection) {
      currentItems.push(itemMatch[1].trim());
    }
  }

  if (currentDate && currentSection && currentItems.length > 0) {
    entries.push({ date: currentDate, workspace, section: currentSection, items: [...currentItems] });
  }

  return entries;
}
