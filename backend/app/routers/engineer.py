from collections import defaultdict
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user
from app.core.database import get_db
from app.engineer import demo
from app.engineer.runner import engineer_hub
from app.engineer.voice import voice_cache
from app.live.state import live_store
from app.models import EngineerMessage, GameSession, User
from app.telemetry import constants as c

# Answers that did not use an AI model: they cost nothing and are not "calls".
FREE_PROVIDERS = ("reglas", "aviso inmediato")

router = APIRouter(prefix="/api/engineer", tags=["engineer"])


class ToggleIn(BaseModel):
    active: bool


class AskIn(BaseModel):
    texto: str = Field(min_length=1, max_length=500)


class DemoTurn(BaseModel):
    pregunta: str = Field(max_length=300)
    respuesta: str | None = Field(default=None, max_length=600)


class DemoIn(BaseModel):
    texto: str = Field(min_length=1, max_length=300)
    historial: list[DemoTurn] = Field(default_factory=list, max_length=8)


class SettingsIn(BaseModel):
    nombre_radio: str | None = Field(default=None, max_length=40)


@router.get("/live")
async def live_engineer(user: User = Depends(get_current_user)):
    return engineer_hub.runner(user.tenant_id).state()


@router.post("/live")
async def toggle_live_engineer(body: ToggleIn, user: User = Depends(get_current_user)):
    """Turn the race engineer on or off for the player's live sessions."""
    runner = engineer_hub.runner(user.tenant_id)
    runner.active = body.active
    if not body.active:
        runner.discard_pending()
    return runner.state()


@router.post("/ask")
async def ask_engineer(body: AskIn, user: User = Depends(get_current_user)):
    """The driver talks to the engineer (by voice in the browser, or typed). Answered on the radio."""
    runner = engineer_hub.runner(user.tenant_id)
    message = await runner.ask(body.texto, live_store.get(user.tenant_id))
    return message


@router.get("/demo")
async def demo_state(user: User = Depends(get_current_user)):
    """The engineer demo in Plans: the frozen race it talks about and the questions left today."""
    s = demo.race()["estado_breve"]
    ahead, behind = s.get("adelante") or {}, s.get("atras") or {}
    tyres = s.get("gomas") or {}
    return {"pista": s.get("pista"), "vuelta": s.get("vuelta"), "vueltas_restantes": s.get("vueltas_restantes"),
            "posicion": s.get("posicion"), "clima": s.get("clima"),
            "compuesto": tyres.get("compuesto"), "desgaste_pct": tyres.get("desgaste_max_pct"),
            "adelante": {"piloto": ahead.get("piloto"), "gap_s": ahead.get("gap_s")} if ahead else None,
            "atras": {"piloto": behind.get("piloto"),
                      "gap_s": behind.get("gap_s") or (behind.get("alcance") or {}).get("gap_s")} if behind else None,
            "restantes": demo.limits.left(user.id), "por_dia": demo.PER_PLAYER_PER_DAY}


@router.post("/demo")
async def demo_ask(body: DemoIn, user: User = Depends(get_current_user)):
    """Ask the Pro engineer about the demo race (a few a day; then scripted answers)."""
    out = await demo.ask(user.id, user.radio_name, body.texto, [t.model_dump() for t in body.historial])
    key = voice_cache.request(out["radio"])
    return {**out, "pregunta": body.texto, "audio": f"/api/engineer/radio/{key}.mp3" if key else None}


@router.get("/memory")
async def engineer_memory(user: User = Depends(get_current_user)):
    """What the engineer remembers of this weekend: reports, setup history, plan."""
    runner = engineer_hub.runner(user.tenant_id)
    return {"nombre_radio": user.radio_name, "pista_id": runner.memory.track_id, **runner.memory.data,
            "conversacion": runner.conversation[-20:]}


@router.get("/settings")
async def get_settings(user: User = Depends(get_current_user)):
    return {"nombre_radio": user.radio_name}


@router.put("/settings")
async def put_settings(body: SettingsIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """How the engineer calls the player on the radio (the game's name is the seat they took)."""
    name = (body.nombre_radio or "").strip() or None
    db_user = await db.get(User, user.id)
    db_user.radio_name = name
    await db.commit()
    runner = engineer_hub.runner(user.tenant_id)
    runner.set_memory(runner.memory, name)
    return {"nombre_radio": name}


def _empty() -> dict:
    return {"calls": 0, "cost_usd": 0.0, "input_tokens": 0, "output_tokens": 0, "cache_read_tokens": 0}


def _add(bucket: dict, m: EngineerMessage) -> None:
    usage = m.usage or {}
    bucket["calls"] += 1
    bucket["cost_usd"] += m.cost_usd or 0.0
    bucket["input_tokens"] += usage.get("input", 0) + usage.get("cache_write", 0)
    bucket["output_tokens"] += usage.get("output", 0)
    bucket["cache_read_tokens"] += usage.get("cache_read", 0)


def _rounded(bucket: dict) -> dict:
    return {**bucket, "cost_usd": round(bucket["cost_usd"], 4)}


@router.get("/usage")
async def usage(
    days: int = Query(30, ge=1, le=365),
    tz_offset_minutes: int = Query(0, ge=-840, le=840, description="Player's UTC offset, e.g. -180 for Argentina"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """What the AI engineer consumed and cost: totals, per day, per session and per model.

    Days and months follow the player's local time, so a race at 22:00 counts on that day.
    """
    offset = timedelta(minutes=tz_offset_minutes)
    now = datetime.now(timezone.utc)
    local_now = now + offset
    since = now - timedelta(days=days)
    month_start = local_now.replace(day=1, hour=0, minute=0, second=0, microsecond=0) - offset
    today_start = local_now.replace(hour=0, minute=0, second=0, microsecond=0) - offset
    ai = EngineerMessage.provider.not_in(FREE_PROVIDERS)

    rows = list(await db.scalars(
        select(EngineerMessage)
        .where(EngineerMessage.tenant_id == user.tenant_id, ai,
               EngineerMessage.created_at >= min(since, month_start))
        .order_by(EngineerMessage.created_at)
    ))
    total_calls, total_cost = (await db.execute(
        select(func.count(), func.coalesce(func.sum(EngineerMessage.cost_usd), 0.0))
        .where(EngineerMessage.tenant_id == user.tenant_id, ai)
    )).one()
    free_calls = await db.scalar(select(func.count()).where(
        EngineerMessage.tenant_id == user.tenant_id, EngineerMessage.provider.in_(FREE_PROVIDERS)))

    month, today = _empty(), _empty()
    per_day: dict[str, dict] = defaultdict(_empty)
    per_model: dict[str, dict] = defaultdict(lambda: {**_empty(), "latency_ms_total": 0})
    per_session: dict[int | None, dict] = defaultdict(lambda: {**_empty(), "modes": set()})
    for m in rows:
        if m.created_at >= month_start:
            _add(month, m)
        if m.created_at >= today_start:
            _add(today, m)
        if m.created_at < since:
            continue
        _add(per_day[(m.created_at + offset).date().isoformat()], m)
        _add(per_model[m.provider], m)
        per_model[m.provider]["latency_ms_total"] += m.latency_ms or 0
        _add(per_session[m.game_session_id], m)
        per_session[m.game_session_id]["modes"].add(m.mode)

    sessions = {g.id: g for g in await db.scalars(
        select(GameSession).where(GameSession.id.in_([k for k in per_session if k is not None])))}
    by_session = []
    for sid, bucket in per_session.items():
        g = sessions.get(sid)
        by_session.append({
            **_rounded({k: v for k, v in bucket.items() if k != "modes"}),
            "game_session_id": sid,
            "track": c.TRACKS.get(g.track_id) if g and g.track_id is not None else None,
            "session_type": c.SESSION_TYPES.get(g.session_type) if g and g.session_type is not None else None,
            "started_at": g.started_at.isoformat() if g else None,
            "modes": sorted(bucket["modes"]),
        })
    by_session.sort(key=lambda x: x["started_at"] or "", reverse=True)

    day_list = []
    for i in range(days - 1, -1, -1):
        d = (local_now - timedelta(days=i)).date().isoformat()
        day_list.append({"date": d, **_rounded(per_day.get(d, _empty()))})

    return {
        "today": _rounded(today),
        "month": _rounded(month),
        "total": {"calls": total_calls, "cost_usd": round(float(total_cost), 4)},
        "free_answers": free_calls,
        "average_cost_per_call": round(float(total_cost) / total_calls, 4) if total_calls else None,
        "by_day": day_list,
        "by_session": by_session,
        "by_model": [
            {"model": model, **_rounded({k: v for k, v in b.items() if k != "latency_ms_total"}),
             "avg_latency_ms": round(b["latency_ms_total"] / b["calls"]) if b["calls"] else None}
            for model, b in sorted(per_model.items(), key=lambda kv: -kv[1]["cost_usd"])
        ],
        "provider_now": engineer_hub.runner(user.tenant_id).provider_name,
    }


@router.get("/radio/{key}.mp3")
async def radio_audio(key: str):
    """The engineer's voice for one radio line. No login: the id is the hash of a line this
    server produced (OBS and the overlays need it too), and anything else is a 404."""
    if len(key) != 32 or any(ch not in "0123456789abcdef" for ch in key):
        raise HTTPException(404)
    audio = await voice_cache.get(key)
    if audio is None:
        raise HTTPException(404, "No voice for that line")
    return Response(audio, media_type="audio/mpeg", headers={"Cache-Control": "public, max-age=86400, immutable"})
