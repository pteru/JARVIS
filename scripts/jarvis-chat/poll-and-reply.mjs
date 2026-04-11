#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

import { listRecentMessages, sendReply } from '../helpers/chat-client.mjs';
import { loadRegistry, lookupSpace } from './lib/space-registry.mjs';
import { appendMessage } from './lib/transcript-store.mjs';
import { loadThreads, saveThreads, getThread, upsertThread, pruneExpired } from './lib/thread-tracker.mjs';
import { decideAction } from './lib/speaking-policy.mjs';
import { loadStaticProjectContext } from './lib/project-context.mjs';
import { loadRecentFacts, searchFacts } from './lib/fact-store.mjs';
import { generateAnswer } from './lib/answer-generator.mjs';
import { logQA } from './lib/qa-logger.mjs';
import { MESSAGES } from './lib/messages.pt-br.mjs';

const ORCHESTRATOR_HOME = process.env.ORCHESTRATOR_HOME || `${process.env.HOME}/JARVIS`;
const CONFIG_PATH = join(ORCHESTRATOR_HOME, 'config/orchestrator/jarvis-chat.json');
const REGISTRY_PATH = join(ORCHESTRATOR_HOME, 'config/orchestrator/jarvis-chat-spaces.json');
const DATA_ROOT = join(ORCHESTRATOR_HOME, 'data/jarvis-chat');
const STATE_PATH = join(DATA_ROOT, 'state-poll.json');
const THREADS_PATH = join(DATA_ROOT, 'threads/active.json');
const TRANSCRIPTS_ROOT = join(DATA_ROOT, 'transcripts');
const FACTS_DIR = join(DATA_ROOT, 'facts');
const QA_LOG_DIR = join(DATA_ROOT, 'qa-log');

function loadJsonOrDefault(path, fallback) {
  if (!existsSync(path)) return fallback;
  try { return JSON.parse(readFileSync(path, 'utf-8')); } catch { return fallback; }
}

function saveJson(path, data) {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2));
}

async function main() {
  const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
  if (!config.enabled) {
    console.log('[jarvis-chat] disabled in config');
    return;
  }

  const registry = loadRegistry(REGISTRY_PATH);
  const state = loadJsonOrDefault(STATE_PATH, { spaces_state: {}, warned_unmapped: {} });
  const threads = loadThreads(THREADS_PATH);
  const nowIso = new Date().toISOString();

  pruneExpired(threads, nowIso, config);

  const mappedSpaceIds = Object.keys(registry.spaces || {});
  let processed = 0;

  for (const spaceId of mappedSpaceIds) {
    const mapping = lookupSpace(registry, spaceId);
    const lastTs = state.spaces_state?.[spaceId]?.last_message_ts || null;

    let messages;
    try {
      messages = await listRecentMessages(spaceId, lastTs);
    } catch (err) {
      console.error(`[jarvis-chat] listRecentMessages failed for ${spaceId}: ${err.message}`);
      continue;
    }

    for (const raw of messages) {
      const message = {
        ts: raw.createTime,
        space_id: spaceId,
        thread_id: raw.thread?.name || raw.name,
        message_id: raw.name,
        sender: { id: raw.sender?.name, name: raw.sender?.displayName || raw.sender?.name },
        text: raw.text || '',
        is_bot: raw.sender?.type === 'BOT' || raw.sender?.name === config.bot_user_id,
        annotations: raw.annotations || [],
      };

      if (mapping.memory_enabled !== false) {
        appendMessage(TRANSCRIPTS_ROOT, message);
      }

      const threadState = getThread(threads, message.thread_id);
      const decision = decideAction({
        message,
        spaceMapping: mapping,
        threadState,
        config,
        botUserId: config.bot_user_id,
      });

      if (decision.action === 'ignore') {
        if (decision.newThreadState && decision.newThreadState.status === 'expired') {
          delete threads[message.thread_id];
        }
        continue;
      }

      // action === 'reply'
      try {
        const projectContext = loadStaticProjectContext(mapping.project_code, mapping.product);
        const facts = loadRecentFacts(FACTS_DIR, 3);
        const factHits = searchFacts(facts, message.text, {
          projectCode: mapping.project_code,
          k: config.max_facts_per_answer,
          nowIso,
        });

        const answer = await generateAnswer({
          question: message.text,
          projectContext,
          facts: factHits,
          projectCode: mapping.project_code,
          spaceLabel: mapping.label,
          model: config.model,
        });

        await sendReply(spaceId, answer, message.thread_id);

        if (mapping.memory_enabled !== false) {
          appendMessage(TRANSCRIPTS_ROOT, {
            ts: new Date().toISOString(),
            space_id: spaceId,
            thread_id: message.thread_id,
            message_id: `local-bot-${Date.now()}`,
            sender: { id: config.bot_user_id, name: 'JARVIS' },
            text: answer,
            is_bot: true,
          });
        }

        upsertThread(threads, decision.newThreadState);

        logQA(QA_LOG_DIR, {
          ts: nowIso,
          space_id: spaceId,
          space_label: mapping.label,
          project_code: mapping.project_code,
          thread_id: message.thread_id,
          asker: message.sender.name,
          question: message.text,
          answer,
          facts_used: factHits.map(f => f.fact.id),
          context_sources: projectContext.sources.map(s => s.label),
        });

        processed += 1;
      } catch (err) {
        console.error(`[jarvis-chat] reply pipeline failed: ${err.message}`);
        try {
          await sendReply(spaceId, MESSAGES.errorGeneric, message.thread_id);
        } catch { /* swallow */ }
      }
    }

    if (messages.length > 0) {
      const latest = messages[messages.length - 1];
      if (!state.spaces_state) state.spaces_state = {};
      state.spaces_state[spaceId] = { last_message_ts: latest.createTime };
    }
  }

  saveThreads(THREADS_PATH, threads);
  state.last_poll = nowIso;
  saveJson(STATE_PATH, state);
  console.log(`[jarvis-chat] poll done; processed ${processed} replies`);
}

main().catch(err => {
  console.error(`[jarvis-chat] fatal: ${err.message}`);
  process.exit(1);
});
