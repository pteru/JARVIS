import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { decideAction } from '../lib/speaking-policy.mjs';
import { appendMessage, readMessagesSince } from '../lib/transcript-store.mjs';
import { loadThreads, saveThreads, upsertThread, pruneExpired } from '../lib/thread-tracker.mjs';
import { appendFact, loadRecentFacts, searchFacts } from '../lib/fact-store.mjs';

test('end-to-end: mention → reply decision → transcript log → fact retrieval → thread persistence', () => {
  const root = mkdtempSync(join(tmpdir(), 'jarvis-int-'));
  try {
    const transcriptsRoot = join(root, 'transcripts');
    const factsDir = join(root, 'facts');
    const threadsPath = join(root, 'threads/active.json');
    const config = { thread_window_minutes: 5, max_follow_ups_per_window: 3, question_shape_required: true };
    const botUserId = 'users/jarvis-bot';
    const mapping = { project_code: '03002', product: 'visionking', label: 'VK 03002', memory_enabled: true };

    // Seed a fact
    appendFact(factsDir, {
      id: 'seed1',
      extracted_at: '2026-04-10T08:00:00Z',
      source: { project_code: '03002', space_label: 'VK 03002' },
      type: 'observation',
      summary: 'Disco do vk03 está em 78 por cento',
      entities: ['vk03', 'disco'],
      people: ['Pedro'],
    });

    // Simulate incoming mention
    const message = {
      ts: '2026-04-10T14:00:00Z',
      space_id: 'spaces/AAQ',
      thread_id: 'spaces/AAQ/threads/T1',
      message_id: 'spaces/AAQ/messages/M1',
      sender: { id: 'users/human', name: 'Pedro' },
      text: '@JARVIS qual o uso de disco do vk03?',
      is_bot: false,
    };

    // Step 1: log to transcript
    appendMessage(transcriptsRoot, message);

    // Step 2: speaking policy
    const threads = loadThreads(threadsPath);
    pruneExpired(threads, message.ts, config);
    const decision = decideAction({
      message, spaceMapping: mapping, threadState: threads[message.thread_id] || null,
      config, botUserId,
    });
    assert.equal(decision.action, 'reply');
    assert.equal(decision.reason, 'mention');

    // Step 3: fact retrieval (uses now=2026-04-10 to keep recency boost stable)
    const allFacts = loadRecentFacts(factsDir, 3, new Date('2026-04-10T15:00:00Z'));
    const hits = searchFacts(allFacts, message.text, { projectCode: '03002', k: 5, nowIso: message.ts });
    assert.ok(hits.length >= 1);
    assert.equal(hits[0].fact.id, 'seed1');

    // Step 4: thread state persisted
    upsertThread(threads, decision.newThreadState);
    saveThreads(threadsPath, threads);
    const reloaded = loadThreads(threadsPath);
    assert.ok(reloaded[message.thread_id]);

    // Step 5: transcript readable
    const transcript = readMessagesSince(transcriptsRoot, 'spaces/AAQ', null);
    assert.equal(transcript.length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('end-to-end: follow-up question in active thread → reply with incremented counter', () => {
  const root = mkdtempSync(join(tmpdir(), 'jarvis-int-'));
  try {
    const config = { thread_window_minutes: 5, max_follow_ups_per_window: 3, question_shape_required: true };
    const botUserId = 'users/jarvis-bot';
    const mapping = { project_code: '03002', product: 'visionking', label: 'VK 03002', memory_enabled: true };

    const threads = {};
    upsertThread(threads, {
      thread_id: 'spaces/AAQ/threads/T1',
      space_id: 'spaces/AAQ',
      engaged_at: '2026-04-10T14:00:00Z',
      last_jarvis_reply_at: '2026-04-10T14:00:00Z',
      follow_ups_used: 0,
      status: 'active',
    });

    const followUp = {
      ts: '2026-04-10T14:02:00Z',
      space_id: 'spaces/AAQ',
      thread_id: 'spaces/AAQ/threads/T1',
      message_id: 'spaces/AAQ/messages/M2',
      sender: { id: 'users/human', name: 'Pedro' },
      text: 'e o uso de cpu?',
      is_bot: false,
    };

    const decision = decideAction({
      message: followUp, spaceMapping: mapping,
      threadState: threads[followUp.thread_id], config, botUserId,
    });
    assert.equal(decision.action, 'reply');
    assert.equal(decision.reason, 'follow_up_in_window');
    assert.equal(decision.newThreadState.follow_ups_used, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('end-to-end: out-of-window follow-up → ignored, thread dropped', () => {
  const config = { thread_window_minutes: 5, max_follow_ups_per_window: 3, question_shape_required: true };
  const botUserId = 'users/jarvis-bot';
  const mapping = { project_code: '03002', product: 'visionking', label: 'VK 03002', memory_enabled: true };

  const threadState = {
    thread_id: 'spaces/AAQ/threads/T1',
    space_id: 'spaces/AAQ',
    engaged_at: '2026-04-10T14:00:00Z',
    last_jarvis_reply_at: '2026-04-10T14:00:00Z',
    follow_ups_used: 0,
    status: 'active',
  };

  const lateFollowUp = {
    ts: '2026-04-10T14:30:00Z',  // 30 min after — way past window
    space_id: 'spaces/AAQ',
    thread_id: 'spaces/AAQ/threads/T1',
    message_id: 'spaces/AAQ/messages/M3',
    sender: { id: 'users/human', name: 'Pedro' },
    text: 'algum update?',
    is_bot: false,
  };

  const decision = decideAction({
    message: lateFollowUp, spaceMapping: mapping, threadState, config, botUserId,
  });
  assert.equal(decision.action, 'ignore');
  assert.equal(decision.reason, 'window_expired');
  assert.equal(decision.newThreadState.status, 'expired');
});
