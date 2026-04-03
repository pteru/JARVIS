import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

/**
 * Recursively find all .md files in a directory
 */
function findMarkdownFiles(dir, files = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    if (entry.isDirectory()) findMarkdownFiles(fullPath, files);
    else if (entry.name.endsWith('.md')) files.push(fullPath);
  }
  return files;
}

/**
 * Extract keywords from a question (simple tokenization + stopword removal)
 */
function extractKeywords(question) {
  const stopwords = new Set([
    'o', 'a', 'os', 'as', 'um', 'uma', 'de', 'do', 'da', 'dos', 'das',
    'em', 'no', 'na', 'nos', 'nas', 'por', 'para', 'com', 'como', 'que',
    'qual', 'quais', 'onde', 'quando', 'e', 'ou', 'se', 'nao', 'sim',
    'the', 'is', 'are', 'was', 'were', 'of', 'in', 'on', 'at', 'to',
    'and', 'or', 'not', 'what', 'how', 'where', 'when', 'which', 'who',
    'jarvis', '@jarvis', 'me', 'eu', 'meu', 'isso', 'esse', 'esta'
  ]);

  return question
    .toLowerCase()
    .replace(/[^\w\s\u00e1\u00e9\u00ed\u00f3\u00fa\u00e2\u00ea\u00f4\u00e3\u00f5\u00e7-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopwords.has(w));
}

/**
 * Score a file against keywords. Returns { path, relPath, score, title, preview }
 */
function scoreFile(filePath, kbRoot, keywords) {
  const content = readFileSync(filePath, 'utf-8');
  const lower = content.toLowerCase();
  const relPath = relative(kbRoot, filePath);

  let score = 0;
  for (const kw of keywords) {
    // Count occurrences in content
    const regex = new RegExp(kw, 'gi');
    const matches = lower.match(regex);
    if (matches) score += matches.length;

    // Bonus for keyword in filename
    if (relPath.toLowerCase().includes(kw)) score += 5;

    // Bonus for keyword in title (first line)
    const firstLine = content.split('\n')[0].toLowerCase();
    if (firstLine.includes(kw)) score += 3;
  }

  // Extract title
  const titleMatch = content.match(/^#\s+(.+)/m);
  const title = titleMatch ? titleMatch[1] : relPath;

  // Extract first 3 non-empty, non-header lines as preview
  const preview = content
    .split('\n')
    .filter(l => l.trim() && !l.startsWith('#') && !l.startsWith('>'))
    .slice(0, 3)
    .join(' ')
    .substring(0, 200);

  return { path: filePath, relPath, score, title, preview };
}

/**
 * Search KB for pages relevant to a question.
 * @param {string} kbRoot - Path to KB repo root
 * @param {string} question - User's question
 * @param {number} maxResults - Max pages to return
 * @returns {Array<{relPath, title, content}>} - Relevant pages with full content
 */
export function searchKB(kbRoot, question, maxResults = 5) {
  const keywords = extractKeywords(question);
  if (keywords.length === 0) return [];

  const files = findMarkdownFiles(kbRoot);
  const scored = files
    .map(f => scoreFile(f, kbRoot, keywords))
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);

  return scored.map(s => ({
    relPath: s.relPath,
    title: s.title,
    content: readFileSync(s.path, 'utf-8'),
    score: s.score
  }));
}
