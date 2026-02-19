# JARVIS Voice Interface

## Overview
Voice-activated conversational interface for JARVIS with Paul Bettany's JARVIS voice and a reactive visual identity (energy orb).

## Architecture

```
[Mic] → Porcupine ("JARVIS") → faster-whisper (STT) → Claude → ElevenLabs/XTTS (TTS) → [Speaker]
                                                                        ↓
                                                              [Visual Orb — WebGL]
```

## Components

### 1. Wake Word Detection
- **Porcupine** (Picovoice) — custom "JARVIS" keyword model (`.ppn`)
- Runs on background thread, near-zero CPU
- Plays acknowledgment chime on detection

### 2. Speech-to-Text
- **Primary**: `faster-whisper` (local, `medium` model, ~1-2s latency)
- **Alt**: Deepgram API (streaming, sub-300ms, costs money)
- VAD (Voice Activity Detection) for automatic endpoint detection (silero-vad)

### 3. LLM Processing
- **Option A**: `claude -p` CLI (no API billing, ~2-3s)
- **Option B**: Anthropic API with streaming (lower latency, first token ~1s, but costs money)
- System prompt includes JARVIS persona + current context (time, active alerts, deployment status)
- Conversation history maintained in-memory for multi-turn dialogue

### 4. Text-to-Speech (JARVIS Voice)

**Option A — ElevenLabs (best quality, easiest)**
- Clone JARVIS voice from 3-5 min of isolated MCU dialogue
- Professional Voice Clone plan (~$5/mo)
- Streaming API → ~500ms to first audio
- Total latency: ~3-4s wake-to-speech

**Option B — Local (free, offline, GPU required)**
- XTTS v2 or Fish Speech for base TTS (voice cloning from 6s reference)
- RVC v2 for voice conversion refinement (train on ~10min of JARVIS audio)
- Pipeline: text → XTTS → RVC → speaker
- Total latency: ~4-6s (depends on GPU)

### 5. Reactive Visual Identity — Energy Orb

A floating, semi-transparent energy sphere rendered in WebGL/Three.js, displayed on a dedicated screen or browser window.

**Visual states:**

| State | Color | Behavior |
|-------|-------|----------|
| Idle | Soft white/silver, slow pulse | Gentle breathing animation, barely visible particle trails |
| Listening | Blue glow, expanding rings | Orb expands slightly, surface ripples outward from center |
| Thinking | Amber/gold, swirling particles | Internal rotation accelerates, particles orbit faster |
| Speaking | Cyan/teal, pulsing with amplitude | Orb surface deforms in sync with audio waveform (FFT analysis) |
| Alert | Red pulse | Sharp spikes on surface, urgent particle bursts |
| Healthy | Green shimmer (brief) | Smooth pulse after confirming "all systems nominal" |

**Technical approach:**
- Three.js with custom GLSL shaders for organic deformation
- Audio analyzer (Web Audio API `AnalyserNode`) drives orb displacement in real-time
- Simplex noise for organic surface movement
- Bloom post-processing for the glow effect
- WebSocket connection to Python orchestrator for state changes
- Particle system (instanced meshes) for ambient floating particles
- Runs in fullscreen Electron window or browser tab

**Inspiration references:**
- MCU JARVIS holographic interface (blue-white energy aesthetic)
- iOS Siri orb animation (fluid, responsive)
- Cortana's ring in Halo (color-coded emotional states)

## Python Orchestrator (Main Loop)

```python
# Pseudocode
class JarvisVoice:
    def __init__(self):
        self.wake = pvporcupine.create(keyword_paths=["jarvis.ppn"])
        self.stt = faster_whisper.WhisperModel("medium")
        self.tts = elevenlabs.ElevenLabs(voice_id="jarvis_clone")
        self.orb = WebSocketClient("ws://localhost:9000/orb")  # visual state
        self.history = []

    def run(self):
        while True:
            if self.detect_wake_word():
                self.orb.send({"state": "listening"})
                audio = self.record_until_silence()

                self.orb.send({"state": "thinking"})
                text = self.stt.transcribe(audio)
                response = self.query_claude(text)

                self.orb.send({"state": "speaking"})
                for chunk in self.tts.stream(response):
                    self.play_audio(chunk)
                    self.orb.send({"amplitude": get_rms(chunk)})

                self.orb.send({"state": "idle"})
```

## Voice Training Data Sources
- MCU Iron Man 1/2/3, Avengers 1/2 — JARVIS dialogue (isolate from soundtrack)
- Paul Bettany interviews (clean audio, natural voice)
- Behind-the-scenes featurettes and commentary tracks
- Fan-made voice isolations (YouTube, various quality)
- Use audio separation tools (Demucs, UVR5) to isolate vocals from music/SFX

## Hardware
- Microphone: Any decent USB mic (Blue Yeti, etc.) or ReSpeaker array for far-field
- Speaker: Good desktop speakers or smart speaker for clear voice output
- GPU: Required for local pipeline (XTTS + RVC). Not needed for ElevenLabs path.
- Optional: Dedicated small display for the orb (old tablet, small monitor)

## Implementation Phases

### Phase 1: Voice Pipeline (MVP)
- Wake word + Whisper STT + Claude CLI + ElevenLabs TTS
- Terminal-based, no visual
- Test latency and conversation flow

### Phase 2: Visual Orb
- Three.js orb with idle/listening/thinking/speaking states
- WebSocket bridge from Python orchestrator
- Audio amplitude → orb deformation in real-time

### Phase 3: Context Integration
- Inject JARVIS context: current VK health status, pending alerts, backlog summary
- "JARVIS, how's VisionKing doing?" → reads latest health report
- "JARVIS, any new PRs?" → checks pr-inbox.json

### Phase 4: Ambient Mode
- Always-on display with orb in idle state
- Proactive spoken alerts (critical Telegram alerts → spoken notification)
- Time-aware greetings ("Good morning, sir. All systems nominal.")

## Estimated Effort
- Phase 1: 1-2 days
- Phase 2: 2-3 days (Three.js shader work)
- Phase 3: 1 day (mostly prompt engineering)
- Phase 4: 1 day
