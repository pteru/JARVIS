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
