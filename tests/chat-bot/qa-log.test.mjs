/**
 * Tests for scripts/lib/chat-bot/qa-log.mjs — shared monthly Q&A log writers.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appendMonthlyJsonl, appendKbMarkdown } from '../../scripts/lib/chat-bot/qa-log.mjs';

test('appendMonthlyJsonl: creates dir, appends one JSON line per call to UTC month file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-jsonl-'));
  try {
    const ts = '2026-03-05T10:00:00.000Z';
    appendMonthlyJsonl(dir, { ts, question: 'q1', answer: 'a1' });
    appendMonthlyJsonl(dir, { ts, question: 'q2', answer: 'a2' });

    const file = path.join(dir, '2026-03.jsonl');
    const lines = fs.readFileSync(file, 'utf-8').trim().split('\n');
    assert.equal(lines.length, 2);
    assert.equal(JSON.parse(lines[0]).question, 'q1');
    assert.equal(JSON.parse(lines[1]).answer, 'a2');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('appendKbMarkdown: month file with header, entry fields, gap goes to pendentes.md', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-md-'));
  try {
    appendKbMarkdown(dir, {
      who: 'Pedro',
      question: 'Como funciona o pipeline?',
      answer: 'Assim.',
      kbPagesUsed: ['produtos/vk/arquitetura.md'],
      isGap: false,
    });
    appendKbMarkdown(dir, {
      who: 'Eduardo',
      question: 'Pergunta sem resposta na KB',
      answer: 'Nao encontrei.',
      kbPagesUsed: [],
      isGap: true,
    });

    const files = fs.readdirSync(dir);
    const monthFile = files.find(f => /^\d{4}-\d{2}\.md$/.test(f));
    assert.ok(monthFile, `month file must exist, got: ${files}`);
    const content = fs.readFileSync(path.join(dir, monthFile), 'utf-8');
    assert.match(content, /^# Registro Q&A/, 'header written once');
    assert.match(content, /\*\*Quem perguntou:\*\* Pedro/);
    assert.match(content, /produtos\/vk\/arquitetura\.md/);
    assert.match(content, /\*\*Lacuna identificada:\*\* sim/);

    const pendentes = fs.readFileSync(path.join(dir, 'pendentes.md'), 'utf-8');
    assert.match(pendentes, /Pergunta sem resposta na KB \(Eduardo\)/);
    assert.doesNotMatch(pendentes, /Como funciona/, 'non-gap entries stay out of pendentes');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
