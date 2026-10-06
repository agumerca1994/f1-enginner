"""Who is calling a tool.

The authenticated caller does not arrive as a header. The chain is:

    BearerAuthBackend     → verifies the token, puts an AuthenticatedUser in scope
    AuthContextMiddleware → copies it into a contextvar
    get_access_token()    → reads that contextvar from inside the tool

`tenant_id` travels inside `AccessToken.claims`, so a tool never loads a `User`.
"""

import logging
from dataclasses import dataclass

from mcp.server.auth.middleware.auth_context import get_access_token
from mcp.server.fastmcp.exceptions import ToolError
from sqlalchemy import select

from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.models import User
from app.services.mcp_tokens import READ_SCOPE

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class McpCaller:
    user_id: int
    tenant_id: int
    scopes: tuple[str, ...]
    client_name: str | None = None


async def _dev_caller() -> McpCaller:
    """MCP_AUTH_DISABLED only (never in production): act as the first player."""
    async with AsyncSessionLocal() as db:
        user = await db.scalar(select(User).order_by(User.id).limit(1))
    if user is None:
        raise ToolError("No hay jugadores en la base de datos (modo dev sin auth)")
    logger.warning("MCP running without auth", extra={"user_id": user.id})
    return McpCaller(user_id=user.id, tenant_id=user.tenant_id, scopes=(READ_SCOPE,), client_name="dev")


async def current_caller() -> McpCaller:
    """The player behind the bearer token of the current request."""
    token = get_access_token()
    if token is None:
        if settings.MCP_AUTH_DISABLED:
            return await _dev_caller()
        raise ToolError("No autenticado")
    claims = token.claims or {}
    if "tenant_id" not in claims or "user_id" not in claims:
        raise ToolError("Token sin identidad de jugador")
    if READ_SCOPE not in token.scopes:
        raise ToolError(f"El token no tiene permiso de lectura ({READ_SCOPE})")
    return McpCaller(
        user_id=int(claims["user_id"]),
        tenant_id=int(claims["tenant_id"]),
        scopes=tuple(token.scopes),
        client_name=claims.get("client_name"),
    )
