"""Operator endpoints behind `x-internal-key`: logs for the logs MCP, and a way to
pair a bridge before the web app's pairing page exists.

Log endpoints ported from registrapp (backend/app/routers/internal_logs.py).
"""

import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_or_create_user
from app.core.config import settings
from app.core.database import get_db
from app.live import snapshot
from app.live.state import live_store
from app.models import AppLog, Device, GameSession, User
from app.services import pairing
from app.telemetry import constants as c

router = APIRouter(prefix="/internal", tags=["internal"])

LEVEL_ORDER = {"DEBUG": 0, "INFO": 1, "WARNING": 2, "ERROR": 3, "CRITICAL": 4}


def require_internal_key(x_internal_key: str = Header(...)) -> None:
    # compare_digest: these endpoints read across tenants, don't leak a timing oracle.
    if not settings.INTERNAL_LOG_KEY or not secrets.compare_digest(x_internal_key, settings.INTERNAL_LOG_KEY):
        raise HTTPException(status_code=403, detail="Invalid internal key")


@router.get("/logs", dependencies=[Depends(require_internal_key)])
async def get_logs(
    level: str = Query("WARNING"),
    hours: int = Query(24, ge=1, le=720),
    limit: int = Query(50, ge=1, le=200),
    search: str | None = Query(None),
    module: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    min_level = LEVEL_ORDER.get(level.upper(), 2)
    conditions = [
        AppLog.created_at >= datetime.now(timezone.utc) - timedelta(hours=hours),
        AppLog.level.in_([k for k, v in LEVEL_ORDER.items() if v >= min_level]),
    ]
    if search:
        conditions.append(AppLog.message.ilike(f"%{search}%"))
    if module:
        conditions.append(AppLog.logger_name.ilike(f"%{module}%"))

    total = await db.scalar(select(func.count()).select_from(AppLog).where(and_(*conditions)))
    rows = await db.scalars(
        select(AppLog).where(and_(*conditions)).order_by(AppLog.created_at.desc()).limit(limit)
    )
    return {
        "total": total,
        "hours": hours,
        "level": level.upper(),
        "items": [
            {
                "id": r.id,
                "created_at": r.created_at.isoformat(),
                "level": r.level,
                "logger_name": r.logger_name,
                "message": r.message,
                "module": r.module,
                "request_path": r.request_path,
                "status_code": r.status_code,
                "user_id": r.user_id,
                "tenant_id": r.tenant_id,
                "traceback": r.traceback,
                "extra": r.extra,
            }
            for r in rows
        ],
    }


@router.get("/logs/summary", dependencies=[Depends(require_internal_key)])
async def get_logs_summary(hours: int = Query(24, ge=1, le=720), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(
        select(AppLog.level, func.count().label("count"))
        .where(AppLog.created_at >= datetime.now(timezone.utc) - timedelta(hours=hours))
        .group_by(AppLog.level)
    )).all()
    counts = {r.level: r.count for r in rows}
    return {"hours": hours, **{lvl: counts.get(lvl, 0) for lvl in LEVEL_ORDER}}


@router.get("/devices", dependencies=[Depends(require_internal_key)])
async def list_all_devices(limit: int = Query(50, ge=1, le=500), db: AsyncSession = Depends(get_db)):
    """Diagnostics: every bridge, when it was last seen and how much of the game's telemetry it receives."""
    rows = (await db.execute(
        select(Device, User.email).join(User, User.id == Device.user_id)
        .order_by(Device.last_seen_at.desc().nulls_last()).limit(limit)
    )).all()
    return [
        {
            "id": d.id,
            "email": email,
            "tenant_id": d.tenant_id,
            "name": d.name,
            "os": d.os,
            "bridge_version": d.bridge_version,
            "last_seen_at": d.last_seen_at.isoformat() if d.last_seen_at else None,
            "last_reception": d.last_reception,
            "revoked": d.revoked_at is not None,
        }
        for d, email in rows
    ]


@router.get("/sessions", dependencies=[Depends(require_internal_key)])
async def list_all_sessions(limit: int = Query(20, ge=1, le=200), db: AsyncSession = Depends(get_db)):
    """Diagnostics: the latest game sessions received, across all players."""
    rows = await db.scalars(select(GameSession).order_by(GameSession.started_at.desc()).limit(limit))
    return [
        {
            "id": g.id,
            "tenant_id": g.tenant_id,
            "device_id": g.device_id,
            "session_uid": g.session_uid,
            "game_version": g.game_version,
            "track": c.TRACKS.get(g.track_id) if g.track_id is not None else None,
            "session_type": c.SESSION_TYPES.get(g.session_type) if g.session_type is not None else None,
            "started_at": g.started_at.isoformat(),
            "last_packet_at": g.last_packet_at.isoformat() if g.last_packet_at else None,
            "ended_at": g.ended_at.isoformat() if g.ended_at else None,
            "packets_received": g.packets_received,
            "packets_rejected": g.packets_rejected,
        }
        for g in rows
    ]


@router.get("/live", dependencies=[Depends(require_internal_key)])
async def live_sessions(tenant_id: int | None = Query(None)):
    """Diagnostics: the in-memory live state. With tenant_id, that player's full snapshot."""
    if tenant_id is not None:
        state = live_store.get(tenant_id)
        if state is None:
            raise HTTPException(404, "No live state for that tenant")
        return snapshot.build(state)
    return [
        {
            "tenant_id": s.tenant_id,
            "device_id": s.device_id,
            "session_uid": f"{s.session_uid:016x}",
            "packets": s.packets,
            "reception": s.reception,
            "seconds_since_last_packet": round(s.age_since_update(), 1),
        }
        for s in live_store.all()
    ]


class InternalPairConfirmIn(BaseModel):
    user_code: str = Field(max_length=20)
    email: str = Field(max_length=255)


@router.post("/devices/pair/confirm", dependencies=[Depends(require_internal_key)])
async def internal_pair_confirm(body: InternalPairConfirmIn, db: AsyncSession = Depends(get_db)):
    """Confirm a bridge's pairing code on behalf of a player, creating the account if needed.

    Stand-in for the web app's /pair page until P2; the player never sees this endpoint.
    """
    user = await get_or_create_user(db, email=body.email, firebase_uid=None, name=None)
    try:
        req = await pairing.confirm(db, user=user, user_code=body.user_code)
    except pairing.PairingError as e:
        raise HTTPException(404, str(e))
    return {"user_id": user.id, "tenant_id": user.tenant_id, "device_name": req.name}
