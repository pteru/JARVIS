"""Application configuration via environment variables."""

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    service_data_dir: str = "/data/service"
    port: int = 8091
    gh_org: str = "strokmatic"

    # Google Drive settings
    gcp_credentials_path: str = "/data/credentials/gcp-service-account.json"
    drive_shared_drive_id: str = "0AC4RjZu6DAzcUk9PVA"
    drive_folder_name: str = "PR Reviews"
    impersonate_email: str = "pedro@lumesolutions.com"

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
