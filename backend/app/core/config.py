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

    # --- MCP connector (P5), ported from registrapp ---------------------------
    MCP_ENABLED: bool = True
    # Local-only: reach /mcp without a token, as the first player in the DB.
    # Forced off in production by the validator below.
    MCP_AUTH_DISABLED: bool = False
    # Both derived from API_DOMAIN when empty. The resource URL is the RFC 8707
    # audience every token is bound to, so it must match what clients send.
    OAUTH_ISSUER_URL: str = ""
    MCP_RESOURCE_URL: str = ""
    MCP_ACCESS_TOKEN_TTL_SECONDS: int = 3600
    MCP_REFRESH_TOKEN_TTL_DAYS: int = 30
    MCP_DCR_ENABLED: bool = True
    # Extra Host:/Origin: values for the transport's anti-DNS-rebinding check,
    # comma-separated, so a client rejected with 421/403 can be allowed without a deploy.
    MCP_ALLOWED_HOSTS: str = ""
    MCP_ALLOWED_ORIGINS: str = ""

    @model_validator(mode="after")
    def production_guards(self) -> "Settings":
        if self.APP_DOMAIN and self.FRONTEND_URL == "http://localhost:3000":
            self.FRONTEND_URL = f"https://{self.APP_DOMAIN}"
        if not self.OAUTH_ISSUER_URL:
            self.OAUTH_ISSUER_URL = f"https://{self.API_DOMAIN}" if self.API_DOMAIN else "http://localhost:8000"
        self.OAUTH_ISSUER_URL = self.OAUTH_ISSUER_URL.rstrip("/")
        if not self.MCP_RESOURCE_URL:
            self.MCP_RESOURCE_URL = f"{self.OAUTH_ISSUER_URL}/mcp"
        self.MCP_RESOURCE_URL = self.MCP_RESOURCE_URL.rstrip("/")
        if self.ENVIRONMENT == "production":
            self.AUTH_DEV_MODE = False
            self.MCP_AUTH_DISABLED = False
        return self

    @property
    def mcp_allowed_hosts(self) -> list[str]:
        hosts = ["localhost", "localhost:*", "127.0.0.1", "127.0.0.1:*", "[::1]", "[::1]:*", "testserver"]
        if self.API_DOMAIN:
            hosts += [self.API_DOMAIN, f"{self.API_DOMAIN}:*"]
        return hosts + [h.strip() for h in self.MCP_ALLOWED_HOSTS.split(",") if h.strip()]

    @property
    def mcp_allowed_origins(self) -> list[str]:
        """Origins the MCP transport accepts. A missing Origin (non-browser clients) always passes."""
        origins = ["https://claude.ai", "https://claude.com", "http://localhost:*", "http://127.0.0.1:*",
                   self.FRONTEND_URL.rstrip("/")]
        return origins + [o.strip() for o in self.MCP_ALLOWED_ORIGINS.split(",") if o.strip()]

    @property
    def mcp_resource_metadata_url(self) -> str:
        """Where clients discover which authorization server protects /mcp."""
        return f"{self.OAUTH_ISSUER_URL}/.well-known/oauth-protected-resource/mcp"

    @property
    def allowed_origins(self) -> list[str]:
        return [o.strip() for o in self.ALLOWED_ORIGINS.split(",") if o.strip()]

    @property
    def pairing_url(self) -> str:
        """Page where a signed-in player types the code shown by the bridge."""
        return f"{self.FRONTEND_URL.rstrip('/')}/pair"


settings = Settings()
