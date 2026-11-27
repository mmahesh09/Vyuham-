from functools import lru_cache
from typing import Literal

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DEV_SIGNING_SECRET = "dev-only-signing-secret-change-me-0123456789"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", hide_input_in_errors=True)

    environment: Literal["development", "production"] = "development"

    # SQLite for quick local dev; docker-compose sets a Postgres URL.
    # The Next.js app (Better Auth) writes users and sessions to the same database.
    database_url: str = "sqlite:///./dev.db"

    @field_validator("database_url")
    @classmethod
    def _psycopg_driver(cls, url: str) -> str:
        """Managed Postgres hands out postgres:// or postgresql:// URLs; SQLAlchemy would read those as
        psycopg2, which isn't installed. Use psycopg 3 (the same URL then works for Vercel and here)."""
        for prefix in ("postgres://", "postgresql://"):
            if url.startswith(prefix):
                return "postgresql+psycopg://" + url[len(prefix):]
        return url

    data_dir: str = "./data"
    # AI (SQL help, the AI Data Engineer). Off when the key is empty: the AI endpoints then say so.
    anthropic_api_key: str = ""
    ai_model: str = "claude-opus-5-5"
    # Uploads (beta limits; the browser checks the same size before sending).
    max_upload_bytes: int = 10 * 1024 * 1024
    max_upload_rows: int = 1_000_000
    # What one workspace may keep on the shared data volume, so one customer can't fill it for everyone.
    max_workspace_datasets: int = 200
    max_workspace_bytes: int = 2 * 1024 * 1024 * 1024
    # DuckDB queries running at once in one API process (each may use up to 512 MB). With several
    # processes (WEB_CONCURRENCY), the server-wide limit is processes × this.
    max_concurrent_queries: int = 4
    # Postgres connections per process (the API, each Celery worker and beat each have their own pool).
    # Keep processes × (size + overflow) under the managed database's connection limit.
    db_pool_size: int = 5
    db_max_overflow: int = 10
    # An .xlsx is a zip: a 10 MB file can unpack to gigabytes and take the API down. Refuse workbooks
    # whose contents add up to more than this, before opening them.
    max_xlsx_uncompressed_bytes: int = 150 * 1024 * 1024
    # Per-account / per-address request limits (app/ratelimit.py).
    rate_limit_enabled: bool = True
    # Database connections (app/connectors). Passwords are encrypted with these Fernet keys:
    # comma-separated, newest first, so an old key can stay for decryption while rotating.
    # Generate one with: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
    connections_key: str = ""
    # Private and loopback addresses are refused so a connection can't reach our own services.
    # Local development and tests turn this on to reach databases on the same machine.
    connections_allow_private: bool = False
    # Plan limits (app/plans.py) block creating new things only when this is on. Usage is metered and
    # shown either way. Off until paid plans launch, so a deploy never cuts beta users off.
    plan_limits_enforced: bool = False
    # Shown in the connect dialog so customers can allowlist our outbound address in their firewall.
    public_egress_ip: str = ""
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
    # Optional: check invite addresses with a self-hosted Reacher (app/email_check.py). Off when empty.
    # Invitations expire after this many days.
    invite_ttl_days: int = 7
    # Postgres row-level security is a second wall behind the app's workspace checks. It only works when
    # the API connects as a role that isn't a superuser and lacks BYPASSRLS; in production the API refuses
    # to start otherwise, unless this is turned off (see DEPLOY.md).
    rls_enforce: bool = True
    reacher_url: str = ""
    reacher_secret: str = ""

    # Signs short-lived links: the print page a PDF report is rendered from, report downloads.
    signing_secret: str = DEV_SIGNING_SECRET
    # Where the report worker's headless browser opens the print page (in Docker: the frontend
    # container, which proxies /api to the backend).
    print_base_url: str = "http://localhost:3000"
    # PDF reports: "forme" (the web app renders them, no browser) or "chromium" (print the page in a
    # headless browser). With the fallback on, a Forme failure retries that report in Chromium.
    pdf_renderer: Literal["forme", "chromium"] = "forme"
    pdf_chromium_fallback: bool = True
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

    # Support: Vyuham staff who can see every ticket, write help articles and post incidents.
    # Comma-separated emails, matched against the signed-in (Better Auth) address.
    support_staff_emails: str = ""
    # Error tracking with the Sentry SDK, sent to a self-hosted GlitchTip (MIT). Off when empty.
    sentry_dsn: str = ""
    sentry_traces_sample_rate: float = 0.0
    release: str = ""
    # Shared secret GlitchTip sends with its webhook (?secret=... on the webhook URL). Webhook is off when empty.
    glitchtip_webhook_secret: str = ""
    # Status page: where the scheduler pings the API's /health/live. Empty = the check runs inside
    # the API process (no-Redis dev), so a finished check already proves the API is up.
    status_api_url: str = ""
    status_retention_days: int = 90

    @property
    def staff_emails(self) -> set[str]:
        return {e.strip().lower() for e in self.support_staff_emails.split(",") if e.strip()}

    def _check_connections_key(self) -> None:
        """A malformed key would otherwise only surface when the first password is saved."""
        from cryptography.fernet import Fernet

        for key in (k.strip() for k in self.connections_key.split(",")):
            if not key:
                continue
            try:
                Fernet(key.encode())
            except ValueError:  # includes binascii.Error; the key itself is never repeated in the message
                raise ValueError("CONNECTIONS_KEY must be one or more Fernet keys, separated by commas") from None

    @model_validator(mode="after")
    def _production_is_safe(self):
        """Fail at startup rather than run production on development defaults."""
        self._check_connections_key()
        if self.environment == "production":
            if self.database_url.startswith("sqlite"):
                raise ValueError("ENVIRONMENT=production needs DATABASE_URL pointing at Postgres, not SQLite")
            if self.data_dir in ("./data", "data"):
                raise ValueError("ENVIRONMENT=production needs DATA_DIR set to a persistent volume path")
            if self.signing_secret == DEV_SIGNING_SECRET or len(self.signing_secret) < 32:
                raise ValueError("ENVIRONMENT=production needs SIGNING_SECRET set to a random string of 32+ characters")
            if not self.connections_key.strip():
                raise ValueError("ENVIRONMENT=production needs CONNECTIONS_KEY (a Fernet key) to store database passwords")
            if self.connections_allow_private:
                raise ValueError("CONNECTIONS_ALLOW_PRIVATE must stay off in production")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
