"""In-memory conversation history with rolling window."""

from dataclasses import dataclass, field
from datetime import datetime, timezone


@dataclass
class Exchange:
    user: str
    assistant: str
    timestamp: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


class Conversation:
    def __init__(self, max_exchanges: int = 10):
        self._exchanges: list[Exchange] = []
        self._max = max_exchanges

    def add(self, user_text: str, assistant_text: str) -> None:
        self._exchanges.append(Exchange(user=user_text, assistant=assistant_text))
        if len(self._exchanges) > self._max:
            self._exchanges = self._exchanges[-self._max:]

    def format_for_prompt(self) -> str:
        if not self._exchanges:
            return ""
        lines = []
        for ex in self._exchanges:
            lines.append(f"User: {ex.user}")
            lines.append(f"JARVIS: {ex.assistant}")
        return "\n".join(lines)

    def clear(self) -> None:
        self._exchanges.clear()

    def __len__(self) -> int:
        return len(self._exchanges)
