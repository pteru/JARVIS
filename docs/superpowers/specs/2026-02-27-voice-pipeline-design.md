---
type: Design Spec
title: JARVIS Voice Pipeline — Design Document
description: Python-based voice pipeline for the JARVIS assistant. Listens for a 'JARVIS' wake word via Porcupine, transcribes speech with Deepgram Nova-2 streaming STT, generates responses through `claude --pr...
timestamp: 2026-02-27
---

# JARVIS Voice Pipeline — Design Document

**Date:** 2026-02-27
**Status:** Approved
**Component:** Voice Interface — Phase 1 (MVP)

## Overview

Python-based voice pipeline for the JARVIS assistant. Listens for a "JARVIS" wake word via Porcupine, transcribes speech with Deepgram Nova-2 streaming STT, generates responses through `claude --print`, and speaks them back via ElevenLabs streaming TTS. Controls the Energy Orb visual state over WebSocket.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Location | `tools/voice-interface/pipeline/` | Sibling to orb, grouped under voice-interface |
| Language | Python 3.12 | Best library ecosystem for audio (PyAudio, Porcupine, Deepgram SDK) |
| Wake word | Porcupine (Picovoice) | Near-zero CPU, custom keywords, free tier for personal use |
| STT | Deepgram Nova-2 streaming | Sub-300ms latency, existing API key, proven in meeting-assistant |
| LLM | `claude --print` CLI | No API billing, consistent with JARVIS automation patterns |
| TTS | ElevenLabs streaming | Best voice quality, ~500ms to first audio, voice cloning available |
| Orb coupling | WebSocket server on port 9000 | TTS-agnostic amplitude data, orb connects as client |

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  Python Voice Orchestrator (async main loop)                     │
│                                                                  │
│  ┌─────────┐    ┌──────────┐    ┌───────┐    ┌──────────────┐  │
│  │Porcupine│───▶│ Deepgram │───▶│Claude │───▶│ ElevenLabs   │  │
│  │Wake Word│    │ STT      │    │ CLI   │    │ TTS          │  │
│  │(always) │    │(on wake) │    │--print│    │ (streaming)  │  │
│  └─────────┘    └──────────┘    └───────┘    └──────┬───────┘  │
│       ↑              ↑                              │          │
│       │              │                              ▼          │
│  ┌────┴────┐   ┌─────┴─────┐                 ┌──────────┐     │
│  │ PyAudio │   │ Deepgram  │                 │ PyAudio  │     │
│  │ Mic     │   │ WebSocket │                 │ Speaker  │     │
│  │ Stream  │   │ Streaming │                 │ Playback │     │
│  └─────────┘   └───────────┘                 └──────────┘     │
│                                                                │
│  WebSocket Server (ws://localhost:9000/orb) ──────────────────▶│ Orb
│    sends: { state, amplitude }                                 │
└──────────────────────────────────────────────────────────────────┘
```

## Flow

1. **Idle** — Porcupine processes mic frames continuously (~0% CPU). Orb shows `idle`.
2. **Wake** — "JARVIS" detected. Play acknowledgment chime. Orb → `listening`. Open Deepgram WebSocket.
3. **Listen** — Forward mic audio to Deepgram. Transcribe in real-time. Endpointing detects 1s silence → finalize.
4. **Think** — Orb → `thinking`. Pipe full transcript to `claude --print` with JARVIS system prompt + conversation history.
5. **Speak** — Orb → `speaking`. Stream Claude response text to ElevenLabs. Play audio chunks via PyAudio. Send per-chunk RMS amplitude to orb WebSocket.
6. **Done** — Orb → `idle`. Append exchange to conversation history. Resume Porcupine.

## Components

### 1. Mic Capture (`audio.py`)

- PyAudio stream: 16kHz, mono, 16-bit PCM
- Shared between Porcupine (always consuming frames) and Deepgram (on demand)
- Porcupine needs 512-sample frames at 16kHz
- Deepgram needs raw PCM chunks (any size, typically 100ms)
- Speaker output via separate PyAudio stream for TTS playback

### 2. Wake Word (`wake_word.py`)

- `pvporcupine.create(access_key, keyword_paths=["jarvis.ppn"])`
- Processes 512-sample frames from mic stream
- Returns keyword index on detection
- Runs in main async loop (non-blocking frame processing)
- Picovoice free tier: 3 custom keywords, personal use

### 3. Speech-to-Text (`stt.py`)

- Deepgram Python SDK v3, live transcription WebSocket
- Model: `nova-2`, encoding: `linear16`, sample_rate: 16000
- Features: smart_format, endpointing (1000ms), utterance_end
- Only active between wake detection and endpointing
- Returns final transcript text

### 4. LLM Integration (`llm.py`)

- Subprocess: `echo "$prompt" | claude --print --model sonnet`
- System prompt loaded from `config/system-prompt.md` (JARVIS persona, current time, context)
- Conversation history: last 10 exchanges appended to prompt
- Capture stdout as response text
- Timeout: 30 seconds

### 5. Text-to-Speech (`tts.py`)

- `elevenlabs` Python SDK with streaming
- Default voice initially (e.g., "Adam" or "Antoni"), swap to cloned voice later
- Stream audio chunks to PyAudio output
- Calculate RMS amplitude per chunk → send to orb bridge
- Model: `eleven_turbo_v2_5` for lowest latency

### 6. Orb Bridge (`orb_bridge.py`)

- `websockets` async server on `ws://localhost:9000/orb`
- Sends JSON messages: `{ "state": "listening" }`, `{ "amplitude": 0.73 }`
- Multiple clients supported (orb + future session tracker)
- State transitions triggered by pipeline events

### 7. Conversation History (`conversation.py`)

- In-memory list of `{ role, content }` dicts
- Max 10 exchanges (20 messages) before oldest are dropped
- Serialized into prompt context for Claude
- Reset on explicit command or after 30 min idle

### 8. Configuration (`config.py`)

- Load API keys from `~/.secrets/` (deepgram, picovoice, elevenlabs)
- Load system prompt from `config/system-prompt.md`
- Configurable: mic device index, model, voice ID, history length

## File Structure

```
tools/voice-interface/pipeline/
├── pyproject.toml              # Dependencies, project metadata
├── src/
│   ├── __init__.py
│   ├── main.py                 # Async main loop, component wiring
│   ├── wake_word.py            # Porcupine wrapper
│   ├── stt.py                  # Deepgram streaming client
│   ├── llm.py                  # Claude CLI subprocess
│   ├── tts.py                  # ElevenLabs streaming + playback
│   ├── audio.py                # PyAudio mic capture + speaker output
│   ├── orb_bridge.py           # WebSocket server for orb state
│   ├── conversation.py         # Conversation history management
│   └── config.py               # Load API keys, settings
├── config/
│   └── system-prompt.md        # JARVIS persona prompt
└── README.md
```

## API Keys & Secrets

| Secret | File | Status |
|--------|------|--------|
| Deepgram | `~/.secrets/deepgram-api-key` | Exists |
| Picovoice | `~/.secrets/picovoice-access-key` | Needs signup |
| ElevenLabs | `~/.secrets/elevenlabs-api-key` | Needs signup |

## Dependencies

```
pvporcupine ~= 3.0
deepgram-sdk ~= 3.0
elevenlabs ~= 1.0
pyaudio ~= 0.2.14
websockets ~= 13.0
```

System dependencies: `portaudio19-dev` (for PyAudio compilation).

## Scope Boundaries

**In scope:** Wake word → STT → LLM → TTS → orb state control. Working end-to-end voice loop.

**Out of scope:** Context integration (health/PR queries), ambient mode, session tracker, voice cloning setup.
