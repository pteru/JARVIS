"""Tests for Deepgram STT module (no live audio)."""

import pytest
from src.stt import StreamingSTT


def test_stt_requires_api_key():
    """StreamingSTT should raise ValueError without an API key."""
    with pytest.raises(ValueError, match="Deepgram API key is required"):
        StreamingSTT("")


def test_stt_instantiation():
    """StreamingSTT should instantiate with a valid API key."""
    stt = StreamingSTT("fake-key-for-testing")
    assert stt._transcript_parts == []
    assert stt._done_event is None
