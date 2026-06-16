# Meeting Assistant

## Purpose
Real-time meeting assistance MCP server that captures audio (via PipeWire/PulseAudio system audio capture), transcribes speech using Deepgram Nova-2 STT with speaker diarization, accumulates transcript lines, generates live notes in a Google Doc, and produces structured meeting minutes upon session end. Supports both automatic audio capture and manual transcript injection modes.

## MCP Tools
- **start_meeting** — Create a Google Doc and start the live-notes update cycle; accepts `source: 'system_audio'` for automatic audio capture or `'manual'` for inject-only mode
- **stop_meeting** — Stop the update cycle, generate meeting minutes in a separate Google Doc, return both doc URLs
- **inject_transcript** — Manually append a timestamped line to the transcript accumulator
- **get_meeting_status** — Get current session info (duration, line count, audio pipeline status)
- **list_meetings** — List past sessions from the sessions index
- **get_action_items** — Extract action items from the latest minutes doc
- **create_tasks_from_meeting** — Write extracted action items to a product backlog markdown file
- **get_audio_status** — Check audio capture pipeline status (PipeWire, Deepgram connection, buffer stats)

## Tech Stack
- TypeScript (compiled to JS), Node.js (ESM)
- @modelcontextprotocol/sdk, googleapis, @deepgram/sdk
- PipeWire/PulseAudio for system audio capture
- Build: `tsc` with output to `dist/src/`

## Configuration
- Config file: `config/meeting-assistant.json` (update interval, model, Drive ID, STT settings)
- Session data: `data/meetings/{date}/{sessionId}.{transcript.jsonl|meta.json}`
- Sessions index: `data/meetings/sessions.json`
- Google Docs folder: "Meeting Assistant" on JARVIS Shared Drive (`0AC4RjZu6DAzcUk9PVA`)
- Deepgram API key: `DEEPGRAM_API_KEY` env var (key file at `~/.secrets/deepgram-api-key`)
- MCP entry point: `dist/src/index.js` (not `dist/index.js` due to rootDir config)

## Integration Points
- Uses google-workspace service account for Google Docs creation and updates
- Backlogs written to `backlogs/products/<workspace>.md` via create_tasks_from_meeting
- Audio pipeline: SystemAudioCapture -> DeepgramSTT -> TranscriptAccumulator -> LiveNotesEngine -> GDocBridge

## Key Files
- `src/index.ts` — Main MCP server with tool definitions and session management
- `src/gdoc-bridge.ts` — Google Docs API wrapper
- `src/transcript.ts` — Transcript line accumulator
- `src/live-notes.ts` — Periodic live-notes update engine
- `src/minutes-generator.ts` — Meeting minutes generation
- `src/audio/system-capture.ts` — PipeWire/PulseAudio system audio capture
- `src/audio/audio-pipeline.ts` — Audio capture orchestration
- `src/stt/deepgram.ts` — Deepgram STT provider
- `src/stt/provider.ts` — STT provider interface (swappable)
