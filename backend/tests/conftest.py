"""Integration tests run against the local Postgres from docker-compose.yml
(`docker compose up -d db`), in a separate `engineer_test` database."""

import asyncio
import os
import tempfile

import pytest

TEST_DB = "engineer_test"
ADMIN_URL = "postgresql://engineer:engineer@localhost:5433/engineer"
CAPTURE_DIR = tempfile.mkdtemp(prefix="captures-")

os.environ.update(
    DATABASE_URL=f"postgresql+asyncpg://engineer:engineer@localhost:5433/{TEST_DB}",
    DATABASE_NULL_POOL="true",
    ENVIRONMENT="test",
    AUTH_DEV_MODE="true",
    INTERNAL_LOG_KEY="test-internal-key",
    CAPTURE_DIR=CAPTURE_DIR,
    FRONTEND_URL="https://app.example.test",
)


async def _reset_database() -> None:
    import asyncpg
    from sqlalchemy.ext.asyncio import create_async_engine

    import app.models  # noqa: F401
    from app.core.config import settings
    from app.core.database import Base

    admin = await asyncpg.connect(ADMIN_URL)
    try:
        exists = await admin.fetchval("SELECT 1 FROM pg_database WHERE datname = $1", TEST_DB)
        if not exists:
            await admin.execute(f'CREATE DATABASE "{TEST_DB}"')
    finally:
        await admin.close()

    engine = create_async_engine(settings.DATABASE_URL)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    await engine.dispose()


def _postgres_available() -> bool:
    import socket

    try:
        socket.create_connection(("localhost", 5433), timeout=1).close()
        return True
    except OSError:
        return False


@pytest.fixture(scope="session")
def database():
    if not _postgres_available():
        pytest.skip("local Postgres not running (docker compose up -d db)")
    asyncio.run(_reset_database())


@pytest.fixture
def client(database):
    from fastapi.testclient import TestClient

    from app.live.state import live_store
    from app.main import app

    live_store.clear()
    with TestClient(app) as c:
        yield c
