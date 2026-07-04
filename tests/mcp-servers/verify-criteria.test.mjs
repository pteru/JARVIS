import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  verifyFileExists,
  verifyCommandSuccess,
  verifyContentMatch,
  verifyCriterion,
} from '../../mcp-servers/task-dispatcher/lib/verify-criteria.js';

describe('task-dispatcher/lib/verify-criteria', () => {
  let ws;

  before(() => {
    ws = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-criteria-ws-'));
    fs.mkdirSync(path.join(ws, 'src'), { recursive: true });
    fs.writeFileSync(path.join(ws, 'src', 'app.js'), 'export const answer = 42;\n');
    fs.writeFileSync(path.join(ws, 'marker.txt'), 'present\n');
  });

  after(() => {
    fs.rmSync(ws, { recursive: true, force: true });
  });

  describe('verifyFileExists', () => {
    it('passes for an existing relative path', async () => {
      const r = await verifyFileExists({ type: 'file_exists', path: 'src/app.js' }, ws);
      assert.equal(r.passed, true);
      assert.match(r.message, /File exists: src\/app\.js/);
    });

    it('passes for an existing absolute path (workspace ignored)', async () => {
      const abs = path.join(ws, 'src', 'app.js');
      const r = await verifyFileExists({ type: 'file_exists', path: abs }, '/nonexistent-workspace');
      assert.equal(r.passed, true);
    });

    it('fails for a missing file', async () => {
      const r = await verifyFileExists({ type: 'file_exists', path: 'src/missing.js' }, ws);
      assert.equal(r.passed, false);
      assert.match(r.message, /File not found: src\/missing\.js/);
    });
  });

  describe('verifyCommandSuccess', () => {
    it('passes when the command exits 0', async () => {
      const r = await verifyCommandSuccess({ type: 'command_success', command: 'true' }, ws);
      assert.equal(r.passed, true);
      assert.match(r.message, /Command succeeded: true/);
    });

    it('fails when the command exits non-zero', async () => {
      const r = await verifyCommandSuccess({ type: 'command_success', command: 'false' }, ws);
      assert.equal(r.passed, false);
      assert.match(r.message, /Command failed: false/);
    });

    it('runs the command with cwd set to the workspace', async () => {
      // marker.txt only exists inside the workspace dir
      const r = await verifyCommandSuccess(
        { type: 'command_success', command: 'test -f marker.txt' },
        ws,
      );
      assert.equal(r.passed, true);
    });
  });

  describe('verifyContentMatch', () => {
    it('passes when the regex pattern matches file content', async () => {
      const r = await verifyContentMatch(
        { type: 'content_match', path: 'src/app.js', pattern: 'answer\\s*=\\s*42' },
        ws,
      );
      assert.equal(r.passed, true);
      assert.match(r.message, /Content match found/);
    });

    it('fails when the pattern does not match', async () => {
      const r = await verifyContentMatch(
        { type: 'content_match', path: 'src/app.js', pattern: 'no-such-token' },
        ws,
      );
      assert.equal(r.passed, false);
      assert.match(r.message, /Content match not found/);
    });

    it('fails gracefully when the file cannot be read', async () => {
      const r = await verifyContentMatch(
        { type: 'content_match', path: 'nope/gone.txt', pattern: 'x' },
        ws,
      );
      assert.equal(r.passed, false);
      assert.match(r.message, /Could not read nope\/gone\.txt/);
    });
  });

  describe('verifyCriterion dispatcher', () => {
    it('routes file_exists', async () => {
      const r = await verifyCriterion({ type: 'file_exists', path: 'marker.txt' }, ws);
      assert.equal(r.passed, true);
    });

    it('routes content_match', async () => {
      const r = await verifyCriterion(
        { type: 'content_match', path: 'marker.txt', pattern: '^present' },
        ws,
      );
      assert.equal(r.passed, true);
    });

    it('routes command_success', async () => {
      const r = await verifyCriterion({ type: 'command_success', command: 'true' }, ws);
      assert.equal(r.passed, true);
    });

    it('routes test_pass using the explicit command when provided', async () => {
      const r = await verifyCriterion({ type: 'test_pass', command: 'true' }, ws);
      assert.equal(r.passed, true);
      assert.match(r.message, /Command succeeded: true/);
    });

    it('fails on an unknown criterion type', async () => {
      const r = await verifyCriterion({ type: 'wat' }, ws);
      assert.equal(r.passed, false);
      assert.match(r.message, /Unknown criterion type: wat/);
    });
  });
});
