from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user
from app.core.database import get_db
from app.live import snapshot
from app.live.state import live_store
from app.models import GameSession, User
from app.telemetry import constants as c

router = APIRouter(prefix="/api", tags=["live"])


@router.get("/live")
async def live(user: User = Depends(get_current_user)):
    """The player's current race as seen from the latest packets. The dashboard's source until P2 adds push."""
    state = live_store.get(user.tenant_id)
    if state is None:
        raise HTTPException(404, "No telemetry received yet. Is the bridge running?")
    return snapshot.build(state)


class GameSessionOut(BaseModel):
    id: int
    session_uid: str
    game_version: str | None
    track: str | None
    session_type: str | None
    total_laps: int | None
    online: bool | None
    started_at: datetime
    last_packet_at: datetime | None
    ended_at: datetime | None
    packets_received: int


@router.get("/sessions", response_model=list[GameSessionOut])
async def sessions(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    rows = await db.scalars(
        select(GameSession)
        .where(GameSession.tenant_id == user.tenant_id)
        .order_by(GameSession.started_at.desc())
        .limit(50)
    )
    return [
        GameSessionOut(
            id=g.id,
            session_uid=g.session_uid,
            game_version=g.game_version,
            track=c.TRACKS.get(g.track_id) if g.track_id is not None else None,
            session_type=c.SESSION_TYPES.get(g.session_type) if g.session_type is not None else None,
            total_laps=g.total_laps,
            online=bool(g.network_game) if g.network_game is not None else None,
            started_at=g.started_at,
            last_packet_at=g.last_packet_at,
            ended_at=g.ended_at,
            packets_received=g.packets_received,
        )
        for g in rows
    ]
