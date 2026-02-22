#!/usr/bin/env node
/**
 * Integration test — spawns the MCP server and sends real tool calls.
 * Tests the full flow: start_meeting → inject_transcript → stop_meeting.
 *
 * Usage: node test/integration.mjs
 */

import { spawn } from 'child_process';
import { createInterface } from 'readline';

const SERVER_PATH = new URL('../dist/src/index.js', import.meta.url).pathname;

let msgId = 0;
let serverProcess;
let rl;

// --- JSON-RPC helpers ---

function sendRequest(method, params = {}) {
  const id = ++msgId;
  const msg = JSON.stringify({ jsonrpc: '2.0', id, method, params });
  console.log(`\n→ ${method} (id=${id})`);
  serverProcess.stdin.write(msg + '\n');
  return id;
}

function waitForResponse(expectedId, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for id=${expectedId}`)), timeoutMs);
    const handler = (line) => {
      try {
        const data = JSON.parse(line);
        if (data.id === expectedId) {
          clearTimeout(timer);
          rl.off('line', handler);
          resolve(data);
        }
      } catch { /* skip non-JSON lines */ }
    };
    rl.on('line', handler);
  });
}

async function callTool(name, args = {}) {
  const id = sendRequest('tools/call', { name, arguments: args });
  const resp = await waitForResponse(id);
  if (resp.error) {
    console.error(`  ✗ Error: ${JSON.stringify(resp.error)}`);
    return null;
  }
  const text = resp.result?.content?.[0]?.text ?? JSON.stringify(resp.result);
  console.log(`  ← ${text.slice(0, 300)}${text.length > 300 ? '...' : ''}`);
  return resp.result;
}

// --- Main test flow ---

async function main() {
  console.log('=== Meeting Assistant Integration Test ===\n');
  console.log(`Server: ${SERVER_PATH}`);

  // Spawn MCP server
  serverProcess = spawn('node', [SERVER_PATH], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ORCHESTRATOR_HOME: process.env.ORCHESTRATOR_HOME || process.env.HOME + '/JARVIS' },
  });

  // Capture stderr for debug
  serverProcess.stderr.on('data', (data) => {
    const msg = data.toString().trim();
    if (msg) console.log(`  [server] ${msg}`);
  });

  rl = createInterface({ input: serverProcess.stdout });

  // Initialize MCP session
  console.log('\n--- Step 0: Initialize MCP session ---');
  const initId = sendRequest('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'integration-test', version: '1.0.0' },
  });
  const initResp = await waitForResponse(initId);
  console.log(`  ← Server: ${initResp.result?.serverInfo?.name} v${initResp.result?.serverInfo?.version}`);

  // Send initialized notification
  serverProcess.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

  // List tools
  console.log('\n--- Step 1: List available tools ---');
  const listId = sendRequest('tools/list', {});
  const listResp = await waitForResponse(listId);
  const tools = listResp.result?.tools ?? [];
  console.log(`  ← ${tools.length} tools: ${tools.map(t => t.name).join(', ')}`);

  // Start meeting
  console.log('\n--- Step 2: Start meeting (creates Google Doc) ---');
  const startResult = await callTool('start_meeting', { title: 'Integration Test Meeting' });
  if (!startResult || startResult.isError) {
    console.error('\n✗ start_meeting failed. Aborting.');
    cleanup(1);
    return;
  }
  const startData = JSON.parse(startResult.content[0].text);
  console.log(`  Doc URL: ${startData.docUrl}`);

  // Inject transcript lines
  console.log('\n--- Step 3: Inject transcript lines ---');
  await callTool('inject_transcript', { text: 'Good morning everyone, let us start the sprint review.', speaker: 'Pedro' });
  await callTool('inject_transcript', { text: 'The CI pipeline has been failing since Monday. We need to fix it by Friday.', speaker: 'Maria' });
  await callTool('inject_transcript', { text: 'I will take ownership of the CI fix. Can someone review the Dockerfile changes?', speaker: 'Pedro' });
  await callTool('inject_transcript', { text: 'I can review them tomorrow morning.', speaker: 'João' });
  await callTool('inject_transcript', { text: 'Great. Next topic: the client demo is scheduled for next Wednesday.', speaker: 'Pedro' });
  await callTool('inject_transcript', { text: 'We should prepare the staging environment by Monday. I will handle the deployment.', speaker: 'Maria' });
  await callTool('inject_transcript', { text: 'Agreed. Let us also update the release notes before the demo.', speaker: 'Pedro' });

  // Check status
  console.log('\n--- Step 4: Check meeting status ---');
  await callTool('get_meeting_status');

  // Wait a moment for live notes cycle (it runs every 30s)
  console.log('\n--- Step 5: Waiting 35s for live notes update cycle... ---');
  await new Promise(r => setTimeout(r, 35000));

  // Stop meeting (triggers minutes generation)
  console.log('\n--- Step 6: Stop meeting (generates structured minutes) ---');
  const stopResult = await callTool('stop_meeting');
  if (stopResult && !stopResult.isError) {
    const stopData = JSON.parse(stopResult.content[0].text);
    console.log(`  Live notes: ${stopData.liveNotesDocUrl ?? stopData.docUrl}`);
    console.log(`  Minutes:    ${stopData.minutesDocUrl ?? 'not generated'}`);
  }

  // List meetings
  console.log('\n--- Step 7: List past meetings ---');
  await callTool('list_meetings');

  console.log('\n=== Integration test complete ===');
  cleanup(0);
}

function cleanup(code) {
  if (serverProcess) {
    serverProcess.kill('SIGTERM');
  }
  setTimeout(() => process.exit(code), 500);
}

main().catch((err) => {
  console.error('\nFatal error:', err);
  cleanup(1);
});
