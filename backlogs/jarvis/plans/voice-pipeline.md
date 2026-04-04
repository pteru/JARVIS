# JARVIS Voice Pipeline Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a working voice loop — wake word detection → speech transcription → Claude response → spoken reply — with orb visual state control.

**Architecture:** Python async application using Porcupine for wake word, Deepgram Nova-2 for streaming STT, `claude --print` for LLM, ElevenLabs for streaming TTS, and a WebSocket server to drive the Energy Orb. All components wired through an async main loop.

**Tech Stack:** Python 3.12, pvporcupine, deepgram-sdk, elevenlabs, pyaudio, websockets

**Prerequisites (manual, before starting):**
1. Picovoice Console signup → AccessKey → save to `~/.secrets/picovoice-access-key`
2. Train custom "JARVIS" keyword at console.picovoice.ai → download `.ppn` file
3. ElevenLabs signup → API key → save to `~/.secrets/elevenlabs-api-key`
4. `sudo apt-get install portaudio19-dev` (for PyAudio compilation)

---

### Task 1: Project Scaffolding

**Files:**
- Create: `tools/voice-interface/pipeline/pyproject.toml`
- Create: `tools/voice-interface/pipeline/src/__init__.py`
- Create: `tools/voice-interface/pipeline/src/config.py`

**Step 1: Create pyproject.toml**

```toml
[project]
name = "jarvis-voice-pipeline"
version = "0.1.0"
description = "JARVIS Voice Interface — wake word, STT, LLM, TTS pipeline"
requires-python = ">=3.12"
dependencies = [
    "pvporcupine~=3.0",
    "deepgram-sdk~=3.0",
    "elevenlabs~=1.0",
    "pyaudio~=0.2.14",
    "websockets~=13.0",
]

[project.optional-dependencies]
dev = ["pytest~=8.0", "pytest-asyncio~=0.24"]

[project.scripts]
jarvis-voice = "src.main:cli_entry"
```

**Step 2: Create venv and install**

```bash
cd tools/voice-interface/pipeline
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
```

Expected: Clean install, all 5 dependencies resolve. PyAudio compiles against system portaudio.

**Step 3: Create `src/__init__.py`** (empty file)

**Step 4: Create `src/config.py`**

```python
"""Load API keys and pipeline configuration from ~/.secrets/ and defaults."""

from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class Config:
    deepgram_api_key: str = ""
    picovoice_access_key: str = ""
    elevenlabs_api_key: str = ""
    porcupine_keyword_path: str = ""
    elevenlabs_voice_id: str = "JBFqnCBsd6RMkjVDRZzb"  # "George" — deep British male
    elevenlabs_model: str = "eleven_turbo_v2_5"
    claude_model: str = "sonnet"
    mic_device_index: int | None = None  # None = system default
    sample_rate: int = 16000
    history_max_exchanges: int = 10
    orb_ws_port: int = 9000
    system_prompt_path: str = "config/system-prompt.md"

    @classmethod
    def load(cls, base_dir: Path | None = None) -> "Config":
        """Load config, reading API keys from ~/.secrets/ files."""
        secrets = Path.home() / ".secrets"
        base = base_dir or Path(__file__).parent.parent

        def read_secret(name: str) -> str:
            path = secrets / name
            if path.exists():
                return path.read_text().strip()
            return ""

        # Find .ppn file in config/ directory
        ppn_dir = base / "config"
        ppn_files = list(ppn_dir.glob("*.ppn")) if ppn_dir.exists() else []
        keyword_path = str(ppn_files[0]) if ppn_files else ""

        return cls(
            deepgram_api_key=read_secret("deepgram-api-key"),
            picovoice_access_key=read_secret("picovoice-access-key"),
            elevenlabs_api_key=read_secret("elevenlabs-api-key"),
            porcupine_keyword_path=keyword_path,
            system_prompt_path=str(base / "config" / "system-prompt.md"),
        )
```

**Step 5: Commit**

```bash
git add tools/voice-interface/pipeline/
git commit -m "feat(voice-pipeline): scaffold project with config loader"
```

---

### Task 2: Conversation History

**Files:**
- Create: `tools/voice-interface/pipeline/src/conversation.py`
- Create: `tools/voice-interface/pipeline/tests/test_conversation.py`

**Step 1: Write the failing test**

```python
"""Tests for conversation history management."""

import pytest
from src.conversation import Conversation


def test_empty_history():
    conv = Conversation(max_exchanges=5)
    assert conv.format_for_prompt() == ""
    assert len(conv) == 0


def test_add_exchange():
    conv = Conversation(max_exchanges=5)
    conv.add("Hello JARVIS", "Good evening, sir.")
    assert len(conv) == 1
    formatted = conv.format_for_prompt()
    assert "Hello JARVIS" in formatted
    assert "Good evening, sir." in formatted


def test_max_exchanges_truncation():
    conv = Conversation(max_exchanges=2)
    conv.add("First", "Reply 1")
    conv.add("Second", "Reply 2")
    conv.add("Third", "Reply 3")
    assert len(conv) == 2
    formatted = conv.format_for_prompt()
    assert "First" not in formatted
    assert "Second" in formatted
    assert "Third" in formatted


def test_clear():
    conv = Conversation(max_exchanges=5)
    conv.add("Hello", "Hi")
    conv.clear()
    assert len(conv) == 0
```

**Step 2: Run test to verify it fails**

```bash
cd tools/voice-interface/pipeline
source .venv/bin/activate
python -m pytest tests/test_conversation.py -v
```

Expected: FAIL — `ModuleNotFoundError: No module named 'src.conversation'`

**Step 3: Write implementation**

```python
"""In-memory conversation history with rolling window."""

from dataclasses import dataclass, field
from datetime import datetime, timezone


@dataclass
class Exchange:
    user: str
    assistant: str
    timestamp: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


class Conversation:
    def __init__(self, max_exchanges: int = 10):
        self._exchanges: list[Exchange] = []
        self._max = max_exchanges

    def add(self, user_text: str, assistant_text: str) -> None:
        self._exchanges.append(Exchange(user=user_text, assistant=assistant_text))
        if len(self._exchanges) > self._max:
            self._exchanges = self._exchanges[-self._max:]

    def format_for_prompt(self) -> str:
        if not self._exchanges:
            return ""
        lines = []
        for ex in self._exchanges:
            lines.append(f"User: {ex.user}")
            lines.append(f"JARVIS: {ex.assistant}")
        return "\n".join(lines)

    def clear(self) -> None:
        self._exchanges.clear()

    def __len__(self) -> int:
        return len(self._exchanges)
```

**Step 4: Run test to verify it passes**

```bash
python -m pytest tests/test_conversation.py -v
```

Expected: 4 passed

**Step 5: Commit**

```bash
git add tools/voice-interface/pipeline/src/conversation.py tools/voice-interface/pipeline/tests/
git commit -m "feat(voice-pipeline): add conversation history with rolling window"
```

---

### Task 3: LLM Integration (Claude CLI)

**Files:**
- Create: `tools/voice-interface/pipeline/src/llm.py`
- Create: `tools/voice-interface/pipeline/config/system-prompt.md`
- Create: `tools/voice-interface/pipeline/tests/test_llm.py`

**Step 1: Create the JARVIS system prompt**

```markdown
You are J.A.R.V.I.S. (Just A Rather Very Intelligent System), a voice assistant.

Rules:
- Address the user as "sir"
- Be politely formal yet witty — dry British humor, understated observations
- Keep responses concise — you are speaking aloud, not writing an essay
- Aim for 1-3 sentences unless the question demands more
- When reporting status, use phrasing like "All systems nominal, sir"
- When encountering problems, stay composed: "I'm afraid we have a slight complication, sir"
- Never use markdown formatting, bullet points, or code blocks — this is spoken dialogue
- Never use emojis
- Maintain full technical competence — the persona is flavor, never a barrier to precision
```

**Step 2: Write the failing test**

```python
"""Tests for LLM prompt building (not the subprocess call itself)."""

import pytest
from src.llm import build_prompt
from src.conversation import Conversation


def test_build_prompt_no_history():
    prompt = build_prompt(
        system_prompt="You are JARVIS.",
        user_text="Hello",
        conversation=Conversation(),
    )
    assert "You are JARVIS." in prompt
    assert "Hello" in prompt


def test_build_prompt_with_history():
    conv = Conversation()
    conv.add("What time is it?", "It's 3pm, sir.")
    prompt = build_prompt(
        system_prompt="You are JARVIS.",
        user_text="And the weather?",
        conversation=conv,
    )
    assert "What time is it?" in prompt
    assert "It's 3pm, sir." in prompt
    assert "And the weather?" in prompt
```

**Step 3: Run test to verify it fails**

```bash
python -m pytest tests/test_llm.py -v
```

Expected: FAIL — `cannot import name 'build_prompt'`

**Step 4: Write implementation**

```python
"""Claude CLI integration — build prompts and call claude --print."""

import asyncio
import logging
from datetime import datetime, timezone
from pathlib import Path

from .conversation import Conversation

logger = logging.getLogger(__name__)


def build_prompt(
    system_prompt: str,
    user_text: str,
    conversation: Conversation,
) -> str:
    """Build the full prompt for Claude, including system prompt, history, and current query."""
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    parts = [
        system_prompt.strip(),
        f"\nCurrent time: {now}",
    ]

    history = conversation.format_for_prompt()
    if history:
        parts.append(f"\nConversation so far:\n{history}")

    parts.append(f"\nUser: {user_text}")
    parts.append("\nRespond as JARVIS (spoken dialogue, concise):")

    return "\n".join(parts)


def load_system_prompt(path: str) -> str:
    """Load the system prompt from a markdown file."""
    p = Path(path)
    if p.exists():
        return p.read_text().strip()
    logger.warning("System prompt not found at %s, using default", path)
    return "You are JARVIS, a voice assistant. Address the user as sir. Be concise."


async def query_claude(prompt: str, model: str = "sonnet", timeout: float = 30.0) -> str:
    """Call claude --print and return the response text."""
    try:
        proc = await asyncio.create_subprocess_exec(
            "claude", "--print", "--model", model,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(
            proc.communicate(input=prompt.encode()),
            timeout=timeout,
        )
        if proc.returncode != 0:
            logger.error("claude --print failed: %s", stderr.decode().strip())
            return "I'm afraid I'm having a slight difficulty processing that, sir."
        return stdout.decode().strip()
    except asyncio.TimeoutError:
        logger.error("claude --print timed out after %.0fs", timeout)
        proc.kill()
        return "My apologies, sir. That took rather longer than expected."
    except FileNotFoundError:
        logger.error("claude CLI not found in PATH")
        return "I'm afraid the Claude CLI is not available at the moment, sir."
```

**Step 5: Run tests**

```bash
python -m pytest tests/test_llm.py -v
```

Expected: 2 passed

**Step 6: Commit**

```bash
git add tools/voice-interface/pipeline/src/llm.py tools/voice-interface/pipeline/config/ tools/voice-interface/pipeline/tests/test_llm.py
git commit -m "feat(voice-pipeline): add Claude CLI integration and system prompt"
```

---

### Task 4: Orb Bridge (WebSocket Server)

**Files:**
- Create: `tools/voice-interface/pipeline/src/orb_bridge.py`
- Create: `tools/voice-interface/pipeline/tests/test_orb_bridge.py`

**Step 1: Write the failing test**

```python
"""Tests for orb WebSocket bridge."""

import asyncio
import json
import pytest
import pytest_asyncio
import websockets
from src.orb_bridge import OrbBridge


@pytest_asyncio.fixture
async def bridge():
    b = OrbBridge(port=9876)  # test port
    await b.start()
    yield b
    await b.stop()


@pytest.mark.asyncio
async def test_state_change(bridge):
    """Connect a client and verify it receives state messages."""
    received = []

    async with websockets.connect("ws://localhost:9876/orb") as ws:
        await bridge.set_state("listening")
        msg = await asyncio.wait_for(ws.recv(), timeout=2.0)
        data = json.loads(msg)
        assert data["state"] == "listening"


@pytest.mark.asyncio
async def test_amplitude(bridge):
    """Verify amplitude messages are sent."""
    async with websockets.connect("ws://localhost:9876/orb") as ws:
        await bridge.send_amplitude(0.73)
        msg = await asyncio.wait_for(ws.recv(), timeout=2.0)
        data = json.loads(msg)
        assert data["amplitude"] == pytest.approx(0.73, abs=0.01)
```

**Step 2: Run test to verify it fails**

```bash
python -m pytest tests/test_orb_bridge.py -v
```

Expected: FAIL — `cannot import name 'OrbBridge'`

**Step 3: Write implementation**

```python
"""WebSocket server that sends state/amplitude updates to the Energy Orb."""

import asyncio
import json
import logging
from websockets.asyncio.server import serve, ServerConnection

logger = logging.getLogger(__name__)


class OrbBridge:
    def __init__(self, port: int = 9000):
        self._port = port
        self._clients: set[ServerConnection] = set()
        self._server = None
        self._current_state = "idle"

    async def _handler(self, websocket: ServerConnection) -> None:
        self._clients.add(websocket)
        remote = websocket.remote_address
        logger.info("Orb client connected: %s", remote)
        # Send current state on connect
        await websocket.send(json.dumps({"state": self._current_state}))
        try:
            async for _ in websocket:
                pass  # We don't expect inbound messages, but keep connection alive
        finally:
            self._clients.discard(websocket)
            logger.info("Orb client disconnected: %s", remote)

    async def start(self) -> None:
        self._server = await serve(self._handler, "0.0.0.0", self._port)
        logger.info("Orb bridge listening on ws://0.0.0.0:%d/orb", self._port)

    async def stop(self) -> None:
        if self._server:
            self._server.close()
            await self._server.wait_closed()

    async def _broadcast(self, message: dict) -> None:
        if not self._clients:
            return
        payload = json.dumps(message)
        dead = set()
        for ws in self._clients:
            try:
                await ws.send(payload)
            except Exception:
                dead.add(ws)
        self._clients -= dead

    async def set_state(self, state: str) -> None:
        self._current_state = state
        await self._broadcast({"state": state})

    async def send_amplitude(self, amplitude: float) -> None:
        await self._broadcast({"amplitude": round(amplitude, 3)})

    async def send_alert(self, source: str, level: str) -> None:
        await self._broadcast({"alert": source, "level": level})
```

**Step 4: Run tests**

```bash
python -m pytest tests/test_orb_bridge.py -v
```

Expected: 2 passed

**Step 5: Commit**

```bash
git add tools/voice-interface/pipeline/src/orb_bridge.py tools/voice-interface/pipeline/tests/test_orb_bridge.py
git commit -m "feat(voice-pipeline): add WebSocket orb bridge for state/amplitude"
```

---

### Task 5: Audio Capture & Playback

**Files:**
- Create: `tools/voice-interface/pipeline/src/audio.py`

**Note:** Audio hardware cannot be unit tested. This task is verified manually.

**Step 1: Write implementation**

```python
"""PyAudio mic capture and speaker playback."""

import asyncio
import logging
import struct
import math
from collections.abc import AsyncIterator
from typing import Callable

import pyaudio

logger = logging.getLogger(__name__)

RATE = 16000
CHANNELS = 1
FORMAT = pyaudio.paInt16
PORCUPINE_FRAME_LENGTH = 512  # Porcupine requires exactly 512 samples at 16kHz


class MicStream:
    """Continuous microphone capture yielding PCM frames."""

    def __init__(self, device_index: int | None = None, frame_length: int = PORCUPINE_FRAME_LENGTH):
        self._pa = pyaudio.PyAudio()
        self._frame_length = frame_length
        self._stream = self._pa.open(
            rate=RATE,
            channels=CHANNELS,
            format=FORMAT,
            input=True,
            input_device_index=device_index,
            frames_per_buffer=frame_length,
        )
        logger.info("Mic stream opened (device=%s, frame_length=%d)", device_index, frame_length)

    def read_frame(self) -> bytes:
        """Read one frame of PCM audio (blocking). Returns raw bytes."""
        return self._stream.read(self._frame_length, exception_on_overflow=False)

    def read_pcm_int16(self) -> list[int]:
        """Read one frame as list of int16 values (for Porcupine)."""
        frame = self.read_frame()
        return list(struct.unpack(f"{self._frame_length}h", frame))

    def close(self) -> None:
        self._stream.stop_stream()
        self._stream.close()
        self._pa.terminate()
        logger.info("Mic stream closed")


class Speaker:
    """Audio playback via PyAudio."""

    def __init__(self, sample_rate: int = 24000, channels: int = 1):
        self._pa = pyaudio.PyAudio()
        self._rate = sample_rate
        self._channels = channels
        self._stream = self._pa.open(
            rate=sample_rate,
            channels=channels,
            format=pyaudio.paInt16,
            output=True,
        )
        logger.info("Speaker opened (rate=%d)", sample_rate)

    def play_chunk(self, audio_bytes: bytes) -> float:
        """Play a chunk of PCM audio. Returns RMS amplitude (0.0-1.0)."""
        self._stream.write(audio_bytes)
        return compute_rms(audio_bytes)

    def close(self) -> None:
        self._stream.stop_stream()
        self._stream.close()
        self._pa.terminate()
        logger.info("Speaker closed")


def compute_rms(audio_bytes: bytes) -> float:
    """Compute RMS amplitude of PCM16 audio, normalized to 0.0-1.0."""
    n_samples = len(audio_bytes) // 2
    if n_samples == 0:
        return 0.0
    samples = struct.unpack(f"{n_samples}h", audio_bytes)
    rms = math.sqrt(sum(s * s for s in samples) / n_samples)
    return min(rms / 32768.0, 1.0)
```

**Step 2: Manual verification**

```bash
python -c "
from src.audio import MicStream
mic = MicStream()
print('Recording 1 second...')
for _ in range(31):  # ~1s at 512 samples / 16kHz
    frame = mic.read_frame()
    print(f'  frame: {len(frame)} bytes')
mic.close()
print('Done')
"
```

Expected: 31 frames of 1024 bytes each (512 samples * 2 bytes/sample), no errors.

**Step 3: Commit**

```bash
git add tools/voice-interface/pipeline/src/audio.py
git commit -m "feat(voice-pipeline): add PyAudio mic capture and speaker playback"
```

---

### Task 6: Wake Word Detection

**Files:**
- Create: `tools/voice-interface/pipeline/src/wake_word.py`

**Prerequisite:** Picovoice AccessKey in `~/.secrets/picovoice-access-key` and a `.ppn` keyword file in `tools/voice-interface/pipeline/config/`.

**Step 1: Write implementation**

```python
"""Porcupine wake word detection wrapper."""

import logging
import pvporcupine

logger = logging.getLogger(__name__)


class WakeWordDetector:
    """Listens for the 'JARVIS' wake word using Porcupine."""

    def __init__(self, access_key: str, keyword_path: str):
        if not access_key:
            raise ValueError("Picovoice access key is required")

        # Use custom keyword if provided, otherwise fall back to built-in "jarvis"
        if keyword_path:
            self._porcupine = pvporcupine.create(
                access_key=access_key,
                keyword_paths=[keyword_path],
            )
            logger.info("Porcupine initialized with custom keyword: %s", keyword_path)
        else:
            self._porcupine = pvporcupine.create(
                access_key=access_key,
                keywords=["jarvis"],
            )
            logger.info("Porcupine initialized with built-in 'jarvis' keyword")

    @property
    def frame_length(self) -> int:
        return self._porcupine.frame_length

    @property
    def sample_rate(self) -> int:
        return self._porcupine.sample_rate

    def process(self, pcm_frame: list[int]) -> bool:
        """Process a single audio frame. Returns True if wake word detected."""
        result = self._porcupine.process(pcm_frame)
        return result >= 0

    def close(self) -> None:
        self._porcupine.delete()
        logger.info("Porcupine released")
```

**Step 2: Manual verification**

```bash
python -c "
from src.config import Config
from src.audio import MicStream
from src.wake_word import WakeWordDetector

cfg = Config.load()
detector = WakeWordDetector(cfg.picovoice_access_key, cfg.porcupine_keyword_path)
mic = MicStream(frame_length=detector.frame_length)

print(f'Listening for JARVIS... (say it now)')
for _ in range(500):  # ~16 seconds
    pcm = mic.read_pcm_int16()
    if detector.process(pcm):
        print('*** JARVIS detected! ***')
        break
else:
    print('No detection in 16 seconds')

mic.close()
detector.close()
"
```

Expected: Prints "JARVIS detected!" when you say the wake word.

**Step 3: Commit**

```bash
git add tools/voice-interface/pipeline/src/wake_word.py
git commit -m "feat(voice-pipeline): add Porcupine wake word detector"
```

---

### Task 7: Deepgram Streaming STT

**Files:**
- Create: `tools/voice-interface/pipeline/src/stt.py`

**Step 1: Write implementation**

```python
"""Deepgram Nova-2 streaming speech-to-text."""

import asyncio
import logging
from deepgram import DeepgramClient, LiveOptions, LiveTranscriptionEvents

logger = logging.getLogger(__name__)


class StreamingSTT:
    """Streams mic audio to Deepgram and returns the final transcript."""

    def __init__(self, api_key: str):
        if not api_key:
            raise ValueError("Deepgram API key is required")
        self._client = DeepgramClient(api_key)
        self._transcript_parts: list[str] = []
        self._done_event: asyncio.Event | None = None
        self._connection = None

    async def transcribe(self, mic_read_fn, timeout: float = 15.0) -> str:
        """
        Start streaming transcription. Reads mic frames via mic_read_fn().
        Returns the final transcript when the user stops speaking.

        Args:
            mic_read_fn: Callable that returns raw PCM bytes (blocking OK, run in executor)
            timeout: Max seconds to listen before giving up
        """
        self._transcript_parts = []
        self._done_event = asyncio.Event()

        options = LiveOptions(
            model="nova-2",
            encoding="linear16",
            sample_rate=16000,
            channels=1,
            smart_format=True,
            endpointing=1000,  # 1s silence = done
            utterance_end_ms=1500,
        )

        self._connection = self._client.listen.live.v("1")

        # Register event handlers
        self._connection.on(LiveTranscriptionEvents.Transcript, self._on_transcript)
        self._connection.on(LiveTranscriptionEvents.UtteranceEnd, self._on_utterance_end)
        self._connection.on(LiveTranscriptionEvents.Error, self._on_error)

        if not self._connection.start(options):
            logger.error("Failed to start Deepgram connection")
            return ""

        logger.info("Deepgram STT streaming started")

        # Stream mic audio in a background task
        loop = asyncio.get_event_loop()
        stream_task = asyncio.create_task(self._stream_audio(mic_read_fn, loop))

        try:
            await asyncio.wait_for(self._done_event.wait(), timeout=timeout)
        except asyncio.TimeoutError:
            logger.warning("STT timed out after %.0fs", timeout)
        finally:
            stream_task.cancel()
            self._connection.finish()

        transcript = " ".join(self._transcript_parts).strip()
        logger.info("Transcript: %s", transcript)
        return transcript

    async def _stream_audio(self, mic_read_fn, loop: asyncio.AbstractEventLoop) -> None:
        """Read mic frames and send to Deepgram."""
        try:
            while not self._done_event.is_set():
                frame = await loop.run_in_executor(None, mic_read_fn)
                self._connection.send(frame)
        except asyncio.CancelledError:
            pass

    def _on_transcript(self, _self, result, **kwargs) -> None:
        transcript = result.channel.alternatives[0].transcript
        if transcript and result.is_final:
            self._transcript_parts.append(transcript)
            logger.debug("Final: %s", transcript)

    def _on_utterance_end(self, _self, result, **kwargs) -> None:
        logger.debug("Utterance end detected")
        if self._done_event and self._transcript_parts:
            self._done_event.set()

    def _on_error(self, _self, error, **kwargs) -> None:
        logger.error("Deepgram error: %s", error)
        if self._done_event:
            self._done_event.set()
```

**Step 2: Manual verification**

```bash
python -c "
import asyncio
from src.config import Config
from src.audio import MicStream
from src.stt import StreamingSTT

async def test():
    cfg = Config.load()
    mic = MicStream()
    stt = StreamingSTT(cfg.deepgram_api_key)
    print('Speak now (listening for 10s max)...')
    transcript = await stt.transcribe(mic.read_frame, timeout=10.0)
    print(f'You said: {transcript}')
    mic.close()

asyncio.run(test())
"
```

Expected: Your spoken words appear as transcript text.

**Step 3: Commit**

```bash
git add tools/voice-interface/pipeline/src/stt.py
git commit -m "feat(voice-pipeline): add Deepgram Nova-2 streaming STT"
```

---

### Task 8: ElevenLabs TTS with Amplitude

**Files:**
- Create: `tools/voice-interface/pipeline/src/tts.py`

**Step 1: Write implementation**

```python
"""ElevenLabs streaming text-to-speech with amplitude extraction."""

import logging
from typing import Callable

from elevenlabs import ElevenLabs
from .audio import Speaker, compute_rms

logger = logging.getLogger(__name__)


class TextToSpeech:
    """Stream text to ElevenLabs and play audio with amplitude callbacks."""

    def __init__(self, api_key: str, voice_id: str, model: str = "eleven_turbo_v2_5"):
        if not api_key:
            raise ValueError("ElevenLabs API key is required")
        self._client = ElevenLabs(api_key=api_key)
        self._voice_id = voice_id
        self._model = model
        self._speaker = Speaker(sample_rate=24000, channels=1)
        logger.info("ElevenLabs TTS initialized (voice=%s, model=%s)", voice_id, model)

    def speak(
        self,
        text: str,
        on_amplitude: Callable[[float], None] | None = None,
    ) -> None:
        """
        Convert text to speech, play it, and report amplitude per chunk.

        Args:
            text: The text to speak
            on_amplitude: Optional callback receiving RMS amplitude (0.0-1.0) per chunk
        """
        logger.info("Speaking: %s", text[:80])

        audio_stream = self._client.text_to_speech.convert(
            text=text,
            voice_id=self._voice_id,
            model_id=self._model,
            output_format="pcm_24000",
        )

        for chunk in audio_stream:
            if chunk:
                amplitude = self._speaker.play_chunk(chunk)
                if on_amplitude:
                    on_amplitude(amplitude)

    def close(self) -> None:
        self._speaker.close()
        logger.info("TTS closed")
```

**Step 2: Manual verification**

```bash
python -c "
from src.config import Config
from src.tts import TextToSpeech

cfg = Config.load()
tts = TextToSpeech(cfg.elevenlabs_api_key, cfg.elevenlabs_voice_id)
tts.speak('Good evening, sir. All systems nominal.', on_amplitude=lambda a: print(f'  amp: {a:.3f}'))
tts.close()
"
```

Expected: Hear "Good evening, sir. All systems nominal." spoken aloud. Amplitude values printed.

**Step 3: Commit**

```bash
git add tools/voice-interface/pipeline/src/tts.py
git commit -m "feat(voice-pipeline): add ElevenLabs streaming TTS with amplitude"
```

---

### Task 9: Main Loop — Wire Everything Together

**Files:**
- Create: `tools/voice-interface/pipeline/src/main.py`
- Create: `tools/voice-interface/pipeline/README.md`

**Step 1: Write the main orchestrator**

```python
"""JARVIS Voice Pipeline — main async loop wiring all components."""

import asyncio
import logging
import signal
import sys
from pathlib import Path

from .config import Config
from .audio import MicStream
from .wake_word import WakeWordDetector
from .stt import StreamingSTT
from .llm import build_prompt, load_system_prompt, query_claude
from .tts import TextToSpeech
from .orb_bridge import OrbBridge
from .conversation import Conversation

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("jarvis")


class JarvisVoice:
    def __init__(self, config: Config):
        self.cfg = config
        self.conversation = Conversation(max_exchanges=config.history_max_exchanges)
        self.system_prompt = load_system_prompt(config.system_prompt_path)
        self.running = False

        # Components initialized in start()
        self.mic: MicStream | None = None
        self.wake: WakeWordDetector | None = None
        self.stt: StreamingSTT | None = None
        self.tts: TextToSpeech | None = None
        self.orb: OrbBridge | None = None

    async def start(self) -> None:
        """Initialize all components and start the main loop."""
        logger.info("Initializing JARVIS Voice Pipeline...")

        # Orb bridge (WebSocket server)
        self.orb = OrbBridge(port=self.cfg.orb_ws_port)
        await self.orb.start()

        # Audio
        self.mic = MicStream(device_index=self.cfg.mic_device_index)

        # Wake word
        self.wake = WakeWordDetector(
            access_key=self.cfg.picovoice_access_key,
            keyword_path=self.cfg.porcupine_keyword_path,
        )

        # STT
        self.stt = StreamingSTT(api_key=self.cfg.deepgram_api_key)

        # TTS
        self.tts = TextToSpeech(
            api_key=self.cfg.elevenlabs_api_key,
            voice_id=self.cfg.elevenlabs_voice_id,
            model=self.cfg.elevenlabs_model,
        )

        await self.orb.set_state("idle")
        logger.info("All systems online. Listening for wake word...")
        self.running = True

        try:
            await self._main_loop()
        finally:
            await self.shutdown()

    async def _main_loop(self) -> None:
        """Main loop: wake → listen → think → speak → repeat."""
        loop = asyncio.get_event_loop()

        while self.running:
            # 1. Listen for wake word (blocking reads in executor)
            pcm = await loop.run_in_executor(None, self.mic.read_pcm_int16)
            if not self.wake.process(pcm):
                continue

            # 2. Wake word detected!
            logger.info("Wake word detected!")
            await self.orb.set_state("listening")

            # 3. Transcribe speech
            transcript = await self.stt.transcribe(self.mic.read_frame, timeout=15.0)
            if not transcript:
                logger.info("No speech detected, returning to idle")
                await self.orb.set_state("idle")
                continue

            logger.info("User said: %s", transcript)

            # 4. Think — query Claude
            await self.orb.set_state("thinking")
            prompt = build_prompt(self.system_prompt, transcript, self.conversation)
            response = await query_claude(prompt, model=self.cfg.claude_model)
            logger.info("JARVIS: %s", response)

            # 5. Speak — TTS with amplitude to orb
            await self.orb.set_state("speaking")

            def on_amplitude(amp: float) -> None:
                asyncio.run_coroutine_threadsafe(
                    self.orb.send_amplitude(amp),
                    loop,
                )

            await loop.run_in_executor(None, self.tts.speak, response, on_amplitude)

            # 6. Save to history and return to idle
            self.conversation.add(transcript, response)
            await self.orb.set_state("idle")
            logger.info("Ready for next command")

    async def shutdown(self) -> None:
        """Clean up all resources."""
        self.running = False
        logger.info("Shutting down...")
        if self.tts:
            self.tts.close()
        if self.wake:
            self.wake.close()
        if self.mic:
            self.mic.close()
        if self.orb:
            await self.orb.stop()
        logger.info("Goodbye, sir.")


def cli_entry() -> None:
    """CLI entry point."""
    config = Config.load(base_dir=Path(__file__).parent.parent)
    jarvis = JarvisVoice(config)

    loop = asyncio.new_event_loop()

    def handle_signal(*_):
        jarvis.running = False

    signal.signal(signal.SIGINT, handle_signal)
    signal.signal(signal.SIGTERM, handle_signal)

    try:
        loop.run_until_complete(jarvis.start())
    except KeyboardInterrupt:
        loop.run_until_complete(jarvis.shutdown())
    finally:
        loop.close()


if __name__ == "__main__":
    cli_entry()
```

**Step 2: Write README**

```markdown
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
```

**Step 3: Commit**

```bash
git add tools/voice-interface/pipeline/src/main.py tools/voice-interface/pipeline/README.md
git commit -m "feat(voice-pipeline): add main loop wiring all components"
```

---

### Task 10: End-to-End Smoke Test

**Step 1: Verify all API keys are in place**

```bash
ls -la ~/.secrets/deepgram-api-key ~/.secrets/picovoice-access-key ~/.secrets/elevenlabs-api-key
```

Expected: All three files exist with correct permissions.

**Step 2: Run the full pipeline**

```bash
cd tools/voice-interface/pipeline
source .venv/bin/activate
python -m src.main
```

Expected output:
```
HH:MM:SS [jarvis] INFO: Initializing JARVIS Voice Pipeline...
HH:MM:SS [jarvis] INFO: Orb bridge listening on ws://0.0.0.0:9000/orb
HH:MM:SS [jarvis] INFO: Mic stream opened (device=None, frame_length=512)
HH:MM:SS [jarvis] INFO: Porcupine initialized with built-in 'jarvis' keyword
HH:MM:SS [jarvis] INFO: ElevenLabs TTS initialized (voice=..., model=...)
HH:MM:SS [jarvis] INFO: All systems online. Listening for wake word...
```

**Step 3: Test the conversation**

1. Say "JARVIS" → should print "Wake word detected!"
2. Say "Good evening" → should print transcript
3. Wait for Claude response → should hear JARVIS speak back
4. Ctrl+C → should shut down gracefully

**Step 4: Test with the orb (optional)**

In a second terminal:
```bash
cd tools/voice-interface/orb
npm start
```

The orb should cycle through idle → listening → thinking → speaking as you interact with the pipeline.

**Step 5: Final commit**

```bash
git add -A tools/voice-interface/pipeline/
git commit -m "chore(voice-pipeline): finalize v0.1.0 with smoke test verification"
```

---

## Execution Notes

- **Tasks 1-4** are testable without API keys (pure logic, unit tests, local WebSocket)
- **Tasks 5-8** require hardware + API keys (manual verification only)
- **Task 9** wires everything — requires all API keys and hardware
- **Task 10** is the end-to-end smoke test
- The `conftest.py` or `pytest.ini` should set the Python path so `from src.X import Y` works in tests. Add `pythonpath = .` to `pyproject.toml` under `[tool.pytest.ini_options]`.
