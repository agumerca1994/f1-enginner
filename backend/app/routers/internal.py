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
from app.models import AppLog
from app.services import pairing

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
