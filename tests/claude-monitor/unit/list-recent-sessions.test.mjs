import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listRecentSessions } from '../../../scripts/claude-monitor/lib/sessions.mjs';

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'claude-monitor-recent-'));
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function writeJsonl(path, lines, mtimeMs) {
  writeFileSync(path, lines.join('\n') + '\n');
  const sec = mtimeMs / 1000;
  utimesSync(path, sec, sec);
}

const TITLE = (name) => JSON.stringify({ type: 'custom-title', customTitle: name });
const CWD = (cwd) => JSON.stringify({ type: 'user', cwd });

test('listRecentSessions returns empty array when projectsDir does not exist', () => {
  assert.deepEqual(listRecentSessions('/nonexistent/xyz', {}), []);
});

test('listRecentSessions returns empty array when no JSONL files exist', () => {
  const { root, cleanup } = setup();
  try {
    mkdirSync(join(root, '-empty'), { recursive: true });
    assert.deepEqual(listRecentSessions(root, {}), []);
  } finally { cleanup(); }
});

test('listRecentSessions sorts by mtime descending', () => {
  const { root, cleanup } = setup();
  try {
    mkdirSync(join(root, '-p'), { recursive: true });
    writeJsonl(join(root, '-p', 'older.jsonl'), [TITLE('old'), CWD('/a')], 1_000_000);
    writeJsonl(join(root, '-p', 'newer.jsonl'), [TITLE('new'), CWD('/b')], 2_000_000);
    writeJsonl(join(root, '-p', 'middle.jsonl'), [TITLE('mid'), CWD('/c')], 1_500_000);

    const result = listRecentSessions(root, {});
    assert.deepEqual(result.map((r) => r.sessionId), ['newer', 'middle', 'older']);
    assert.deepEqual(result.map((r) => r.name), ['new', 'mid', 'old']);
  } finally { cleanup(); }
});

test('listRecentSessions excludes sessionIds in excludeSessionIds', () => {
  const { root, cleanup } = setup();
  try {
    mkdirSync(join(root, '-p'), { recursive: true });
    writeJsonl(join(root, '-p', 'aaa.jsonl'), [TITLE('a')], 1_000_000);
    writeJsonl(join(root, '-p', 'bbb.jsonl'), [TITLE('b')], 2_000_000);
    writeJsonl(join(root, '-p', 'ccc.jsonl'), [TITLE('c')], 3_000_000);

    const result = listRecentSessions(root, { excludeSessionIds: new Set(['bbb']) });
    assert.deepEqual(result.map((r) => r.sessionId), ['ccc', 'aaa']);
  } finally { cleanup(); }
});

test('listRecentSessions applies the limit', () => {
  const { root, cleanup } = setup();
  try {
    mkdirSync(join(root, '-p'), { recursive: true });
    for (let i = 0; i < 5; i++) {
      writeJsonl(join(root, '-p', `s${i}.jsonl`), [TITLE(`n${i}`)], 1_000_000 + i * 1000);
    }
    const result = listRecentSessions(root, { limit: 2 });
    assert.equal(result.length, 2);
    assert.deepEqual(result.map((r) => r.sessionId), ['s4', 's3']);
  } finally { cleanup(); }
});

test('listRecentSessions searches across multiple project dirs', () => {
  const { root, cleanup } = setup();
  try {
    mkdirSync(join(root, '-proj-a'), { recursive: true });
    mkdirSync(join(root, '-proj-b'), { recursive: true });
    writeJsonl(join(root, '-proj-a', 'sA.jsonl'), [TITLE('A')], 1_000_000);
    writeJsonl(join(root, '-proj-b', 'sB.jsonl'), [TITLE('B')], 2_000_000);
    const result = listRecentSessions(root, {});
    assert.deepEqual(result.map((r) => r.sessionId), ['sB', 'sA']);
  } finally { cleanup(); }
});

test('listRecentSessions attaches name, cwd, mtime, filepath, kind=recent', () => {
  const { root, cleanup } = setup();
  try {
    mkdirSync(join(root, '-p'), { recursive: true });
    const fp = join(root, '-p', 'sess.jsonl');
    writeJsonl(fp, [TITLE('hello'), CWD('/work/dir')], 1_500_000);
    const result = listRecentSessions(root, {});
    assert.equal(result.length, 1);
    assert.equal(result[0].kind, 'recent');
    assert.equal(result[0].sessionId, 'sess');
    assert.equal(result[0].name, 'hello');
    assert.equal(result[0].cwd, '/work/dir');
    assert.equal(result[0].mtime, 1_500_000);
    assert.equal(result[0].filepath, fp);
  } finally { cleanup(); }
});

test('listRecentSessions sets name to null when transcript has no custom-title', () => {
  const { root, cleanup } = setup();
  try {
    mkdirSync(join(root, '-p'), { recursive: true });
    writeJsonl(join(root, '-p', 'anon.jsonl'), [CWD('/somewhere')], 1_000_000);
    const result = listRecentSessions(root, {});
    assert.equal(result[0].name, null);
  } finally { cleanup(); }
});
