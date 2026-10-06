"""The OAuth 2.1 authorization server behind the MCP connector (ported from registrapp).

The SDK already implements the protocol itself — PKCE enforcement, redirect_uri
validation, code expiry, RFC 6749 error shapes, client authentication. What
lives here is only the storage and the policy: nine provider methods on top of
Postgres.

The part that is genuinely ours is the *login*. There is no password: the
player signs in with Google through Firebase, in the Next.js frontend. So
`authorize()` doesn't render anything — it parks the request as a "transaction"
row and redirects the browser to `{FRONTEND_URL}/oauth/authorize?txn=...`. The
consent page there authenticates the player the way the rest of the app does, and
calls back into `POST /oauth/authorize/consent`, which is what actually mints
the code.

Three things the SDK does *not* do, and we must:
- validate the RFC 8707 `resource` (it carries it around but never compares it),
- emit `iss` on the authorization response (RFC 9207),
- advertise `authorization_response_iss_parameter_supported`.
"""
import logging
import secrets
from datetime import timedelta
from urllib.parse import urlparse

from mcp.server.auth.provider import (
    AuthorizationCode, AuthorizationParams, AuthorizeError,
    OAuthAuthorizationServerProvider, RefreshToken, RegistrationError, TokenError,
)
from mcp.shared.auth import OAuthClientInformationFull, OAuthToken
from pydantic import AnyUrl
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import utcnow
from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.core.security import hash_token
from app.models import McpAuthCode, McpOAuthAuthorization, McpOAuthClient, McpToken
from app.services.mcp_tokens import READ_SCOPE, EngineerTokenVerifier, create_token, revoke_grant

logger = logging.getLogger(__name__)

MAX_REDIRECT_URIS = 5
AUTH_CODE_TTL = timedelta(seconds=60)
TXN_TTL = timedelta(minutes=10)


class EngineerAuthorizationCode(AuthorizationCode):
    """The SDK's code plus the player it was approved for."""
    user_id: int
    tenant_id: int


class EngineerRefreshToken(RefreshToken):
    row_id: int
    user_id: int
    tenant_id: int
    grant_id: str
    resource: str | None = None


def _validate_redirect_uris(uris: list[AnyUrl]) -> None:
    """Reject redirect URIs that would make the flow unsafe.

    Custom schemes (`claude://`) are fine — desktop clients need them. Plain
    HTTP is only tolerated on loopback, and a fragment is never allowed because
    the authorization response is appended to the query.
    """
    if not uris:
        raise RegistrationError("invalid_redirect_uri", "Se requiere al menos un redirect_uri")
    if len(uris) > MAX_REDIRECT_URIS:
        raise RegistrationError(
            "invalid_redirect_uri", f"Máximo {MAX_REDIRECT_URIS} redirect_uris"
        )
    for uri in uris:
        parsed = urlparse(str(uri))
        if parsed.fragment:
            raise RegistrationError("invalid_redirect_uri", "redirect_uri no puede tener fragment")
        if parsed.scheme == "http" and parsed.hostname not in ("localhost", "127.0.0.1", "::1"):
            raise RegistrationError(
                "invalid_redirect_uri", "http:// sólo está permitido en localhost"
            )


class EngineerOAuthProvider(
    OAuthAuthorizationServerProvider[
        EngineerAuthorizationCode, EngineerRefreshToken, "object"
    ]
):
    # --- clients ---------------------------------------------------------

    async def get_client(self, client_id: str) -> OAuthClientInformationFull | None:
        async with AsyncSessionLocal() as db:
            row = await db.get(McpOAuthClient, client_id)
        if row is None:
            return None
        return OAuthClientInformationFull(
            client_id=row.client_id,
            client_secret=row.client_secret,
            client_id_issued_at=row.client_id_issued_at,
            client_secret_expires_at=row.client_secret_expires_at,
            redirect_uris=row.redirect_uris,
            grant_types=row.grant_types or ["authorization_code", "refresh_token"],
            response_types=row.response_types or ["code"],
            scope=row.scope,
            client_name=row.client_name,
            client_uri=row.client_uri,
            logo_uri=row.logo_uri,
            token_endpoint_auth_method=row.token_endpoint_auth_method,
            software_id=row.software_id,
            software_version=row.software_version,
        )

    async def register_client(self, client_info: OAuthClientInformationFull) -> None:
        if not settings.MCP_DCR_ENABLED:
            raise RegistrationError(
                "invalid_client_metadata", "El registro dinámico está deshabilitado"
            )
        _validate_redirect_uris(client_info.redirect_uris)

        async with AsyncSessionLocal() as db:
            db.add(McpOAuthClient(
                client_id=client_info.client_id,
                client_secret=client_info.client_secret,
                client_id_issued_at=client_info.client_id_issued_at,
                client_secret_expires_at=client_info.client_secret_expires_at,
                client_name=client_info.client_name,
                client_uri=str(client_info.client_uri) if client_info.client_uri else None,
                logo_uri=str(client_info.logo_uri) if client_info.logo_uri else None,
                redirect_uris=[str(u) for u in client_info.redirect_uris],
                grant_types=list(client_info.grant_types or []),
                response_types=list(client_info.response_types or []),
                scope=client_info.scope,
                token_endpoint_auth_method=client_info.token_endpoint_auth_method,
                software_id=client_info.software_id,
                software_version=client_info.software_version,
            ))
            await db.commit()
        logger.info("MCP OAuth client registered: %s", client_info.client_name)

    # --- authorization ---------------------------------------------------

    async def authorize(
        self, client: OAuthClientInformationFull, params: AuthorizationParams
    ) -> str:
        """Park the request and send the browser to the app's consent screen."""
        self._require_known_resource(params.resource)

        scopes = params.scopes or [READ_SCOPE]
        unknown = set(scopes) - {READ_SCOPE}
        if unknown:
            raise AuthorizeError("invalid_scope", f"Scope desconocido: {', '.join(unknown)}")

        txn_id = secrets.token_urlsafe(24)
        async with AsyncSessionLocal() as db:
            db.add(McpOAuthAuthorization(
                txn_id=txn_id,
                client_id=client.client_id,
                redirect_uri=str(params.redirect_uri),
                redirect_uri_provided_explicitly=params.redirect_uri_provided_explicitly,
                state=params.state,
                scopes=" ".join(scopes),
                code_challenge=params.code_challenge,
                resource=params.resource,
                expires_at=utcnow() + TXN_TTL,
            ))
            await db.commit()

        return f"{settings.FRONTEND_URL.rstrip('/')}/oauth/authorize?txn={txn_id}"

    async def load_authorization_code(
        self, client: OAuthClientInformationFull, authorization_code: str
    ) -> EngineerAuthorizationCode | None:
        async with AsyncSessionLocal() as db:
            row = await db.get(McpAuthCode, hash_token(authorization_code))
        if row is None or row.used_at is not None or row.client_id != client.client_id:
            return None
        return EngineerAuthorizationCode(
            code=authorization_code,
            scopes=row.scopes.split(),
            expires_at=row.expires_at.timestamp(),
            client_id=row.client_id,
            code_challenge=row.code_challenge,
            redirect_uri=AnyUrl(row.redirect_uri),
            redirect_uri_provided_explicitly=row.redirect_uri_provided_explicitly,
            resource=row.resource,
            subject=f"user:{row.user_id}",
            user_id=row.user_id,
            tenant_id=row.tenant_id,
        )

    async def exchange_authorization_code(
        self, client: OAuthClientInformationFull, authorization_code: EngineerAuthorizationCode
    ) -> OAuthToken:
        """PKCE, expiry and redirect_uri were already checked by the handler."""
        self._require_known_resource(authorization_code.resource, TokenError)

        async with AsyncSessionLocal() as db:
            # Burn the code atomically. A check-then-set would let two
            # simultaneous exchanges both succeed.
            burned = await db.execute(
                update(McpAuthCode)
                .where(
                    McpAuthCode.code_hash == hash_token(authorization_code.code),
                    McpAuthCode.used_at.is_(None),
                )
                .values(used_at=utcnow())
                .returning(McpAuthCode.code_hash)
            )
            if burned.first() is None:
                await db.rollback()
                raise TokenError("invalid_grant", "El código ya fue usado o expiró")

            token = await self._issue_pair(
                db,
                user_id=authorization_code.user_id,
                tenant_id=authorization_code.tenant_id,
                client=client,
                scopes=authorization_code.scopes,
                resource=authorization_code.resource,
                grant_id=f"grant_{secrets.token_urlsafe(16)}",
            )
            await db.commit()
        return token

    # --- refresh ---------------------------------------------------------

    async def load_refresh_token(
        self, client: OAuthClientInformationFull, refresh_token: str
    ) -> EngineerRefreshToken | None:
        async with AsyncSessionLocal() as db:
            row = await db.scalar(
                select(McpToken).where(
                    McpToken.token_hash == hash_token(refresh_token),
                    McpToken.kind == "oauth_refresh",
                )
            )
        if row is None or row.client_id != client.client_id:
            return None
        # A revoked row is still returned on purpose: exchange_refresh_token
        # needs to see it to detect replay of an already-rotated token.
        return EngineerRefreshToken(
            token=refresh_token,
            client_id=row.client_id,
            scopes=row.scopes.split(),
            expires_at=int(row.expires_at.timestamp()) if row.expires_at else None,
            subject=f"user:{row.user_id}",
            row_id=row.id,
            user_id=row.user_id,
            tenant_id=row.tenant_id,
            grant_id=row.grant_id,
            resource=row.resource,
        )

    async def exchange_refresh_token(
        self,
        client: OAuthClientInformationFull,
        refresh_token: EngineerRefreshToken,
        scopes: list[str],
    ) -> OAuthToken:
        """Rotate the pair, and treat a replayed refresh token as theft."""
        async with AsyncSessionLocal() as db:
            row = await db.get(McpToken, refresh_token.row_id)
            if row is None:
                raise TokenError("invalid_grant", "Refresh token desconocido")

            if row.revoked_at is not None:
                # Someone is presenting a token that was already rotated away.
                # Either it leaked or the client is buggy; either way the whole
                # grant dies rather than staying in a half-trusted state.
                await revoke_grant(db, row.grant_id, "reuse_detected")
                await db.commit()
                logger.warning("Refresh token reuse detected for grant %s", row.grant_id)
                raise TokenError("invalid_grant", "Refresh token reutilizado")

            if row.expires_at is not None and row.expires_at < utcnow():
                raise TokenError("invalid_grant", "Refresh token expirado")

            granted = set(row.scopes.split())
            requested = set(scopes) if scopes else granted
            if requested - granted:
                raise TokenError("invalid_scope", "Scope mayor al otorgado")

            row.revoked_at = utcnow()
            row.revoked_reason = "rotated"

            token = await self._issue_pair(
                db,
                user_id=row.user_id,
                tenant_id=row.tenant_id,
                client=client,
                scopes=sorted(requested),
                resource=row.resource,
                grant_id=row.grant_id,
                parent_id=row.id,
            )
            await db.commit()
        return token

    # --- token verification / revocation ---------------------------------

    async def load_access_token(self, token: str):
        return await EngineerTokenVerifier().verify_token(token)

    async def revoke_token(self, token) -> None:
        """RFC 7009. Revoking either half of a grant takes down the whole grant."""
        raw = getattr(token, "token", None)
        if not raw:
            return
        async with AsyncSessionLocal() as db:
            row = await db.scalar(
                select(McpToken).where(McpToken.token_hash == hash_token(raw))
            )
            if row is not None:
                await revoke_grant(db, row.grant_id, "user")
                await db.commit()

    # --- helpers ---------------------------------------------------------

    def _require_known_resource(self, resource: str | None, error=AuthorizeError) -> None:
        """Reject a token request aimed at anything but this MCP server.

        This is the confused-deputy defence: without it, a token minted here
        could be replayed against a different resource that trusts the same
        issuer. Enforced again at exchange time and once more in the verifier.
        """
        if resource and resource.rstrip("/") != settings.MCP_RESOURCE_URL:
            raise error("invalid_request", f"Recurso desconocido: {resource}")

    async def _issue_pair(
        self,
        db: AsyncSession,
        *,
        user_id: int,
        tenant_id: int,
        client: OAuthClientInformationFull,
        scopes: list[str],
        resource: str | None,
        grant_id: str,
        parent_id: int | None = None,
    ) -> OAuthToken:
        scope_str = " ".join(scopes)
        common = dict(
            user_id=user_id,
            tenant_id=tenant_id,
            grant_id=grant_id,
            scopes=scope_str,
            client_id=client.client_id,
            client_name=client.client_name,
            # Bind the token to this MCP server even when the client didn't send
            # a `resource`, so the verifier's audience check always has teeth.
            resource=resource or settings.MCP_RESOURCE_URL,
        )
        access_raw, _ = await create_token(
            db,
            kind="oauth_access",
            expires_at=utcnow() + timedelta(seconds=settings.MCP_ACCESS_TOKEN_TTL_SECONDS),
            parent_id=parent_id,
            **common,
        )
        refresh_raw, _ = await create_token(
            db,
            kind="oauth_refresh",
            expires_at=utcnow() + timedelta(days=settings.MCP_REFRESH_TOKEN_TTL_DAYS),
            parent_id=parent_id,
            **common,
        )
        return OAuthToken(
            access_token=access_raw,
            token_type="Bearer",
            expires_in=settings.MCP_ACCESS_TOKEN_TTL_SECONDS,
            scope=scope_str,
            refresh_token=refresh_raw,
        )


async def mint_authorization_code(
    db: AsyncSession, txn: McpOAuthAuthorization, *, user_id: int, tenant_id: int
) -> str:
    """Turn an approved consent transaction into a one-shot authorization code."""
    code = secrets.token_urlsafe(32)  # 256 bits; the spec asks for ≥128
    db.add(McpAuthCode(
        code_hash=hash_token(code),
        client_id=txn.client_id,
        user_id=user_id,
        tenant_id=tenant_id,
        scopes=txn.scopes,
        code_challenge=txn.code_challenge,
        redirect_uri=txn.redirect_uri,
        redirect_uri_provided_explicitly=txn.redirect_uri_provided_explicitly,
        resource=txn.resource,
        expires_at=utcnow() + AUTH_CODE_TTL,
    ))
    return code

