"""Claude CLI integration — build prompts and call claude --print."""

import asyncio
import logging
from datetime import datetime, timezone
from pathlib import Path

from .conversation import Conversation

logger = logging.getLogger(__name__)


def build_prompt(
    system_prompt: str,
    user_text: str,
    conversation: Conversation,
) -> str:
    """Build the full prompt for Claude, including system prompt, history, and current query."""
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    parts = [
        system_prompt.strip(),
        f"\nCurrent time: {now}",
    ]

    history = conversation.format_for_prompt()
    if history:
        parts.append(f"\nConversation so far:\n{history}")

    parts.append(f"\nUser: {user_text}")
    parts.append("\nRespond as JARVIS (spoken dialogue, concise):")

    return "\n".join(parts)


def load_system_prompt(path: str) -> str:
    """Load the system prompt from a markdown file."""
    p = Path(path)
    if p.exists():
        return p.read_text().strip()
    logger.warning("System prompt not found at %s, using default", path)
    return "You are JARVIS, a voice assistant. Address the user as sir. Be concise."


class ClaudeProcess:
    """Pre-spawned Claude CLI process. Spawn early, send prompt later."""

    def __init__(self, model: str = "haiku"):
        self._model = model
        self._proc: asyncio.subprocess.Process | None = None

    async def warm_up(self) -> None:
        """Spawn the claude --print process. It will block waiting for stdin."""
        self._proc = await asyncio.create_subprocess_exec(
            "claude", "--print", "--model", self._model,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        logger.debug("Claude CLI pre-spawned (pid=%d)", self._proc.pid)

    async def query(self, prompt: str, timeout: float = 30.0) -> str:
        """Send the prompt to the already-running process and get the response."""
        if not self._proc:
            await self.warm_up()

        try:
            stdout, stderr = await asyncio.wait_for(
                self._proc.communicate(input=prompt.encode()),
                timeout=timeout,
            )
            if self._proc.returncode != 0:
                logger.error("claude --print failed: %s", stderr.decode().strip())
                return "I'm afraid I'm having a slight difficulty processing that, sir."
            return stdout.decode().strip()
        except asyncio.TimeoutError:
            logger.error("claude --print timed out after %.0fs", timeout)
            self._proc.kill()
            return "My apologies, sir. That took rather longer than expected."
        except FileNotFoundError:
            logger.error("claude CLI not found in PATH")
            return "I'm afraid the Claude CLI is not available at the moment, sir."
        finally:
            self._proc = None  # Process is consumed, need a new one next time


async def query_claude(prompt: str, model: str = "sonnet", timeout: float = 30.0) -> str:
    """Call claude --print and return the response text."""
    proc = ClaudeProcess(model)
    return await proc.query(prompt, timeout)
