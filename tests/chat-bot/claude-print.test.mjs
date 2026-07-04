/**
 * Tests for scripts/lib/chat-bot/claude-print.mjs — shared `claude --print`
 * invocation. Hermetic: a stub `claude` on PATH.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runClaudePrint } from '../../scripts/lib/chat-bot/claude-print.mjs';

function installClaudeStub({ out = 'stub answer', exit = 0 }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-stub-'));
  const script = `#!/bin/bash
cat > "${dir}/stdin.txt"
echo "$@" > "${dir}/args.txt"
echo -n "${out}"
exit ${exit}
`;
  fs.writeFileSync(path.join(dir, 'claude'), script, { mode: 0o755 });
  return {
    dir,
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}` },
    stdin: () => fs.readFileSync(path.join(dir, 'stdin.txt'), 'utf-8'),
    args: () => fs.readFileSync(path.join(dir, 'args.txt'), 'utf-8').trim(),
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

test('pipes the prompt via stdin, passes model + max-turns, returns trimmed stdout', async () => {
  const stub = installClaudeStub({ out: '  the answer \n' });
  const oldPath = process.env.PATH;
  process.env.PATH = stub.env.PATH;
  try {
    const answer = await runClaudePrint('what is up?', { model: 'test-model' });
    assert.equal(answer, 'the answer');
    assert.equal(stub.stdin(), 'what is up?');
    assert.match(stub.args(), /--print/);
    assert.match(stub.args(), /--model test-model/);
    assert.match(stub.args(), /--max-turns 1/);
  } finally {
    process.env.PATH = oldPath;
    stub.cleanup();
  }
});

test('non-zero exit rejects with stderr in the message', async () => {
  const stub = installClaudeStub({ out: '', exit: 3 });
  const oldPath = process.env.PATH;
  process.env.PATH = stub.env.PATH;
  try {
    await assert.rejects(
      () => runClaudePrint('boom'),
      /exited 3/,
    );
  } finally {
    process.env.PATH = oldPath;
    stub.cleanup();
  }
});
