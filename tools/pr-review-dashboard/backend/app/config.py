"""Application configuration via environment variables."""

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    service_data_dir: str = "/data/service"
    port: int = 8091
    gh_org: str = "strokmatic"

    @property
    def data_dir(self) -> str:
        return f"{self.service_data_dir}/data"

    @property
    def reviews_dir(self) -> str:
        return f"{self.service_data_dir}/reviews"

    @property
    def archive_dir(self) -> str:
        return f"{self.service_data_dir}/reviews/archive"

    @property
    def logs_dir(self) -> str:
        return f"{self.service_data_dir}/logs"

    @property
    def config_dir(self) -> str:
        return f"{self.service_data_dir}/config"

    @property
    def scripts_dir(self) -> str:
        return self.service_data_dir


settings = Settings()
