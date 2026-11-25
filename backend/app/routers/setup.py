"""Starting setups: the app's base setup for a track and the player's best one there."""

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user
from app.core.database import get_db
from app.engineer.base_setup import base_setup
from app.models import TrackKnowledge, User
from app.telemetry import constants as c

router = APIRouter(prefix="/api/setup", tags=["setup"])


@router.get("/tracks")
async def tracks(user: User = Depends(get_current_user)):
    """Every track the game knows, for picking a base setup without a session."""
    return [{"id": tid, "pista": name} for tid, name in sorted(c.TRACKS.items(), key=lambda kv: kv[1])]


@router.get("/base")
async def base(track_id: int, lluvia: bool = False, user: User = Depends(get_current_user),
               db: AsyncSession = Depends(get_db)):
    """The app's base setup for the track and, if the player has run there, the setup of their best clean lap."""
    row = await db.scalar(
        select(TrackKnowledge).where(TrackKnowledge.tenant_id == user.tenant_id, TrackKnowledge.track_id == track_id)
    )
    best = ((row.summary or {}).get("mejor_reglaje") or {}).get("lluvia" if lluvia else "seco") if row else None
    return {**base_setup(track_id, lluvia), "tu_mejor": best}


_COMPOUND_ES = {"Soft": "blandos", "Medium": "medios", "Hard": "duros", "Intermediate": "intermedios", "Wet": "de lluvia"}


def _best_lap(summary: dict | None) -> float | None:
    if not summary:
        return None
    times = [v.get("mejor_s") for v in (summary.get("compuestos") or {}).values() if v.get("mejor_s")]
    times += [v.get("vuelta_s") for v in (summary.get("mejor_reglaje") or {}).values() if isinstance(v, dict) and v.get("vuelta_s")]
    return min(times) if times else None


def _dec(value: float, digits: int = 1) -> str:
    return f"{value:.{digits}f}".replace(".", ",")


def _lap(s: float) -> str:
    return f"{int(s // 60)}:{s % 60:06.3f}".replace(".", ",")


def knowledge_notes(summary: dict | None) -> list[str]:
    """What the player's sessions taught about a track, in plain sentences (written by code)."""
    if not summary:
        return []
    notes = []
    for compound, v in (summary.get("compuestos") or {}).items():
        name = _COMPOUND_ES.get(compound, compound)
        line = f"Con {name} tu ritmo limpio es {_lap(v['ritmo_medio_s'])}"
        deg = v.get("degradacion_s_por_vuelta")
        if deg is not None and deg > 0.02:
            line += f" y perdés {_dec(deg, 2)} s por vuelta de goma"
        notes.append(line + ".")
    if summary.get("consumo_kg_por_vuelta"):
        notes.append(f"Gastás {_dec(summary['consumo_kg_por_vuelta'])} kg de combustible por vuelta.")
    if summary.get("perdida_box_s"):
        notes.append(f"Una parada en boxes te cuesta {_dec(summary['perdida_box_s'])} s.")
    return notes


@router.get("/circuits")
async def circuits(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """The tracks the player has driven, most recent first, with their best lap there."""
    from sqlalchemy import func

    from app.models import GameSession
    from app.models.game_session import meaningful_session

    rows = (await db.execute(
        select(GameSession.track_id, func.count(GameSession.id), func.max(GameSession.started_at))
        .where(GameSession.tenant_id == user.tenant_id, meaningful_session())
        .group_by(GameSession.track_id).order_by(func.max(GameSession.started_at).desc())
    )).all()
    known = {k.track_id: k.summary for k in await db.scalars(select(TrackKnowledge).where(TrackKnowledge.tenant_id == user.tenant_id))}
    return [
        {"id": tid, "pista": c.TRACKS.get(tid, f"Pista {tid}"), "sesiones": n, "ultima": last.isoformat(),
         "mejor_vuelta_s": _best_lap(known.get(tid))}
        for tid, n, last in rows
    ]


@router.get("/circuits/{track_id}")
async def circuit(track_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """One track: its size and corners, the player's best lap and sessions there, and what was learned."""
    from app.models import GameSession, TrackLayout
    from app.models.game_session import meaningful_session

    layout = await db.get(TrackLayout, track_id)
    k = await db.scalar(select(TrackKnowledge).where(TrackKnowledge.tenant_id == user.tenant_id, TrackKnowledge.track_id == track_id))
    sessions = list(await db.scalars(
        select(GameSession).where(GameSession.tenant_id == user.tenant_id, GameSession.track_id == track_id, meaningful_session())
        .order_by(GameSession.started_at.desc()).limit(20)
    ))
    return {
        "id": track_id,
        "pista": c.TRACKS.get(track_id, f"Pista {track_id}"),
        "largo_m": round(layout.track_length_m) if layout else None,
        "curvas": len(layout.corners) if layout and layout.corners else None,
        "mejor_vuelta_s": _best_lap(k.summary if k else None),
        "notas": knowledge_notes(k.summary if k else None),
        "sesiones": [
            {"id": g.id, "tipo": c.SESSION_TYPES.get(g.session_type) if g.session_type is not None else None,
             "inicio": g.started_at.isoformat(), "vueltas": g.total_laps}
            for g in sessions
        ],
    }
