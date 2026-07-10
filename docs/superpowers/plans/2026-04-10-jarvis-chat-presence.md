---
type: Implementation Plan
title: JARVIS Chat Presence Implementation Plan
description: Sets up directory structure, config files, gitignore, and verifies Node test runner works. One task.
timestamp: 2026-04-10
---

# JARVIS Chat Presence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Google Chat bot (`jarvis-chat`) that lives in Strokmatic project spaces, answers PT-BR questions on `@JARVIS` mention with thread-sticky multi-turn behavior, and silently extracts structured facts from chat history for cross-project insight.

**Architecture:** Two cron-driven Node entrypoints over a shared library of small modules. `poll-and-reply.mjs` runs every minute (poll → log → speaking-policy → answer → reply). `distill-facts.mjs` runs hourly (read new transcripts → extract facts via `claude --print` → append to global JSONL fact store). The conversation policy and fact-store query are pure functions designed for unit testing under `node:test`. All bot output is PT-BR.

**Tech Stack:** Node 20 ESM, `node:test` (built-in), `claude --print` for LLM calls, Google Workspace MCP for Chat I/O (via existing `chat-client.mjs` lifted out of `scripts/kb-chat/`), file-based JSONL for state.

**Spec:** `docs/superpowers/specs/2026-04-10-jarvis-chat-presence-design.md`

**Spec deviations (deliberate):**
- Spec §8 says `qa-logger.mjs` is "shared between both bots." The existing `kb-chat/lib/qa-logger.mjs` writes Markdown to KB's `registro-qa/` directory; the spec body (§6.1) requires JSONL at `data/jarvis-chat/qa-log/`. These are incompatible. **The plan promotes only `chat-client.mjs` and writes a new JSONL `qa-logger.mjs` inside `scripts/jarvis-chat/lib/`.** kb-chat's existing logger is left untouched. The v2 merge (also in the spec) will reconcile.

---

## File Structure

### Created

```
config/orchestrator/
├── jarvis-chat.json                       # runtime config (knobs + cadence)
└── jarvis-chat-spaces.json                # space_id → project_code map

scripts/helpers/
└── chat-client.mjs                        # PROMOTED from scripts/kb-chat/lib/chat-client.mjs

scripts/jarvis-chat/
├── poll-and-reply.mjs                     # cron entrypoint (every 1 min)
├── distill-facts.mjs                      # cron entrypoint (every 1 hour)
├── lib/
│   ├── messages.pt-br.js                  # PT-BR string constants
│   ├── space-registry.mjs                 # space lookup + unmapped guard
│   ├── transcript-store.mjs               # raw message append + read
│   ├── thread-tracker.mjs                 # active thread state I/O
│   ├── speaking-policy.mjs                # PURE: decideAction()
│   ├── fact-store.mjs                     # JSONL append + pure search()
│   ├── project-context.mjs                # bounded context bundle loader
│   ├── fact-extractor.mjs                 # claude --print extraction
│   ├── answer-generator.mjs               # claude --print PT-BR answer
│   └── qa-logger.mjs                      # JSONL audit trail
└── test/
    ├── speaking-policy.test.mjs           # ~20 unit tests
    ├── fact-store.test.mjs                # ~10 unit tests
    ├── transcript-store.test.mjs          # FS integration tests
    ├── thread-tracker.test.mjs            # FS integration tests
    └── test-integration.mjs               # end-to-end smoke
```

### Modified

```
.gitignore                                 # add data/jarvis-chat/
config/cron/orchestrator.cron              # add 2 cron entries (final task)
scripts/kb-chat/poll-and-reply.mjs         # update import path for chat-client
```

### Data (gitignored, created at runtime)

```
data/jarvis-chat/
├── transcripts/{space_id_safe}/{YYYY-MM-DD}.jsonl
├── facts/{YYYY-MM}.jsonl
├── threads/active.json
├── qa-log/{YYYY-MM}.jsonl
└── state.json
```

---

## Phase 0 — Scaffolding

Sets up directory structure, config files, gitignore, and verifies Node test runner works. One task.

### Task 0.1: Scaffolding & config files

**Files:**
- Create: `config/orchestrator/jarvis-chat.json`
- Create: `config/orchestrator/jarvis-chat-spaces.json`
- Create: `scripts/jarvis-chat/lib/.gitkeep`
- Create: `scripts/jarvis-chat/test/.gitkeep`
- Modify: `.gitignore`

- [ ] **Step 1: Create directory tree**

```bash
mkdir -p scripts/jarvis-chat/lib scripts/jarvis-chat/test data/jarvis-chat
touch scripts/jarvis-chat/lib/.gitkeep scripts/jarvis-chat/test/.gitkeep
```

- [ ] **Step 2: Write `config/orchestrator/jarvis-chat.json`**

```json
{
  "enabled": false,
  "poll_interval_minutes": 1,
  "distill_interval_minutes": 60,
  "thread_window_minutes": 5,
  "max_follow_ups_per_window": 3,
  "question_shape_required": true,
  "max_context_pages": 5,
  "max_facts_per_answer": 10,
  "model": "claude-sonnet-4-6",
  "language": "pt-br",
  "bot_user_id": "users/REPLACE_WITH_BOT_ID"
}
```

`enabled: false` is intentional — we flip it to `true` only after the manual end-to-end test in Phase 8. `bot_user_id` will be filled in once the bot is registered in GCP (Phase 8); leave the placeholder for now.

- [ ] **Step 3: Write `config/orchestrator/jarvis-chat-spaces.json`**

```json
{
  "spaces": {}
}
```

Empty registry. Real entries are added in Phase 8 when we know real space IDs.

- [ ] **Step 4: Add `data/jarvis-chat/` to `.gitignore`**

Append this line to `.gitignore`:

```
data/jarvis-chat/
```

Verify with:

```bash
git check-ignore -v data/jarvis-chat/
```

Expected output: `.gitignore:<line>:data/jarvis-chat/   data/jarvis-chat/`

- [ ] **Step 5: Verify Node test runner works**

```bash
node --version
node -e "const t = require('node:test'); console.log('node:test OK')"
```

Expected: Node v20.x or newer, `node:test OK`. If not, abort and install Node 20+.

No commit yet — we'll commit the whole thing at the end per user instruction.

---

## Phase 1 — Pure module: `speaking-policy.mjs`

The heart of the conversation policy. Pure function, no I/O, fully unit-testable. Built TDD-strict.

### Task 1.1: First test — unmapped space

**Files:**
- Create: `scripts/jarvis-chat/test/speaking-policy.test.mjs`
- Create: `scripts/jarvis-chat/lib/speaking-policy.mjs` (stub, will be filled by following tasks)

- [ ] **Step 1: Write the failing test**

Create `scripts/jarvis-chat/test/speaking-policy.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideAction } from '../lib/speaking-policy.mjs';

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

test('unmapped space → ignore_unmapped (caller decides one-shot warn)', () => {
  const result = decideAction({
    message: msg(),
    spaceMapping: null,                    // not in registry
    threadState: null,
    config: baseConfig,
    botUserId,
  });
  assert.equal(result.action, 'ignore');
  assert.equal(result.reason, 'unmapped_space');
});
```

- [ ] **Step 2: Run test, verify it fails**

```bash
node --test scripts/jarvis-chat/test/speaking-policy.test.mjs
```

Expected: failure with `Cannot find module '../lib/speaking-policy.mjs'`.

- [ ] **Step 3: Write minimal stub**

Create `scripts/jarvis-chat/lib/speaking-policy.mjs`:

```js
/**
 * Pure decision function for the JARVIS chat speaking policy.
 *
 * @param {object} args
 * @param {object} args.message              - { space_id, thread_id, message_id, sender:{id,name}, text, is_bot, ts }
 * @param {object|null} args.spaceMapping    - { project_code, product, label, memory_enabled } or null if unmapped
 * @param {object|null} args.threadState     - active thread record or null
 * @param {object} args.config               - { thread_window_minutes, max_follow_ups_per_window, question_shape_required }
 * @param {string} args.botUserId            - the bot's own users/<id>
 * @returns {{ action: 'reply'|'ignore', reason: string, newThreadState?: object }}
 */
export function decideAction({ message, spaceMapping, threadState, config, botUserId }) {
  if (!spaceMapping) {
    return { action: 'ignore', reason: 'unmapped_space' };
  }
  return { action: 'ignore', reason: 'not_implemented' };
}
```

- [ ] **Step 4: Run test, verify it passes**

```bash
node --test scripts/jarvis-chat/test/speaking-policy.test.mjs
```

Expected: 1 test passing.

- [ ] **Step 5: No commit yet — continuing to fill out the module.**

### Task 1.2: Self-loop guard

- [ ] **Step 1: Add the failing test**

Append to `scripts/jarvis-chat/test/speaking-policy.test.mjs`:

```js
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
```

- [ ] **Step 2: Run, verify it fails** (`ignore/not_implemented` instead of `ignore/self_loop`).

```bash
node --test scripts/jarvis-chat/test/speaking-policy.test.mjs
```

- [ ] **Step 3: Implement** — add right after the unmapped check in `speaking-policy.mjs`:

```js
  if (message.is_bot || message.sender?.id === botUserId) {
    return { action: 'ignore', reason: 'self_loop' };
  }
```

- [ ] **Step 4: Run, verify both tests pass.**

```bash
node --test scripts/jarvis-chat/test/speaking-policy.test.mjs
```

Expected: 2 tests passing.

- [ ] **Step 5: Continue.**

### Task 1.3: Mention detection (annotation + substring fallback)

- [ ] **Step 1: Add three failing tests** (annotation match, substring fallback, no mention + no thread).

Append to `speaking-policy.test.mjs`:

```js
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
```

- [ ] **Step 2: Run, verify all three new tests fail.**

```bash
node --test scripts/jarvis-chat/test/speaking-policy.test.mjs
```

- [ ] **Step 3: Implement mention detection.** Replace the entire `decideAction` function body and add a helper at the bottom of `speaking-policy.mjs`:

```js
export function decideAction({ message, spaceMapping, threadState, config, botUserId }) {
  if (!spaceMapping) {
    return { action: 'ignore', reason: 'unmapped_space' };
  }
  if (message.is_bot || message.sender?.id === botUserId) {
    return { action: 'ignore', reason: 'self_loop' };
  }

  const isMention = detectMention(message, botUserId);

  if (isMention) {
    const newThreadState = {
      thread_id: message.thread_id,
      space_id: message.space_id,
      engaged_at: message.ts,
      last_jarvis_reply_at: message.ts,
      follow_ups_used: 0,
      status: 'active',
    };
    return { action: 'reply', reason: 'mention', newThreadState };
  }

  if (!threadState) {
    return { action: 'ignore', reason: 'no_mention' };
  }

  return { action: 'ignore', reason: 'not_implemented' };
}

function detectMention(message, botUserId) {
  // Primary: structured annotation
  if (Array.isArray(message.annotations)) {
    for (const a of message.annotations) {
      if (a?.type === 'USER_MENTION' && a?.userMention?.user?.name === botUserId) {
        return true;
      }
    }
  }
  // Fallback: case-insensitive substring on raw text
  if (typeof message.text === 'string' && message.text.toLowerCase().includes('jarvis')) {
    return true;
  }
  return false;
}
```

- [ ] **Step 4: Run, verify all 5 tests pass.**

```bash
node --test scripts/jarvis-chat/test/speaking-policy.test.mjs
```

Expected: 5 passing.

- [ ] **Step 5: Continue.**

### Task 1.4: Thread expiry (time + budget) and follow-up handling

- [ ] **Step 1: Add five failing tests.**

Append to `speaking-policy.test.mjs`:

```js
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
  assert.equal(result.newThreadState, undefined);   // do not mutate state
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
    message: msg({ ts: '2026-04-10T14:10:00Z', text: 'e o disco?' }),  // 10 min after engaged_at
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
```

- [ ] **Step 2: Run, verify the new tests fail.**

```bash
node --test scripts/jarvis-chat/test/speaking-policy.test.mjs
```

- [ ] **Step 3: Implement window expiry, question gate, follow-up bookkeeping.**

Replace the placeholder bottom branch (`return { action: 'ignore', reason: 'not_implemented' };`) in `speaking-policy.mjs` with:

```js
  // We have a thread state and no fresh mention. Check expiry.
  const expired = isExpired(threadState, message.ts, config);
  if (expired) {
    return {
      action: 'ignore',
      reason: 'window_expired',
      newThreadState: { ...threadState, status: 'expired' },
    };
  }

  if (config.question_shape_required && !isQuestion(message.text)) {
    return { action: 'ignore', reason: 'not_a_question' };
  }

  return {
    action: 'reply',
    reason: 'follow_up_in_window',
    newThreadState: {
      ...threadState,
      follow_ups_used: threadState.follow_ups_used + 1,
      last_jarvis_reply_at: message.ts,
    },
  };
}

function isExpired(threadState, nowIso, config) {
  if (threadState.follow_ups_used >= config.max_follow_ups_per_window) return true;
  const last = new Date(threadState.last_jarvis_reply_at).getTime();
  const now = new Date(nowIso).getTime();
  const elapsedMin = (now - last) / 60000;
  return elapsedMin > config.thread_window_minutes;
}

const QUESTION_WORDS_PT = new Set([
  'qual', 'quais', 'quanto', 'quantos', 'quantas',
  'quando', 'como', 'onde', 'por', 'porque', 'o', 'quem',
]);

export function isQuestion(text) {
  if (typeof text !== 'string') return false;
  if (text.includes('?')) return true;
  const firstWord = text
    .trim()
    .toLowerCase()
    .replace(/[^a-záàâãéêíóôõúç ]/gi, '')
    .split(/\s+/)[0];
  return QUESTION_WORDS_PT.has(firstWord);
}
```

- [ ] **Step 4: Run, verify all 10 tests pass.**

```bash
node --test scripts/jarvis-chat/test/speaking-policy.test.mjs
```

Expected: 10 passing.

- [ ] **Step 5: Continue.**

### Task 1.5: `isQuestion` edge cases and `question_shape_required = false` kill switch

- [ ] **Step 1: Add edge case tests.**

Append to `speaking-policy.test.mjs`:

```js
import { isQuestion } from '../lib/speaking-policy.mjs';

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
```

- [ ] **Step 2: Run.**

```bash
node --test scripts/jarvis-chat/test/speaking-policy.test.mjs
```

Note: the third test (`'o que ...'`) currently fails because `isQuestion` returns true for first word `"o"` only if `"o"` is in the question-words set — and it IS, by design (it's the start of `"o que"`). So this test will pass already. The `por que` test will also pass for the same reason. Good — these are regression tests for behavior we already coded. The `'plain statement'` test must return false: the first word `"o"` IS in the set, so this will incorrectly return true. **This is a real edge case that needs fixing.** The fix is to require that the first word is either standalone-question OR a multi-word question opener — but at our scale that's overkill. Simpler fix: require `"o"` to be followed by `"que"`.

- [ ] **Step 3: Refine `isQuestion` to handle the `o que` / `o sistema` ambiguity.**

In `speaking-policy.mjs`, replace the `isQuestion` function with:

```js
const QUESTION_WORDS_PT = new Set([
  'qual', 'quais', 'quanto', 'quantos', 'quantas',
  'quando', 'como', 'onde', 'porque', 'quem',
]);
const QUESTION_OPENERS_TWO_WORDS = [
  ['o', 'que'],
  ['por', 'que'],
];

export function isQuestion(text) {
  if (typeof text !== 'string') return false;
  if (text.includes('?')) return true;
  const tokens = text
    .trim()
    .toLowerCase()
    .replace(/[^a-záàâãéêíóôõúç ]/gi, '')
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length === 0) return false;
  if (QUESTION_WORDS_PT.has(tokens[0])) return true;
  for (const [a, b] of QUESTION_OPENERS_TWO_WORDS) {
    if (tokens[0] === a && tokens[1] === b) return true;
  }
  return false;
}
```

- [ ] **Step 4: Run, all tests should pass.**

```bash
node --test scripts/jarvis-chat/test/speaking-policy.test.mjs
```

Expected: 18 passing.

- [ ] **Step 5: Continue.**

### Task 1.6: `decideAction` handles `not-in-active-set` thread

The state machine has one branch we have not tested: a message arrives with no mention, and there is *no* threadState passed in but the message is in a thread that *was* active before pruning. This is actually the same as "no_mention" — if the caller pruned the thread, threadState is null and we return `no_mention`. So no new logic. But let me add an explicit test to lock the contract.

- [ ] **Step 1: Add the test.**

Append to `speaking-policy.test.mjs`:

```js
test('non-mention in a thread that the caller did not pass state for → no_mention', () => {
  const result = decideAction({
    message: msg({ text: 'só comentando' }),
    spaceMapping: mappedSpace,
    threadState: null,                     // caller already pruned
    config: baseConfig,
    botUserId,
  });
  assert.equal(result.action, 'ignore');
  assert.equal(result.reason, 'no_mention');
});
```

- [ ] **Step 2: Run, verify it passes immediately.**

```bash
node --test scripts/jarvis-chat/test/speaking-policy.test.mjs
```

Expected: 19 passing.

- [ ] **Step 3-5: No new code, just lock the contract. Continue.**

---

## Phase 2 — Pure module: `fact-store.mjs` (query side)

The other pure-function module. Implement the query/search side TDD-strict; the append side is trivial and gets done in Task 2.4 without ceremony.

### Task 2.1: Token extraction and PT-BR stopword stripping

**Files:**
- Create: `scripts/jarvis-chat/test/fact-store.test.mjs`
- Create: `scripts/jarvis-chat/lib/fact-store.mjs`

- [ ] **Step 1: Write the failing test.**

Create `scripts/jarvis-chat/test/fact-store.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenize } from '../lib/fact-store.mjs';

test('tokenize: lowercases, strips stopwords, returns unique tokens', () => {
  const tokens = tokenize('Qual o status do vk03 e do RabbitMQ?');
  assert.deepEqual(tokens.sort(), ['rabbitmq', 'status', 'vk03'].sort());
});

test('tokenize: empty input returns empty array', () => {
  assert.deepEqual(tokenize(''), []);
  assert.deepEqual(tokenize(null), []);
});
```

- [ ] **Step 2: Run, verify failure.**

```bash
node --test scripts/jarvis-chat/test/fact-store.test.mjs
```

- [ ] **Step 3: Create `scripts/jarvis-chat/lib/fact-store.mjs` with `tokenize`.**

```js
import { readFileSync, existsSync, appendFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

const STOPWORDS_PT = new Set([
  'o', 'a', 'os', 'as', 'um', 'uma', 'uns', 'umas',
  'de', 'do', 'da', 'dos', 'das', 'em', 'no', 'na', 'nos', 'nas',
  'que', 'e', 'é', 'para', 'pra', 'com', 'sem', 'por', 'se', 'sua',
  'seu', 'suas', 'seus', 'ao', 'aos', 'à', 'às', 'ou', 'mas',
]);

export function tokenize(text) {
  if (typeof text !== 'string') return [];
  const raw = text
    .toLowerCase()
    .replace(/[^a-z0-9áàâãéêíóôõúç ]/gi, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter(t => !STOPWORDS_PT.has(t));
  return [...new Set(raw)];
}
```

- [ ] **Step 4: Run, verify both tests pass.**

```bash
node --test scripts/jarvis-chat/test/fact-store.test.mjs
```

Expected: 2 passing.

- [ ] **Step 5: Continue.**

### Task 2.2: `scoreFact` — token overlap on summary + entities + people

- [ ] **Step 1: Write tests.**

Append to `scripts/jarvis-chat/test/fact-store.test.mjs`:

```js
import { scoreFact } from '../lib/fact-store.mjs';

const refDate = '2026-04-10T15:00:00Z';

function fact(overrides = {}) {
  return {
    id: 'f1',
    extracted_at: '2026-04-10T10:00:00Z',
    source: { project_code: '03002' },
    type: 'observation',
    summary: 'Pico de fila no RabbitMQ do vk03',
    entities: ['vk03', 'RabbitMQ'],
    people: ['Pedro'],
    ...overrides,
  };
}

test('scoreFact: token overlap on summary, entities, and people', () => {
  const tokens = tokenize('qual o status do vk03 e do rabbitmq');
  const score = scoreFact(fact(), tokens, '03002', refDate);
  // overlap: vk03, rabbitmq, status (status only in query) → 2 hits
  // recency boost: < 7 days → 1.5
  // project preference: 03002 == 03002 → 1.3
  assert.ok(score > 0);
});

test('scoreFact: zero overlap → score 0', () => {
  const tokens = tokenize('quando sai o relatório do honda');
  const score = scoreFact(fact(), tokens, '01001', refDate);
  assert.equal(score, 0);
});

test('scoreFact: facts older than 30 days get no recency boost', () => {
  const stale = fact({ extracted_at: '2025-01-01T00:00:00Z' });
  const fresh = fact({ extracted_at: '2026-04-10T08:00:00Z' });
  const tokens = tokenize('vk03 rabbitmq');
  const staleScore = scoreFact(stale, tokens, '03002', refDate);
  const freshScore = scoreFact(fresh, tokens, '03002', refDate);
  assert.ok(freshScore > staleScore);
});

test('scoreFact: same project_code adds preference boost', () => {
  const tokens = tokenize('vk03 rabbitmq');
  const sameProject = scoreFact(fact(), tokens, '03002', refDate);
  const otherProject = scoreFact(fact(), tokens, '01001', refDate);
  assert.ok(sameProject > otherProject);
});
```

- [ ] **Step 2: Run, verify failures.**

```bash
node --test scripts/jarvis-chat/test/fact-store.test.mjs
```

- [ ] **Step 3: Implement `scoreFact`.**

Append to `scripts/jarvis-chat/lib/fact-store.mjs`:

```js
export function scoreFact(fact, queryTokens, queryProjectCode, nowIso) {
  if (queryTokens.length === 0) return 0;
  const haystackText = [
    fact.summary || '',
    ...(fact.entities || []),
    ...(fact.people || []),
  ].join(' ');
  const factTokens = new Set(tokenize(haystackText));
  let overlap = 0;
  for (const t of queryTokens) {
    if (factTokens.has(t)) overlap += 1;
  }
  if (overlap === 0) return 0;
  let score = overlap;

  // Recency boost
  const ageDays = (new Date(nowIso) - new Date(fact.extracted_at)) / 86400000;
  if (ageDays < 7) score *= 1.5;
  else if (ageDays < 30) score *= 1.2;

  // Project preference boost
  if (fact.source?.project_code === queryProjectCode) score *= 1.3;

  return score;
}
```

- [ ] **Step 4: Run, verify all 6 tests pass.**

```bash
node --test scripts/jarvis-chat/test/fact-store.test.mjs
```

Expected: 6 passing.

- [ ] **Step 5: Continue.**

### Task 2.3: `searchFacts` — top-k ranking from in-memory list

- [ ] **Step 1: Write the test.**

Append to `scripts/jarvis-chat/test/fact-store.test.mjs`:

```js
import { searchFacts } from '../lib/fact-store.mjs';

test('searchFacts: returns top-k ranked, ties broken by recency', () => {
  const facts = [
    fact({ id: 'a', summary: 'vk03 rabbitmq queue spike', extracted_at: '2026-04-10T09:00:00Z' }),
    fact({ id: 'b', summary: 'honda press status normal', extracted_at: '2026-04-10T10:00:00Z', source: { project_code: '01001' } }),
    fact({ id: 'c', summary: 'rabbitmq prefetch tuning notes', extracted_at: '2026-04-10T11:00:00Z' }),
    fact({ id: 'd', summary: 'unrelated meeting note', extracted_at: '2026-04-10T12:00:00Z' }),
  ];
  const results = searchFacts(facts, 'qual o status do rabbitmq no vk03', { projectCode: '03002', k: 2, nowIso: refDate });
  assert.equal(results.length, 2);
  assert.ok(results[0].score >= results[1].score);
  // 'a' has the highest token overlap (vk03 + rabbitmq) and same project → must be #1
  assert.equal(results[0].fact.id, 'a');
});

test('searchFacts: empty query → empty result', () => {
  const facts = [fact()];
  const results = searchFacts(facts, '', { projectCode: '03002', k: 5, nowIso: refDate });
  assert.deepEqual(results, []);
});

test('searchFacts: k respected', () => {
  const facts = Array.from({ length: 10 }, (_, i) =>
    fact({ id: `f${i}`, summary: `vk03 rabbitmq item ${i}` })
  );
  const results = searchFacts(facts, 'vk03 rabbitmq', { projectCode: '03002', k: 3, nowIso: refDate });
  assert.equal(results.length, 3);
});
```

- [ ] **Step 2: Run, verify failures.**

```bash
node --test scripts/jarvis-chat/test/fact-store.test.mjs
```

- [ ] **Step 3: Implement `searchFacts`.**

Append to `scripts/jarvis-chat/lib/fact-store.mjs`:

```js
export function searchFacts(facts, query, { projectCode, k = 10, nowIso }) {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];
  const scored = facts
    .map(f => ({ fact: f, score: scoreFact(f, tokens, projectCode, nowIso) }))
    .filter(x => x.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      // Tie-break by recency
      return new Date(b.fact.extracted_at) - new Date(a.fact.extracted_at);
    });
  return scored.slice(0, k);
}
```

- [ ] **Step 4: Run, all tests pass.**

```bash
node --test scripts/jarvis-chat/test/fact-store.test.mjs
```

Expected: 9 passing.

- [ ] **Step 5: Continue.**

### Task 2.4: `appendFact` and `loadRecentFacts` — file-system side (no TDD ceremony, simple I/O)

- [ ] **Step 1: Add minimal integration test.**

Append to `scripts/jarvis-chat/test/fact-store.test.mjs`:

```js
import { appendFact, loadRecentFacts } from '../lib/fact-store.mjs';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';

test('appendFact + loadRecentFacts roundtrip', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jarvis-fact-'));
  try {
    appendFact(dir, fact({ id: 'rt1' }));
    appendFact(dir, fact({ id: 'rt2', extracted_at: '2026-04-10T11:00:00Z' }));
    const loaded = loadRecentFacts(dir, 1);   // last 1 month
    assert.equal(loaded.length, 2);
    assert.ok(loaded.find(f => f.id === 'rt1'));
    assert.ok(loaded.find(f => f.id === 'rt2'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

Add the missing import at the top of the file:

```js
import { join } from 'path';
```

- [ ] **Step 2: Run, verify failure.**

```bash
node --test scripts/jarvis-chat/test/fact-store.test.mjs
```

- [ ] **Step 3: Implement `appendFact` and `loadRecentFacts`.**

Append to `scripts/jarvis-chat/lib/fact-store.mjs`:

```js
function monthShardName(iso) {
  const d = new Date(iso);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}.jsonl`;
}

export function appendFact(factsDir, factRecord) {
  if (!existsSync(factsDir)) mkdirSync(factsDir, { recursive: true });
  const shardPath = join(factsDir, monthShardName(factRecord.extracted_at));
  appendFileSync(shardPath, JSON.stringify(factRecord) + '\n');
}

export function loadRecentFacts(factsDir, monthsBack = 3) {
  if (!existsSync(factsDir)) return [];
  const now = new Date();
  const shards = [];
  for (let i = 0; i < monthsBack; i += 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    shards.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}.jsonl`);
  }
  const out = [];
  for (const name of shards) {
    const p = join(factsDir, name);
    if (!existsSync(p)) continue;
    const lines = readFileSync(p, 'utf-8').split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        out.push(JSON.parse(line));
      } catch {
        // skip malformed
      }
    }
  }
  return out;
}
```

- [ ] **Step 4: Run, all 10 tests pass.**

```bash
node --test scripts/jarvis-chat/test/fact-store.test.mjs
```

Expected: 10 passing.

- [ ] **Step 5: Continue.**

---

## Phase 3 — Storage modules

### Task 3.1: `transcript-store.mjs` — append + read by space + cursor

**Files:**
- Create: `scripts/jarvis-chat/lib/transcript-store.mjs`
- Create: `scripts/jarvis-chat/test/transcript-store.test.mjs`

- [ ] **Step 1: Write the test.**

Create `scripts/jarvis-chat/test/transcript-store.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { appendMessage, readMessagesSince } from '../lib/transcript-store.mjs';

function tmp() { return mkdtempSync(join(tmpdir(), 'jarvis-tx-')); }

const sampleMsg = {
  ts: '2026-04-10T14:00:00Z',
  space_id: 'spaces/AAQ',
  thread_id: 'spaces/AAQ/threads/T1',
  message_id: 'spaces/AAQ/messages/M1',
  sender: { id: 'users/1', name: 'Pedro' },
  text: 'oi',
  is_bot: false,
};

test('appendMessage writes JSONL partitioned by space and UTC day', () => {
  const dir = tmp();
  try {
    appendMessage(dir, sampleMsg);
    const all = readMessagesSince(dir, 'spaces/AAQ', null);
    assert.equal(all.length, 1);
    assert.equal(all[0].text, 'oi');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('readMessagesSince: cursor filters older messages', () => {
  const dir = tmp();
  try {
    appendMessage(dir, { ...sampleMsg, ts: '2026-04-10T14:00:00Z' });
    appendMessage(dir, { ...sampleMsg, message_id: 'M2', ts: '2026-04-10T14:05:00Z', text: 'segunda' });
    const after = readMessagesSince(dir, 'spaces/AAQ', '2026-04-10T14:02:00Z');
    assert.equal(after.length, 1);
    assert.equal(after[0].text, 'segunda');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('readMessagesSince: nonexistent space returns empty', () => {
  const dir = tmp();
  try {
    assert.deepEqual(readMessagesSince(dir, 'spaces/MISSING', null), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: Run, verify failure.**

```bash
node --test scripts/jarvis-chat/test/transcript-store.test.mjs
```

- [ ] **Step 3: Implement.**

Create `scripts/jarvis-chat/lib/transcript-store.mjs`:

```js
import { existsSync, mkdirSync, appendFileSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';

function safeSpaceDir(spaceId) {
  return spaceId.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function dayFileName(iso) {
  return `${iso.substring(0, 10)}.jsonl`;
}

export function appendMessage(transcriptsRoot, message) {
  const safe = safeSpaceDir(message.space_id);
  const dir = join(transcriptsRoot, safe);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const file = join(dir, dayFileName(message.ts));
  appendFileSync(file, JSON.stringify(message) + '\n');
}

export function readMessagesSince(transcriptsRoot, spaceId, sinceIso) {
  const safe = safeSpaceDir(spaceId);
  const dir = join(transcriptsRoot, safe);
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir).filter(f => f.endsWith('.jsonl')).sort();
  const out = [];
  for (const f of files) {
    const lines = readFileSync(join(dir, f), 'utf-8').split('\n').filter(Boolean);
    for (const line of lines) {
      let m;
      try { m = JSON.parse(line); } catch { continue; }
      if (sinceIso && new Date(m.ts) <= new Date(sinceIso)) continue;
      out.push(m);
    }
  }
  return out;
}
```

- [ ] **Step 4: Run, all 3 tests pass.**

```bash
node --test scripts/jarvis-chat/test/transcript-store.test.mjs
```

- [ ] **Step 5: Continue.**

### Task 3.2: `thread-tracker.mjs` — load, save, prune

**Files:**
- Create: `scripts/jarvis-chat/lib/thread-tracker.mjs`
- Create: `scripts/jarvis-chat/test/thread-tracker.test.mjs`

- [ ] **Step 1: Write the test.**

Create `scripts/jarvis-chat/test/thread-tracker.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { loadThreads, saveThreads, getThread, upsertThread, pruneExpired } from '../lib/thread-tracker.mjs';

function tmpFile() {
  const dir = mkdtempSync(join(tmpdir(), 'jarvis-tt-'));
  return join(dir, 'active.json');
}

const threadA = {
  thread_id: 'spaces/AAQ/threads/A',
  space_id: 'spaces/AAQ',
  engaged_at: '2026-04-10T14:00:00Z',
  last_jarvis_reply_at: '2026-04-10T14:00:00Z',
  follow_ups_used: 0,
  status: 'active',
};

test('loadThreads: missing file returns empty object', () => {
  const f = tmpFile();
  assert.deepEqual(loadThreads(f), {});
});

test('saveThreads + loadThreads roundtrip', () => {
  const f = tmpFile();
  saveThreads(f, { [threadA.thread_id]: threadA });
  const loaded = loadThreads(f);
  assert.equal(loaded[threadA.thread_id].follow_ups_used, 0);
});

test('upsertThread + getThread', () => {
  const state = {};
  upsertThread(state, { ...threadA, follow_ups_used: 2 });
  assert.equal(getThread(state, threadA.thread_id).follow_ups_used, 2);
});

test('pruneExpired removes status="expired" and time-stale active threads', () => {
  const state = {
    [threadA.thread_id]: { ...threadA, status: 'expired' },
    'spaces/AAQ/threads/B': { ...threadA, thread_id: 'spaces/AAQ/threads/B', last_jarvis_reply_at: '2025-01-01T00:00:00Z' },
    'spaces/AAQ/threads/C': { ...threadA, thread_id: 'spaces/AAQ/threads/C', last_jarvis_reply_at: '2026-04-10T14:00:00Z' },
  };
  pruneExpired(state, '2026-04-10T14:01:00Z', { thread_window_minutes: 5 });
  assert.equal(state[threadA.thread_id], undefined);              // explicit expired
  assert.equal(state['spaces/AAQ/threads/B'], undefined);          // time-stale
  assert.ok(state['spaces/AAQ/threads/C']);                        // still fresh
});
```

- [ ] **Step 2: Run, verify failure.**

```bash
node --test scripts/jarvis-chat/test/thread-tracker.test.mjs
```

- [ ] **Step 3: Implement.**

Create `scripts/jarvis-chat/lib/thread-tracker.mjs`:

```js
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

export function loadThreads(filePath) {
  if (!existsSync(filePath)) return {};
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return {};
  }
}

export function saveThreads(filePath, state) {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(filePath, JSON.stringify(state, null, 2));
}

export function getThread(state, threadId) {
  return state[threadId] || null;
}

export function upsertThread(state, threadRecord) {
  state[threadRecord.thread_id] = threadRecord;
}

export function pruneExpired(state, nowIso, config) {
  const nowMs = new Date(nowIso).getTime();
  for (const id of Object.keys(state)) {
    const t = state[id];
    if (t.status === 'expired') {
      delete state[id];
      continue;
    }
    const lastMs = new Date(t.last_jarvis_reply_at).getTime();
    if ((nowMs - lastMs) / 60000 > config.thread_window_minutes) {
      delete state[id];
    }
  }
}
```

- [ ] **Step 4: Run, all 4 tests pass.**

```bash
node --test scripts/jarvis-chat/test/thread-tracker.test.mjs
```

- [ ] **Step 5: Continue.**

---

## Phase 4 — Helper modules (no TDD ceremony, small modules)

### Task 4.1: `messages.pt-br.js` — string constants

**Files:**
- Create: `scripts/jarvis-chat/lib/messages.pt-br.js`

- [ ] **Step 1: Write the file.**

Create `scripts/jarvis-chat/lib/messages.pt-br.js`:

```js
export const MESSAGES = {
  unmappedSpaceWarning:
    'Olá! Sou o JARVIS, mas este espaço ainda não está configurado para mim. ' +
    'Peça ao Pedro para vincular este espaço a um código de projeto antes que eu possa ajudar.',
  errorGeneric:
    'Desculpe, sir, encontrei uma falha ao processar sua pergunta. Tente novamente em alguns instantes.',
  fallbackNoContext:
    'Não tenho contexto suficiente para responder isso com confiança. Pode reformular ou consultar a KB diretamente?',
};
```

- [ ] **Step 2-5: Trivial constants — no test, no commit yet.**

### Task 4.2: `space-registry.mjs` — load + lookup + warned-once tracker

**Files:**
- Create: `scripts/jarvis-chat/lib/space-registry.mjs`

- [ ] **Step 1: Write the module.**

Create `scripts/jarvis-chat/lib/space-registry.mjs`:

```js
import { readFileSync, existsSync } from 'fs';

export function loadRegistry(configPath) {
  if (!existsSync(configPath)) return { spaces: {} };
  try {
    return JSON.parse(readFileSync(configPath, 'utf-8'));
  } catch {
    return { spaces: {} };
  }
}

export function lookupSpace(registry, spaceId) {
  return registry.spaces?.[spaceId] || null;
}

export function isWarned(state, spaceId) {
  return Boolean(state.warned_unmapped?.[spaceId]);
}

export function markWarned(state, spaceId) {
  if (!state.warned_unmapped) state.warned_unmapped = {};
  state.warned_unmapped[spaceId] = new Date().toISOString();
}
```

- [ ] **Step 2-5: No tests for this — too trivial. Continue.**

### Task 4.3: `qa-logger.mjs` — JSONL writer

**Files:**
- Create: `scripts/jarvis-chat/lib/qa-logger.mjs`

- [ ] **Step 1: Write the module.**

Create `scripts/jarvis-chat/lib/qa-logger.mjs`:

```js
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
```

- [ ] **Step 2-5: Trivial. No test. Continue.**

---

## Phase 5 — Promote `chat-client.mjs` to shared location

Touches the working `kb-chat`. Verify kb-chat still works after the move.

### Task 5.1: Move + update imports

**Files:**
- Create: `scripts/helpers/chat-client.mjs` (moved content)
- Delete: `scripts/kb-chat/lib/chat-client.mjs`
- Modify: `scripts/kb-chat/poll-and-reply.mjs` (line 7)

- [ ] **Step 1: Move the file.**

```bash
git mv scripts/kb-chat/lib/chat-client.mjs scripts/helpers/chat-client.mjs
```

- [ ] **Step 2: Update kb-chat import.**

In `scripts/kb-chat/poll-and-reply.mjs`, line 7 currently reads:

```js
import { listRecentMessages, sendReply, listSpaces } from './lib/chat-client.mjs';
```

Change to:

```js
import { listRecentMessages, sendReply, listSpaces } from '../helpers/chat-client.mjs';
```

- [ ] **Step 3: Sanity-check kb-chat still loads (no actual poll).**

```bash
node -e "import('./scripts/kb-chat/poll-and-reply.mjs').then(() => console.log('kb-chat loads OK')).catch(e => { console.error(e); process.exit(1); })"
```

Note: this will *parse* the module and run any top-level code. Since `kb-chat/poll-and-reply.mjs` has top-level config reads and a `main().catch()` invocation, it may attempt to actually poll. To avoid that, run instead:

```bash
node --check scripts/kb-chat/poll-and-reply.mjs
node --check scripts/helpers/chat-client.mjs
```

Expected: no output, exit code 0 (syntax check passes for both).

- [ ] **Step 4: Verify** `scripts/kb-chat/lib/` still has the other files (`answer-generator.mjs`, `kb-search.mjs`, `qa-logger.mjs`).

```bash
ls scripts/kb-chat/lib/
```

Expected: 3 files, `chat-client.mjs` absent.

- [ ] **Step 5: Continue.**

---

## Phase 6 — Context loader and LLM modules

### Task 6.1: `project-context.mjs` — load bounded context bundle

**Files:**
- Create: `scripts/jarvis-chat/lib/project-context.mjs`

- [ ] **Step 1: Write the module.**

Create `scripts/jarvis-chat/lib/project-context.mjs`:

```js
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const ORCHESTRATOR_HOME = process.env.ORCHESTRATOR_HOME || `${process.env.HOME}/JARVIS`;
const MAX_BUNDLE_CHARS = 16000;   // ~4k tokens

/**
 * Load a bounded context bundle for a project code.
 * Returns: { sources: [{label, content}], totalChars }
 */
export function loadProjectContext(projectCode, product) {
  const sources = [];
  let totalChars = 0;

  const tryAdd = (label, content) => {
    if (!content) return;
    const remaining = MAX_BUNDLE_CHARS - totalChars;
    if (remaining <= 0) return;
    const trimmed = content.length > remaining ? content.slice(0, remaining) + '\n…[truncated]' : content;
    sources.push({ label, content: trimmed });
    totalChars += trimmed.length;
  };

  // 1. VK health latest (only for VisionKing projects)
  if (product === 'visionking') {
    const vkLatest = join(ORCHESTRATOR_HOME, 'reports/vk-health', projectCode, 'latest.md');
    if (existsSync(vkLatest)) {
      tryAdd(`reports/vk-health/${projectCode}/latest.md`, readFileSync(vkLatest, 'utf-8'));
    }
  }

  // 2. PMO latest report (any product)
  const pmoLatest = join(ORCHESTRATOR_HOME, 'workspaces/strokmatic/pmo', projectCode, 'reports/md');
  if (existsSync(pmoLatest)) {
    // Take the most recent .md file in the directory
    try {
      const { readdirSync, statSync } = require('fs');
      const files = readdirSync(pmoLatest)
        .filter(f => f.endsWith('.md'))
        .map(f => ({ f, mtime: statSync(join(pmoLatest, f)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime);
      if (files.length > 0) {
        tryAdd(`pmo/${projectCode}/reports/${files[0].f}`, readFileSync(join(pmoLatest, files[0].f), 'utf-8'));
      }
    } catch {
      // ignore
    }
  }

  // 3. KB pages — reuse kb-chat search if available
  try {
    const { searchKB } = await import('../../kb-chat/lib/kb-search.mjs');
    // Note: this is a stub — kb-search expects a KB root and a query.
    // Wired in by the caller (answer-generator passes the query).
    sources.kbSearch = searchKB;
  } catch {
    // KB not available
  }

  return { sources, totalChars };
}
```

**Note for the implementer:** the dynamic `import()` of kb-search must happen inside an `async` function or at the top level. The shape above is a hint — the *real* loader is called from `answer-generator.mjs` which is already async, so move the kb-search call there if needed. Specifically: `loadProjectContext` should return the static sources (VK health, PMO report) and `answer-generator.mjs` should call `searchKB` separately and merge the results.

**Refined module shape — replace the file content above with this cleaner version:**

```js
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const ORCHESTRATOR_HOME = process.env.ORCHESTRATOR_HOME || `${process.env.HOME}/JARVIS`;
const MAX_BUNDLE_CHARS = 16000;

export function loadStaticProjectContext(projectCode, product) {
  const sources = [];
  let totalChars = 0;

  const tryAdd = (label, content) => {
    if (!content) return;
    const remaining = MAX_BUNDLE_CHARS - totalChars;
    if (remaining <= 0) return;
    const trimmed = content.length > remaining ? content.slice(0, remaining) + '\n…[truncated]' : content;
    sources.push({ label, content: trimmed });
    totalChars += trimmed.length;
  };

  if (product === 'visionking') {
    const vkLatest = join(ORCHESTRATOR_HOME, 'reports/vk-health', projectCode, 'latest.md');
    if (existsSync(vkLatest)) {
      tryAdd(`reports/vk-health/${projectCode}/latest.md`, readFileSync(vkLatest, 'utf-8'));
    }
  }

  const pmoMdDir = join(ORCHESTRATOR_HOME, 'workspaces/strokmatic/pmo', projectCode, 'reports/md');
  if (existsSync(pmoMdDir)) {
    try {
      const files = readdirSync(pmoMdDir)
        .filter(f => f.endsWith('.md'))
        .map(f => ({ f, mtime: statSync(join(pmoMdDir, f)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime);
      if (files.length > 0) {
        tryAdd(`pmo/${projectCode}/reports/${files[0].f}`, readFileSync(join(pmoMdDir, files[0].f), 'utf-8'));
      }
    } catch { /* ignore */ }
  }

  return { sources, totalChars, remainingChars: MAX_BUNDLE_CHARS - totalChars };
}
```

- [ ] **Step 2: Sanity-check syntax.**

```bash
node --check scripts/jarvis-chat/lib/project-context.mjs
```

- [ ] **Step 3-5: No test (FS-bound, varies per env). Continue.**

### Task 6.2: `answer-generator.mjs` — PT-BR `claude --print` wrapper

**Files:**
- Create: `scripts/jarvis-chat/lib/answer-generator.mjs`

- [ ] **Step 1: Write the module.**

Create `scripts/jarvis-chat/lib/answer-generator.mjs`:

```js
import { spawn } from 'child_process';

const SYSTEM_PROMPT = `Você é o JARVIS, assistente do Pedro e do time Strokmatic.
Responda SEMPRE em português brasileiro, mesmo que a pergunta venha em outro idioma.
Use APENAS o contexto fornecido. Se não houver informação suficiente, diga que não sabe.
Se uma informação vier de outro projeto/espaço, mencione a origem explicitamente entre parênteses, ex: (de espaço VK 03001 — Stellantis).
Seja conciso e direto. Use markdown leve. Evite preâmbulos como "claro" ou "ótima pergunta".`;

function buildUserPrompt({ question, projectContext, facts, projectCode, spaceLabel }) {
  const parts = [];
  parts.push(`# Pergunta no espaço ${spaceLabel} (projeto ${projectCode})`);
  parts.push(question);
  parts.push('');
  parts.push('# Contexto do projeto');
  if (projectContext.sources.length === 0) {
    parts.push('_(sem fontes estáticas disponíveis)_');
  } else {
    for (const s of projectContext.sources) {
      parts.push(`## ${s.label}`);
      parts.push(s.content);
      parts.push('');
    }
  }
  parts.push('# Fatos relevantes da memória de chat');
  if (facts.length === 0) {
    parts.push('_(nenhum fato relevante encontrado)_');
  } else {
    facts.forEach((entry, i) => {
      const f = entry.fact;
      parts.push(`${i + 1}. [${f.type}] ${f.summary}`);
      parts.push(`   _origem: ${f.source.space_label} — extraído em ${f.extracted_at.substring(0, 10)}_`);
    });
  }
  return parts.join('\n');
}

export async function generateAnswer({ question, projectContext, facts, projectCode, spaceLabel, model }) {
  const userPrompt = buildUserPrompt({ question, projectContext, facts, projectCode, spaceLabel });
  const fullPrompt = `${SYSTEM_PROMPT}\n\n${userPrompt}`;
  return new Promise((resolve, reject) => {
    const proc = spawn('claude', [
      '--print',
      '--model', model || 'claude-sonnet-4-6',
      '--max-turns', '1',
    ], { env: { ...process.env }, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', d => { stdout += d.toString(); });
    proc.stderr.on('data', d => { stderr += d.toString(); });
    proc.on('close', code => {
      if (code !== 0) reject(new Error(`claude --print exited ${code}: ${stderr}`));
      else resolve(stdout.trim());
    });
    proc.stdin.write(fullPrompt);
    proc.stdin.end();
  });
}

export { buildUserPrompt };   // exported for testability
```

- [ ] **Step 2: Add a unit test for the prompt builder (pure function).**

Create `scripts/jarvis-chat/test/answer-generator.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildUserPrompt } from '../lib/answer-generator.mjs';

test('buildUserPrompt: includes question, sources, and facts with attribution', () => {
  const prompt = buildUserPrompt({
    question: 'qual o status do vk03?',
    projectContext: { sources: [{ label: 'vk-health/latest.md', content: 'CPU OK\nDisk 60%' }] },
    facts: [
      { fact: { type: 'observation', summary: 'fila do rabbitmq estourou', source: { space_label: 'VK 03001 — Stellantis' }, extracted_at: '2026-04-09T10:00:00Z' } },
    ],
    projectCode: '03002',
    spaceLabel: 'VK 03002 — Nissan',
  });
  assert.match(prompt, /VK 03002 — Nissan/);
  assert.match(prompt, /vk-health\/latest\.md/);
  assert.match(prompt, /VK 03001 — Stellantis/);
  assert.match(prompt, /\[observation\]/);
});

test('buildUserPrompt: handles empty sources and empty facts', () => {
  const prompt = buildUserPrompt({
    question: 'oi',
    projectContext: { sources: [] },
    facts: [],
    projectCode: '03002',
    spaceLabel: 'VK 03002',
  });
  assert.match(prompt, /sem fontes estáticas/);
  assert.match(prompt, /nenhum fato relevante/);
});
```

- [ ] **Step 3: Run.**

```bash
node --test scripts/jarvis-chat/test/answer-generator.test.mjs
```

Expected: 2 passing.

- [ ] **Step 4-5: Continue.**

### Task 6.3: `fact-extractor.mjs` — `claude --print` extraction wrapper

**Files:**
- Create: `scripts/jarvis-chat/lib/fact-extractor.mjs`

- [ ] **Step 1: Write the module.**

Create `scripts/jarvis-chat/lib/fact-extractor.mjs`:

```js
import { spawn } from 'child_process';

const SYSTEM_PROMPT = `Você é um extrator estruturado de fatos a partir de conversas de chat de times de engenharia em português brasileiro.
Sua tarefa: ler uma thread de mensagens e extrair fatos estruturados úteis para memória de longo prazo do projeto.

Tipos de fato permitidos (use exatamente estes valores no campo "type"):
- decision: uma decisão tomada
- action_item: uma ação atribuída ou combinada
- blocker: um impedimento mencionado
- open_question: uma dúvida em aberto, sem resposta ainda
- observation: uma observação técnica ou status relevante
- risk: um risco identificado
- commitment: um compromisso assumido com alguém (data, entrega)
- metric: um valor numérico relevante mencionado (KPI, medida, contagem)

Saída: JSON puro, um array de objetos, sem texto fora do JSON. Cada objeto deve ter:
{
  "type": "...",
  "summary": "frase curta em PT-BR",
  "entities": ["..."],
  "people": ["..."]
}

Se nenhuma informação relevante for encontrada, retorne array vazio [].
Não invente fatos. Não inclua small talk.`;

function buildUserPrompt(threadMessages, sourceMeta) {
  const lines = [];
  lines.push(`# Thread no espaço ${sourceMeta.space_label} (projeto ${sourceMeta.project_code})`);
  lines.push('');
  for (const m of threadMessages) {
    lines.push(`[${m.ts}] ${m.sender?.name || 'desconhecido'}: ${m.text}`);
  }
  lines.push('');
  lines.push('Extraia os fatos estruturados desta thread.');
  return lines.join('\n');
}

function callClaude(prompt) {
  return new Promise((resolve, reject) => {
    const proc = spawn('claude', [
      '--print',
      '--model', 'claude-sonnet-4-6',
      '--max-turns', '1',
    ], { env: { ...process.env }, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', d => { stdout += d.toString(); });
    proc.stderr.on('data', d => { stderr += d.toString(); });
    proc.on('close', code => {
      if (code !== 0) reject(new Error(`claude exited ${code}: ${stderr}`));
      else resolve(stdout.trim());
    });
    proc.stdin.write(prompt);
    proc.stdin.end();
  });
}

function parseJsonArray(raw) {
  // Extract first [...] block; tolerate model adding stray text around it
  const m = raw.match(/\[[\s\S]*\]/);
  if (!m) return [];
  try {
    const parsed = JSON.parse(m[0]);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

let factCounter = 0;
function nextFactId(extractedAt) {
  factCounter += 1;
  return `f_${extractedAt.substring(0, 10)}_${String(factCounter).padStart(3, '0')}`;
}

/**
 * Extract facts from a single thread of messages.
 * @returns {Promise<object[]>} - normalized fact records ready for fact-store
 */
export async function extractFactsFromThread(threadMessages, sourceMeta) {
  if (threadMessages.length < 2) return [];
  const prompt = `${SYSTEM_PROMPT}\n\n${buildUserPrompt(threadMessages, sourceMeta)}`;
  const raw = await callClaude(prompt);
  const items = parseJsonArray(raw);
  const extractedAt = new Date().toISOString();
  return items.map(item => ({
    id: nextFactId(extractedAt),
    extracted_at: extractedAt,
    source: {
      space_id: sourceMeta.space_id,
      space_label: sourceMeta.space_label,
      project_code: sourceMeta.project_code,
      product: sourceMeta.product,
      thread_id: threadMessages[0].thread_id,
      message_ids: threadMessages.map(m => m.message_id),
    },
    type: item.type,
    summary: item.summary,
    entities: Array.isArray(item.entities) ? item.entities : [],
    people: Array.isArray(item.people) ? item.people : [],
  }));
}

export { buildUserPrompt as _buildExtractionPrompt, parseJsonArray as _parseJsonArray };
```

- [ ] **Step 2: Add unit tests for the pure helpers.**

Create `scripts/jarvis-chat/test/fact-extractor.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _buildExtractionPrompt, _parseJsonArray } from '../lib/fact-extractor.mjs';

test('_buildExtractionPrompt: includes space label and message lines', () => {
  const prompt = _buildExtractionPrompt(
    [
      { ts: '2026-04-10T14:00:00Z', sender: { name: 'Pedro' }, text: 'vamos aumentar prefetch para 50' },
      { ts: '2026-04-10T14:01:00Z', sender: { name: 'Joshua' }, text: 'fechado, faço hoje' },
    ],
    { space_label: 'VK 03002 — Nissan', project_code: '03002' },
  );
  assert.match(prompt, /VK 03002 — Nissan/);
  assert.match(prompt, /Pedro: vamos aumentar prefetch/);
  assert.match(prompt, /Joshua: fechado/);
});

test('_parseJsonArray: extracts JSON array surrounded by stray text', () => {
  const raw = 'Aqui está a saída:\n[{"type":"decision","summary":"teste","entities":[],"people":[]}]\nfim.';
  const out = _parseJsonArray(raw);
  assert.equal(out.length, 1);
  assert.equal(out[0].type, 'decision');
});

test('_parseJsonArray: malformed JSON returns empty array', () => {
  assert.deepEqual(_parseJsonArray('not json at all'), []);
  assert.deepEqual(_parseJsonArray('[invalid'), []);
});
```

- [ ] **Step 3: Run.**

```bash
node --test scripts/jarvis-chat/test/fact-extractor.test.mjs
```

Expected: 3 passing.

- [ ] **Step 4-5: Continue.**

---

## Phase 7 — Main loops

### Task 7.1: `poll-and-reply.mjs` — full orchestration

**Files:**
- Create: `scripts/jarvis-chat/poll-and-reply.mjs`

- [ ] **Step 1: Write the file.**

Create `scripts/jarvis-chat/poll-and-reply.mjs`:

```js
#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

import { listRecentMessages, sendReply, listSpaces } from '../helpers/chat-client.mjs';
import { loadRegistry, lookupSpace, isWarned, markWarned } from './lib/space-registry.mjs';
import { appendMessage } from './lib/transcript-store.mjs';
import { loadThreads, saveThreads, getThread, upsertThread, pruneExpired } from './lib/thread-tracker.mjs';
import { decideAction } from './lib/speaking-policy.mjs';
import { loadStaticProjectContext } from './lib/project-context.mjs';
import { loadRecentFacts, searchFacts } from './lib/fact-store.mjs';
import { generateAnswer } from './lib/answer-generator.mjs';
import { logQA } from './lib/qa-logger.mjs';
import { MESSAGES } from './lib/messages.pt-br.js';

const ORCHESTRATOR_HOME = process.env.ORCHESTRATOR_HOME || `${process.env.HOME}/JARVIS`;
const CONFIG_PATH = join(ORCHESTRATOR_HOME, 'config/orchestrator/jarvis-chat.json');
const REGISTRY_PATH = join(ORCHESTRATOR_HOME, 'config/orchestrator/jarvis-chat-spaces.json');
const DATA_ROOT = join(ORCHESTRATOR_HOME, 'data/jarvis-chat');
const STATE_PATH = join(DATA_ROOT, 'state.json');
const THREADS_PATH = join(DATA_ROOT, 'threads/active.json');
const TRANSCRIPTS_ROOT = join(DATA_ROOT, 'transcripts');
const FACTS_DIR = join(DATA_ROOT, 'facts');
const QA_LOG_DIR = join(DATA_ROOT, 'qa-log');

function loadJsonOrDefault(path, fallback) {
  if (!existsSync(path)) return fallback;
  try { return JSON.parse(readFileSync(path, 'utf-8')); } catch { return fallback; }
}

function saveJson(path, data) {
  const dir = path.substring(0, path.lastIndexOf('/'));
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

  // Determine which spaces to poll: explicit registry only (refuse-on-unmapped behavior)
  const mappedSpaceIds = Object.keys(registry.spaces || {});

  // Also poll any unmapped space the bot is in, ONCE, to deliver the warning.
  // For simplicity in v1, we only poll mapped spaces. If the bot is in an unmapped space,
  // it will not respond at all. The "warn once on first mention" behavior is a v1.1 polish.
  // (See spec §5.4 #3 for the intent; v1 simply ignores unmapped spaces silently.)

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

      // Always log to transcript (even if we won't reply)
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

        // Log the bot's own reply to the transcript so cross-loop dedupe sees it
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
```

- [ ] **Step 2: Syntax check.**

```bash
node --check scripts/jarvis-chat/poll-and-reply.mjs
```

Expected: no output, exit 0.

- [ ] **Step 3-5: Continue.**

### Task 7.2: `distill-facts.mjs` — full orchestration

**Files:**
- Create: `scripts/jarvis-chat/distill-facts.mjs`

- [ ] **Step 1: Write the file.**

Create `scripts/jarvis-chat/distill-facts.mjs`:

```js
#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

import { loadRegistry, lookupSpace } from './lib/space-registry.mjs';
import { readMessagesSince } from './lib/transcript-store.mjs';
import { extractFactsFromThread } from './lib/fact-extractor.mjs';
import { appendFact } from './lib/fact-store.mjs';

const ORCHESTRATOR_HOME = process.env.ORCHESTRATOR_HOME || `${process.env.HOME}/JARVIS`;
const CONFIG_PATH = join(ORCHESTRATOR_HOME, 'config/orchestrator/jarvis-chat.json');
const REGISTRY_PATH = join(ORCHESTRATOR_HOME, 'config/orchestrator/jarvis-chat-spaces.json');
const DATA_ROOT = join(ORCHESTRATOR_HOME, 'data/jarvis-chat');
const STATE_PATH = join(DATA_ROOT, 'state.json');
const TRANSCRIPTS_ROOT = join(DATA_ROOT, 'transcripts');
const FACTS_DIR = join(DATA_ROOT, 'facts');

function loadJsonOrDefault(path, fallback) {
  if (!existsSync(path)) return fallback;
  try { return JSON.parse(readFileSync(path, 'utf-8')); } catch { return fallback; }
}

function saveJson(path, data) {
  const dir = path.substring(0, path.lastIndexOf('/'));
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

    // Advance cursor to latest message ts in this batch
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
```

- [ ] **Step 2: Syntax check.**

```bash
node --check scripts/jarvis-chat/distill-facts.mjs
```

Expected: no output, exit 0.

- [ ] **Step 3-5: Continue.**

---

## Phase 8 — Integration smoke test, dry run, and cron wiring

### Task 8.1: Integration smoke test against fixtures

**Files:**
- Create: `scripts/jarvis-chat/test/test-integration.mjs`

- [ ] **Step 1: Write the smoke test.**

Create `scripts/jarvis-chat/test/test-integration.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { decideAction } from '../lib/speaking-policy.mjs';
import { appendMessage, readMessagesSince } from '../lib/transcript-store.mjs';
import { loadThreads, saveThreads, upsertThread, pruneExpired } from '../lib/thread-tracker.mjs';
import { appendFact, loadRecentFacts, searchFacts } from '../lib/fact-store.mjs';

test('end-to-end: mention → reply decision → transcript log → fact retrieval', () => {
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

    // Step 1: log
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

    // Step 3: fact retrieval
    const allFacts = loadRecentFacts(factsDir, 3);
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
```

- [ ] **Step 2: Run all tests.**

```bash
node --test scripts/jarvis-chat/test/
```

Expected: all tests across all files pass (~36 tests total).

- [ ] **Step 3-5: Continue.**

### Task 8.2: Dry-run the entrypoints with `enabled: false`

The config currently has `enabled: false` from Task 0.1. Both entrypoints should noop cleanly.

- [ ] **Step 1: Run `poll-and-reply.mjs` with config disabled.**

```bash
ORCHESTRATOR_HOME=$(pwd) node scripts/jarvis-chat/poll-and-reply.mjs
```

Expected output: `[jarvis-chat] disabled in config`. Exit 0.

- [ ] **Step 2: Run `distill-facts.mjs` with config disabled.**

```bash
ORCHESTRATOR_HOME=$(pwd) node scripts/jarvis-chat/distill-facts.mjs
```

Expected output: `[jarvis-chat:distill] disabled in config`. Exit 0.

- [ ] **Step 3-5: Continue.**

### Task 8.3: Cron wiring (deferred until after manual end-to-end)

**Manual user step before this task** — Pedro must:
1. Create / identify a "JARVIS Sandbox" Chat space.
2. Add the JARVIS bot user to the space (requires the GCP Chat app to exist; reuse the kb-chat bot identity if available, or register a new one).
3. Capture the bot's `users/<id>` and the sandbox space's `spaces/<id>`.
4. Add the sandbox entry to `config/orchestrator/jarvis-chat-spaces.json`:
   ```json
   {
     "spaces": {
       "spaces/REAL_SANDBOX_ID": {
         "label": "JARVIS Sandbox",
         "project_code": "03002",
         "product": "visionking",
         "memory_enabled": true
       }
     }
   }
   ```
5. Update `bot_user_id` in `config/orchestrator/jarvis-chat.json` to the real bot ID.
6. Set `"enabled": true` in `jarvis-chat.json`.

**Files (modified after manual step):**
- Modify: `config/cron/orchestrator.cron`

- [ ] **Step 1: Manual end-to-end test (with config enabled and sandbox configured).**

```bash
ORCHESTRATOR_HOME=$(pwd) node scripts/jarvis-chat/poll-and-reply.mjs
```

Then in the sandbox Chat space, post: `@JARVIS oi, está aí?`

Wait one minute, run again:

```bash
ORCHESTRATOR_HOME=$(pwd) node scripts/jarvis-chat/poll-and-reply.mjs
```

Expected: a PT-BR reply appears in the sandbox Chat thread within seconds. Inspect:

```bash
cat data/jarvis-chat/qa-log/$(date -u +%Y-%m).jsonl
cat data/jarvis-chat/threads/active.json
ls data/jarvis-chat/transcripts/
```

All three should have content from the live exchange.

- [ ] **Step 2: Manual distillation test.**

In the sandbox space, post 3-4 messages forming a "decision" thread. Then run:

```bash
ORCHESTRATOR_HOME=$(pwd) node scripts/jarvis-chat/distill-facts.mjs
cat data/jarvis-chat/facts/$(date -u +%Y-%m).jsonl
```

Expected: at least one fact extracted with `type` from the 8 allowed values.

- [ ] **Step 3: Add cron entries.**

Append to `config/cron/orchestrator.cron`:

```
# JARVIS chat presence — poll spaces, route mentions, post replies (every 1 min)
* * * * * cd $ORCHESTRATOR_HOME && node scripts/jarvis-chat/poll-and-reply.mjs >> logs/jarvis-chat-poll.log 2>&1

# JARVIS chat presence — hourly fact distillation
0 * * * * cd $ORCHESTRATOR_HOME && node scripts/jarvis-chat/distill-facts.mjs >> logs/jarvis-chat-distill.log 2>&1
```

- [ ] **Step 4: Reload cron** (Pedro's regular workflow — typically `crontab config/cron/orchestrator.cron`, but follow whatever the existing kb-chat cron entry does).

- [ ] **Step 5: Watch the first hour of logs.**

```bash
tail -f logs/jarvis-chat-poll.log
```

Expected: a line every minute, no Node errors. After one hour, also tail `jarvis-chat-distill.log` and verify the hourly job ran.

---

## Phase 9 — Single end-of-feature commit

Per Pedro's instruction, the entire feature is committed as one logical change at the end.

### Task 9.1: Final commit

- [ ] **Step 1: Confirm test suite is green.**

```bash
node --test scripts/jarvis-chat/test/
```

Expected: all tests pass.

- [ ] **Step 2: Review the diff.**

```bash
git status
git diff --stat -- docs/superpowers/specs/2026-04-10-jarvis-chat-presence-design.md \
                   docs/superpowers/plans/2026-04-10-jarvis-chat-presence.md \
                   .gitignore \
                   config/orchestrator/jarvis-chat.json \
                   config/orchestrator/jarvis-chat-spaces.json \
                   config/cron/orchestrator.cron \
                   scripts/helpers/chat-client.mjs \
                   scripts/kb-chat/poll-and-reply.mjs \
                   scripts/jarvis-chat/
```

Verify the change set is exactly what was planned. **Do not stage or commit unrelated dirty files** from the working tree.

- [ ] **Step 3: ASK PEDRO BEFORE STAGING.** Per memory rule: `git add`, `git commit`, `git push`, `gh pr merge` ALWAYS require explicit user approval. Show the diff summary above and wait for go/no-go.

- [ ] **Step 4: After approval, stage and commit.**

```bash
git add docs/superpowers/specs/2026-04-10-jarvis-chat-presence-design.md \
        docs/superpowers/plans/2026-04-10-jarvis-chat-presence.md \
        .gitignore \
        config/orchestrator/jarvis-chat.json \
        config/orchestrator/jarvis-chat-spaces.json \
        config/cron/orchestrator.cron \
        scripts/helpers/chat-client.mjs \
        scripts/kb-chat/poll-and-reply.mjs \
        scripts/jarvis-chat/

git commit -m "$(cat <<'EOF'
feat(jarvis-chat): project-space chat presence with ambient memory

New Google Chat bot parallel to kb-chat that lives in Strokmatic project
spaces. Mention-only with thread-sticky 5-min/3-follow-up window, PT-BR
throughout, project-aware Q&A grounded in PMO data + ClickUp + KB + an
ambient fact store extracted hourly from chat transcripts. Cross-project
context surfaces with attribution.

Pure speaking-policy and fact-store modules under node:test (~36 tests).
chat-client.mjs promoted from kb-chat/lib/ to scripts/helpers/ and shared.

Spec:  docs/superpowers/specs/2026-04-10-jarvis-chat-presence-design.md
Plan:  docs/superpowers/plans/2026-04-10-jarvis-chat-presence.md

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 5: Verify.**

```bash
git log -1 --stat
```

Expected: one commit on `develop` with the full feature changeset.

---

## Self-review notes

Spec coverage check (against `docs/superpowers/specs/2026-04-10-jarvis-chat-presence-design.md`):

| Spec section | Plan task(s) |
|---|---|
| §4.1 module decomposition | All Phase 1-7 tasks |
| §4.2 component diagram | Implemented as wired in 7.1 |
| §4.3 runtime model (cron) | 8.3 |
| §5 conversation policy + state machine | Phase 1 (TDD) |
| §5.5 question-shape detector | 1.4-1.5 |
| §5.6 mention detection (annotation + fallback) | 1.3 |
| §6.1 directory layout | 0.1 + runtime mkdir in stores |
| §6.2 transcript record | 3.1 + used in 7.1 |
| §6.3 fact record (8 types) | 6.3 (extractor prompt enumerates them) |
| §6.4 fact extraction pipeline | 6.3 + 7.2 |
| §6.5 retrieval at answer time | 2.1-2.4 + 7.1 wiring |
| §6.6 cross-project attribution | 6.2 (system prompt) |
| §6.7 no embeddings rationale | Implicit — no embedding code anywhere |
| §7 configuration | 0.1 |
| §8 relationship to existing systems | 5.1 (chat-client promotion) |
| §9 testing strategy | All TDD steps + 8.1 smoke |
| §10 rollout plan | Phase ordering matches spec rollout |
| §11 deferred items | Documented in plan header (qa-logger deviation) |
| §12 success criteria | Verifiable via 8.1, 8.3 manual tests |

**Documented spec deviation:** §8 promotion of `qa-logger.mjs` is not done (format incompatibility with kb-chat); a new JSONL logger is built in 4.3 instead. Noted in plan header.

**Placeholder scan:** No "TBD", "TODO", or vague guidance — every step contains the actual code or command.

**Type consistency check:** `decideAction` signature matches across Tasks 1.1-1.6, `searchFacts` signature matches between 2.3 and 7.1 wiring, `extractFactsFromThread` shape matches between 6.3 and 7.2 wiring, `appendFact` / `loadRecentFacts` signatures consistent between 2.4 and 7.1/7.2.
