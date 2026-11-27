"""Leaderboards: the best valid lap of every player per track, in the same game, assists and weather."""

import asyncio
import logging
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user
from app.core.database import AsyncSessionLocal, get_db
from app.live import records
from app.models import GameSession, GroupMember, LapRecord, SessionCapture, User
from app.routers.internal import require_internal_key
from app.telemetry import constants as c

logger = logging.getLogger(__name__)
router = APIRouter(tags=["leaderboard"])
GAMES = {2024: "Edición 2024", 2025: "Edición 2025", 2026: "Temporada 2026"}


def public_name(user: User | None, tenant_id: int) -> str:
    """How a player shows on a board: their radio name, else first name and initial. Never the mail."""
    if user is not None:
        if user.radio_name:
            return user.radio_name
        if user.display_name:
            parts = user.display_name.split()
            return parts[0] if len(parts) == 1 else f"{parts[0]} {parts[-1][0]}."
    return f"Piloto {tenant_id}"


@router.get("/api/leaderboard")
async def leaderboard(
    track_id: int,
    juego: int | None = Query(None, description="packet format: 2024, 2025, 2026; empty = the most played"),
    categoria: str = Query("sin_ayudas", pattern="^(sin_ayudas|con_ayudas)$"),
    clima: str = Query("seco", pattern="^(seco|mojado)$"),
    limit: int = Query(50, ge=1, le=200),
    grupo: int | None = Query(None, description="only this group's members (you must be one)"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    only = LapRecord.track_id == track_id
    if grupo is not None:
        tenants = list(await db.scalars(select(GroupMember.tenant_id).where(GroupMember.group_id == grupo)))
        if user.tenant_id not in tenants:
            raise HTTPException(404, "Group not found")
        only = and_(only, LapRecord.tenant_id.in_(tenants))
    # Which games and categories have laps on this track, so the screen offers only those.
    have = (await db.execute(
        select(LapRecord.packet_format, LapRecord.category, LapRecord.weather, func.count())
        .where(only).group_by(LapRecord.packet_format, LapRecord.category, LapRecord.weather)
    )).all()
    if juego is None and have:
        totals: dict[int, int] = {}
        for fmt, _cat, _w, n in have:
            totals[fmt] = totals.get(fmt, 0) + n
        juego = max(totals, key=totals.get)
    rows = (await db.execute(
        select(LapRecord, User).outerjoin(User, User.tenant_id == LapRecord.tenant_id)
        .where(only, LapRecord.packet_format == juego,
               LapRecord.category == categoria, LapRecord.weather == clima)
        .order_by(LapRecord.lap_ms, LapRecord.set_at)
    )).all()
    seen: set[int] = set()
    board = []
    for rec, u in rows:
        if rec.tenant_id in seen:  # a tenant with several users still shows once
            continue
        seen.add(rec.tenant_id)
        board.append((rec, u))
    best = board[0][0].lap_ms if board else None

    def out(i: int, rec: LapRecord, u: User | None) -> dict:
        return {"pos": i + 1, "nombre": public_name(u, rec.tenant_id), "tiempo_ms": rec.lap_ms,
                "sectores_ms": [rec.s1_ms, rec.s2_ms, rec.s3_ms], "dif_ms": rec.lap_ms - best if best else None,
                "equipo": rec.team, "fecha": rec.set_at.isoformat() if rec.set_at else None, "soy_yo": rec.tenant_id == user.tenant_id}

    filas = [out(i, r, u) for i, (r, u) in enumerate(board)]
    mine = next((f for f in filas if f["soy_yo"]), None)
    return {
        "pista": c.TRACKS.get(track_id, f"Pista {track_id}"),
        "juego": juego, "juego_nombre": GAMES.get(juego) if juego else None,
        "categoria": categoria, "clima": clima,
        "opciones": [{"juego": f, "juego_nombre": GAMES.get(f, str(f)), "categoria": cat, "clima": w, "pilotos": n} for f, cat, w, n in have],
        "pilotos": len(filas), "filas": filas[:limit], "yo": mine,
    }


@router.get("/api/leaderboard/mine")
async def my_positions(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> dict:
    """Where the player stands on each track they have a record on (for the circuits list)."""
    mine = (await db.execute(select(LapRecord).where(LapRecord.tenant_id == user.tenant_id))).scalars().all()
    out = {}
    for rec in mine:
        faster = await db.scalar(select(func.count(func.distinct(LapRecord.tenant_id))).where(
            LapRecord.track_id == rec.track_id, LapRecord.packet_format == rec.packet_format,
            LapRecord.category == rec.category, LapRecord.weather == rec.weather, LapRecord.lap_ms < rec.lap_ms))
        total = await db.scalar(select(func.count(func.distinct(LapRecord.tenant_id))).where(
            LapRecord.track_id == rec.track_id, LapRecord.packet_format == rec.packet_format,
            LapRecord.category == rec.category, LapRecord.weather == rec.weather))
        key = str(rec.track_id)
        entry = {"pos": faster + 1, "pilotos": total, "tiempo_ms": rec.lap_ms, "juego": rec.packet_format,
                 "categoria": rec.category, "clima": rec.weather}
        # One line per track: the most contested board (dry first, then the one with more drivers).
        prev = out.get(key)
        rank = lambda e: (e["clima"] == "seco", e["pilotos"], -e["pos"])  # noqa: E731
        if prev is None or rank(entry) > rank(prev):
            out[key] = entry
    return {"pistas": out}


# --- internal: fill the boards from the recordings already on the server ---------

def _scan(path: str) -> list[tuple[int, dict]]:
    """Replay one recording and return each session's record attempt (session uid, candidate)."""
    from app.live.state import LiveSession
    from app.replay.player import ReplaySource
    from app.telemetry import registry

    found: dict[int, dict] = {}
    live = None
    clock = {"t": 0.0}
    for t, data in ReplaySource([path]).records():
        clock["t"] = t
        try:
            packet = registry.parse(data)
        except registry.PacketError:
            continue
        if packet.session_uid == 0:
            continue
        if live is None or live.session_uid != packet.session_uid:
            if live is not None and (cand := records.candidate(live)):
                found[live.session_uid] = cand
            live = LiveSession(tenant_id=0, device_id=0, session_uid=packet.session_uid, packet_format=packet.packet_format,
                               build_layout=False, clock=lambda: clock["t"])
        live.update(packet)
    if live is not None and (cand := records.candidate(live)):
        found[live.session_uid] = cand
    return list(found.items())


async def backfill() -> None:
    async with AsyncSessionLocal() as db:
        caps = (await db.execute(select(SessionCapture, GameSession).join(GameSession, GameSession.id == SessionCapture.game_session_id))).all()
        jobs = [(cap.path, gs.tenant_id, gs.id) for cap, gs in caps if Path(cap.path).exists()]
    saved = 0
    for path, tenant_id, gs_id in jobs:
        try:
            found = await asyncio.to_thread(_scan, path)
        except Exception as e:
            logger.warning("record backfill skipped a capture", extra={"path": path, "error": str(e)})
            continue
        async with AsyncSessionLocal() as db:
            for _uid, cand in found:
                if await records.store(db, tenant_id, cand, gs_id) is not None:
                    saved += 1
            await db.commit()
    logger.info("record backfill done", extra={"captures": len(jobs), "records_saved": saved})


@router.post("/internal/records/backfill", dependencies=[Depends(require_internal_key)], status_code=202)
async def start_backfill(tasks: BackgroundTasks) -> dict:
    tasks.add_task(backfill)
    return {"started": True}
