"""Deepgram Nova-2 streaming speech-to-text."""

import asyncio
import logging
import time
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
        self._last_speech_time: float = 0
        self._silence_timeout: float = 2.0  # seconds of silence after speech = done

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
            interim_results=True,
            endpointing="1000",  # 1s silence = speech_final
        )

        self._connection = self._client.listen.websocket.v("1")

        # Register event handlers
        self._connection.on(LiveTranscriptionEvents.Transcript, self._on_transcript)
        self._connection.on(LiveTranscriptionEvents.Error, self._on_error)

        if not self._connection.start(options):
            logger.error("Failed to start Deepgram connection")
            return ""

        logger.info("Deepgram STT streaming started")

        # Stream mic audio in a background task
        loop = asyncio.get_event_loop()
        self._last_speech_time = 0
        stream_task = asyncio.create_task(self._stream_audio(mic_read_fn, loop))
        silence_task = asyncio.create_task(self._silence_monitor())

        try:
            await asyncio.wait_for(self._done_event.wait(), timeout=timeout)
        except asyncio.TimeoutError:
            logger.warning("STT timed out after %.0fs", timeout)
        finally:
            stream_task.cancel()
            silence_task.cancel()
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

    async def _silence_monitor(self) -> None:
        """Monitor for silence after speech — if no new speech for _silence_timeout, we're done."""
        try:
            while not self._done_event.is_set():
                await asyncio.sleep(0.5)
                if (
                    self._last_speech_time > 0
                    and self._transcript_parts
                    and time.monotonic() - self._last_speech_time > self._silence_timeout
                ):
                    logger.info("Silence detected after speech, ending STT")
                    self._done_event.set()
        except asyncio.CancelledError:
            pass

    def _on_transcript(self, _self, result, **kwargs) -> None:
        transcript = result.channel.alternatives[0].transcript
        if transcript and result.is_final:
            self._transcript_parts.append(transcript)
            self._last_speech_time = time.monotonic()
            logger.info("STT final: %s", transcript)
        elif transcript:
            # Interim result — user is still speaking
            self._last_speech_time = time.monotonic()
            logger.debug("STT interim: %s", transcript)
        # speech_final fires after endpointing silence
        if getattr(result, "speech_final", False) and self._transcript_parts:
            logger.info("Speech final detected, ending STT")
            if self._done_event:
                self._done_event.set()

    def _on_error(self, _self, error, **kwargs) -> None:
        logger.error("Deepgram error: %s", error)
        if self._done_event:
            self._done_event.set()
