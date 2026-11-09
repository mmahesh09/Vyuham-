from functools import lru_cache
from typing import Literal

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    environment: Literal["development", "production"] = "development"

    # SQLite for quick local dev; docker-compose sets a Postgres URL.
    # The Next.js app (Better Auth) writes users and sessions to the same database.
    database_url: str = "sqlite:///./dev.db"
    data_dir: str = "./data"
    # Uploads (beta limits; the browser checks the same size before sending).
    max_upload_bytes: int = 10 * 1024 * 1024
    max_upload_rows: int = 1_000_000
    # Background checks for alerts and automations (off in tests; run in one process only).
    scheduler_enabled: bool = True

    @model_validator(mode="after")
    def _production_is_safe(self):
        """Fail at startup rather than run production on development defaults."""
        if self.environment == "production":
            if self.database_url.startswith("sqlite"):
                raise ValueError("ENVIRONMENT=production needs DATABASE_URL pointing at Postgres, not SQLite")
            if self.data_dir in ("./data", "data"):
                raise ValueError("ENVIRONMENT=production needs DATA_DIR set to a persistent volume path")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
