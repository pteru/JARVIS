"""ElevenLabs streaming text-to-speech with amplitude extraction."""

import logging
from typing import Callable

from elevenlabs import ElevenLabs
from .audio import Speaker

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
