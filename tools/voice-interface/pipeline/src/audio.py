"""PyAudio mic capture and speaker playback."""

import logging
import struct
import math

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
