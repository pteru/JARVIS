"""JARVIS Voice Pipeline — main async loop wiring all components."""

import asyncio
import logging
import signal
from pathlib import Path

from .config import Config
from .audio import MicStream
from .wake_word import WakeWordDetector
from .stt import StreamingSTT
from .llm import load_system_prompt, query_claude
from .tts import TextToSpeech
from .orb_bridge import OrbBridge
from .conversation import Conversation
from .session import VoiceSession, detect_meta_command

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
        self.session = VoiceSession()
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
        logger.info("Session ID: %s", self.session.session_id[:8])

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
        """Main loop: wake -> listen -> think -> speak -> repeat."""
        import time as _time
        loop = asyncio.get_event_loop()

        while self.running:
            # 1. Listen for wake word (blocking reads in executor)
            pcm = await loop.run_in_executor(None, self.mic.read_pcm_int16)
            if not self.wake.process(pcm):
                continue

            # 2. Wake word detected
            logger.info("Wake word detected!")
            await self.orb.set_state("listening")

            # 3. Transcribe speech
            t0 = _time.monotonic()
            transcript = await self.stt.transcribe(self.mic.read_frame, timeout=10.0)
            t1 = _time.monotonic()
            logger.info("⏱ STT took %.1fs", t1 - t0)
            if not transcript:
                logger.info("No speech detected, returning to idle")
                await self.orb.set_state("idle")
                continue

            logger.info("User said: %s", transcript)

            # 4. Check for meta-commands (new session, clear history)
            meta_cmd = detect_meta_command(transcript)
            if meta_cmd:
                response = self._handle_meta_command(meta_cmd)
            else:
                # 5. Think — query Claude with session persistence
                await self.orb.set_state("thinking")
                t2 = _time.monotonic()
                response = await query_claude(
                    transcript,
                    session=self.session,
                    system_prompt=self.system_prompt,
                    model=self.cfg.claude_model,
                )
                t3 = _time.monotonic()
                logger.info("⏱ LLM took %.1fs (turn %d)", t3 - t2, self.session.turn_count)

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
            logger.info("Ready for next command (session %s, turn %d)",
                        self.session.session_id[:8], self.session.turn_count)

    def _handle_meta_command(self, command: str) -> str:
        """Handle voice meta-commands (new session, clear history, etc.)."""
        if command == "new_session":
            self.session.reset()
            self.conversation.clear()
            logger.info("Meta-command: new session started")
            return "Very well, sir. Fresh session initialized. How may I assist you?"

        if command == "clear_history":
            self.session.reset()
            self.conversation.clear()
            logger.info("Meta-command: history cleared")
            return "Conversation history cleared, sir. Starting with a clean slate."

        logger.warning("Unknown meta-command: %s", command)
        return "I'm not quite sure what you're asking me to do, sir."

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
