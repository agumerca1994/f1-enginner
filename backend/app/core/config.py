from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    DATABASE_URL: str = "postgresql+asyncpg://engineer:engineer@localhost:5433/engineer"
    # Tests open a new event loop per client; pooled asyncpg connections are
    # bound to the loop that created them, so tests turn pooling off.
    DATABASE_NULL_POOL: bool = False
    ENVIRONMENT: str = "development"

    FIREBASE_PROJECT_ID: str = ""
    FIREBASE_CREDENTIALS_PATH: str = "/app/firebase-credentials.json"
    # Local-only: accept `X-Dev-User: <email>` instead of a Firebase token, so the
    # API can be used before the web app exists. Forced off in production.
    AUTH_DEV_MODE: bool = False

    APP_DOMAIN: str = ""
    API_DOMAIN: str = ""
    FRONTEND_URL: str = "http://localhost:3000"
    ALLOWED_ORIGINS: str = "http://localhost:3000"
    INTERNAL_LOG_KEY: str = ""

    # Race engineer. Without an API key it runs on rules (no AI).
    ANTHROPIC_API_KEY: str = ""
    ENGINEER_TIER: str = "standard"  # standard | pro
    ENGINEER_FAST_MODEL: str = ""  # per-lap radio; empty = the tier's default
    ENGINEER_DEEP_MODEL: str = ""  # strategy and important moments; empty = the tier's default

    # Raw telemetry received from bridges, one .f1cap.zst per connection and game session.
    CAPTURE_DIR: str = "/data/captures"
    PAIRING_TTL_SECONDS: int = 600
    PAIRING_POLL_INTERVAL_SECONDS: int = 3

    @model_validator(mode="after")
    def production_guards(self) -> "Settings":
        if self.APP_DOMAIN and self.FRONTEND_URL == "http://localhost:3000":
            self.FRONTEND_URL = f"https://{self.APP_DOMAIN}"
        if self.ENVIRONMENT == "production":
            self.AUTH_DEV_MODE = False
        return self

    @property
    def allowed_origins(self) -> list[str]:
        return [o.strip() for o in self.ALLOWED_ORIGINS.split(",") if o.strip()]

    @property
    def pairing_url(self) -> str:
        """Page where a signed-in player types the code shown by the bridge."""
        return f"{self.FRONTEND_URL.rstrip('/')}/pair"


settings = Settings()
