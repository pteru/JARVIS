#!/usr/bin/env node
import { resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';

import { loadConfig, loadEmailRules, dataDir } from './lib/config.mjs';
import { buildClients } from './lib/google-clients.mjs';
import { classifyEmail } from './lib/email-classifier.mjs';
import { extractWithLlm } from './lib/email-extractor.mjs';
import { makeLogger } from './lib/logger.mjs';

const log = makeLogger('collect-emails');
const argDate = process.argv[2] ?? new Date().toISOString().slice(0, 10);

function decodeBody(payload) {
  if (!payload) return '';
  if (payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64url').toString('utf-8');
  }
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        return Buffer.from(part.body.data, 'base64url').toString('utf-8');
      }
    }
    for (const part of payload.parts) {
      const nested = decodeBody(part);
      if (nested) return nested;
    }
  }
  return '';
}

function header(headers, name) {
  return headers?.find(h => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';
}

function parseEmailDate(dateStr) {
  // RFC 2822 → ISO date
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

async function main() {
  const cfg = loadConfig();
  const rules = loadEmailRules();
  const { gmail } = buildClients(cfg);
  const out = dataDir(argDate);
  mkdirSync(out, { recursive: true });

  const lookback = rules.lookback_days ?? 365;
  const query = `label:${rules.master_label} newer_than:${lookback}d`;
  log.info('searching gmail', { query });

  // List message ids
  const ids = [];
  let pageToken;
  do {
    const r = await gmail.users.messages.list({ userId: 'me', q: query, pageToken, maxResults: 500 });
    for (const m of r.data.messages ?? []) ids.push(m.id);
    pageToken = r.data.nextPageToken;
  } while (pageToken);
  log.info(`found ${ids.length} messages`);

  const aprovacoes = [];
  for (const id of ids) {
    try {
      const m = await gmail.users.messages.get({ userId: 'me', id, format: 'full' });
      const headers = m.data.payload?.headers ?? [];
      const email = {
        from: header(headers, 'From'),
        to: header(headers, 'To'),
        subject: header(headers, 'Subject'),
        date: parseEmailDate(header(headers, 'Date')),
        body: decodeBody(m.data.payload),
      };

      const cls = classifyEmail(email, rules, { selfFromAddresses: cfg.self_from_addresses });
      const extracaoCfg = cls.classifier?.extracao ?? {};
      let extracao = {};
      if (extracaoCfg.use_llm_for?.length > 0) {
        extracao = extractWithLlm({
          from: email.from, subject: email.subject, date: email.date, body: email.body,
          fields: extracaoCfg.use_llm_for,
        });
      }

      aprovacoes.push({
        gmail_message_id: id,
        gmail_link: `https://mail.google.com/mail/u/0/#all/${id}`,
        tipo: cls.type,
        data_email: email.date,
        remetente: email.from,
        assunto: email.subject,
        corpo_resumido: email.body.slice(0, 500),
        extracao,
        confirmacao_humana: !!extracaoCfg.confirmacao_humana,
      });
    } catch (err) {
      log.warn(`failed to process message ${id}`, { err: err.message });
    }
  }

  const snapshot = { collected_at: new Date().toISOString(), status: 'ok', aprovacoes_email: aprovacoes };
  const path = resolve(out, 'email-snapshot.json');
  writeFileSync(path, JSON.stringify(snapshot, null, 2));
  log.info('snapshot written', { path, aprovacoes: aprovacoes.length });
}

main().catch(err => {
  log.error('collect-emails failed', { err: err.message, stack: err.stack });
  process.exitCode = 1;
});
