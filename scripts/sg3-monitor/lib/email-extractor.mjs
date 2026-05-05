import { spawnSync } from 'node:child_process';
import { makeLogger } from './logger.mjs';

const log = makeLogger('email-extractor');

const PROMPT_TEMPLATE = `You are extracting structured data from a Brazilian Portuguese business email.

Email metadata:
- From: {{from}}
- Subject: {{subject}}
- Date: {{date}}

Email body:
"""
{{body}}
"""

Extract the following fields as a single JSON object on one line, with these keys (set value to null if not present):
{{fields}}

Output ONLY the JSON object, no preamble, no markdown fences. Use ISO date format YYYY-MM-DD for any date fields.
`;

const FIELD_SPECS = {
  carta_id: '"carta_id": <string identifier of the subcontracting letter, e.g., "2024-XYZ" or null>',
  prazo_definido: '"prazo_definido": <date the email defines as the validity deadline (YYYY-MM-DD) or null>',
  status: '"status": <one of "aprovado", "pendente", "rejeitado" or null>',
  alocacao_inferida: '"alocacao_inferida": <text describing colaborador and planta mentioned (e.g., "João Silva em Gravataí") or null>',
  tipo_inferido: '"tipo_inferido": <best guess at the email type (e.g., "renovacao_aso", "carta_subcontratacao_pendente") or null>',
};

export function extractWithLlm({ from, subject, date, body, fields }) {
  const fieldLines = fields.map(f => '  ' + (FIELD_SPECS[f] ?? `"${f}": <value or null>`)).join(',\n');
  const prompt = PROMPT_TEMPLATE
    .replace('{{from}}', from)
    .replace('{{subject}}', subject)
    .replace('{{date}}', date)
    .replace('{{body}}', body.slice(0, 10000))
    .replace('{{fields}}', `{\n${fieldLines}\n}`);

  const r = spawnSync('claude', ['--print', '--allowedTools=', '--max-turns=1'], {
    input: prompt,
    encoding: 'utf-8',
    timeout: 60_000,
  });

  if (r.status !== 0) {
    log.warn('claude --print failed', { stderr: r.stderr });
    return Object.fromEntries(fields.map(f => [f, null]));
  }

  try {
    const trimmed = r.stdout.trim();
    const m = trimmed.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('no JSON found');
    return JSON.parse(m[0]);
  } catch (err) {
    log.warn('failed to parse LLM JSON', { stdout: r.stdout, err: err.message });
    return Object.fromEntries(fields.map(f => [f, null]));
  }
}
