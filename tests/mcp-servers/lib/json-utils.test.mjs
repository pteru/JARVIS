import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readJson, writeJson, readJsonSafe } from '../../../mcp-servers/lib/json-utils.js';

describe('mcp-servers/lib/json-utils', () => {
  it('readJson parses an existing JSON file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ju-'));
    try {
      const f = join(dir, 'a.json');
      writeFileSync(f, JSON.stringify({ x: 1, nested: [true] }));
      assert.deepEqual(await readJson(f), { x: 1, nested: [true] });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('writeJson creates missing parent dirs and writes pretty JSON with a trailing newline', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ju-'));
    try {
      const f = join(dir, 'nested/deep/b.json');
      await writeJson(f, { y: 2 });
      assert.ok(existsSync(f), 'file should exist after writeJson');
      assert.equal(readFileSync(f, 'utf-8'), JSON.stringify({ y: 2 }, null, 2) + '\n');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('writeJson then readJson round-trips', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ju-'));
    try {
      const f = join(dir, 'rt.json');
      const data = { a: 1, b: 'two', c: [3, 4], d: { e: null } };
      await writeJson(f, data);
      assert.deepEqual(await readJson(f), data);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('readJsonSafe returns the default for a missing file', async () => {
    assert.equal(await readJsonSafe('/no/such/path/zzz.json', 'DEFAULT'), 'DEFAULT');
  });

  it('readJsonSafe returns the default for malformed JSON', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ju-'));
    try {
      const f = join(dir, 'bad.json');
      writeFileSync(f, '{ not valid json');
      assert.equal(await readJsonSafe(f, null), null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
