"""Application settings loaded from environment variables."""

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """PMO Dashboard configuration.

    All values can be overridden via environment variables (case-insensitive).
    """

    PMO_ROOT: str = "/data/pmo"
    CONFIG_ROOT: str = "/data/config"
    DB_PATH: str = "/data/db/pmo.db"
    AUTH_TOKEN: str = ""
    GOOGLE_SHEET_ID: str = ""
    GOOGLE_CREDENTIALS_PATH: str = ""
    HOST: str = "0.0.0.0"
    PORT: int = 8090

    model_config = {"env_prefix": "", "case_sensitive": False}


settings = Settings()
