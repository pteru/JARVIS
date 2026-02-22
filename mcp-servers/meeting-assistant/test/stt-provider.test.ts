/**
 * Tests for the STT provider interface and DeepgramSTT implementation.
 * Since DeepgramSTT requires a real API key and WebSocket connection,
 * we test the interface contract, configuration validation, and error handling.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DeepgramSTT } from '../src/stt/deepgram.js';
import type { STTResult, STTProviderConfig } from '../src/stt/provider.js';

describe('STTResult interface', () => {
  it('has correct fields for a final result', () => {
    const result: STTResult = {
      text: 'Hello world',
      speaker: 'Speaker 0',
      language: 'en',
      confidence: 0.95,
      isFinal: true,
      timestamp: new Date().toISOString(),
    };

    assert.equal(result.text, 'Hello world');
    assert.equal(result.speaker, 'Speaker 0');
    assert.equal(result.language, 'en');
    assert.equal(result.confidence, 0.95);
    assert.equal(result.isFinal, true);
    assert.ok(result.timestamp.match(/^\d{4}-\d{2}-\d{2}T/));
  });

  it('allows optional fields to be undefined', () => {
    const result: STTResult = {
      text: 'Hello',
      isFinal: false,
      timestamp: new Date().toISOString(),
    };

    assert.equal(result.speaker, undefined);
    assert.equal(result.language, undefined);
    assert.equal(result.confidence, undefined);
    assert.equal(result.isFinal, false);
  });
});

describe('STTProviderConfig interface', () => {
  it('accepts a full configuration', () => {
    const config: STTProviderConfig = {
      apiKeyEnv: 'DEEPGRAM_API_KEY',
      model: 'nova-2',
      language: 'multi',
      diarize: true,
    };

    assert.equal(config.apiKeyEnv, 'DEEPGRAM_API_KEY');
    assert.equal(config.model, 'nova-2');
    assert.equal(config.language, 'multi');
    assert.equal(config.diarize, true);
  });

  it('allows all fields to be optional', () => {
    const config: STTProviderConfig = {};
    assert.equal(config.apiKeyEnv, undefined);
    assert.equal(config.model, undefined);
  });
});

describe('DeepgramSTT', () => {
  it('implements STTProvider interface', () => {
    const stt = new DeepgramSTT();
    assert.equal(stt.name, 'Deepgram Nova-2');
    assert.equal(typeof stt.start, 'function');
    assert.equal(typeof stt.feedAudio, 'function');
    assert.equal(typeof stt.stop, 'function');
    assert.equal(typeof stt.isStreaming, 'function');
  });

  it('starts in non-streaming state', () => {
    const stt = new DeepgramSTT();
    assert.equal(stt.isStreaming(), false);
  });

  it('throws clear error when API key is missing', async () => {
    const stt = new DeepgramSTT();
    const originalKey = process.env.DEEPGRAM_API_KEY;
    delete process.env.DEEPGRAM_API_KEY;

    try {
      await assert.rejects(
        () => stt.start({ apiKeyEnv: 'DEEPGRAM_API_KEY' }, () => {}),
        (err: Error) => {
          assert.ok(err.message.includes('DEEPGRAM_API_KEY'));
          assert.ok(err.message.includes('not found'));
          return true;
        },
      );
    } finally {
      if (originalKey !== undefined) {
        process.env.DEEPGRAM_API_KEY = originalKey;
      }
    }
  });

  it('throws clear error for custom API key env that is missing', async () => {
    const stt = new DeepgramSTT();

    await assert.rejects(
      () => stt.start({ apiKeyEnv: 'MY_CUSTOM_DG_KEY' }, () => {}),
      (err: Error) => {
        assert.ok(err.message.includes('MY_CUSTOM_DG_KEY'));
        return true;
      },
    );
  });

  it('feedAudio is a no-op when not streaming', () => {
    const stt = new DeepgramSTT();
    // Should not throw
    stt.feedAudio(Buffer.alloc(3200));
  });

  it('stop is safe to call when not streaming', async () => {
    const stt = new DeepgramSTT();
    // Should not throw
    await stt.stop();
    assert.equal(stt.isStreaming(), false);
  });
});
