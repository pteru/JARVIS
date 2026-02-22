/**
 * stt/deepgram.ts
 *
 * Deepgram Nova-2 streaming STT provider.
 * Connects via WebSocket using the official @deepgram/sdk v3.
 * Expects raw PCM 16-bit, 16kHz, mono audio input.
 */

import { createClient, LiveTranscriptionEvents } from '@deepgram/sdk';
import type { ListenLiveClient } from '@deepgram/sdk';
import type { STTProvider, STTProviderConfig, STTResult } from './provider.js';

export class DeepgramSTT implements STTProvider {
  readonly name = 'Deepgram Nova-2';

  private connection: ListenLiveClient | null = null;
  private streaming = false;
  private keepAliveTimer: NodeJS.Timeout | null = null;

  async start(config: STTProviderConfig, onResult: (result: STTResult) => void): Promise<void> {
    if (this.streaming) {
      throw new Error('DeepgramSTT is already streaming. Call stop() first.');
    }

    const apiKeyEnv = config.apiKeyEnv ?? 'DEEPGRAM_API_KEY';
    const apiKey = process.env[apiKeyEnv];
    if (!apiKey) {
      throw new Error(
        `Deepgram API key not found. Set the ${apiKeyEnv} environment variable.`,
      );
    }

    const client = createClient(apiKey);

    const language = config.language ?? 'multi';
    const model = config.model ?? 'nova-2';
    const diarize = config.diarize ?? true;

    this.connection = client.listen.live({
      model,
      language,
      smart_format: true,
      diarize,
      interim_results: true,
      utterance_end_ms: 1000,
      encoding: 'linear16',
      sample_rate: 16000,
      channels: 1,
    });

    const conn = this.connection;

    // Wait for the connection to open
    await new Promise<void>((resolve, reject) => {
      const openTimeout = setTimeout(() => {
        reject(new Error('DeepgramSTT: WebSocket connection timed out after 10s'));
      }, 10_000);

      conn.on(LiveTranscriptionEvents.Open, () => {
        clearTimeout(openTimeout);
        this.streaming = true;
        console.error('[deepgram-stt] WebSocket connected');
        resolve();
      });

      conn.on(LiveTranscriptionEvents.Error, (error: Error) => {
        clearTimeout(openTimeout);
        if (!this.streaming) {
          reject(new Error(`DeepgramSTT: Connection failed — ${error.message}`));
        } else {
          console.error('[deepgram-stt] WebSocket error:', error.message);
        }
      });
    });

    // Listen for transcription results
    conn.on(LiveTranscriptionEvents.Transcript, (event: unknown) => {
      try {
        const result = this.parseTranscriptionEvent(event);
        if (result) {
          onResult(result);
        }
      } catch (err) {
        console.error('[deepgram-stt] Error parsing transcription event:', err);
      }
    });

    conn.on(LiveTranscriptionEvents.Close, () => {
      console.error('[deepgram-stt] WebSocket closed');
      this.streaming = false;
      this.stopKeepAlive();
    });

    // Send keepalive pings every 8 seconds to maintain the connection
    this.startKeepAlive();
  }

  feedAudio(chunk: Buffer): void {
    if (!this.connection || !this.streaming) return;
    // Convert Buffer to ArrayBuffer for Deepgram's SocketDataLike type
    this.connection.send(chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength));
  }

  async stop(): Promise<void> {
    this.stopKeepAlive();

    if (this.connection && this.streaming) {
      try {
        this.connection.requestClose();
      } catch {
        // Connection may already be closed
      }
    }

    this.connection = null;
    this.streaming = false;
    console.error('[deepgram-stt] Stopped');
  }

  isStreaming(): boolean {
    return this.streaming;
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /**
   * Parse a Deepgram LiveTranscriptionEvent into our STTResult interface.
   * Returns null for empty/irrelevant events.
   */
  private parseTranscriptionEvent(event: unknown): STTResult | null {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const evt = event as any;
    if (!evt?.channel?.alternatives?.length) return null;

    const alt = evt.channel.alternatives[0];
    const transcript = alt.transcript?.trim();
    if (!transcript) return null;

    const isFinal = evt.is_final === true;

    // Extract speaker from the first word's speaker field (diarization)
    let speaker: string | undefined;
    if (alt.words?.length > 0 && alt.words[0].speaker !== undefined) {
      speaker = `Speaker ${alt.words[0].speaker}`;
    }

    // Extract detected language from words
    let language: string | undefined;
    if (alt.languages?.length > 0) {
      language = alt.languages[0];
    } else if (alt.words?.length > 0 && alt.words[0].language) {
      language = alt.words[0].language;
    }

    const confidence = typeof alt.confidence === 'number' ? alt.confidence : undefined;

    return {
      text: transcript,
      speaker,
      language,
      confidence,
      isFinal,
      timestamp: new Date().toISOString(),
    };
  }

  private startKeepAlive(): void {
    this.stopKeepAlive();
    this.keepAliveTimer = setInterval(() => {
      if (this.connection && this.streaming) {
        try {
          this.connection.keepAlive();
        } catch {
          // Ignore keepalive errors
        }
      }
    }, 8_000);
  }

  private stopKeepAlive(): void {
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
  }
}
