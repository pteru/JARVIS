/**
 * Tests for scripts/lib/chat-bot/poll-harness.mjs — the shared Google Chat
 * polling skeleton used by jarvis-chat and kb-chat.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pollSpaces } from '../../scripts/lib/chat-bot/poll-harness.mjs';

function msg(id, createTime, text = 'hello') {
  return { name: id, createTime, text };
}

test('cursor advances to the latest message per space; processed counts replies', async () => {
  const state = {};
  const calls = [];
  const processed = await pollSpaces({
    spaceIds: ['spaces/A'],
    state,
    listRecentMessages: async () => [msg('m1', 't1'), msg('m2', 't2')],
    onMessage: async (raw, spaceId) => {
      calls.push([raw.name, spaceId]);
      return raw.name === 'm2'; // only one counts as a reply
    },
  });

  assert.equal(processed, 1);
  assert.deepEqual(calls, [['m1', 'spaces/A'], ['m2', 'spaces/A']]);
  assert.equal(state.spaces_state['spaces/A'].last_message_ts, 't2');
  assert.ok(state.last_poll, 'last_poll stamped');
});

test('legacy last_message_time cursor is honored and migrated', async () => {
  const seen = [];
  const state = { spaces_state: { 'spaces/A': { last_message_time: 'legacy-ts' } } };
  await pollSpaces({
    spaceIds: ['spaces/A'],
    state,
    listRecentMessages: async (spaceId, lastTs) => {
      seen.push(lastTs);
      return [msg('m1', 't9')];
    },
    onMessage: async () => false,
  });

  assert.deepEqual(seen, ['legacy-ts'], 'legacy cursor passed to fetch');
  assert.equal(state.spaces_state['spaces/A'].last_message_ts, 't9');
  assert.equal('last_message_time' in state.spaces_state['spaces/A'], false, 'legacy key migrated away');
});

test('a failing space is skipped without aborting the others', async () => {
  const state = {};
  const processed = await pollSpaces({
    spaceIds: ['spaces/BAD', 'spaces/OK'],
    state,
    listRecentMessages: async spaceId => {
      if (spaceId === 'spaces/BAD') throw new Error('boom');
      return [msg('m1', 't1')];
    },
    onMessage: async () => true,
  });

  assert.equal(processed, 1);
  assert.equal(state.spaces_state['spaces/BAD'], undefined, 'failed space state untouched');
  assert.equal(state.spaces_state['spaces/OK'].last_message_ts, 't1');
});

test('an onMessage throw is contained to that message', async () => {
  const state = {};
  const processed = await pollSpaces({
    spaceIds: ['spaces/A'],
    state,
    listRecentMessages: async () => [msg('m1', 't1'), msg('m2', 't2')],
    onMessage: async raw => {
      if (raw.name === 'm1') throw new Error('pipeline failed');
      return true;
    },
  });

  assert.equal(processed, 1, 'second message still processed');
  assert.equal(state.spaces_state['spaces/A'].last_message_ts, 't2');
});

test('no messages and no onSpaceDone → no state entry invented', async () => {
  const state = {};
  await pollSpaces({
    spaceIds: ['spaces/A'],
    state,
    listRecentMessages: async () => [],
    onMessage: async () => true,
  });
  assert.equal(state.spaces_state?.['spaces/A'], undefined);
});

test('onSpaceDone can extend the state entry (sent_ids pattern)', async () => {
  const state = {};
  await pollSpaces({
    spaceIds: ['spaces/A'],
    state,
    listRecentMessages: async () => [msg('m1', 't1')],
    onMessage: async () => true,
    onSpaceDone: (spaceId, base) => ({ ...base, sent_ids: ['m1-reply'] }),
  });
  assert.equal(state.spaces_state['spaces/A'].last_message_ts, 't1');
  assert.deepEqual(state.spaces_state['spaces/A'].sent_ids, ['m1-reply']);
});
