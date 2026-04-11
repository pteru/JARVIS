/**
 * Pure decision function for the JARVIS chat speaking policy.
 *
 * @param {object} args
 * @param {object} args.message              - { space_id, thread_id, message_id, sender:{id,name}, text, is_bot, ts, annotations? }
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

  // We have a thread state and no fresh mention. Check expiry.
  const expired = isExpired(threadState, message.ts, config);
  if (expired) {
    return {
      action: 'ignore',
      reason: 'window_expired',
      newThreadState: { ...threadState, status: 'expired' },
    };
  }

  // Intentionally returns NO newThreadState: a non-question inside an active
  // thread is ignored silently, the thread stays open, and the window timer is
  // NOT reset — only JARVIS's own replies refresh the window (spec §5.4 #1/#2).
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

// Spec §5.6: annotation match is primary; substring "jarvis" is a deliberate
// fallback for payloads missing structured annotations. The fallback is
// intentionally loose (no @ prefix required) and will match messages that
// merely mention "jarvis" by name. This is a known, accepted false-positive
// surface — tighten here only if the spec changes.
function detectMention(message, botUserId) {
  if (Array.isArray(message.annotations)) {
    for (const a of message.annotations) {
      if (a?.type === 'USER_MENTION' && a?.userMention?.user?.name === botUserId) {
        return true;
      }
    }
  }
  if (typeof message.text === 'string' && message.text.toLowerCase().includes('jarvis')) {
    return true;
  }
  return false;
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
