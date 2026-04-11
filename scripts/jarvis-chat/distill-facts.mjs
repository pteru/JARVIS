#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

import { loadRegistry, lookupSpace } from './lib/space-registry.mjs';
import { readMessagesSince } from './lib/transcript-store.mjs';
import { extractFactsFromThread } from './lib/fact-extractor.mjs';
import { appendFact } from './lib/fact-store.mjs';

const ORCHESTRATOR_HOME = process.env.ORCHESTRATOR_HOME || `${process.env.HOME}/JARVIS`;
const CONFIG_PATH = join(ORCHESTRATOR_HOME, 'config/orchestrator/jarvis-chat.json');
const REGISTRY_PATH = join(ORCHESTRATOR_HOME, 'config/orchestrator/jarvis-chat-spaces.json');
const DATA_ROOT = join(ORCHESTRATOR_HOME, 'data/jarvis-chat');
const STATE_PATH = join(DATA_ROOT, 'state-distill.json');
const TRANSCRIPTS_ROOT = join(DATA_ROOT, 'transcripts');
const FACTS_DIR = join(DATA_ROOT, 'facts');

function loadJsonOrDefault(path, fallback) {
  if (!existsSync(path)) return fallback;
  try { return JSON.parse(readFileSync(path, 'utf-8')); } catch { return fallback; }
}

function saveJson(path, data) {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2));
}

function groupByThread(messages) {
  const groups = {};
  for (const m of messages) {
    if (!groups[m.thread_id]) groups[m.thread_id] = [];
    groups[m.thread_id].push(m);
  }
  return groups;
}

async function main() {
  const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
  if (!config.enabled) {
    console.log('[jarvis-chat:distill] disabled in config');
    return;
  }

  const registry = loadRegistry(REGISTRY_PATH);
  const state = loadJsonOrDefault(STATE_PATH, { spaces_state: {}, distill_cursor: {} });
  if (!state.distill_cursor) state.distill_cursor = {};
  const nowIso = new Date().toISOString();

  let totalFacts = 0;
  for (const spaceId of Object.keys(registry.spaces || {})) {
    const mapping = lookupSpace(registry, spaceId);
    if (mapping.memory_enabled === false) continue;

    const cursor = state.distill_cursor[spaceId] || null;
    const newMessages = readMessagesSince(TRANSCRIPTS_ROOT, spaceId, cursor);
    if (newMessages.length === 0) continue;

    const groups = groupByThread(newMessages);
    for (const [, threadMsgs] of Object.entries(groups)) {
      if (threadMsgs.length < 2) continue;
      try {
        const facts = await extractFactsFromThread(threadMsgs, {
          space_id: spaceId,
          space_label: mapping.label,
          project_code: mapping.project_code,
          product: mapping.product,
        });
        for (const f of facts) {
          appendFact(FACTS_DIR, f);
          totalFacts += 1;
        }
      } catch (err) {
        console.error(`[jarvis-chat:distill] extraction failed for ${spaceId}: ${err.message}`);
      }
    }

    const latestTs = newMessages[newMessages.length - 1].ts;
    state.distill_cursor[spaceId] = latestTs;
  }

  state.last_distill = nowIso;
  saveJson(STATE_PATH, state);
  console.log(`[jarvis-chat:distill] done; extracted ${totalFacts} facts`);
}

main().catch(err => {
  console.error(`[jarvis-chat:distill] fatal: ${err.message}`);
  process.exit(1);
});
