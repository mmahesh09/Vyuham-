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
    # Background jobs (alerts, automations, reports) run on a Celery worker fed by Redis.
    # Without REDIS_URL (local dev), the API runs them in a thread instead: one process only.
    redis_url: str = ""
    worker_concurrency: int = 2
    # The in-process fallback; off in tests and ignored when REDIS_URL is set.
    scheduler_enabled: bool = True
    # Email through Resend; without a key, emails are only logged (local dev).
    resend_api_key: str = ""
    email_from: str = "Vyuham <onboarding@resend.dev>"
    # Public URL of the web app, for links in emails.
    app_url: str = "http://localhost:3000"

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
