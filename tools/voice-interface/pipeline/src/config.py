"""Load API keys and pipeline configuration from ~/.secrets/ and defaults."""

from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class Config:
    deepgram_api_key: str = ""
    picovoice_access_key: str = ""
    elevenlabs_api_key: str = ""
    porcupine_keyword_path: str = ""
    elevenlabs_voice_id: str = "JBFqnCBsd6RMkjVDRZzb"  # "George" — deep British male
    elevenlabs_model: str = "eleven_turbo_v2_5"
    claude_model: str = "sonnet"
    mic_device_index: int | None = None  # None = system default
    sample_rate: int = 16000
    history_max_exchanges: int = 10
    orb_ws_port: int = 9000
    system_prompt_path: str = "config/system-prompt.md"

    @classmethod
    def load(cls, base_dir: Path | None = None) -> "Config":
        """Load config, reading API keys from ~/.secrets/ files."""
        secrets = Path.home() / ".secrets"
        base = base_dir or Path(__file__).parent.parent

        def read_secret(name: str) -> str:
            path = secrets / name
            if path.exists():
                return path.read_text().strip()
            return ""

        # Find .ppn file in config/ directory
        ppn_dir = base / "config"
        ppn_files = list(ppn_dir.glob("*.ppn")) if ppn_dir.exists() else []
        keyword_path = str(ppn_files[0]) if ppn_files else ""

        return cls(
            deepgram_api_key=read_secret("deepgram-api-key"),
            picovoice_access_key=read_secret("picovoice-access-key"),
            elevenlabs_api_key=read_secret("elevenlabs-api-key"),
            porcupine_keyword_path=keyword_path,
            system_prompt_path=str(base / "config" / "system-prompt.md"),
        )
