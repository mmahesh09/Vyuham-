from functools import lru_cache
from typing import Literal

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DEV_SIGNING_SECRET = "dev-only-signing-secret-change-me-0123456789"


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

    # Signs short-lived links: the print page a PDF report is rendered from, report downloads.
    signing_secret: str = DEV_SIGNING_SECRET
    # Where the report worker's headless browser opens the print page (in Docker: the frontend
    # container, which proxies /api to the backend).
    print_base_url: str = "http://localhost:3000"
    # Generated report files: "local" (under DATA_DIR/reports) or "s3" (any S3-compatible store,
    # e.g. MinIO; needs `pip install boto3`).
    report_storage: Literal["local", "s3"] = "local"
    s3_bucket: str = ""
    s3_endpoint_url: str = ""
    s3_region: str = "us-east-1"
    s3_access_key: str = ""
    s3_secret_key: str = ""
    report_retention_days: int = 30
    report_max_rows: int = 1_000_000

    @model_validator(mode="after")
    def _production_is_safe(self):
        """Fail at startup rather than run production on development defaults."""
        if self.environment == "production":
            if self.database_url.startswith("sqlite"):
                raise ValueError("ENVIRONMENT=production needs DATABASE_URL pointing at Postgres, not SQLite")
            if self.data_dir in ("./data", "data"):
                raise ValueError("ENVIRONMENT=production needs DATA_DIR set to a persistent volume path")
            if self.signing_secret == DEV_SIGNING_SECRET or len(self.signing_secret) < 32:
                raise ValueError("ENVIRONMENT=production needs SIGNING_SECRET set to a random string of 32+ characters")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
