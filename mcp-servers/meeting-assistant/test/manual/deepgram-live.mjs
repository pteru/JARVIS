#!/usr/bin/env node
/**
 * Quick test: send captured audio to Deepgram Nova-2 and print transcription.
 * Usage: DEEPGRAM_API_KEY=xxx node test-deepgram.mjs /tmp/test-audio.raw
 */
import { createClient, LiveTranscriptionEvents } from '@deepgram/sdk';
import { readFileSync } from 'fs';

const apiKey = process.env.DEEPGRAM_API_KEY;
if (!apiKey) { console.error('Set DEEPGRAM_API_KEY'); process.exit(1); }

const audioFile = process.argv[2] || '/tmp/test-audio.raw';
const audio = readFileSync(audioFile);
console.log(`Audio file: ${audioFile} (${audio.length} bytes)`);

const client = createClient(apiKey);
const conn = client.listen.live({
  model: 'nova-2',
  language: 'multi',
  smart_format: true,
  diarize: true,
  encoding: 'linear16',
  sample_rate: 16000,
  channels: 1,
});

let results = [];

conn.on(LiveTranscriptionEvents.Open, () => {
  console.log('WebSocket connected. Sending audio...');

  // Send in 3200-byte chunks (100ms at 16kHz mono 16-bit)
  const chunkSize = 3200;
  for (let i = 0; i < audio.length; i += chunkSize) {
    const chunk = audio.subarray(i, i + chunkSize);
    conn.send(chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength));
  }

  // Signal end of audio after a small delay
  setTimeout(() => {
    console.log('Audio sent. Waiting for final results...');
    conn.requestClose();
  }, 2000);
});

conn.on(LiveTranscriptionEvents.Transcript, (event) => {
  const alt = event.channel?.alternatives?.[0];
  if (!alt?.transcript) return;

  const isFinal = event.is_final;
  const speaker = alt.words?.[0]?.speaker !== undefined ? `Speaker ${alt.words[0].speaker}` : '?';
  const lang = alt.languages?.[0] || alt.words?.[0]?.language || '?';

  console.log(`  [${isFinal ? 'FINAL' : 'interim'}] (${speaker}, ${lang}) ${alt.transcript}`);
  if (isFinal) results.push(alt.transcript);
});

conn.on(LiveTranscriptionEvents.Close, () => {
  console.log('\n--- Results ---');
  if (results.length === 0) {
    console.log('No speech detected (was there audio playing during capture?)');
  } else {
    console.log(results.join(' '));
  }
  process.exit(0);
});

conn.on(LiveTranscriptionEvents.Error, (err) => {
  console.error('Error:', err.message || err);
  process.exit(1);
});

// Safety timeout
setTimeout(() => { console.log('Timeout — exiting'); process.exit(0); }, 15000);
