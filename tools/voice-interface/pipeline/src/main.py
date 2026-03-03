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
from .session import SessionManager, parse_voice_command

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

        # Session manager with persistent storage
        data_dir = Path(config.sessions_data_dir)
        self.sessions = SessionManager(data_dir)
        self.sessions.ensure_active()

        # Components initialized in start()
        self.mic: MicStream | None = None
        self.wake: WakeWordDetector | None = None
        self.stt: StreamingSTT | None = None
        self.tts: TextToSpeech | None = None
        self.orb: OrbBridge | None = None

    async def start(self) -> None:
        """Initialize all components and start the main loop."""
        logger.info("Initializing JARVIS Voice Pipeline...")
        active = self.sessions.active
        logger.info("Active session: '%s' (%s, %d turns)",
                     active.name, active.id[:8], active.turn_count)

        # Orb bridge (WebSocket server)
        self.orb = OrbBridge(port=self.cfg.orb_ws_port)
        self.orb.set_command_handler(self._handle_orb_command)
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
        await self._broadcast_sessions()
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
            logger.info("STT took %.1fs", t1 - t0)
            if not transcript:
                logger.info("No speech detected, returning to idle")
                await self.orb.set_state("idle")
                continue

            logger.info("User said: %s", transcript)

            # 4. Check for voice commands (session management)
            cmd = parse_voice_command(transcript)
            if cmd:
                response = await self._handle_command(cmd.action, cmd.param)
            else:
                # 5. Think — query Claude with session persistence
                await self.orb.set_state("thinking")
                session = self.sessions.active
                t2 = _time.monotonic()
                response = await query_claude(
                    transcript,
                    session=session,
                    system_prompt=self.system_prompt,
                    model=self.cfg.claude_model,
                )
                t3 = _time.monotonic()
                logger.info("LLM took %.1fs (session '%s', turn %d)",
                            t3 - t2, session.name, session.turn_count)

            logger.info("JARVIS: %s", response)

            # 6. Speak — TTS with amplitude to orb
            await self.orb.set_state("speaking")

            def on_amplitude(amp: float) -> None:
                asyncio.run_coroutine_threadsafe(
                    self.orb.send_amplitude(amp),
                    loop,
                )

            await loop.run_in_executor(None, self.tts.speak, response, on_amplitude)

            # 7. Save to local history and return to idle
            self.conversation.add(transcript, response)
            await self.orb.set_state("idle")
            session = self.sessions.active
            logger.info("Ready (session '%s', turn %d)", session.name, session.turn_count)

    async def _handle_command(self, action: str, param: str | None) -> str:
        """Handle voice commands for session management."""

        if action == "create_session":
            name = param or "Untitled"
            name = " ".join(w.capitalize() for w in name.split())
            self.sessions.create_session(name)
            self.conversation.clear()
            await self._broadcast_sessions()
            return f"New session created: {name}. Ready for your instructions, sir."

        if action == "switch_session":
            if not param:
                return "Which session would you like to switch to, sir?"
            session = self.sessions.switch_to(param)
            if session:
                await self._broadcast_sessions()
                return f"Switched to session {session.name}, sir. Turn {session.turn_count}."
            return f"I couldn't find a session matching {param}, sir."

        if action == "list_sessions":
            sessions = self.sessions.list_sessions()
            if not sessions:
                return "No sessions available, sir."
            if len(sessions) == 1:
                s = sessions[0]
                return f"One session active: {s.name}, {s.turn_count} turns, {s.state}."
            parts = []
            for s in sessions[:5]:
                parts.append(f"{s.name}, {s.state}")
            return f"You have {len(sessions)} sessions, sir. " + ". ".join(parts) + "."

        if action == "status":
            session = self.sessions.active
            if session:
                return (f"Current session: {session.name}. "
                        f"{session.turn_count} turns. Status: {session.state}.")
            return "No active session, sir."

        if action == "clear_history":
            session = self.sessions.active
            if session:
                session.reset()
                self.conversation.clear()
                await self._broadcast_sessions()
                return "Conversation history cleared, sir. Starting with a clean slate."
            return "No active session to clear, sir."

        logger.warning("Unknown command action: %s", action)
        return "I'm not quite sure what you're asking me to do, sir."

    async def _broadcast_sessions(self) -> None:
        """Send current session list to the orb."""
        if not self.orb:
            return
        sessions = [
            {
                "id": s.id,
                "name": s.name,
                "state": s.state,
                "turn_count": s.turn_count,
            }
            for s in self.sessions.list_sessions()
        ]
        await self.orb.send_sessions(sessions)

    def _handle_orb_command(self, command: str, msg: dict) -> None:
        """Handle inbound commands from the orb UI (click-to-switch, etc.)."""
        if command == "switch_session":
            session_id = msg.get("session_id", "")
            session = self.sessions.sessions.get(session_id)
            if session:
                self.sessions._activate(session)
                self.conversation.clear()
                logger.info("Orb UI switched to session '%s'", session.name)
                # Schedule session broadcast
                loop = asyncio.get_event_loop()
                asyncio.run_coroutine_threadsafe(self._broadcast_sessions(), loop)

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
