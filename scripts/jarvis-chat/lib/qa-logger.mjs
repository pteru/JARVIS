import { existsSync, mkdirSync, appendFileSync } from 'fs';
import { join } from 'path';

export function logQA(qaLogDir, entry) {
  if (!existsSync(qaLogDir)) mkdirSync(qaLogDir, { recursive: true });
  const now = new Date(entry.ts || Date.now());
  const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const file = join(qaLogDir, `${month}.jsonl`);
  const record = {
    ts: now.toISOString(),
    space_id: entry.space_id,
    space_label: entry.space_label,
    project_code: entry.project_code,
    thread_id: entry.thread_id,
    asker: entry.asker,
    question: entry.question,
    answer: entry.answer,
    facts_used: entry.facts_used || [],
    context_sources: entry.context_sources || [],
  };
  appendFileSync(file, JSON.stringify(record) + '\n');
}
