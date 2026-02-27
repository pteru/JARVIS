// JARVIS Energy Orb — Mock WebSocket Server
// Cycles through all states for visual testing

const { WebSocketServer } = require('ws');

const PORT = 9000;

const wss = new WebSocketServer({ port: PORT, path: '/orb' });

console.log(`[Mock] WebSocket server listening on ws://localhost:${PORT}/orb`);

// Demo sequence: [state, durationMs, options]
const SEQUENCE = [
  { state: 'idle',      duration: 3000 },
  { state: 'listening', duration: 2000 },
  { state: 'thinking',  duration: 3000 },
  { state: 'speaking',  duration: 5000, withAmplitude: true },
  { state: 'healthy',   duration: 2000 },
  { state: 'alert',     duration: 2000 },
  { state: 'idle',      duration: 3000 },
];

function broadcast(data) {
  const msg = JSON.stringify(data);
  for (const client of wss.clients) {
    if (client.readyState === 1) { // OPEN
      client.send(msg);
    }
  }
}

let sequenceIndex = 0;
let amplitudeInterval = null;

function runSequence() {
  const step = SEQUENCE[sequenceIndex % SEQUENCE.length];

  console.log(`[Mock] → ${step.state} (${step.duration / 1000}s)`);
  broadcast({ state: step.state });

  // If speaking, simulate amplitude sine wave at 30Hz
  if (amplitudeInterval) {
    clearInterval(amplitudeInterval);
    amplitudeInterval = null;
  }

  if (step.withAmplitude) {
    let t = 0;
    amplitudeInterval = setInterval(() => {
      t += 0.033;
      // Simulate speech-like amplitude with multiple sine waves
      const amplitude = Math.abs(
        Math.sin(t * 3.0) * 0.5 +
        Math.sin(t * 7.3) * 0.3 +
        Math.sin(t * 13.7) * 0.2
      );
      broadcast({ amplitude: Math.min(1.0, amplitude) });
    }, 33);
  }

  sequenceIndex++;

  setTimeout(runSequence, step.duration);
}

wss.on('connection', (ws) => {
  console.log('[Mock] Client connected');
  ws.on('close', () => console.log('[Mock] Client disconnected'));
});

// Start the demo loop
runSequence();
