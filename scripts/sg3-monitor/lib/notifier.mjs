import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { makeLogger } from './logger.mjs';

const log = makeLogger('notifier');

function expandHome(p) {
  return p.startsWith('~/') ? resolve(homedir(), p.slice(2)) : p;
}

export class Notifier {
  constructor({ chat, config }) {
    this.chat = chat;
    this.config = config;
  }

  async postPrimary(text) {
    try {
      const r = await this.chat.spaces.messages.create({
        parent: this.config.google_chat_space,
        requestBody: { text },
      });
      return { ok: true, messageId: r.data.name, channel: 'google_chat' };
    } catch (err) {
      log.warn('google chat post failed; falling back to telegram', { err: err.message });
      const fb = await this.postTelegram(text);
      return { ...fb, primary_failed: err.message };
    }
  }

  async postTelegram(text) {
    const path = expandHome(this.config.telegram_bot_secret_path);
    if (!existsSync(path)) {
      log.error('telegram secret not found', { path });
      return { ok: false, channel: 'telegram', error: 'secret missing' };
    }
    const { token, chat_id } = JSON.parse(readFileSync(path, 'utf-8'));
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const body = JSON.stringify({ chat_id, text, parse_mode: 'Markdown', disable_web_page_preview: true });
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    if (!r.ok) {
      const errBody = await r.text();
      log.error('telegram send failed', { status: r.status, body: errBody });
      return { ok: false, channel: 'telegram', error: `${r.status} ${errBody}` };
    }
    const data = await r.json();
    return { ok: true, channel: 'telegram', messageId: String(data.result.message_id) };
  }

  async postEscalation(text) {
    return this.postTelegram(`🔥 ESCALATION\n\n${text}`);
  }
}
