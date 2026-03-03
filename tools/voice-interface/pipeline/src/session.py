"""Voice session management — named, persistent sessions with lifecycle states."""

import json
import logging
import re
import uuid
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

logger = logging.getLogger(__name__)

SessionState = Literal["active", "idle", "background", "complete", "error"]


@dataclass
class VoiceSession:
    """A single named voice session backed by a Claude CLI session."""

    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    name: str = "Default"
    state: SessionState = "active"
    turn_count: int = 0
    created_at: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )
    last_activity: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )

    @property
    def is_first_turn(self) -> bool:
        return self.turn_count == 0

    def advance(self) -> None:
        self.turn_count += 1
        self.last_activity = datetime.now(timezone.utc).isoformat()

    def reset(self) -> None:
        self.id = str(uuid.uuid4())
        self.turn_count = 0
        self.last_activity = datetime.now(timezone.utc).isoformat()
        logger.info("Session '%s' reset: %s", self.name, self.id[:8])


class SessionManager:
    """Manages multiple named voice sessions with persistent storage."""

    def __init__(self, data_dir: Path):
        self.data_dir = data_dir
        self.index_path = data_dir / "sessions.json"
        self.sessions: dict[str, VoiceSession] = {}
        self.active_id: str | None = None
        self._load()

    def _load(self) -> None:
        """Load session index from disk."""
        if self.index_path.exists():
            try:
                data = json.loads(self.index_path.read_text())
                for s in data.get("sessions", []):
                    session = VoiceSession(**s)
                    self.sessions[session.id] = session
                self.active_id = data.get("active_id")
                # Validate active_id still exists
                if self.active_id and self.active_id not in self.sessions:
                    self.active_id = None
                logger.info("Loaded %d sessions from index", len(self.sessions))
            except (json.JSONDecodeError, TypeError) as e:
                logger.warning("Failed to load sessions index: %s", e)

    def _save(self) -> None:
        """Persist session index to disk."""
        self.data_dir.mkdir(parents=True, exist_ok=True)
        data = {
            "active_id": self.active_id,
            "sessions": [asdict(s) for s in self.sessions.values()],
        }
        self.index_path.write_text(json.dumps(data, indent=2) + "\n")

    @property
    def active(self) -> VoiceSession | None:
        if self.active_id:
            return self.sessions.get(self.active_id)
        return None

    def create_session(self, name: str = "Default") -> VoiceSession:
        """Create a new named session and make it active."""
        # Deactivate current session
        if self.active:
            self.active.state = "idle"

        session = VoiceSession(name=name, state="active")
        self.sessions[session.id] = session
        self.active_id = session.id
        self._save()
        logger.info("Created session '%s' (%s)", name, session.id[:8])
        return session

    def switch_to(self, name_or_partial: str) -> VoiceSession | None:
        """Switch to a session by name (case-insensitive, partial match)."""
        target = name_or_partial.lower().strip()

        # Try exact match first
        for s in self.sessions.values():
            if s.name.lower() == target:
                return self._activate(s)

        # Try partial match
        matches = [s for s in self.sessions.values() if target in s.name.lower()]
        if len(matches) == 1:
            return self._activate(matches[0])

        if len(matches) > 1:
            logger.warning("Ambiguous session name '%s': %d matches", target, len(matches))
        return None

    def _activate(self, session: VoiceSession) -> VoiceSession:
        """Set a session as active, deactivating the current one."""
        if self.active and self.active.id != session.id:
            self.active.state = "idle"
        session.state = "active"
        session.last_activity = datetime.now(timezone.utc).isoformat()
        self.active_id = session.id
        self._save()
        logger.info("Switched to session '%s' (%s)", session.name, session.id[:8])
        return session

    def list_sessions(self) -> list[VoiceSession]:
        """Return all sessions, active first."""
        sessions = list(self.sessions.values())
        sessions.sort(key=lambda s: (s.state != "active", s.last_activity), reverse=False)
        return sessions

    def ensure_active(self) -> VoiceSession:
        """Ensure there's an active session, creating a default if needed."""
        if not self.active:
            return self.create_session("Default")
        return self.active


# --- Voice command parsing ---

@dataclass
class VoiceCommand:
    """Parsed voice command with action and optional parameter."""
    action: str
    param: str | None = None


# Patterns for parameterized commands
_COMMAND_PATTERNS = [
    # Session creation
    (r"(?:start|create|open)\s+(?:a\s+)?(?:new\s+)?session\s+(?:called|named)\s+(.+)",
     "create_session"),
    (r"new session\s+(?:called|named)\s+(.+)", "create_session"),
    (r"new session$", "create_session"),
    (r"fresh session$", "create_session"),
    # Session switching
    (r"switch\s+to\s+(?:the\s+)?(?:session\s+)?(.+)", "switch_session"),
    (r"go\s+to\s+(?:the\s+)?(?:session\s+)?(.+)", "switch_session"),
    (r"resume\s+(?:the\s+)?(?:session\s+)?(.+)", "switch_session"),
    # Session listing
    (r"list\s+(?:all\s+)?(?:active\s+)?sessions?", "list_sessions"),
    (r"(?:show|what are)\s+(?:my\s+)?(?:active\s+)?sessions?", "list_sessions"),
    # Status
    (r"(?:status|status report)$", "status"),
    # History/session reset
    (r"clear\s+(?:the\s+)?history", "clear_history"),
    (r"reset\s+(?:the\s+)?conversation", "clear_history"),
    (r"forget\s+everything", "clear_history"),
]


def parse_voice_command(text: str) -> VoiceCommand | None:
    """Parse transcribed text into a voice command. Returns None if not a command."""
    normalized = text.lower().strip().rstrip(".")

    for pattern, action in _COMMAND_PATTERNS:
        m = re.match(pattern, normalized)
        if m:
            param = m.group(1).strip().rstrip(".") if m.lastindex else None
            return VoiceCommand(action=action, param=param)

    return None
