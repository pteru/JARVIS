/**
 * Tests for AudioPipeline wiring logic.
 * Uses mock implementations of SystemAudioCapture, STTProvider, and TranscriptAccumulator
 * to verify the pipeline routes data correctly.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { AudioPipeline } from '../src/audio/audio-pipeline.js';
import { TranscriptAccumulator } from '../src/transcript.js';
import type { STTProvider, STTProviderConfig, STTResult } from '../src/stt/provider.js';
import type { SystemAudioCapture, AudioCaptureConfig } from '../src/audio/system-capture.js';

// ---------------------------------------------------------------------------
// Mock STT Provider
// ---------------------------------------------------------------------------

class MockSTTProvider implements STTProvider {
  readonly name = 'MockSTT';
  private streaming = false;
  private onResultCallback: ((result: STTResult) => void) | null = null;
  public startCallCount = 0;
  public stopCallCount = 0;
  public feedCallCount = 0;

  async start(_config: STTProviderConfig, onResult: (result: STTResult) => void): Promise<void> {
    this.streaming = true;
    this.onResultCallback = onResult;
    this.startCallCount++;
  }

  feedAudio(_chunk: Buffer): void {
    this.feedCallCount++;
  }

  async stop(): Promise<void> {
    this.streaming = false;
    this.onResultCallback = null;
    this.stopCallCount++;
  }

  isStreaming(): boolean {
    return this.streaming;
  }

  /** Simulate a transcription result from the STT engine. */
  emitResult(result: STTResult): void {
    if (this.onResultCallback) {
      this.onResultCallback(result);
    }
  }
}

// ---------------------------------------------------------------------------
// Mock Audio Capture
// ---------------------------------------------------------------------------

class MockAudioCapture {
  private capturing = false;
  private onChunkCallback: ((chunk: Buffer) => void) | null = null;
  public startCallCount = 0;
  public stopCallCount = 0;

  async start(_config: AudioCaptureConfig, onChunk: (chunk: Buffer) => void): Promise<void> {
    this.capturing = true;
    this.onChunkCallback = onChunk;
    this.startCallCount++;
  }

  stop(): void {
    this.capturing = false;
    this.onChunkCallback = null;
    this.stopCallCount++;
  }

  isCapturing(): boolean {
    return this.capturing;
  }

  /** Simulate an audio chunk from the system. */
  emitChunk(chunk: Buffer): void {
    if (this.onChunkCallback) {
      this.onChunkCallback(chunk);
    }
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AudioPipeline', () => {
  let capture: MockAudioCapture;
  let stt: MockSTTProvider;
  let transcript: TranscriptAccumulator;

  beforeEach(() => {
    capture = new MockAudioCapture();
    stt = new MockSTTProvider();
    transcript = new TranscriptAccumulator();
    transcript.startSession('test-session');
  });

  it('starts both capture and STT', async () => {
    const pipeline = new AudioPipeline(
      capture as unknown as SystemAudioCapture,
      stt,
      transcript,
    );

    await pipeline.start({}, {});

    assert.equal(pipeline.isRunning(), true);
    assert.equal(stt.startCallCount, 1);
    assert.equal(capture.startCallCount, 1);
  });

  it('stops both capture and STT', async () => {
    const pipeline = new AudioPipeline(
      capture as unknown as SystemAudioCapture,
      stt,
      transcript,
    );

    await pipeline.start({}, {});
    await pipeline.stop();

    assert.equal(pipeline.isRunning(), false);
    assert.equal(stt.stopCallCount, 1);
    assert.equal(capture.stopCallCount, 1);
  });

  it('routes audio chunks from capture to STT', async () => {
    const pipeline = new AudioPipeline(
      capture as unknown as SystemAudioCapture,
      stt,
      transcript,
    );

    await pipeline.start({}, {});

    // Simulate audio chunks
    capture.emitChunk(Buffer.alloc(3200));
    capture.emitChunk(Buffer.alloc(3200));
    capture.emitChunk(Buffer.alloc(3200));

    assert.equal(stt.feedCallCount, 3);
  });

  it('appends final STT results to transcript', async () => {
    const pipeline = new AudioPipeline(
      capture as unknown as SystemAudioCapture,
      stt,
      transcript,
    );

    await pipeline.start({}, {});

    stt.emitResult({
      text: 'Hello everyone',
      speaker: 'Speaker 0',
      isFinal: true,
      timestamp: new Date().toISOString(),
    });

    assert.equal(transcript.getCount(), 1);
    const lines = transcript.getAll();
    assert.equal(lines[0].speaker, 'Speaker 0');
    assert.equal(lines[0].text, 'Hello everyone');
  });

  it('ignores interim (non-final) STT results', async () => {
    const pipeline = new AudioPipeline(
      capture as unknown as SystemAudioCapture,
      stt,
      transcript,
    );

    await pipeline.start({}, {});

    stt.emitResult({
      text: 'Hello',
      isFinal: false,
      timestamp: new Date().toISOString(),
    });

    stt.emitResult({
      text: 'Hello ever',
      isFinal: false,
      timestamp: new Date().toISOString(),
    });

    assert.equal(transcript.getCount(), 0, 'Interim results should not be appended');
  });

  it('appends final results but not interim results', async () => {
    const pipeline = new AudioPipeline(
      capture as unknown as SystemAudioCapture,
      stt,
      transcript,
    );

    await pipeline.start({}, {});

    // Interim
    stt.emitResult({ text: 'Hel', isFinal: false, timestamp: new Date().toISOString() });
    // Final
    stt.emitResult({ text: 'Hello world', speaker: 'Speaker 1', isFinal: true, timestamp: new Date().toISOString() });
    // Interim
    stt.emitResult({ text: 'How', isFinal: false, timestamp: new Date().toISOString() });
    // Final
    stt.emitResult({ text: 'How are you', speaker: 'Speaker 0', isFinal: true, timestamp: new Date().toISOString() });

    assert.equal(transcript.getCount(), 2);
    assert.equal(transcript.getAll()[0].text, 'Hello world');
    assert.equal(transcript.getAll()[1].text, 'How are you');
  });

  it('defaults speaker to "Speaker" when not provided', async () => {
    const pipeline = new AudioPipeline(
      capture as unknown as SystemAudioCapture,
      stt,
      transcript,
    );

    await pipeline.start({}, {});

    stt.emitResult({
      text: 'No speaker label',
      isFinal: true,
      timestamp: new Date().toISOString(),
    });

    assert.equal(transcript.getAll()[0].speaker, 'Speaker');
  });

  it('fires language detection callback on first language result', async () => {
    let detectedLanguage: string | null = null;
    let callCount = 0;

    const pipeline = new AudioPipeline(
      capture as unknown as SystemAudioCapture,
      stt,
      transcript,
      (lang: string) => {
        detectedLanguage = lang;
        callCount++;
      },
    );

    await pipeline.start({}, {});

    // First result with language
    stt.emitResult({
      text: 'Olá',
      language: 'pt',
      isFinal: true,
      timestamp: new Date().toISOString(),
    });

    assert.equal(detectedLanguage, 'pt');
    assert.equal(callCount, 1);

    // Second result with different language — callback should NOT fire again
    stt.emitResult({
      text: 'Hello',
      language: 'en',
      isFinal: true,
      timestamp: new Date().toISOString(),
    });

    assert.equal(detectedLanguage, 'pt', 'Should keep first detected language');
    assert.equal(callCount, 1, 'Callback should only fire once');
  });

  it('does not fire language callback when language is not in result', async () => {
    let callCount = 0;

    const pipeline = new AudioPipeline(
      capture as unknown as SystemAudioCapture,
      stt,
      transcript,
      () => { callCount++; },
    );

    await pipeline.start({}, {});

    stt.emitResult({
      text: 'Hello',
      isFinal: true,
      timestamp: new Date().toISOString(),
    });

    assert.equal(callCount, 0);
  });

  it('reports provider name', async () => {
    const pipeline = new AudioPipeline(
      capture as unknown as SystemAudioCapture,
      stt,
      transcript,
    );

    assert.equal(pipeline.getProviderName(), 'MockSTT');
  });

  it('reports detected language as null before detection', () => {
    const pipeline = new AudioPipeline(
      capture as unknown as SystemAudioCapture,
      stt,
      transcript,
    );

    assert.equal(pipeline.getDetectedLanguage(), null);
  });

  it('ignores empty text in final results', async () => {
    const pipeline = new AudioPipeline(
      capture as unknown as SystemAudioCapture,
      stt,
      transcript,
    );

    await pipeline.start({}, {});

    stt.emitResult({
      text: '',
      isFinal: true,
      timestamp: new Date().toISOString(),
    });

    stt.emitResult({
      text: '   ',
      isFinal: true,
      timestamp: new Date().toISOString(),
    });

    assert.equal(transcript.getCount(), 0, 'Empty/whitespace-only results should be ignored');
  });
});
