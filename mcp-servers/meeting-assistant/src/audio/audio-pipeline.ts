/**
 * audio/audio-pipeline.ts
 *
 * Glue layer that connects SystemAudioCapture → STTProvider → TranscriptAccumulator.
 * Wires audio chunks from the system capture into the STT provider, and feeds
 * final transcription results into the transcript accumulator.
 */

import type { SystemAudioCapture, AudioCaptureConfig } from './system-capture.js';
import type { STTProvider, STTProviderConfig, STTResult } from '../stt/provider.js';
import type { TranscriptAccumulator } from '../transcript.js';

export class AudioPipeline {
  private running = false;
  private detectedLanguage: string | null = null;

  constructor(
    private capture: SystemAudioCapture,
    private stt: STTProvider,
    private transcript: TranscriptAccumulator,
    private onLanguageDetected?: (lang: string) => void,
  ) {}

  /**
   * Start the full pipeline: audio capture → STT → transcript.
   *
   * 1. Start the STT provider with the given config
   * 2. Start audio capture, piping chunks to stt.feedAudio()
   * 3. STT results flow to the transcript accumulator (final only)
   */
  async start(audioConfig: AudioCaptureConfig, sttConfig: STTProviderConfig): Promise<void> {
    if (this.running) {
      throw new Error('AudioPipeline is already running. Call stop() first.');
    }

    // Start STT first — it needs to be ready to receive audio
    await this.stt.start(sttConfig, (result: STTResult) => {
      this.handleSTTResult(result);
    });

    // Start audio capture, piping chunks to the STT provider
    await this.capture.start(audioConfig, (chunk: Buffer) => {
      this.stt.feedAudio(chunk);
    });

    this.running = true;
    console.error('[audio-pipeline] Started');
  }

  /** Stop the pipeline: stop capture first, then STT. */
  async stop(): Promise<void> {
    this.running = false;

    // Stop capture first to stop feeding audio
    this.capture.stop();

    // Then stop STT
    await this.stt.stop();

    console.error('[audio-pipeline] Stopped');
  }

  /** Whether the pipeline is currently running. */
  isRunning(): boolean {
    return this.running;
  }

  /** The language detected by the STT provider, or null if not yet detected. */
  getDetectedLanguage(): string | null {
    return this.detectedLanguage;
  }

  /** The name of the STT provider in use. */
  getProviderName(): string {
    return this.stt.name;
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private handleSTTResult(result: STTResult): void {
    // Only append final results to the transcript
    if (result.isFinal && result.text.trim()) {
      const speaker = result.speaker ?? 'Speaker';
      this.transcript.append(speaker, result.text);
    }

    // Fire language detection callback on first detection
    if (result.language && !this.detectedLanguage) {
      this.detectedLanguage = result.language;
      if (this.onLanguageDetected) {
        this.onLanguageDetected(result.language);
      }
    }
  }
}
