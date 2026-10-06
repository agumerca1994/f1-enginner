import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from starlette.routing import Route

from app.core.config import settings
from app.core.logging_config import log_queue_consumer, setup_logging
from app.routers import devices, engineer, ingest, internal, live, live_ws, replay_ws

logger = logging.getLogger(__name__)


async def _daily_mcp_cleanup() -> None:
    """Drop expired OAuth codes, consent requests and old revoked tokens once a day."""
    from app.services.mcp_tokens import cleanup_expired

    while True:
        try:
            removed = await cleanup_expired()
            logger.info("mcp cleanup", extra={"removed": removed})
        except Exception:
            logger.exception("mcp cleanup failed")
        await asyncio.sleep(24 * 3600)


@asynccontextmanager
async def lifespan(app: FastAPI):
    setup_logging()
    tasks = [asyncio.create_task(log_queue_consumer())]
    logger.info("api started", extra={"environment": settings.ENVIRONMENT})
    if settings.MCP_ENABLED:
        tasks.append(asyncio.create_task(_daily_mcp_cleanup()))
        # A mounted sub-app's lifespan never runs, so the streamable-HTTP session
        # manager is started here; without it the first /mcp request fails with
        # "Task group is not initialized".
        from app.mcp_server.transport import fresh_session_manager

        async with fresh_session_manager().run():
            yield
    else:
        yield
    for task in tasks:
        task.cancel()


app = FastAPI(title="Race engineer API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(devices.router)
app.include_router(ingest.router)
app.include_router(live.router)
app.include_router(engineer.router)
app.include_router(live_ws.router)
app.include_router(replay_ws.router)
app.include_router(internal.router)
app.include_router(internal.public_router)

# The connector's paths need their own CORS rules: the middleware above sends
# `allow_credentials=True`, which a browser refuses to pair with `*`, but
# claude.ai and the MCP Inspector probe discovery from any origin, without
# cookies. Added last, so it is the outermost and answers those preflights.
_MCP_CORS_PATHS = ("/mcp", "/oauth/", "/.well-known/")
# Called by our own web app (consent screen and Settings): they keep the app's CORS.
_APP_OAUTH_PATHS = ("/oauth/authorize/", "/oauth/connections", "/oauth/tokens")
_MCP_CORS_HEADERS = "authorization, content-type, mcp-session-id, mcp-protocol-version, last-event-id, accept"


@app.middleware("http")
async def mcp_cors_middleware(request: Request, call_next):
    path = request.url.path
    if not (path == "/mcp" or path.startswith(_MCP_CORS_PATHS)) or path.startswith(_APP_OAUTH_PATHS):
        return await call_next(request)
    response = Response(status_code=204) if request.method == "OPTIONS" else await call_next(request)
    response.headers["access-control-allow-origin"] = "*"
    response.headers["access-control-allow-methods"] = "GET, POST, DELETE, OPTIONS"
    response.headers["access-control-allow-headers"] = _MCP_CORS_HEADERS
    response.headers["access-control-expose-headers"] = "mcp-session-id, www-authenticate"
    response.headers["access-control-max-age"] = "3600"
    if "access-control-allow-credentials" in response.headers:
        del response.headers["access-control-allow-credentials"]
    return response


if settings.MCP_ENABLED:
    from app.mcp_server.transport import build_mcp_asgi
    from app.routers import oauth

    app.include_router(oauth.router)
    # A plain Route, not app.mount(): mounting answers POST /mcp with a 307 to
    # /mcp/, giving the RFC 8707 canonical resource two spellings.
    app.router.routes.append(Route("/mcp", endpoint=build_mcp_asgi(), methods=["GET", "POST", "DELETE"]))


@app.get("/health")
async def health():
    return {"status": "ok"}
