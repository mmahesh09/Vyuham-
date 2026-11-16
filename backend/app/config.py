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
    # Email through Resend; without a key, emails are only logged (local dev).
    resend_api_key: str = ""
    email_from: str = "Vyuham <onboarding@resend.dev>"
    # Public URL of the web app, for links in emails.
    app_url: str = "http://localhost:3000"

    # Chatwoot customer support (docs/chatwoot-integration.md). Off unless base URL, account,
    # inbox and website token are all set. Tokens below are server-side secrets.
    chatwoot_base_url: str = ""  # public URL customers' browsers load the widget from
    chatwoot_api_url: str = ""  # optional private URL the backend uses; defaults to chatwoot_base_url
    chatwoot_account_id: int = 0
    chatwoot_inbox_id: int = 0  # the "Vyuham support" website inbox
    chatwoot_website_token: str = ""  # public by design; identifies the inbox to the widget
    chatwoot_hmac_token: str = ""  # inbox's identity-verification secret
    chatwoot_api_token: str = ""  # access token of a dedicated agent that belongs to the support inbox only
    chatwoot_webhook_secret: str = ""  # secret Chatwoot signs webhooks with
    chatwoot_help_center_url: str = ""  # Chatwoot help center (portal) for "Help documentation"
    chatwoot_share_email: bool = True  # lets agents follow up by email after the customer leaves

    # AI troubleshooting assistant (docs/rag-support-engine.md).
    anthropic_api_key: str = ""  # server-side only; without it the assistant answers from approved articles alone
    support_ai_model: str = "claude-opus-5-5"
    support_ai_effort: Literal["low", "medium", "high", "xhigh", "max"] = "medium"
    # Embeddings for knowledge articles. Claude has no embeddings endpoint; Voyage AI is Anthropic's
    # recommended provider. "hash" is a deterministic offline embedding for development and tests only.
    embedding_provider: Literal["voyage", "hash"] = "hash"
    voyage_api_key: str = ""
    voyage_model: str = "voyage-3.5"
    support_ai_min_similarity: float = 0.25
    support_ai_max_articles: int = 5
    support_ai_worker_enabled: bool = True  # background job worker (off in tests; run in one process only)
    support_ai_asks_per_hour: int = 20
    support_ai_errors_per_minute: int = 30
    # Vyuham support staff who may review and approve knowledge (comma-separated emails, verified addresses only).
    support_staff_emails: str = ""
    # Vyuham administrators: everything staff can do, plus approving, rejecting and editing *global* knowledge.
    support_admin_emails: str = ""

    @property
    def staff_emails(self) -> set[str]:
        return {e.strip().lower() for e in self.support_staff_emails.split(",") if e.strip()}

    @property
    def admin_emails(self) -> set[str]:
        return {e.strip().lower() for e in self.support_admin_emails.split(",") if e.strip()}

    @property
    def chatwoot_enabled(self) -> bool:
        return bool(self.chatwoot_base_url and self.chatwoot_account_id and self.chatwoot_inbox_id and self.chatwoot_website_token)

    @model_validator(mode="after")
    def _production_is_safe(self):
        """Fail at startup rather than run production on development defaults."""
        if self.environment == "production":
            if self.database_url.startswith("sqlite"):
                raise ValueError("ENVIRONMENT=production needs DATABASE_URL pointing at Postgres, not SQLite")
            if self.data_dir in ("./data", "data"):
                raise ValueError("ENVIRONMENT=production needs DATA_DIR set to a persistent volume path")
            if self.chatwoot_enabled:
                if not self.chatwoot_base_url.startswith("https://"):
                    raise ValueError("CHATWOOT_BASE_URL must use https in production")
                if not (self.chatwoot_hmac_token and self.chatwoot_webhook_secret and self.chatwoot_api_token):
                    raise ValueError("Chatwoot in production needs CHATWOOT_HMAC_TOKEN, CHATWOOT_WEBHOOK_SECRET and CHATWOOT_API_TOKEN")
            if self.embedding_provider == "hash" and self.anthropic_api_key:
                raise ValueError("EMBEDDING_PROVIDER=hash is for development only; use voyage in production")
        if self.embedding_provider == "voyage" and not self.voyage_api_key:
            raise ValueError("EMBEDDING_PROVIDER=voyage needs VOYAGE_API_KEY")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
