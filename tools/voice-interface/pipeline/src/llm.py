"""Claude CLI integration — session-aware queries via claude --print."""

import asyncio
import logging
from datetime import datetime, timezone
from pathlib import Path

from .session import VoiceSession

logger = logging.getLogger(__name__)


def load_system_prompt(path: str) -> str:
    """Load the system prompt from a markdown file."""
    p = Path(path)
    if p.exists():
        return p.read_text().strip()
    logger.warning("System prompt not found at %s, using default", path)
    return "You are JARVIS, a voice assistant. Address the user as sir. Be concise."


async def query_claude(
    user_text: str,
    session: VoiceSession,
    system_prompt: str,
    model: str = "haiku",
    timeout: float = 30.0,
) -> str:
    """Query Claude CLI with session persistence.

    First turn: creates a new session with --session-id and --system-prompt.
    Subsequent turns: resumes the session with --resume (history maintained by CLI).
    """
    args = ["claude", "--print", "--model", model]

    if session.is_first_turn:
        # First turn: establish session with system prompt
        args.extend(["--session-id", session.session_id])
        args.extend(["--system-prompt", system_prompt])
    else:
        # Subsequent turns: resume the existing session
        args.extend(["--resume", session.session_id])

    # Add timestamp context to each query
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    prompt = f"[{now}] {user_text}"

    try:
        proc = await asyncio.create_subprocess_exec(
            *args,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )

        stdout, stderr = await asyncio.wait_for(
            proc.communicate(input=prompt.encode()),
            timeout=timeout,
        )

        if proc.returncode != 0:
            err = stderr.decode().strip()
            logger.error("claude --print failed (rc=%d): %s", proc.returncode, err)

            # If resume failed, fall back to a fresh session
            if not session.is_first_turn:
                logger.warning("Resume failed, starting fresh session")
                session.reset()
                return await query_claude(user_text, session, system_prompt, model, timeout)

            return "I'm afraid I'm having a slight difficulty processing that, sir."

        session.advance()
        return stdout.decode().strip()

    except asyncio.TimeoutError:
        logger.error("claude --print timed out after %.0fs", timeout)
        return "My apologies, sir. That took rather longer than expected."
    except FileNotFoundError:
        logger.error("claude CLI not found in PATH")
        return "I'm afraid the Claude CLI is not available at the moment, sir."
