import { appendKbMarkdown } from '../../lib/chat-bot/qa-log.mjs';

/**
 * Log a Q&A exchange to the registro-qa/ directory
 * @param {string} logDir - Path to registro-qa/
 * @param {object} entry - { who, question, answer, kbPagesUsed, isGap }
 */
export function logQA(logDir, entry) {
  appendKbMarkdown(logDir, entry);
}
