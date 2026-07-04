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

### Phase 5: Active Session Tracker
- Real-time tracking of all active Claude Code sessions/projects
- Overlay panel in the visual identity (sidebar or floating HUD)
- Shows: running sessions, loaded skills per session, current workspace, resource usage
- Voice-queryable: "JARVIS, what sessions are running?" → spoken summary

## Estimated Effort
- Phase 1: 1-2 days
- Phase 2: 2-3 days (Three.js shader work)
- Phase 3: 1 day (mostly prompt engineering)
- Phase 4: 1 day
- Phase 5: 1-2 days (session tracking addendum)

---

## Addendum: Active Session Tracker (Phase 5)

### Summary

Extension to the JARVIS Voice+Visual Interface that adds real-time tracking of active Claude Code sessions and projects. The visual identity (energy orb) gains an overlay panel showing session status, and voice queries can retrieve session information.

### Problem Statement

When multiple Claude Code sessions run concurrently (health monitoring cron, PR reviews, dispatched tasks, interactive sessions), there's no unified view of:
1. Which sessions are currently active
2. What each session is working on (workspace, task)
3. Which skills are loaded in each session
4. Resource consumption (tokens used, duration, memory)
5. Whether sessions are idle, waiting for input, or actively processing

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│ Session Discovery Layer                                         │
│                                                                 │
│  Option A: Parse claude agent output files                      │
│    /tmp/claude-1000/*/tasks/*.output → extract session metadata  │
│                                                                 │
│  Option B: Process table scan                                   │
│    ps aux | grep 'claude' → extract PIDs, working dirs, uptime  │
│                                                                 │
│  Option C: Dispatch log monitoring (preferred)                  │
│    logs/dispatches.json → active dispatches (status=running)     │
│    + ps scan for interactive sessions not in dispatch log        │
│                                                                 │
└───────────────┬─────────────────────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────────────────────────────┐
│ Session State Aggregator (Python, runs as background thread)    │
│                                                                 │
│  sessions = [                                                   │
│    {                                                            │
│      "id": "sess-abc123",                                       │
│      "type": "interactive" | "cron" | "dispatch",               │
│      "workspace": "strokmatic.visionking",                      │
│      "task": "Health check 03002",                              │
│      "status": "running" | "waiting" | "idle",                  │
│      "skills_loaded": ["/vk-health", "/jarvis"],                │
│      "pid": 12345,                                              │
│      "started_at": "2026-02-20T14:30:00Z",                     │
│      "duration": "4m 23s",                                      │
│      "tokens_used": 8432,                                       │
│      "model": "opus"                                            │
│    },                                                           │
│    ...                                                          │
│  ]                                                              │
│                                                                 │
└───────────────┬─────────────────────────────────────────────────┘
                │ WebSocket (state updates every 5s)
                ▼
┌─────────────────────────────────────────────────────────────────┐
│ Visual Overlay (Three.js / HTML)                                │
│                                                                 │
│  ┌──────────────────────────────────┐                           │
│  │ ACTIVE SESSIONS (3)             │                           │
│  │                                  │                           │
│  │ ● Health Check 03002    4m 23s  │  ← green dot = running    │
│  │   visionking · opus · /vk-health│                           │
│  │                                  │                           │
│  │ ● PR Review SF-backend  1m 02s  │                           │
│  │   spotfusion · haiku · /pr-rev  │                           │
│  │                                  │                           │
│  │ ○ Interactive session   idle     │  ← hollow = waiting       │
│  │   diemaster · opus · /jarvis    │                           │
│  └──────────────────────────────────┘                           │
│                                                                 │
│  Position: right side panel, semi-transparent, auto-hides       │
│  Shows on voice query or hover, fades after 10s                 │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Voice Queries

| Query | Response |
|-------|----------|
| "What sessions are running?" | "Three sessions active, sir. A VisionKing health check running for 4 minutes on Opus, a SpotFusion PR review just started on Haiku, and your interactive DieMaster session is idle." |
| "How's the health check going?" | "The 03002 health check has been running for 4 minutes, 8,400 tokens consumed. No alerts triggered yet." |
| "Kill the PR review" | "I'm afraid I'd need your explicit confirmation to terminate the SpotFusion PR review, sir. It's currently mid-analysis. Shall I proceed?" |
| "Show me active sessions" | (Visual overlay appears for 15s with session cards) |

### Session Discovery — Implementation

**Primary method**: Hybrid of dispatch log + process scan:

```python
import subprocess
import json
from pathlib import Path

def discover_sessions():
    sessions = []

    # 1. Active dispatches from log
    dispatches = json.loads(Path("logs/dispatches.json").read_text())
    for d in dispatches:
        if d.get("status") == "running":
            sessions.append({
                "type": "dispatch",
                "workspace": d["workspace"],
                "task": d["task"],
                "model": d["model"],
                "started_at": d["started_at"],
                "pid": d.get("pid")
            })

    # 2. Process scan for interactive/cron sessions
    ps_output = subprocess.check_output(
        ["ps", "aux"], text=True
    )
    for line in ps_output.split("\n"):
        if "claude" in line and "--print" not in line:
            # Parse PID, working directory, uptime
            pid = extract_pid(line)
            cwd = readlink(f"/proc/{pid}/cwd")
            # Skip if already in dispatch list
            if not any(s["pid"] == pid for s in sessions):
                sessions.append({
                    "type": "interactive",
                    "workspace": resolve_workspace(cwd),
                    "pid": pid,
                    "cwd": cwd
                })

    return sessions
```

### Skill Detection

Detect loaded skills by reading the session's output or checking process environment:

```python
def detect_skills(session):
    # Read from agent task output if available
    output_dir = Path(f"/tmp/claude-1000/{session['cwd_hash']}/tasks/")
    if output_dir.exists():
        for output_file in output_dir.glob("*.output"):
            content = output_file.read_text()
            # Look for skill invocation patterns
            skills = re.findall(r'Launching skill: (\w+)', content)
            return list(set(skills))
    return []
```

### Complexity Analysis

| Aspect | Rating | Notes |
|--------|--------|-------|
| **Scope** | Medium | Process discovery + aggregation + visual overlay |
| **Risk** | Low | Read-only monitoring, no impact on running sessions |
| **Dependencies** | Phase 2 (Visual Orb) | Overlay renders alongside the orb |
| **Testing** | Medium | Need multiple concurrent sessions to test |

**Overall Complexity: Medium (~6-8 hours)**

### Development Steps

1. **Session discovery module** (2h) — dispatch log parser + process scanner
2. **State aggregator** (1-2h) — background thread, WebSocket emitter
3. **Visual overlay component** (2-3h) — HTML/CSS overlay panel, auto-hide behavior
4. **Voice query handlers** (1h) — add session-related intents to voice pipeline

### References

- Claude agent output: `/tmp/claude-1000/*/tasks/*.output`
- Dispatch log: `logs/dispatches.json`
- Process table: `ps aux | grep claude` or `/proc/{pid}/`
- Existing orb WebSocket: `ws://localhost:9000/orb`
