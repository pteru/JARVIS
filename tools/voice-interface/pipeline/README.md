# JARVIS Voice Pipeline

Voice-activated assistant: wake word → speech-to-text → Claude → text-to-speech, with Energy Orb visual control.

## Prerequisites

1. **System deps:** `sudo apt-get install portaudio19-dev`
2. **API keys** in `~/.secrets/`:
   - `deepgram-api-key` — Deepgram Nova-2 STT
   - `picovoice-access-key` — Porcupine wake word (signup: console.picovoice.ai)
   - `elevenlabs-api-key` — ElevenLabs TTS (signup: elevenlabs.io)
3. **Porcupine keyword:** Place a `.ppn` file in `config/` (or use built-in "jarvis")

## Setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
```

## Run

```bash
# Start the voice pipeline
python -m src.main

# Or with the Energy Orb (in separate terminals):
# Terminal 1: Voice pipeline
python -m src.main
# Terminal 2: Orb (from tools/voice-interface/orb/)
npm run start
```

## How It Works

1. Say **"JARVIS"** → wake word triggers
2. Speak your question → Deepgram transcribes in real-time
3. Pause for 1 second → Claude generates a response
4. ElevenLabs speaks the response → audio plays through speakers
5. Energy Orb reflects the current state (idle → listening → thinking → speaking)

## Configuration

Edit `src/config.py` defaults or set API keys in `~/.secrets/`.

| Setting | Default | Description |
|---------|---------|-------------|
| `claude_model` | `sonnet` | Claude model for responses |
| `elevenlabs_voice_id` | `JBFqnCBsd6RMkjVDRZzb` | ElevenLabs voice (George) |
| `elevenlabs_model` | `eleven_turbo_v2_5` | TTS model (lowest latency) |
| `orb_ws_port` | `9000` | WebSocket port for orb bridge |
| `history_max_exchanges` | `10` | Conversation memory depth |
