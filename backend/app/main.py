import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.core.logging_config import log_queue_consumer, setup_logging
from app.routers import devices, engineer, ingest, internal, live, live_ws, replay_ws

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    setup_logging()
    consumer = asyncio.create_task(log_queue_consumer())
    logger.info("api started", extra={"environment": settings.ENVIRONMENT})
    yield
    consumer.cancel()


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


@app.get("/health")
async def health():
    return {"status": "ok"}
