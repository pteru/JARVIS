#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { searchKB } from './lib/kb-search.mjs';
import { generateAnswer } from './lib/answer-generator.mjs';
import { logQA } from './lib/qa-logger.mjs';
import { pollSpaces } from '../lib/chat-bot/poll-harness.mjs';
import { listRecentMessages, sendReply, listSpaces } from '../helpers/chat-client.mjs';

const ORCHESTRATOR_HOME = process.env.ORCHESTRATOR_HOME || `${process.env.HOME}/JARVIS`;
const CONFIG_PATH = join(ORCHESTRATOR_HOME, 'config/orchestrator/kb-chat.json');
const STATE_PATH = join(ORCHESTRATOR_HOME, 'scripts/kb-chat/state.json');

const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
const state = JSON.parse(readFileSync(STATE_PATH, 'utf-8'));
const kbRoot = join(ORCHESTRATOR_HOME, config.kb_repo_path);
const logDir = join(ORCHESTRATOR_HOME, config.log_dir);

async function main() {
  if (!config.enabled) {
    console.log('[kb-chat] Bot disabled in config');
    process.exit(0);
  }

  console.log(`[kb-chat] Polling at ${new Date().toISOString()}`);

  // Get spaces to monitor
  let spaces = config.spaces;
  if (!spaces || spaces.length === 0) {
    const allSpaces = await listSpaces();
    spaces = allSpaces.map(s => s.name);
  }

  const processed = await pollSpaces({
    tag: 'kb-chat',
    spaceIds: spaces,
    state,
    listRecentMessages,
    onMessage: async (msg, spaceName) => {
      // Check if message mentions JARVIS
      const text = msg.text || '';
      if (!text.toLowerCase().includes(config.mention_trigger.toLowerCase())) return false;

      // Extract the question (remove the @JARVIS mention)
      const question = text.replace(/@?jarvis/gi, '').trim();
      if (!question) return false;

      console.log(`[kb-chat] Question from ${msg.sender?.displayName || 'unknown'}: ${question.substring(0, 80)}`);

      // Search KB for relevant pages
      const results = searchKB(kbRoot, question, config.max_context_pages);

      // Generate answer
      let answer;
      let isGap = false;
      try {
        answer = await generateAnswer(question, results, config);
        if (answer.includes('Nao encontrei') || results.length === 0) {
          isGap = true;
        }
      } catch (err) {
        console.error(`[kb-chat] Error generating answer: ${err.message}`);
        answer = 'Desculpe, ocorreu um erro ao processar sua pergunta. Tente novamente ou consulte a KB diretamente.';
        isGap = true;
      }

      // Reply in thread
      const threadName = msg.thread?.name || msg.name;
      try {
        await sendReply(spaceName, answer, threadName);
        console.log(`[kb-chat] Replied in ${spaceName}`);
      } catch (err) {
        console.error(`[kb-chat] Error sending reply: ${err.message}`);
      }

      // Log Q&A
      logQA(logDir, {
        who: msg.sender?.displayName || msg.sender?.name || 'unknown',
        question,
        answer,
        kbPagesUsed: results.map(r => r.relPath),
        isGap
      });

      return true;
    },
  });

  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  console.log(`[kb-chat] Done. Processed ${processed} questions.`);
}

main().catch(err => {
  console.error(`[kb-chat] Fatal: ${err.message}`);
  process.exit(1);
});
