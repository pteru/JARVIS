/**
 * Shared monthly Q&A log writers for JARVIS chat bots.
 *
 * Two sinks, two formats (kept intentionally):
 * - appendMonthlyJsonl: machine-readable JSONL, UTC month files (jarvis-chat).
 * - appendKbMarkdown:   human-readable registro-qa markdown for the KB repo,
 *   local-time month files + pendentes.md gap list (kb-chat). Local time is
 *   preserved because the registro is a PT-BR human document.
 */
import { existsSync, mkdirSync, appendFileSync, writeFileSync } from 'fs';
import { join } from 'path';

/** Append one record to <dir>/<YYYY-MM>.jsonl (UTC month from record.ts). */
export function appendMonthlyJsonl(dir, record) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const now = new Date(record.ts || Date.now());
  const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const file = join(dir, `${month}.jsonl`);
  appendFileSync(file, JSON.stringify({ ...record, ts: now.toISOString() }) + '\n');
}

/**
 * Append one Q&A entry to the KB registro-qa markdown month file.
 * @param {string} dir   registro-qa directory
 * @param {object} entry { who, question, answer, kbPagesUsed, isGap }
 */
export function appendKbMarkdown(dir, entry) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const monthFile = join(dir, `${month}.md`);
  const timestamp = now.toISOString().replace('T', ' ').substring(0, 16);

  if (!existsSync(monthFile)) {
    writeFileSync(monthFile, `# Registro Q&A — ${month}\n\n`);
  }

  const shortQuestion = entry.question.length > 80
    ? entry.question.substring(0, 77) + '...'
    : entry.question;

  const qaEntry = `### ${timestamp} — ${shortQuestion}

**Quem perguntou:** ${entry.who}
**Pergunta:** ${entry.question}
**Resposta:** ${entry.answer}
**Paginas KB usadas:** ${entry.kbPagesUsed.length > 0 ? entry.kbPagesUsed.join(', ') : 'nenhuma'}
**Lacuna identificada:** ${entry.isGap ? 'sim' : 'nao'}

---

`;

  appendFileSync(monthFile, qaEntry);

  if (entry.isGap) {
    const pendentesFile = join(dir, 'pendentes.md');
    const pendentesEntry = `- [ ] ${now.toISOString().substring(0, 10)} — ${shortQuestion} (${entry.who})\n`;
    appendFileSync(pendentesFile, pendentesEntry);
  }
}
