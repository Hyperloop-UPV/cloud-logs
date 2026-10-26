from typing import Any

from pydantic import AliasChoices, Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    database_url: str = "sqlite+aiosqlite:///./cloud_logs.db"
    master_api_key: str | None = None
    master_api_key_hash: str | None = None
    jwt_secret: str = "dev-secret-change-in-production-32b"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 15
    refresh_token_expire_days: int = 90
    github_client_id: str = ""
    github_client_secret: str = ""
    github_redirect_uri: str = "http://localhost:8000/api/v1/auth/github/callback"
    github_org_name: str | None = Field(
        default=None,
        validation_alias=AliasChoices(
            "GITHUB_ORG_NAME",
            "GITHUB_ORG_WHITELIST",
            "github_org_name",
            "github_org_whitelist",
        ),
    )

    @property
    def github_org_whitelist(self) -> str | None:
        """Compatibility property for github_org_whitelist."""
        return self.github_org_name

    # Google Drive configuration
    gdrive_root_folder_id: str = ""
    gdrive_service_account_path: str = ""
    gdrive_simulation_mode: bool = False

    # Weekly cleanup configuration (1 month retention)
    cleanup_enabled: bool = True
    cleanup_retention_days: int = 30
    cleanup_interval_hours: int = 168  # 1 week = 7 * 24h

    environment: str = "development"
    log_level: str = "INFO"
    cors_origins: list[str] | str = ["http://localhost:3000", "http://localhost:5173"]

    @field_validator("cors_origins", mode="before")
    @classmethod
    def assemble_cors_origins(cls, v: Any) -> Any:
        if isinstance(v, str) and not v.strip().startswith("["):
            return [origin.strip() for origin in v.split(",") if origin.strip()]
        return v


settings = Settings()
