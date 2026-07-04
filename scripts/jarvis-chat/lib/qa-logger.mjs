import { appendMonthlyJsonl } from '../../lib/chat-bot/qa-log.mjs';

export function logQA(qaLogDir, entry) {
  appendMonthlyJsonl(qaLogDir, {
    ts: entry.ts,
    space_id: entry.space_id,
    space_label: entry.space_label,
    project_code: entry.project_code,
    thread_id: entry.thread_id,
    asker: entry.asker,
    question: entry.question,
    answer: entry.answer,
    facts_used: entry.facts_used || [],
    context_sources: entry.context_sources || [],
  });
}
