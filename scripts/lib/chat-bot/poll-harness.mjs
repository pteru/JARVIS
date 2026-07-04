/**
 * Shared Google Chat polling skeleton for JARVIS chat bots (jarvis-chat, kb-chat).
 *
 * Handles the per-space cursor loop: fetch messages newer than the stored
 * cursor, hand each to the bot's onMessage, advance the cursor, stamp
 * last_poll. Bots supply only their personality (mention detection, context
 * building, answer generation, reply/send).
 *
 * State shape (mutated in place; caller persists it):
 *   { spaces_state?: { [spaceId]: { last_message_ts, ...botExtras } }, last_poll }
 * The legacy kb-chat cursor key `last_message_time` is honored on read and
 * migrated to `last_message_ts` on write.
 */

/**
 * @param {object}   opts
 * @param {string[]} opts.spaceIds            spaces to poll
 * @param {object}   opts.state               mutable state object (see above)
 * @param {Function} opts.listRecentMessages  async (spaceId, lastTs) => raw messages
 * @param {Function} opts.onMessage           async (raw, spaceId) => truthy when a reply was produced.
 *                                            A throw is contained to that message.
 * @param {Function} [opts.onSpaceDone]       (spaceId, baseEntry, messages) => state entry override
 *                                            (return null/undefined to keep baseEntry; called only
 *                                            when there is something to persist or extend)
 * @param {string}   [opts.tag]               log prefix
 * @returns {Promise<number>} number of messages onMessage counted as replies
 */
export async function pollSpaces({ spaceIds, state, listRecentMessages, onMessage, onSpaceDone, tag = 'chat-bot' }) {
  let processed = 0;

  for (const spaceId of spaceIds) {
    const existing = state.spaces_state?.[spaceId] || {};
    const lastTs = existing.last_message_ts || existing.last_message_time || null;

    let messages;
    try {
      messages = await listRecentMessages(spaceId, lastTs);
    } catch (err) {
      console.error(`[${tag}] listRecentMessages failed for ${spaceId}: ${err.message}`);
      continue;
    }

    for (const raw of messages) {
      try {
        if (await onMessage(raw, spaceId)) processed += 1;
      } catch (err) {
        console.error(`[${tag}] onMessage failed for ${raw?.name ?? '?'} in ${spaceId}: ${err.message}`);
      }
    }

    let entry = null;
    if (messages.length > 0) {
      entry = { ...existing, last_message_ts: messages[messages.length - 1].createTime };
    }
    if (onSpaceDone) {
      const override = onSpaceDone(spaceId, entry ?? { ...existing }, messages);
      if (override) entry = override;
    }
    if (entry) {
      delete entry.last_message_time; // migrate legacy cursor key
      if (!state.spaces_state) state.spaces_state = {};
      state.spaces_state[spaceId] = entry;
    }
  }

  state.last_poll = new Date().toISOString();
  return processed;
}
