#!/usr/bin/env node
// Mock WebSocket server for testing the Energy Orb + Session Dashboard
// Usage: node mock-server.js

const { WebSocketServer } = require('ws');

const PORT = 9000;
const wss = new WebSocketServer({ port: PORT });

const states = ['idle', 'listening', 'thinking', 'speaking'];
let stateIndex = 0;

const mockSessions = [
  { id: 'aaa-111', name: 'DieMaster Debug', state: 'active', turn_count: 5 },
  { id: 'bbb-222', name: 'VisionKing Tests', state: 'idle', turn_count: 12 },
  { id: 'ccc-333', name: 'SpotFusion Deploy', state: 'background', turn_count: 3 },
  { id: 'ddd-444', name: 'API Refactor', state: 'complete', turn_count: 28 },
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
