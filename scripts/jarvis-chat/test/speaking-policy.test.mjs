import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideAction, isQuestion } from '../lib/speaking-policy.mjs';

const baseConfig = {
  thread_window_minutes: 5,
  max_follow_ups_per_window: 3,
  question_shape_required: true,
};

const botUserId = 'users/jarvis-bot';

function msg(overrides = {}) {
  return {
    space_id: 'spaces/MAPPED',
    thread_id: 'spaces/MAPPED/threads/T1',
    message_id: 'spaces/MAPPED/messages/M1',
    sender: { id: 'users/human-1', name: 'Pedro' },
    text: 'oi pessoal',
    is_bot: false,
    ts: '2026-04-10T14:00:00Z',
    ...overrides,
  };
}

test('unmapped space → ignore with reason unmapped_space (caller decides one-shot warn)', () => {
  const result = decideAction({
    message: msg(),
    spaceMapping: null,
    threadState: null,
    config: baseConfig,
    botUserId,
  });
  assert.equal(result.action, 'ignore');
  assert.equal(result.reason, 'unmapped_space');
});

test('sender is the bot itself → ignore (self-loop guard)', () => {
  const result = decideAction({
    message: msg({ sender: { id: 'users/jarvis-bot', name: 'JARVIS' }, is_bot: true }),
    spaceMapping: { project_code: '03002', product: 'visionking', label: 'VK 03002', memory_enabled: true },
    threadState: null,
    config: baseConfig,
    botUserId,
  });
  assert.equal(result.action, 'ignore');
  assert.equal(result.reason, 'self_loop');
});

const mappedSpace = { project_code: '03002', product: 'visionking', label: 'VK 03002', memory_enabled: true };

test('explicit USER_MENTION annotation matching botUserId → reply, opens thread', () => {
  const result = decideAction({
    message: msg({
      text: 'olá pessoal qual o status?',
      annotations: [
        { type: 'USER_MENTION', userMention: { user: { name: 'users/jarvis-bot' } } },
      ],
    }),
    spaceMapping: mappedSpace,
    threadState: null,
    config: baseConfig,
    botUserId,
  });
  assert.equal(result.action, 'reply');
  assert.equal(result.reason, 'mention');
  assert.ok(result.newThreadState);
  assert.equal(result.newThreadState.follow_ups_used, 0);
  assert.equal(result.newThreadState.engaged_at, '2026-04-10T14:00:00Z');
});

test('substring "jarvis" fallback (no annotations) → reply, opens thread', () => {
  const result = decideAction({
    message: msg({ text: '@JARVIS qual o status do vk03?' }),
    spaceMapping: mappedSpace,
    threadState: null,
    config: baseConfig,
    botUserId,
  });
  assert.equal(result.action, 'reply');
  assert.equal(result.reason, 'mention');
});

test('no mention and no active thread → ignore', () => {
  const result = decideAction({
    message: msg({ text: 'bom dia pessoal' }),
    spaceMapping: mappedSpace,
    threadState: null,
    config: baseConfig,
    botUserId,
  });
  assert.equal(result.action, 'ignore');
  assert.equal(result.reason, 'no_mention');
});

function activeThread(overrides = {}) {
  return {
    thread_id: 'spaces/MAPPED/threads/T1',
    space_id: 'spaces/MAPPED',
    engaged_at: '2026-04-10T14:00:00Z',
    last_jarvis_reply_at: '2026-04-10T14:00:00Z',
    follow_ups_used: 0,
    status: 'active',
    ...overrides,
  };
}

test('in-window question follow-up → reply, increment follow_ups_used', () => {
  const result = decideAction({
    message: msg({ ts: '2026-04-10T14:02:00Z', text: 'e o uso de disco?' }),
    spaceMapping: mappedSpace,
    threadState: activeThread(),
    config: baseConfig,
    botUserId,
  });
  assert.equal(result.action, 'reply');
  assert.equal(result.reason, 'follow_up_in_window');
  assert.equal(result.newThreadState.follow_ups_used, 1);
  assert.equal(result.newThreadState.last_jarvis_reply_at, '2026-04-10T14:02:00Z');
});

test('in-window non-question follow-up → ignore silently, thread stays active', () => {
  const result = decideAction({
    message: msg({ ts: '2026-04-10T14:01:00Z', text: 'valeu pelo retorno' }),
    spaceMapping: mappedSpace,
    threadState: activeThread(),
    config: baseConfig,
    botUserId,
  });
  assert.equal(result.action, 'ignore');
  assert.equal(result.reason, 'not_a_question');
  assert.equal(result.newThreadState, undefined);
});

test('in-window question but follow-up budget exhausted → ignore, drop thread', () => {
  const result = decideAction({
    message: msg({ ts: '2026-04-10T14:02:00Z', text: 'e o disco?' }),
    spaceMapping: mappedSpace,
    threadState: activeThread({ follow_ups_used: 3 }),
    config: baseConfig,
    botUserId,
  });
  assert.equal(result.action, 'ignore');
  assert.equal(result.reason, 'window_expired');
  assert.equal(result.newThreadState.status, 'expired');
});

test('time-expired follow-up → ignore, drop thread', () => {
  const result = decideAction({
    message: msg({ ts: '2026-04-10T14:10:00Z', text: 'e o disco?' }),
    spaceMapping: mappedSpace,
    threadState: activeThread(),
    config: baseConfig,
    botUserId,
  });
  assert.equal(result.action, 'ignore');
  assert.equal(result.reason, 'window_expired');
  assert.equal(result.newThreadState.status, 'expired');
});

test('mention re-opens an expired thread (caller passes null threadState after pruning)', () => {
  const result = decideAction({
    message: msg({ ts: '2026-04-10T15:00:00Z', text: '@jarvis está aí?' }),
    spaceMapping: mappedSpace,
    threadState: null,
    config: baseConfig,
    botUserId,
  });
  assert.equal(result.action, 'reply');
  assert.equal(result.reason, 'mention');
  assert.equal(result.newThreadState.engaged_at, '2026-04-10T15:00:00Z');
});

test('isQuestion: question mark in middle of text', () => {
  assert.equal(isQuestion('isso é estranho? acho que sim'), true);
});

test('isQuestion: starts with "qual"', () => {
  assert.equal(isQuestion('qual o status do vk03'), true);
});

test('isQuestion: starts with "o que"', () => {
  assert.equal(isQuestion('o que aconteceu ontem'), true);
});

test('isQuestion: starts with "por que"', () => {
  assert.equal(isQuestion('por que o sistema travou'), true);
});

test('isQuestion: plain statement returns false', () => {
  assert.equal(isQuestion('o sistema voltou ao normal'), false);
});

test('isQuestion: empty string returns false', () => {
  assert.equal(isQuestion(''), false);
});

test('isQuestion: non-string returns false', () => {
  assert.equal(isQuestion(null), false);
});

test('question_shape_required=false → in-window non-question still replies', () => {
  const result = decideAction({
    message: msg({ ts: '2026-04-10T14:01:00Z', text: 'valeu pelo retorno' }),
    spaceMapping: mappedSpace,
    threadState: activeThread(),
    config: { ...baseConfig, question_shape_required: false },
    botUserId,
  });
  assert.equal(result.action, 'reply');
  assert.equal(result.reason, 'follow_up_in_window');
});

test('non-mention in a thread that the caller did not pass state for → no_mention', () => {
  const result = decideAction({
    message: msg({ text: 'só comentando' }),
    spaceMapping: mappedSpace,
    threadState: null,
    config: baseConfig,
    botUserId,
  });
  assert.equal(result.action, 'ignore');
  assert.equal(result.reason, 'no_mention');
});
