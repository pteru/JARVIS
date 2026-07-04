import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Hermetic integration tests for the task-dispatcher MCP server.
//
// The server is spawned as a child process with ORCHESTRATOR_HOME pointing
// at a mkdtemp home, and driven over stdio with raw JSON-RPC (newline-
// delimited JSON, as used by the MCP stdio transport).
//
// NOTE ON HERMETICITY: by reading index.js we verified the server only ever
// writes under ORCHESTRATOR_HOME (logs/dispatches.json via saveDispatches).
// dispatch_task does NOT spawn `claude` — it records the dispatch and returns
// a suggested `command` string for the caller to run. We still prepend a stub
// `claude` executable to PATH and assert it was never invoked, which both
// guarantees hermeticity if that behavior ever changes and documents the
// current contract. verify_task_completion may run commands via exec, so the
// tasks used here only produce file_exists criteria (no command/test
// criteria: the fake workspace has no package.json/pyproject.toml and task
// texts avoid the word "test"/"spec").

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SERVER = path.join(ROOT, 'mcp-servers', 'task-dispatcher', 'index.js');

const EXPECTED_TOOLS = [
  'dispatch_task',
  'get_task_status',
  'list_dispatched_tasks',
  'update_task_status',
  'verify_task_completion',
  'update_task_outcome',
  'mark_task_complete_override',
  'dispatch_batch',
  'get_batch_status',
  'cancel_batch',
];

const REQUEST_TIMEOUT_MS = 10_000;

class McpClient {
  constructor(env) {
    this.child = spawn(process.execPath, [SERVER], {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.pending = new Map();
    this.nextId = 1;
    this.buf = '';
    this.child.stdout.setEncoding('utf-8');
    this.child.stdout.on('data', (chunk) => {
      this.buf += chunk;
      let idx;
      while ((idx = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, idx).trim();
        this.buf = this.buf.slice(idx + 1);
        if (!line) continue;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue; // ignore non-JSON noise
        }
        const waiter = this.pending.get(msg.id);
        if (waiter) {
          this.pending.delete(msg.id);
          waiter(msg);
        }
      }
    });
    // stderr carries only the startup banner; drain it so the pipe never fills
    this.child.stderr.resume();
  }

  request(method, params = {}) {
    const id = this.nextId++;
    const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out after ${REQUEST_TIMEOUT_MS}ms waiting for ${method}`));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, (msg) => {
        clearTimeout(timer);
        if (msg.error) reject(new Error(`${method} returned JSON-RPC error: ${JSON.stringify(msg.error)}`));
        else resolve(msg.result);
      });
      this.child.stdin.write(payload + '\n');
    });
  }

  notify(method, params = {}) {
    this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  }

  async callTool(name, args) {
    const result = await this.request('tools/call', { name, arguments: args });
    assert.ok(Array.isArray(result.content), `tools/call ${name}: missing content array`);
    return result.content[0].text;
  }

  /** callTool + JSON.parse of the text payload (for non-error responses). */
  async callToolJson(name, args) {
    return JSON.parse(await this.callTool(name, args));
  }

  kill() {
    if (this.child.exitCode === null) this.child.kill('SIGKILL');
  }
}

describe('task-dispatcher MCP server (stdio integration)', () => {
  let home;
  let wsPath;
  let stubDir;
  let client;

  // shared across sequential tests below
  let taskId; // from the happy-path dispatch
  let verifyTaskId; // from the criteria-extraction dispatch
  let batchId;

  const dispatchLogPath = () => path.join(home, 'logs', 'dispatches.json');
  const readDispatches = () => JSON.parse(fs.readFileSync(dispatchLogPath(), 'utf-8'));

  before(async () => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'task-dispatcher-home-'));
    wsPath = path.join(home, 'workspaces', 'demo-ws');
    fs.mkdirSync(wsPath, { recursive: true });
    fs.mkdirSync(path.join(home, 'config', 'orchestrator'), { recursive: true });

    fs.writeFileSync(
      path.join(home, 'config', 'orchestrator', 'workspaces.json'),
      JSON.stringify({
        workspaces: {
          'demo-ws': { path: wsPath, product: 'demo' },
        },
      }),
    );
    fs.writeFileSync(
      path.join(home, 'config', 'orchestrator', 'models.json'),
      JSON.stringify({
        task_complexity: {
          simple: { model: 'stub-model-simple' },
          medium: { model: 'stub-model-medium' },
          complex: { model: 'stub-model-complex' },
        },
        rules: [],
      }),
    );

    // Stub `claude` on PATH: records any invocation, prints canned output.
    stubDir = path.join(home, 'stub-bin');
    fs.mkdirSync(stubDir, { recursive: true });
    const stubPath = path.join(stubDir, 'claude');
    fs.writeFileSync(
      stubPath,
      [
        '#!/bin/sh',
        `echo "$@" >> "${path.join(stubDir, 'claude-calls.log')}"`,
        `if [ ! -t 0 ]; then cat >> "${path.join(stubDir, 'claude-stdin.log')}"; fi`,
        'echo "stub claude output"',
      ].join('\n') + '\n',
    );
    fs.chmodSync(stubPath, 0o755);

    client = new McpClient({
      ...process.env,
      ORCHESTRATOR_HOME: home,
      PATH: `${stubDir}:${process.env.PATH}`,
    });

    const init = await client.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'task-dispatcher-test', version: '0.0.0' },
    });
    assert.equal(init.serverInfo.name, 'task-dispatcher');
    client.notify('notifications/initialized');
  });

  after(() => {
    try {
      client?.kill();
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it('tools/list returns exactly the expected 10 tools', async () => {
    const result = await client.request('tools/list');
    const names = result.tools.map((t) => t.name);
    assert.deepEqual([...names].sort(), [...EXPECTED_TOOLS].sort());
    assert.equal(names.length, 10);
    for (const tool of result.tools) {
      assert.equal(tool.inputSchema.type, 'object', `tool ${tool.name} has an object inputSchema`);
    }
  });

  it('dispatch_task happy path records the dispatch and returns the command', async () => {
    const task = 'Add a friendly greeting banner to the homepage';
    const res = await client.callToolJson('dispatch_task', {
      workspace: 'demo-ws',
      task,
      complexity: 'simple',
      priority: 'high',
    });

    assert.match(res.task_id, /^dispatch-\d+-[a-z0-9]{6}$/);
    assert.equal(res.message, 'Task dispatched to demo-ws');
    assert.equal(res.model, 'stub-model-simple'); // from our models.json
    assert.equal(res.workspace_path, wsPath);
    assert.equal(res.context_injected, false); // no .claude/context.md in fake ws
    assert.equal(res.acceptance_criteria_count, 0); // task has no paths/tests/commands
    // The server does not execute anything; it hands back the command to run.
    assert.ok(res.command.startsWith('claude --model stub-model-simple --print '));

    taskId = res.task_id;

    // Record persisted in logs/dispatches.json under the temp home
    const dispatches = readDispatches();
    assert.equal(dispatches.length, 1);
    const rec = dispatches[0];
    assert.equal(rec.id, taskId);
    assert.equal(rec.workspace, 'demo-ws');
    assert.equal(rec.workspace_path, wsPath);
    assert.equal(rec.original_task, task);
    assert.equal(rec.status, 'pending');
    assert.equal(rec.priority, 'high');
    assert.equal(rec.complexity, 'simple');
    assert.equal(rec.model, 'stub-model-simple');
    assert.equal(rec.started_at, null);
    assert.equal(rec.completed_at, null);
    assert.deepEqual(rec.acceptance_criteria, []);
    assert.equal(rec.status_history.length, 1);
    assert.equal(rec.status_history[0].status, 'pending');
    assert.equal(rec.status_history[0].note, 'Task dispatched');

    // dispatch_task never launches claude itself — the stub must be untouched.
    assert.equal(fs.existsSync(path.join(stubDir, 'claude-calls.log')), false);
  });

  it('dispatch_task to an unknown workspace returns an error result', async () => {
    const text = await client.callTool('dispatch_task', {
      workspace: 'no-such-ws',
      task: 'anything',
    });
    // Handler catches and returns the error as text content (no isError flag).
    assert.match(text, /^Error: Workspace "no-such-ws" not found in workspaces\.json/);
    // Nothing new persisted
    assert.equal(readDispatches().length, 1);
  });

  it('get_task_status and list_dispatched_tasks read back the dispatch', async () => {
    const rec = await client.callToolJson('get_task_status', { task_id: taskId });
    assert.equal(rec.id, taskId);
    assert.equal(rec.status, 'pending');
    assert.equal(rec.workspace, 'demo-ws');

    const list = await client.callToolJson('list_dispatched_tasks', { workspace: 'demo-ws' });
    assert.ok(Array.isArray(list));
    const entry = list.find((d) => d.id === taskId);
    assert.ok(entry, 'dispatched task appears in list');
    assert.equal(entry.duration_seconds, null); // not started yet

    const filtered = await client.callToolJson('list_dispatched_tasks', {
      workspace: 'other-ws',
    });
    assert.equal(filtered.length, 0);

    const missing = await client.callTool('get_task_status', { task_id: 'dispatch-nope' });
    assert.match(missing, /^Error: Task "dispatch-nope" not found/);
  });

  it('update_task_status enforces the lifecycle state machine', async () => {
    // pending -> running
    const r1 = await client.callToolJson('update_task_status', {
      task_id: taskId,
      status: 'running',
      note: 'worker picked up',
    });
    assert.match(r1.message, /pending -> running/);
    let rec = readDispatches().find((d) => d.id === taskId);
    assert.equal(rec.status, 'running');
    assert.ok(rec.started_at, 'started_at set on first transition to running');
    assert.equal(rec.status_history.length, 2);
    assert.equal(rec.status_history[1].note, 'worker picked up');

    // running -> complete is NOT allowed (must go through verifying)
    const bad = await client.callTool('update_task_status', {
      task_id: taskId,
      status: 'complete',
    });
    assert.match(bad, /^Error: Invalid transition: running -> complete/);

    // running -> verifying -> complete
    await client.callToolJson('update_task_status', {
      task_id: taskId,
      status: 'verifying',
      verification_log: 'checks queued',
    });
    const r3 = await client.callToolJson('update_task_status', {
      task_id: taskId,
      status: 'complete',
    });
    assert.equal(r3.status, 'complete');

    rec = readDispatches().find((d) => d.id === taskId);
    assert.equal(rec.status, 'complete');
    assert.equal(rec.verification_log, 'checks queued');
    assert.ok(rec.completed_at, 'completed_at set');
    assert.equal(rec.status_history.length, 4);
  });

  it('extracts file_exists criteria and verify_task_completion checks them', async () => {
    const res = await client.callToolJson('dispatch_task', {
      workspace: 'demo-ws',
      task: 'Create docs/notes.md with the release summary',
    });
    verifyTaskId = res.task_id;
    assert.equal(res.acceptance_criteria_count, 1);

    const rec = readDispatches().find((d) => d.id === verifyTaskId);
    assert.deepEqual(rec.acceptance_criteria, [
      { type: 'file_exists', path: 'docs/notes.md', source: 'extracted' },
    ]);

    // File missing -> criterion fails
    const fail = await client.callToolJson('verify_task_completion', { task_id: verifyTaskId });
    assert.equal(fail.passed, false);
    assert.equal(fail.summary, '0/1 passed');

    // Create the file inside the fake workspace -> criterion passes
    fs.mkdirSync(path.join(wsPath, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(wsPath, 'docs', 'notes.md'), '# notes\n');
    const pass = await client.callToolJson('verify_task_completion', { task_id: verifyTaskId });
    assert.equal(pass.passed, true);
    assert.equal(pass.summary, '1/1 passed');
    assert.equal(pass.results[0].criterion.type, 'file_exists');

    // Verification runs are appended to the record's history + log
    const after = readDispatches().find((d) => d.id === verifyTaskId);
    assert.match(after.verification_log, /\[PASS\] file_exists/);
    assert.equal(
      after.status_history.filter((h) => h.status === 'verification_run').length,
      2,
    );
  });

  it('update_task_outcome and mark_task_complete_override update the record', async () => {
    const text = await client.callTool('update_task_outcome', {
      task_id: verifyTaskId,
      outcome: 'success',
      execution_time_seconds: 12,
      tokens_used: 3456,
      notes: 'done cleanly',
    });
    assert.match(text, /outcome=success/);
    assert.match(text, /time=12s/);
    assert.match(text, /tokens=3456/);

    const override = await client.callToolJson('mark_task_complete_override', {
      task_id: verifyTaskId,
      reason: 'verified manually',
    });
    assert.equal(override.status, 'complete');

    const rec = readDispatches().find((d) => d.id === verifyTaskId);
    assert.equal(rec.outcome, 'success');
    assert.equal(rec.execution_time_seconds, 12);
    assert.equal(rec.tokens_used, 3456);
    assert.equal(rec.outcome_notes, 'done cleanly');
    assert.equal(rec.status, 'complete');
    assert.match(rec.status_history.at(-1).note, /Manual override: verified manually/);
  });

  it('dispatch_batch, get_batch_status, and cancel_batch manage a batch lifecycle', async () => {
    const res = await client.callToolJson('dispatch_batch', {
      tasks: [
        { workspace: 'demo-ws', task: 'Polish the landing copy' },
        { workspace: 'demo-ws', task: 'Tidy the sidebar links', complexity: 'complex' },
      ],
      max_parallel: 2,
    });
    batchId = res.batch_id;
    assert.match(batchId, /^batch-/);
    assert.equal(res.dispatch_ids.length, 2);
    assert.match(res.command, /execute-batch\.mjs/); // execution is external, not in-server

    const status = await client.callToolJson('get_batch_status', { batch_id: batchId });
    assert.equal(status.task_count, 2);
    assert.equal(status.pending, 2);
    assert.equal(status.complete, 0);
    assert.equal(status.dispatches.length, 2);
    assert.equal(
      status.dispatches.find((d) => d.model === 'stub-model-complex') !== undefined,
      true,
      'per-task complexity drives model selection',
    );

    const cancel = await client.callToolJson('cancel_batch', { batch_id: batchId });
    assert.equal(cancel.tasks_cancelled, 2);

    const afterCancel = await client.callToolJson('get_batch_status', { batch_id: batchId });
    assert.equal(afterCancel.status, 'cancelled');
    assert.equal(afterCancel.pending, 0);
    assert.equal(afterCancel.failed, 2);

    const missing = await client.callTool('get_batch_status', { batch_id: 'batch-nope' });
    assert.match(missing, /^Error: Batch "batch-nope" not found/);
  });

  it('never invoked the stub claude and never wrote outside ORCHESTRATOR_HOME logs', async () => {
    assert.equal(fs.existsSync(path.join(stubDir, 'claude-calls.log')), false);
    assert.equal(fs.existsSync(path.join(stubDir, 'claude-stdin.log')), false);
    // Only the dispatch log exists under logs/
    assert.deepEqual(fs.readdirSync(path.join(home, 'logs')), ['dispatches.json']);
  });
});
