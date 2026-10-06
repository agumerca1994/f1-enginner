"""Tables behind the MCP connector's authentication, ported from registrapp.

One table per stage of the OAuth flow plus the tokens themselves:

    mcp_oauth_clients        an app that registered itself (RFC 7591 DCR)
    mcp_oauth_authorizations a consent request waiting for the player to approve
    mcp_auth_codes           a one-shot code, already approved, not yet exchanged
    mcp_tokens               every live credential: OAuth and personal tokens

`mcp_tokens` holds both kinds on purpose: the verifier does one lookup by hash,
Settings lists both with one query, and revoking anything is "set revoked_at".
"""

from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class McpOAuthClient(Base):
    """An OAuth client, almost always created by dynamic registration."""

    __tablename__ = "mcp_oauth_clients"

    client_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    # In the clear: the SDK's ClientAuthenticator compares it with
    # hmac.compare_digest against get_client(). PKCE S256 is mandatory, so the
    # secret alone buys an attacker nothing, and most MCP clients are public.
    client_secret: Mapped[str | None] = mapped_column(String(128))
    client_secret_expires_at: Mapped[int | None] = mapped_column(BigInteger)
    client_id_issued_at: Mapped[int | None] = mapped_column(BigInteger)

    client_name: Mapped[str | None] = mapped_column(String(200))
    client_uri: Mapped[str | None] = mapped_column(String(500))
    logo_uri: Mapped[str | None] = mapped_column(String(500))

    redirect_uris: Mapped[list] = mapped_column(JSONB, default=list)
    grant_types: Mapped[list] = mapped_column(JSONB, default=list)
    response_types: Mapped[list] = mapped_column(JSONB, default=list)
    scope: Mapped[str | None] = mapped_column(String(200))
    token_endpoint_auth_method: Mapped[str | None] = mapped_column(String(40))

    software_id: Mapped[str | None] = mapped_column(String(100))
    software_version: Mapped[str | None] = mapped_column(String(50))

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class McpOAuthAuthorization(Base):
    """A pending consent screen: everything needed to mint a code once approved.

    The player's identity is absent: it only exists after they sign in with
    Google and press "Autorizar".
    """

    __tablename__ = "mcp_oauth_authorizations"

    txn_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    client_id: Mapped[str] = mapped_column(String(64), index=True)
    redirect_uri: Mapped[str] = mapped_column(String(700))
    redirect_uri_provided_explicitly: Mapped[bool] = mapped_column(default=False)
    state: Mapped[str | None] = mapped_column(String(500))
    scopes: Mapped[str] = mapped_column(String(300))
    code_challenge: Mapped[str] = mapped_column(String(200))
    resource: Mapped[str | None] = mapped_column(String(300))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class McpAuthCode(Base):
    """An authorization code, stored hashed and burned on first exchange."""

    __tablename__ = "mcp_auth_codes"

    code_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    client_id: Mapped[str] = mapped_column(String(64), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"))
    scopes: Mapped[str] = mapped_column(String(300))
    code_challenge: Mapped[str] = mapped_column(String(200))
    redirect_uri: Mapped[str] = mapped_column(String(700))
    redirect_uri_provided_explicitly: Mapped[bool] = mapped_column(default=False)
    resource: Mapped[str | None] = mapped_column(String(300))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class McpToken(Base):
    """A credential that can reach /mcp: personal token or OAuth access/refresh.

    Only the sha256 is stored; `token_prefix` lets Settings show something
    recognisable next to the "revoke" button.
    """

    __tablename__ = "mcp_tokens"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)

    kind: Mapped[str] = mapped_column(String(20))  # pat | oauth_access | oauth_refresh
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    token_prefix: Mapped[str] = mapped_column(String(24))

    # Ties an access token to its refresh token and every later rotation, so
    # "disconnect this app" is a single UPDATE by grant_id.
    grant_id: Mapped[str] = mapped_column(String(64), index=True)
    parent_id: Mapped[int | None] = mapped_column(ForeignKey("mcp_tokens.id", ondelete="SET NULL"))

    client_id: Mapped[str | None] = mapped_column(String(64))
    client_name: Mapped[str | None] = mapped_column(String(200))
    name: Mapped[str | None] = mapped_column(String(100))  # the player's label, PAT only

    scopes: Mapped[str] = mapped_column(String(300))
    resource: Mapped[str | None] = mapped_column(String(300))

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # user | rotated | reuse_detected | grant_revoked
    revoked_reason: Mapped[str | None] = mapped_column(String(40))
