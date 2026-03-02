"""Tests for audio utilities (no hardware required)."""

import struct
import pytest
from src.audio import compute_rms


def test_compute_rms_silence():
    """Silent audio should return 0."""
    silence = struct.pack("10h", *([0] * 10))
    assert compute_rms(silence) == 0.0


def test_compute_rms_max():
    """Max amplitude should return close to 1.0."""
    loud = struct.pack("10h", *([32767] * 10))
    assert compute_rms(loud) == pytest.approx(1.0, abs=0.001)


def test_compute_rms_empty():
    """Empty audio should return 0."""
    assert compute_rms(b"") == 0.0


def test_compute_rms_mid():
    """Mid-level audio should return ~0.5."""
    mid = struct.pack("10h", *([16384] * 10))
    result = compute_rms(mid)
    assert 0.4 < result < 0.6
