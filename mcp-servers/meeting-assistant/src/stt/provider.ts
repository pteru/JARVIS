/**
 * stt/provider.ts
 *
 * Speech-to-text provider interface for the Meeting Assistant.
 * Defines the contract that all STT backends (Deepgram, Whisper, etc.) must implement.
 * Audio format expectation: PCM 16-bit, 16kHz, mono (raw s16le).
 */

export interface STTResult {
  text: string;
  speaker?: string;       // From diarization (e.g. "Speaker 0", "Speaker 1")
  language?: string;       // Detected language code (e.g. "en", "pt", "es")
  confidence?: number;     // 0-1 confidence score
  isFinal: boolean;        // true = final transcript, false = interim
  timestamp: string;       // ISO 8601
}

export interface STTProviderConfig {
  apiKeyEnv?: string;      // Environment variable name for API key
  model?: string;          // Model name (e.g. "nova-2")
  language?: string;       // Language code or "multi" for auto-detect
  diarize?: boolean;       // Enable speaker diarization
}

export interface STTProvider {
  /** Human-readable provider name */
  readonly name: string;

  /** Start streaming — call onResult for each transcript chunk */
  start(config: STTProviderConfig, onResult: (result: STTResult) => void): Promise<void>;

  /** Feed raw audio data (PCM 16-bit, 16kHz, mono) */
  feedAudio(chunk: Buffer): void;

  /** Stop streaming and clean up */
  stop(): Promise<void>;

  /** Whether the provider is currently streaming */
  isStreaming(): boolean;
}
