#!/usr/bin/env node
// Mock WebSocket server for testing the Energy Orb + Session Dashboard
// Usage: node mock-server.js

const { WebSocketServer } = require('ws');

const PORT = 9000;
const wss = new WebSocketServer({ port: PORT });

const states = ['idle', 'listening', 'thinking', 'speaking'];
let stateIndex = 0;

const mockSessions = [
  {
    id: 'aaa-111', name: 'DieMaster Debug', state: 'active', turn_count: 14,
    topic: 'Sensor Calibration', context_pct: 72,
    log: 'GAP sensor offset adjusted\nRunning validation pass'
  },
  {
    id: 'bbb-222', name: 'VisionKing Tests', state: 'idle', turn_count: 8,
    topic: 'E2E Pipeline', context_pct: 45,
    log: 'Last test run passed\nAwaiting next command'
  },
  {
    id: 'ccc-333', name: 'SpotFusion Deploy', state: 'background', turn_count: 3,
    topic: 'Staging Release', context_pct: 28,
    log: 'Docker build in progress\nETA 2 minutes'
  },
  {
    id: 'ddd-444', name: 'API Refactor', state: 'complete', turn_count: 28,
    topic: 'REST Endpoints', context_pct: 95,
    log: 'All endpoints migrated\nPR #42 ready for review'
  },
  {
    id: 'eee-555', name: 'PMO Reports', state: 'idle', turn_count: 12,
    topic: 'Monthly Review', context_pct: 60,
    log: 'PDF exports complete\nAwaiting approval'
  },
  {
    id: 'fff-666', name: 'PR Review Bot', state: 'background', turn_count: 6,
    topic: 'Code Quality', context_pct: 35,
    log: 'Reviewing PR #18\nAnalyzing diff'
  },
];

console.log(`Mock WS server on ws://localhost:${PORT}`);

wss.on('connection', (ws) => {
  console.log('Client connected');

  // Send initial state + sessions
  ws.send(JSON.stringify({ state: 'idle' }));
  ws.send(JSON.stringify({ sessions: mockSessions }));

  // Handle inbound commands
  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      console.log('Received:', msg);
      if (msg.command === 'switch_session') {
        // Toggle the active session
        mockSessions.forEach(s => s.state = s.id === msg.session_id ? 'active' : 'idle');
        ws.send(JSON.stringify({ sessions: mockSessions }));
        console.log('Switched active to:', msg.session_id);
      }
    } catch (e) {
      console.warn('Invalid message:', raw.toString());
    }
  });

  ws.on('close', () => console.log('Client disconnected'));
});

// Cycle states every 3 seconds for visual testing
setInterval(() => {
  stateIndex = (stateIndex + 1) % states.length;
  const state = states[stateIndex];
  const msg = JSON.stringify(
    state === 'speaking'
      ? { state, amplitude: Math.random() * 0.8 + 0.2 }
      : { state }
  );
  wss.clients.forEach(ws => ws.send(msg));
}, 3000);

// Send amplitude pulses during speaking
setInterval(() => {
  if (states[stateIndex] === 'speaking') {
    const msg = JSON.stringify({ amplitude: Math.random() * 0.8 + 0.2 });
    wss.clients.forEach(ws => ws.send(msg));
  }
}, 100);
