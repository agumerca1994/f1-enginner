from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user
from app.core.database import get_db
from app.live import snapshot
from app.live.state import live_store
from app.models import GameSession, SessionCapture, TrackLayout, User
from app.telemetry import constants as c

router = APIRouter(prefix="/api", tags=["live"])


@router.get("/me")
async def me(user: User = Depends(get_current_user)):
    return {"id": user.id, "email": user.email, "display_name": user.display_name, "tenant_id": user.tenant_id}


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
    has_recording: bool


@router.get("/sessions", response_model=list[GameSessionOut])
async def sessions(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    rows = list(await db.scalars(
        select(GameSession)
        .where(GameSession.tenant_id == user.tenant_id)
        .order_by(GameSession.started_at.desc())
        .limit(50)
    ))
    recorded = set(await db.scalars(
        select(SessionCapture.game_session_id).where(SessionCapture.game_session_id.in_([g.id for g in rows]))
    ))
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
            has_recording=g.id in recorded,
        )
        for g in rows
    ]


@router.get("/tracks/{track_id}/layout")
async def track_layout(track_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """The circuit outline built from telemetry, as polylines of [x, z] world coordinates."""
    live_state = live_store.get(user.tenant_id)
    if live_state is not None and live_state.track_id == track_id and live_state.layout is not None:
        b = live_state.layout  # freshest: includes this session's samples not saved yet
        return {"track_id": track_id, "length_m": b.track_length, "coverage": round(b.coverage, 3),
                "ready": b.ready, "segments": b.segments()}
    row = await db.get(TrackLayout, track_id)
    if row is None:
        raise HTTPException(404, "No outline for this track yet: it is drawn during the first lap")
    return {"track_id": track_id, "length_m": row.track_length_m, "coverage": round(row.coverage, 3),
            "ready": row.ready, "segments": row.points}
