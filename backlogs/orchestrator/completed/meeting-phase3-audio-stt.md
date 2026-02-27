# Task: Meeting Assistant Phase 3 — PipeWire Audio Capture + Deepgram Nova-2 STT

## Context

You are extending an existing Meeting Assistant MCP server at `mcp-servers/meeting-assistant/`.
The server already has Phases 1-2 implemented:
- Phase 1: Manual transcript injection (`inject_transcript`), live Google Doc notes, 30s update cycle
- Phase 2: Post-meeting structured minutes, action items extraction, session persistence

**Your task:** Add real-time audio capture from PipeWire/PulseAudio and Deepgram Nova-2 streaming STT.
This replaces the manual `inject_transcript` workflow with automatic audio → text → transcript pipeline.

## Existing Architecture

Read these files first to understand the current codebase:
- `mcp-servers/meeting-assistant/src/index.ts` — MCP server with 7 tools
- `mcp-servers/meeting-assistant/src/transcript.ts` — TranscriptAccumulator class
- `mcp-servers/meeting-assistant/src/live-notes.ts` — Live notes 30s update engine
- `mcp-servers/meeting-assistant/src/minutes-generator.ts` — Post-meeting minutes generator
- `mcp-servers/meeting-assistant/src/gdoc-bridge.ts` — Google Docs API wrapper
- `mcp-servers/meeting-assistant/package.json` — Current dependencies
- `config/meeting-assistant.json` — Configuration (already has STT section)

The TranscriptAccumulator already has the `append(speaker, text)` method that STT results feed into.

## New Files to Create

### 1. `src/stt/provider.ts` — STT Provider Interface

```typescript
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
```

### 2. `src/stt/deepgram.ts` — Deepgram Nova-2 WebSocket Streaming

Use `@deepgram/sdk` v3+ (the official SDK). Key implementation details:

- Connect via WebSocket using `createClient().listen.live()`
- Audio format: PCM 16-bit, 16kHz, mono (what pw-record produces)
- Enable: `model: "nova-2"`, `smart_format: true`, `diarize: true`, `language: "multi"` (auto-detect)
- Listen for `Transcription` events — extract `.channel.alternatives[0]`
- Map Deepgram speaker labels ("Speaker 0") to the STTResult interface
- Extract detected language from metadata
- Handle WebSocket reconnection on disconnect
- Implement keepalive pings

```typescript
import { createClient, LiveTranscriptionEvents } from '@deepgram/sdk';
```

### 3. `src/audio/system-capture.ts` — PipeWire/PulseAudio Audio Capture

Captures system audio output using PipeWire's `pw-record` or PulseAudio's `parec`.
This captures whatever audio is playing on the system (meeting call audio).

Key implementation details:

- **Auto-detect** PipeWire vs PulseAudio: check if `pw-record` exists, fall back to `parec`
- **PipeWire command:** `pw-record --format=s16 --rate=16000 --channels=1 --target=<monitor-source> -`
  - The `-` at the end means output to stdout (raw PCM)
  - Monitor source: use `pw-record --list-targets` to find the monitor source, or use default
- **PulseAudio command:** `parec --format=s16le --rate=16000 --channels=1 --device=<monitor-source>`
  - Find monitor: `pactl list short sources | grep monitor`
- Spawn as child process, pipe stdout to a callback
- Buffer audio in chunks (e.g., 100ms = 3200 bytes at 16kHz 16-bit mono)
- Emit chunks via callback: `onAudioChunk(buffer: Buffer)`
- Handle process errors, restart on crash
- Provide `start()` and `stop()` lifecycle methods

```typescript
export interface AudioCaptureConfig {
  sampleRate?: number;     // Default: 16000
  channels?: number;       // Default: 1 (mono)
  chunkDurationMs?: number; // Default: 100ms
  device?: string;         // Specific PipeWire/PulseAudio source (auto-detect if omitted)
}

export class SystemAudioCapture {
  start(config: AudioCaptureConfig, onChunk: (chunk: Buffer) => void): Promise<void>;
  stop(): void;
  isCapturing(): boolean;
}
```

### 4. `src/audio/audio-pipeline.ts` — Wires Audio → STT → Transcript

This is the glue that connects audio capture to STT to the transcript accumulator.

```typescript
export class AudioPipeline {
  constructor(
    private capture: SystemAudioCapture,
    private stt: STTProvider,
    private transcript: TranscriptAccumulator,
    private onLanguageDetected?: (lang: string) => void,
  ) {}

  async start(audioConfig: AudioCaptureConfig, sttConfig: STTProviderConfig): Promise<void>;
  async stop(): Promise<void>;
  isRunning(): boolean;
}
```

Pipeline flow:
1. `capture.start()` → audio chunks flow via callback
2. Each chunk → `stt.feedAudio(chunk)`
3. STT `onResult` callback:
   - If `result.isFinal` → `transcript.append(result.speaker ?? 'Speaker', result.text)`
   - If `result.language` and first detection → call `onLanguageDetected`
4. `stop()` → `capture.stop()` + `stt.stop()`

## Modifications to Existing Files

### 5. `src/index.ts` — Add audio source to start_meeting

Modify `start_meeting` to accept an optional `source` parameter:

```typescript
{
  name: 'start_meeting',
  inputSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Meeting title' },
      source: {
        type: 'string',
        enum: ['manual', 'system_audio'],
        description: 'Audio source. "manual" = inject_transcript only (default). "system_audio" = capture system audio via PipeWire/PulseAudio + Deepgram STT.',
      },
    },
  },
}
```

When `source: 'system_audio'`:
1. Load STT config from `config/meeting-assistant.json`
2. Create `SystemAudioCapture` + `DeepgramSTT` + `AudioPipeline`
3. Start the pipeline (audio → STT → transcript accumulator)
4. The live-notes engine still runs on its 30s cycle reading from the transcript accumulator
5. `inject_transcript` still works alongside (for manual corrections)
6. `stop_meeting` also stops the audio pipeline

When `source: 'manual'` (or omitted): current behavior, no audio capture.

Also add a new tool:

```typescript
{
  name: 'get_audio_status',
  description: 'Check the status of the audio capture pipeline. Returns whether audio is being captured, the STT provider, detected language, and audio device info.',
  inputSchema: { type: 'object', properties: {}, required: [] },
}
```

Update `get_meeting_status` to include audio pipeline status (capturing, stt provider, detected language) when active.

Update the `MeetingConfig` interface to include STT config:
```typescript
interface MeetingConfig {
  live_notes: { ... };
  stt: {
    default_provider: string;
    deepgram: {
      api_key_env: string;
      model: string;
      language: string;
      diarize: boolean;
    };
  };
}
```

### 6. `package.json` — Add Deepgram SDK dependency

```json
"dependencies": {
  "@deepgram/sdk": "^3.0.0",
  "@modelcontextprotocol/sdk": "^1.0.0",
  "googleapis": "^144.0.0"
}
```

## Unit Tests

### 7. `test/stt-provider.test.ts`

Test the STTResult and STTProvider contracts:
- STTResult fields are correctly typed
- DeepgramSTT implements STTProvider interface
- DeepgramSTT handles missing API key gracefully (throws clear error)
- DeepgramSTT constructs correct WebSocket options from config

### 8. `test/system-capture.test.ts`

Test SystemAudioCapture command construction:
- Builds correct `pw-record` command with expected flags
- Builds correct `parec` fallback command
- Handles missing `pw-record` and `parec` (throws clear error)
- Chunk buffering logic (accumulates until chunkDurationMs worth of data)

### 9. `test/audio-pipeline.test.ts`

Test AudioPipeline wiring:
- STT results flow to transcript accumulator
- Only `isFinal` results are appended to transcript
- Interim results are ignored
- Language detection callback fires on first language result
- Pipeline start/stop lifecycle

## Important Implementation Notes

1. **Deepgram SDK v3 API**: Use `createClient(apiKey)` not the old `new Deepgram()`. The live transcription API is at `client.listen.live()`.

2. **Audio format consistency**: PipeWire/PulseAudio must output raw PCM s16le at 16kHz mono. Deepgram expects this format. Configure both sides identically.

3. **Error handling**: If Deepgram connection fails (no API key, network error), log the error and fall back gracefully — the meeting should still work via manual `inject_transcript`. Never crash the MCP server.

4. **Environment variable for API key**: Read from `process.env[config.stt.deepgram.api_key_env]` (default: `DEEPGRAM_API_KEY`). If not set, throw a clear error when attempting to start with `source: 'system_audio'`.

5. **Speaker labels**: Deepgram diarization produces "Speaker 0", "Speaker 1", etc. Map these to the speaker field in TranscriptLine. Users can later rename speakers via inject_transcript or doc edits.

6. **Keep inject_transcript working**: Even when audio capture is active, manual inject_transcript should still work. This allows users to add corrections or notes that aren't spoken.

7. **Build must pass**: Run `npm run build` (TypeScript compilation) and `npm test` before committing. All existing tests must still pass.

8. **Follow existing code style**: Look at how live-notes.ts and minutes-generator.ts are structured. Use the same patterns (private methods, console.error for logging, try/catch with clear error messages).

## Deliverables

1. New files: `src/stt/provider.ts`, `src/stt/deepgram.ts`, `src/audio/system-capture.ts`, `src/audio/audio-pipeline.ts`
2. Modified: `src/index.ts` (new source param, get_audio_status tool, pipeline lifecycle)
3. Modified: `package.json` (add @deepgram/sdk)
4. New tests: `test/stt-provider.test.ts`, `test/system-capture.test.ts`, `test/audio-pipeline.test.ts`
5. All existing tests still pass
6. Clean TypeScript build (`npm run build`)
7. Write REPORT.md with summary of changes, new files, and testing notes
