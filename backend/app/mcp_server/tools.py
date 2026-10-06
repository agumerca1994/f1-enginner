"""The connector's tools: the live session, recorded sessions and the engineer's radio.

All read-only and scoped to the caller's tenant. Field names are in Spanish, the
same words the engineer's analysis uses, so the model reads one vocabulary.
"""

import asyncio
import time
import unicodedata
from typing import Annotated, Any, Literal

from mcp.server.fastmcp.exceptions import ToolError
from pydantic import Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import AsyncSessionLocal
from app.engineer import analysis
from app.engineer.review import SessionReview, lap_row, review
from app.engineer.runner import engineer_hub
from app.live.state import live_store
from app.mcp_server.context import current_caller
from app.mcp_server.instance import READ_ONLY, mcp
from app.models import EngineerMessage, GameSession, SessionCapture
from app.telemetry import constants as c

SESSION_KINDS = {
    "practica": range(1, 5),
    "clasificacion": range(5, 15),
    "carrera": range(15, 18),
    "contrarreloj": range(18, 19),
}
# A live session with no packet for this long is reported as stale, not current.
LIVE_STALE_S = 60
# Reviews replay whole captures: one at a time, so a burst of calls cannot pin the CPU.
_review_lock = asyncio.Lock()


def _fold(text: str) -> str:
    return unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode().lower()


def _session_meta(g: GameSession, recorded: bool | None = None) -> dict[str, Any]:
    out = {
        "id": g.id,
        "pista": c.TRACKS.get(g.track_id) if g.track_id is not None else None,
        "tipo": c.SESSION_TYPES.get(g.session_type) if g.session_type is not None else None,
        "vueltas_totales": g.total_laps,
        "online": bool(g.network_game) if g.network_game is not None else None,
        "inicio": g.started_at.isoformat(),
        "ultimo_dato": g.last_packet_at.isoformat() if g.last_packet_at else None,
        "paquetes_recibidos": g.packets_received,
    }
    if recorded is not None:
        out["tiene_grabacion"] = recorded
    return out


async def _own_session(db: AsyncSession, tenant_id: int, session_id: int) -> GameSession:
    g = await db.get(GameSession, session_id)
    if g is None or g.tenant_id != tenant_id:
        raise ToolError(f"No existe la sesión {session_id}. Usá list_sessions para ver los ids.")
    return g


async def _review(tenant_id: int, session_id: int) -> tuple[GameSession, SessionReview]:
    async with AsyncSessionLocal() as db:
        g = await _own_session(db, tenant_id, session_id)
        paths = list(await db.scalars(select(SessionCapture.path).where(SessionCapture.game_session_id == g.id)))
    if not paths:
        raise ToolError("Esa sesión no tiene grabación: sólo se guardan las que llegaron por el bridge.")
    async with _review_lock:
        result = await asyncio.to_thread(review, paths)
    if result is None:
        raise ToolError("No se pudo leer la grabación de esa sesión.")
    return g, result


@mcp.tool(annotations=READ_ONLY)
async def list_sessions(
    limit: Annotated[int, Field(ge=1, le=100, description="Cuántas sesiones traer, de la más nueva a la más vieja")] = 20,
    track: Annotated[str | None, Field(description="Filtrar por pista, en inglés como la nombra el juego: 'Baku', 'Monza', 'Spa'…")] = None,
    kind: Annotated[Literal["practica", "clasificacion", "carrera", "contrarreloj"] | None,
                    Field(description="Filtrar por tipo de sesión")] = None,
) -> dict[str, Any]:
    """Lista las sesiones del jugador (práctica, clasificación, carrera…) con su id, pista, fecha y si tienen grabación."""
    caller = await current_caller()
    q = select(GameSession).where(GameSession.tenant_id == caller.tenant_id)
    if track:
        ids = [tid for tid, name in c.TRACKS.items() if _fold(track) in _fold(name)]
        if not ids:
            raise ToolError(f"No conozco la pista '{track}'. Pistas: {', '.join(sorted(set(c.TRACKS.values())))}")
        q = q.where(GameSession.track_id.in_(ids))
    if kind:
        q = q.where(GameSession.session_type.in_(list(SESSION_KINDS[kind])))
    async with AsyncSessionLocal() as db:
        rows = list(await db.scalars(q.order_by(GameSession.started_at.desc()).limit(limit)))
        recorded = set(await db.scalars(
            select(SessionCapture.game_session_id).where(SessionCapture.game_session_id.in_([g.id for g in rows]))
        ))
        radio = dict((await db.execute(
            select(EngineerMessage.game_session_id, func.count())
            .where(EngineerMessage.game_session_id.in_([g.id for g in rows]))
            .group_by(EngineerMessage.game_session_id)
        )).all())
    return {
        "sesiones": [{**_session_meta(g, g.id in recorded), "mensajes_del_ingeniero": radio.get(g.id, 0)} for g in rows],
        "nota": "Las fechas están en UTC. Para analizar una, usá get_session_review con su id.",
    }


@mcp.tool(annotations=READ_ONLY)
async def get_session_review(
    session_id: Annotated[int, Field(description="Id de la sesión, de list_sessions")],
    include_laps: Annotated[bool, Field(description="Incluir el detalle de cada vuelta (desgaste, temperaturas, combustible, ERS)")] = True,
) -> dict[str, Any]:
    """Analiza una sesión grabada completa: vueltas del jugador, stints con ritmo y degradación,
    clasificación final (si la grabación llegó al final) y el análisis del ingeniero al cierre:
    ritmo, neumáticos, combustible, rivales, estrategia y reglaje."""
    caller = await current_caller()
    g, r = await _review(caller.tenant_id, session_id)
    out: dict[str, Any] = {
        "sesion": _session_meta(g),
        "grabacion_s": r.duration_s,
        "vueltas_registradas": [pl.lap for pl in r.laps],
        "stints": r.stints,
        "clasificacion_final": r.classification,
        "analisis_al_cierre": r.facts,
    }
    if include_laps:
        out["vueltas"] = [lap_row(pl) for pl in r.laps]
    if r.classification is None:
        out["nota"] = "La grabación no llegó a la clasificación final: el análisis es del último momento grabado."
    return out


@mcp.tool(annotations=READ_ONLY)
async def compare_laps(
    session_id: Annotated[int, Field(description="Id de la sesión, de list_sessions")],
    lap_a: Annotated[int, Field(ge=1, description="Primera vuelta")],
    lap_b: Annotated[int, Field(ge=1, description="Segunda vuelta")],
) -> dict[str, Any]:
    """Compara dos vueltas del jugador en una sesión: tiempo, gomas, desgaste, temperaturas, combustible y ERS."""
    caller = await current_caller()
    _, r = await _review(caller.tenant_id, session_id)
    a, b = r.lap(lap_a), r.lap(lap_b)
    missing = [n for n, pl in ((lap_a, a), (lap_b, b)) if pl is None]
    if missing:
        raise ToolError(
            f"No hay datos de la vuelta {', '.join(map(str, missing))}. Vueltas registradas: "
            f"{[pl.lap for pl in r.laps]} (con poca recepción pueden faltar)."
        )
    diff = {
        "tiempo_s": round((b.time_ms - a.time_ms) / 1000, 3) if a.time_ms and b.time_ms else None,
        "posiciones": a.position - b.position,
        "combustible_kg": round(b.fuel_kg - a.fuel_kg, 2) if a.fuel_kg is not None and b.fuel_kg is not None else None,
        "desgaste_pct": {w: round(y - x, 1) for w, x, y in zip(analysis.WHEELS, a.wear, b.wear)} if a.wear and b.wear else None,
        "ers_desplegado_mj": round(b.ers_deployed_mj - a.ers_deployed_mj, 2)
        if a.ers_deployed_mj is not None and b.ers_deployed_mj is not None else None,
    }
    return {
        "vuelta_a": lap_row(a),
        "vuelta_b": lap_row(b),
        "diferencia_b_menos_a": diff,
        "nota": "Tiempo positivo = la vuelta B fue más lenta. Posiciones positivas = ganó lugares en B.",
    }


@mcp.tool(annotations=READ_ONLY)
async def get_engineer_radio(
    session_id: Annotated[int | None, Field(description="Id de la sesión; vacío = los mensajes más recientes de cualquier sesión")] = None,
    limit: Annotated[int, Field(ge=1, le=200)] = 40,
) -> dict[str, Any]:
    """Lo que el ingeniero de IA le dijo al jugador por radio, con su estrategia y análisis de cada momento."""
    caller = await current_caller()
    q = select(EngineerMessage).where(EngineerMessage.tenant_id == caller.tenant_id)
    async with AsyncSessionLocal() as db:
        if session_id is not None:
            await _own_session(db, caller.tenant_id, session_id)
            q = q.where(EngineerMessage.game_session_id == session_id)
        rows = list(await db.scalars(q.order_by(EngineerMessage.created_at.desc()).limit(limit)))
    rows.reverse()
    return {
        "mensajes": [
            {
                "sesion_id": m.game_session_id,
                "modo": "en vivo" if m.mode == "live" else "repetición",
                "vuelta": m.lap,
                "momento": m.triggers,
                "radio": m.response.get("radio"),
                "prioridad": m.response.get("prioridad"),
                "estrategia": m.response.get("estrategia"),
                "manejo": m.response.get("manejo"),
                "reglaje": m.response.get("reglaje"),
                "analisis": m.response.get("analisis"),
                "fuente": m.provider,
                "fecha": m.created_at.isoformat(),
            }
            for m in rows
        ],
    }


@mcp.tool(annotations=READ_ONLY)
async def get_live_session() -> dict[str, Any]:
    """La sesión que el jugador está corriendo ahora: posición, ritmo, neumáticos, combustible,
    rivales, cálculos de estrategia y los últimos mensajes del ingeniero."""
    caller = await current_caller()
    live = live_store.get(caller.tenant_id)
    if live is None:
        return {"en_vivo": False, "nota": "No llega telemetría: el juego o el bridge no están corriendo."}
    age = round(time.monotonic() - live.updated_at, 1)
    runner = engineer_hub.runner(caller.tenant_id)
    return {
        "en_vivo": age < LIVE_STALE_S,
        "segundos_sin_datos": age,
        "sesion_id": runner.game_session_id,
        "analisis": analysis.build(live, runner.engineer.history),
        "ultimos_mensajes_del_ingeniero": [
            {"vuelta": m["lap"], "radio": m.get("radio"), "prioridad": m.get("prioridad"),
             "estrategia": m.get("estrategia")}
            for m in list(runner.messages)[-5:]
        ],
    }
