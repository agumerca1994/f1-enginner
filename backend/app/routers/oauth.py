"""OAuth 2.1 endpoints, discovery metadata, and the connector's token management.

Ported from registrapp (backend/app/routers/oauth.py).

Three groups of routes live here:

- **Discovery** (`/.well-known/*`) — served from the domain root, as RFC 9728 and
  RFC 8414 require. Hand-built dicts rather than the SDK's `build_metadata()`,
  because its `OAuthMetadata` model has no field for
  `authorization_response_iss_parameter_supported` and Claude looks for it.
- **The protocol itself** (`/oauth/register|authorize|token|revoke`) — thin
  wrappers around the SDK handlers, plus the consent endpoints that bridge to
  Google sign-in in the frontend.
- **Management** (`/oauth/connections`, `/oauth/tokens`) — normal signed-in JSON
  endpoints that back the Settings screen.
"""
import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from mcp.server.auth.handlers.authorize import AuthorizationHandler
from mcp.server.auth.handlers.register import RegistrationHandler
from mcp.server.auth.handlers.revoke import RevocationHandler
from mcp.server.auth.handlers.token import TokenHandler
from mcp.server.auth.middleware.client_auth import ClientAuthenticator
from mcp.server.auth.provider import construct_redirect_uri
from mcp.server.auth.settings import ClientRegistrationOptions
from pydantic import BaseModel, Field
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user, utcnow
from app.core.config import settings
from app.core.database import get_db
from app.models import McpOAuthAuthorization, McpOAuthClient, McpToken, User
from app.services import rate_limit
from app.services.mcp_tokens import READ_SCOPE, create_pat, revoke_grant
from app.services.oauth_provider import EngineerOAuthProvider, mint_authorization_code

logger = logging.getLogger(__name__)

router = APIRouter(tags=["mcp-oauth"])

provider = EngineerOAuthProvider()
_client_authenticator = ClientAuthenticator(provider)
_registration_handler = RegistrationHandler(
    provider,
    options=ClientRegistrationOptions(
        enabled=True,
        valid_scopes=[READ_SCOPE],
        default_scopes=[READ_SCOPE],
    ),
)
_authorization_handler = AuthorizationHandler(provider)
_token_handler = TokenHandler(provider, _client_authenticator)
_revocation_handler = RevocationHandler(provider, _client_authenticator)


# --------------------------------------------------------------------------
# Discovery
# --------------------------------------------------------------------------

def _protected_resource_metadata() -> dict:
    return {
        "resource": settings.MCP_RESOURCE_URL,
        "authorization_servers": [settings.OAUTH_ISSUER_URL],
        "scopes_supported": [READ_SCOPE],
        "bearer_methods_supported": ["header"],
        "resource_name": "Ingeniero de carrera",
        "resource_documentation": settings.FRONTEND_URL,
    }


def _authorization_server_metadata() -> dict:
    issuer = settings.OAUTH_ISSUER_URL
    return {
        "issuer": issuer,
        "authorization_endpoint": f"{issuer}/oauth/authorize",
        "token_endpoint": f"{issuer}/oauth/token",
        "registration_endpoint": f"{issuer}/oauth/register",
        "revocation_endpoint": f"{issuer}/oauth/revoke",
        "scopes_supported": [READ_SCOPE],
        "response_types_supported": ["code"],
        "response_modes_supported": ["query"],
        "grant_types_supported": ["authorization_code", "refresh_token"],
        "code_challenge_methods_supported": ["S256"],
        "token_endpoint_auth_methods_supported": [
            "none", "client_secret_post", "client_secret_basic",
        ],
        "revocation_endpoint_auth_methods_supported": [
            "none", "client_secret_post", "client_secret_basic",
        ],
        # Not in the SDK's metadata model, which is why this dict is hand-built.
        "authorization_response_iss_parameter_supported": True,
        "resource_indicators_supported": True,
        "service_documentation": settings.FRONTEND_URL,
    }


@router.get("/.well-known/oauth-protected-resource")
@router.get("/.well-known/oauth-protected-resource/mcp")
async def protected_resource_metadata():
    """RFC 9728. The `/mcp` suffixed variant is the one Claude actually fetches."""
    return _protected_resource_metadata()


@router.get("/.well-known/oauth-authorization-server")
@router.get("/.well-known/oauth-authorization-server/mcp")
@router.get("/.well-known/openid-configuration")
async def authorization_server_metadata():
    """RFC 8414, plus the aliases different clients probe for."""
    return _authorization_server_metadata()


# --------------------------------------------------------------------------
# Protocol endpoints (SDK handlers)
# --------------------------------------------------------------------------

@router.post("/oauth/register")
async def register_client(request: Request) -> Response:
    if not settings.MCP_DCR_ENABLED:
        raise HTTPException(status_code=403, detail="Registro dinámico deshabilitado")
    rate_limit.enforce(request, "oauth_register", limit=5, window_seconds=3600)
    return await _registration_handler.handle(request)


@router.get("/oauth/authorize")
@router.post("/oauth/authorize")
async def authorize(request: Request) -> Response:
    return await _authorization_handler.handle(request)


@router.post("/oauth/token")
async def token(request: Request) -> Response:
    rate_limit.enforce(request, "oauth_token", limit=30, window_seconds=60)
    return await _token_handler.handle(request)


@router.post("/oauth/revoke")
async def revoke(request: Request) -> Response:
    rate_limit.enforce(request, "oauth_revoke", limit=30, window_seconds=60)
    return await _revocation_handler.handle(request)


# --------------------------------------------------------------------------
# Consent bridge — where Firebase login meets the OAuth flow
# --------------------------------------------------------------------------

class ConsentBody(BaseModel):
    txn: str


async def _load_txn(db: AsyncSession, txn_id: str, *, lock: bool = False) -> McpOAuthAuthorization:
    q = select(McpOAuthAuthorization).where(McpOAuthAuthorization.txn_id == txn_id)
    if lock:
        q = q.with_for_update()
    row = await db.scalar(q)
    if row is None or row.consumed_at is not None:
        raise HTTPException(status_code=404, detail="Esta solicitud no existe o ya fue usada")
    if row.expires_at < utcnow():
        raise HTTPException(status_code=410, detail="La solicitud expiró, volvé a intentar desde la app que querías conectar")
    return row


@router.get("/oauth/authorize/txn/{txn_id}")
async def authorize_txn(txn_id: str, db: AsyncSession = Depends(get_db)):
    """What the consent screen needs to render. Public: the player may not be signed in yet."""
    txn = await _load_txn(db, txn_id)
    client = await db.get(McpOAuthClient, txn.client_id)
    return {
        "txn": txn.txn_id,
        "client_name": (client.client_name if client else None) or "Aplicación sin nombre",
        "client_uri": client.client_uri if client else None,
        "logo_uri": client.logo_uri if client else None,
        "redirect_host": txn.redirect_uri.split("/")[2] if "//" in txn.redirect_uri else txn.redirect_uri,
        "scopes": txn.scopes.split(),
        "expires_at": txn.expires_at.isoformat(),
    }


@router.post("/oauth/authorize/consent")
async def authorize_consent(
    body: ConsentBody,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """The player said yes: mint the code and hand back where to send the browser."""
    rate_limit.enforce(request, "oauth_consent", limit=10, window_seconds=60)
    txn = await _load_txn(db, body.txn, lock=True)

    code = await mint_authorization_code(db, txn, user_id=user.id, tenant_id=user.tenant_id)
    txn.consumed_at = utcnow()
    await db.commit()

    logger.info("MCP consent granted by tenant %s for client %s", user.tenant_id, txn.client_id)
    return {
        "redirect_uri": construct_redirect_uri(
            txn.redirect_uri,
            code=code,
            state=txn.state,
            # RFC 9207: lets the client prove the response came from us.
            iss=settings.OAUTH_ISSUER_URL,
        )
    }


@router.post("/oauth/authorize/deny")
async def authorize_deny(body: ConsentBody, db: AsyncSession = Depends(get_db)):
    """The player said no. Public: denying should not require being signed in."""
    txn = await _load_txn(db, body.txn, lock=True)
    txn.consumed_at = utcnow()
    await db.commit()
    return {
        "redirect_uri": construct_redirect_uri(
            txn.redirect_uri,
            error="access_denied",
            error_description="El jugador rechazó la solicitud",
            state=txn.state,
            iss=settings.OAUTH_ISSUER_URL,
        )
    }


# --------------------------------------------------------------------------
# Management (Settings screen)
# --------------------------------------------------------------------------

class PatCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    # None means no expiry. Anything else is capped at two years.
    expires_in_days: int | None = Field(default=90, ge=1, le=730)


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


@router.get("/oauth/connections")
async def list_connections(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Apps connected via OAuth, one entry per grant (not per token)."""
    rows = (await db.execute(
        select(McpToken)
        .where(
            McpToken.tenant_id == user.tenant_id,
            McpToken.kind.in_(("oauth_access", "oauth_refresh")),
            McpToken.revoked_at.is_(None),
        )
        .order_by(McpToken.created_at.desc())
    )).scalars().all()

    grants: dict[str, dict] = {}
    for row in rows:
        entry = grants.setdefault(row.grant_id, {
            "grant_id": row.grant_id,
            "client_id": row.client_id,
            "client_name": row.client_name or "Aplicación",
            "scopes": row.scopes.split(),
            "connected_at": _iso(row.created_at),
            "last_used_at": _iso(row.last_used_at),
        })
        # A grant's timestamps are the earliest connection and the latest use
        # across every rotation it has been through.
        if row.created_at and entry["connected_at"] and row.created_at.isoformat() < entry["connected_at"]:
            entry["connected_at"] = _iso(row.created_at)
        if row.last_used_at and (
            entry["last_used_at"] is None or row.last_used_at.isoformat() > entry["last_used_at"]
        ):
            entry["last_used_at"] = _iso(row.last_used_at)

    return {"connections": list(grants.values()), "connector_url": settings.MCP_RESOURCE_URL}


@router.delete("/oauth/connections/{grant_id}", status_code=204)
async def disconnect(
    grant_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Revoke a whole grant: access token, refresh token and every rotation."""
    owned = await db.scalar(
        select(McpToken.id).where(
            McpToken.grant_id == grant_id, McpToken.tenant_id == user.tenant_id
        ).limit(1)
    )
    if owned is None:
        raise HTTPException(status_code=404, detail="Conexión no encontrada")
    await revoke_grant(db, grant_id, "grant_revoked")
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/oauth/tokens")
async def list_tokens(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Personal access tokens of this player."""
    rows = (await db.execute(
        select(McpToken)
        .where(
            McpToken.tenant_id == user.tenant_id,
            McpToken.kind == "pat",
            McpToken.revoked_at.is_(None),
        )
        .order_by(McpToken.created_at.desc())
    )).scalars().all()

    now = utcnow()
    return {
        "connector_url": settings.MCP_RESOURCE_URL,
        "tokens": [
            {
                "id": r.id,
                "name": r.name,
                "token_prefix": r.token_prefix,
                "created_at": _iso(r.created_at),
                "expires_at": _iso(r.expires_at),
                "last_used_at": _iso(r.last_used_at),
                "expired": bool(r.expires_at and r.expires_at < now),
            }
            for r in rows
        ],
    }


@router.post("/oauth/tokens", status_code=201)
async def create_token_endpoint(
    body: PatCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Mint a PAT. The raw value is in this response and nowhere else, ever."""

    live = await db.scalar(
        select(func.count(McpToken.id)).where(
            McpToken.tenant_id == user.tenant_id,
            McpToken.kind == "pat",
            McpToken.revoked_at.is_(None),
        )
    )
    if live and live >= 20:
        raise HTTPException(status_code=400, detail="Llegaste al máximo de 20 tokens activos")

    raw, row = await create_pat(
        db,
        user_id=user.id,
        tenant_id=user.tenant_id,
        name=body.name.strip(),
        expires_in_days=body.expires_in_days,
    )
    await db.commit()
    return {
        "token": raw,
        "id": row.id,
        "name": row.name,
        "token_prefix": row.token_prefix,
        "expires_at": _iso(row.expires_at),
        "connector_url": settings.MCP_RESOURCE_URL,
    }


@router.delete("/oauth/tokens/{token_id}", status_code=204)
async def delete_token(
    token_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        update(McpToken)
        .where(
            McpToken.id == token_id,
            McpToken.tenant_id == user.tenant_id,
            McpToken.kind == "pat",
            McpToken.revoked_at.is_(None),
        )
        .values(revoked_at=utcnow(), revoked_reason="user")
    )
    if not result.rowcount:
        raise HTTPException(status_code=404, detail="Token no encontrado")
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
