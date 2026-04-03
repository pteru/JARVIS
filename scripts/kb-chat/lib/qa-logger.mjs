import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'fs';
import { join } from 'path';

/**
 * Log a Q&A exchange to the registro-qa/ directory
 * @param {string} logDir - Path to registro-qa/
 * @param {object} entry - { who, question, answer, kbPagesUsed, isGap }
 */
export function logQA(logDir, entry) {
  const now = new Date();
  const monthFile = join(logDir, `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}.md`);
  const timestamp = now.toISOString().replace('T', ' ').substring(0, 16);

  // Create month file header if it doesn't exist
  if (!existsSync(monthFile)) {
    writeFileSync(monthFile, `# Registro Q&A — ${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}\n\n`);
  }

  // Determine short question for header
  const shortQuestion = entry.question.length > 80
    ? entry.question.substring(0, 77) + '...'
    : entry.question;

  // Build entry
  const qaEntry = `### ${timestamp} — ${shortQuestion}

**Quem perguntou:** ${entry.who}
**Pergunta:** ${entry.question}
**Resposta:** ${entry.answer}
**Paginas KB usadas:** ${entry.kbPagesUsed.length > 0 ? entry.kbPagesUsed.join(', ') : 'nenhuma'}
**Lacuna identificada:** ${entry.isGap ? 'sim' : 'nao'}

---

`;

  appendFileSync(monthFile, qaEntry);

  // If gap detected, add to pendentes.md
  if (entry.isGap) {
    const pendentesFile = join(logDir, 'pendentes.md');
    const pendentesEntry = `- [ ] ${now.toISOString().substring(0, 10)} — ${shortQuestion} (${entry.who})\n`;
    appendFileSync(pendentesFile, pendentesEntry);
  }
}
