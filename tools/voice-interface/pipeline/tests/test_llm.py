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


def test_build_prompt_contains_timestamp():
    prompt = build_prompt(
        system_prompt="You are JARVIS.",
        user_text="Hello",
        conversation=Conversation(),
    )
    assert "Current time:" in prompt
