"""The BOX tab: laps, setups and lap-against-lap telemetry of a recorded session."""

import re

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user
from app.core.database import get_db
from app.engineer import box
from app.engineer.review import SessionReview, review_for
from app.engineer.runner import engineer_hub
from app.engineer.traces import trace_json
from app.models import GameSession, SessionCapture, TrackLayout, User
from app.telemetry import constants as c

router = APIRouter(prefix="/api/sessions", tags=["box"])

_LAP_REF = re.compile(r"^(\d{1,2}):(\d{1,3})$")  # "car slot:lap number"


async def _review(session_id: int, user: User, db: AsyncSession) -> tuple[GameSession, SessionReview]:
    g = await db.get(GameSession, session_id)
    if g is None or g.tenant_id != user.tenant_id:
        raise HTTPException(404, "Session not found")
    paths = list(await db.scalars(select(SessionCapture.path).where(SessionCapture.game_session_id == g.id)))
    live = engineer_hub.runner(user.tenant_id).game_session_id == g.id
    if not paths and not live:
        raise HTTPException(404, "This session has no recording")
    layout = await db.get(TrackLayout, g.track_id) if g.track_id is not None else None
    r = await review_for(user.tenant_id, g.id, paths, layout.corners if layout is not None else None)
    if r is None:
        raise HTTPException(422, "The recording could not be read")
    # A track opened before corner maps were stored gets this session's, so its numbers stay from now on.
    if layout is not None and layout.corners is None and r.corners is not None and r.corners.corner_list():
        if r.corners.track_length and abs(layout.track_length_m - r.corners.track_length) < 1:
            layout.corners = r.corners.corner_list()
            await db.commit()
    return g, r


def _parse(ref: str) -> tuple[int, int]:
    m = _LAP_REF.match(ref)
    if m is None:
        raise HTTPException(422, "Laps are given as car:lap, e.g. 19:5")
    return int(m.group(1)), int(m.group(2))


@router.get("/{session_id}/box")
async def overview(session_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """The player's laps with their setup and data coverage, the setups used and the other cars' best laps."""
    g, r = await _review(session_id, user, db)
    return {
        "sesion": {
            "id": g.id,
            "pista": c.TRACKS.get(g.track_id) if g.track_id is not None else None,
            "track_id": g.track_id,
            "tipo": c.SESSION_TYPES.get(g.session_type) if g.session_type is not None else None,
            "inicio": g.started_at.isoformat(),
            "en_curso": g.ended_at is None,
        },
        **box.overview(r),
    }


@router.get("/{session_id}/box/compare")
async def compare(session_id: int, a: str, b: str, user: User = Depends(get_current_user),
                  db: AsyncSession = Depends(get_db)):
    """Two laps' speed, throttle, brake and gear by distance, and the corner-by-corner comparison of B against A."""
    _, r = await _review(session_id, user, db)
    out = box.comparison(r, _parse(a), _parse(b))
    if out is None:
        raise HTTPException(404, "No trace for one of those laps")
    return out


@router.get("/{session_id}/box/trace")
async def trace(session_id: int, lap: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """One lap's trace (a reference for the live chart)."""
    _, r = await _review(session_id, user, db)
    t = r.traces.trace(*_parse(lap)) if r.traces else None
    if t is None:
        raise HTTPException(404, "No trace for that lap")
    return trace_json(t)


@router.get("/{session_id}/box/live")
async def live_lap(session_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """The player's lap in progress, as far as it has been driven: the BOX chart draws it while the car runs."""
    g = await db.get(GameSession, session_id)
    if g is None or g.tenant_id != user.tenant_id:
        raise HTTPException(404, "Session not found")
    runner = engineer_hub.runner(user.tenant_id)
    if runner.game_session_id != g.id or runner.traces is None:
        raise HTTPException(404, "This session is not being driven now")
    t = runner.traces.current()
    if t is None:
        raise HTTPException(404, "No lap in progress yet")
    completed = sorted(runner.traces.player_laps)
    return {**trace_json(t), "en_curso": True, "ultima_completa": completed[-1] if completed else None}
