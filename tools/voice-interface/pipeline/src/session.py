"""Voice session — persistent conversation identity across Claude CLI calls."""

import logging
import uuid

logger = logging.getLogger(__name__)


class VoiceSession:
    """Manages a persistent Claude CLI session via --session-id / --resume."""

    def __init__(self):
        self.session_id: str = str(uuid.uuid4())
        self.turn_count: int = 0
        logger.info("New voice session: %s", self.session_id[:8])

    @property
    def is_first_turn(self) -> bool:
        return self.turn_count == 0

    def advance(self) -> None:
        """Mark a successful turn."""
        self.turn_count += 1

    def reset(self) -> None:
        """Start a fresh session (new UUID, reset turn count)."""
        self.session_id = str(uuid.uuid4())
        self.turn_count = 0
        logger.info("Session reset: %s", self.session_id[:8])


# Voice meta-commands — matched against transcribed text
META_COMMANDS = {
    "new session": "new_session",
    "start a new session": "new_session",
    "fresh session": "new_session",
    "clear history": "clear_history",
    "reset conversation": "clear_history",
    "forget everything": "clear_history",
}


def detect_meta_command(text: str) -> str | None:
    """Check if the transcribed text is a meta-command. Returns command name or None."""
    normalized = text.lower().strip().rstrip(".")
    for trigger, command in META_COMMANDS.items():
        if trigger in normalized:
            return command
    return None
