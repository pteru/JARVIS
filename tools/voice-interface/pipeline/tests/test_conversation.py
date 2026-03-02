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
