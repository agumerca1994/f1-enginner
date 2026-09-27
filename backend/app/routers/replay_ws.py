"""Replays a recorded session to the dashboard, like watching the race again with data only.

First message: {"type": "auth", "token" | "dev_user", "session_id": N}.
The server answers {"type": "ready", "duration_s", "records"} and then sends
{"type": "frame", "t", "duration_s", "playing", "speed", "data": snapshot}
while playing and after every seek.

Controls from the client: {"type": "play"}, {"type": "pause"},
{"type": "speed", "value": 1..16}, {"type": "seek", "t": seconds}.
"""

import asyncio
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, status
from sqlalchemy import select

from app.core.auth import authenticate_token
from app.core.database import AsyncSessionLocal
from app.engineer.runner import EngineerRunner
from app.live import snapshot
from app.live.track_layout import LayoutBuilder
from app.models import GameSession, SessionCapture, TrackLayout
from app.replay.player import ReplayPlayer, ReplaySource

logger = logging.getLogger(__name__)
router = APIRouter(tags=["replay"])

TICK_S = 0.2
SPEEDS = (0.5, 1, 2, 4, 8, 16)


@router.websocket("/replay/v1")
async def replay_ws(ws: WebSocket):
    await ws.accept()
    try:
        first = await asyncio.wait_for(ws.receive_json(), timeout=10)
    except (asyncio.TimeoutError, WebSocketDisconnect, ValueError):
        await ws.close(code=status.WS_1008_POLICY_VIOLATION, reason="auth expected")
        return
    if not isinstance(first, dict):
        await ws.close(code=status.WS_1008_POLICY_VIOLATION, reason="auth expected")
        return

    async with AsyncSessionLocal() as db:
        user = await authenticate_token(db, token=first.get("token"), dev_email=first.get("dev_user"))
        if user is None:
            await ws.close(code=status.WS_1008_POLICY_VIOLATION, reason="invalid credentials")
            return
        game_session = await db.get(GameSession, first.get("session_id") or 0)
        if game_session is None or game_session.tenant_id != user.tenant_id:
            await ws.close(code=status.WS_1008_POLICY_VIOLATION, reason="session not found")
            return
        paths = list(await db.scalars(
            select(SessionCapture.path).where(SessionCapture.game_session_id == game_session.id)
        ))

    source = ReplaySource(paths)
    if not source.files:
        await ws.close(code=4404, reason="this session has no recording")
        return
    # Reading the whole recording once gives the duration and, as a bonus, a
    # complete track outline for the map.
    duration, count, builder = await asyncio.to_thread(source.scan)
    if builder is not None and game_session.track_id is not None:
        await _improve_layout(game_session.track_id, builder)

    engineer = EngineerRunner(user.tenant_id, "replay", game_session.id)
    player = ReplayPlayer(source, on_packet=engineer.observe, on_reset=engineer.reset)
    state = {"playing": False, "speed": 1.0, "dirty": True}
    await ws.send_json({"type": "ready", "duration_s": round(duration, 2), "records": count})
    await ws.send_json({"type": "engineer_state", **engineer.state()})
    last_message = 0

    async def controls():
        while True:
            msg = await ws.receive_json()
            kind = msg.get("type") if isinstance(msg, dict) else None
            if kind == "play":
                if player.t >= duration:
                    await asyncio.to_thread(player.seek, 0.0)
                state["playing"] = True
            elif kind == "pause":
                state["playing"] = False
            elif kind == "speed" and msg.get("value") in SPEEDS:
                state["speed"] = float(msg["value"])
            elif kind == "seek" and isinstance(msg.get("t"), (int, float)):
                await asyncio.to_thread(player.seek, max(0.0, min(float(msg["t"]), duration)))
                engineer.discard_pending()  # a jump is not something the engineer lived through
            elif kind == "engineer" and isinstance(msg.get("active"), bool):
                engineer.active = msg["active"]
                if not engineer.active:
                    engineer.discard_pending()
                await ws.send_json({"type": "engineer_state", "active": engineer.active, "provider": engineer.provider_name})
            state["dirty"] = True

    control_task = asyncio.create_task(controls())
    try:
        while not control_task.done():
            if state["playing"]:
                target = min(duration, player.t + TICK_S * state["speed"])
                await asyncio.to_thread(player.seek, target)
                engineer.dispatch()
                if target >= duration:
                    state["playing"] = False
                state["dirty"] = True
            for message in engineer.messages_after(last_message):
                await ws.send_json({"type": "engineer_message", "message": message})
                last_message = message["id"]
            if state["dirty"]:
                state["dirty"] = False
                await ws.send_json({
                    "type": "frame",
                    "t": round(player.t, 2),
                    "duration_s": round(duration, 2),
                    "playing": state["playing"],
                    "speed": state["speed"],
                    "data": snapshot.build(player.live) if player.live else None,
                })
            await asyncio.sleep(TICK_S)
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        control_task.cancel()


async def _improve_layout(track_id: int, fresh: LayoutBuilder) -> None:
    """Complete the shared outline with a whole recorded session, if it is not complete yet."""
    async with AsyncSessionLocal() as db:
        row = await db.get(TrackLayout, track_id)
        if row is not None and row.ready:
            return
        if row is not None:
            fresh.merge(row.sums, row.counts)
        else:
            row = TrackLayout(track_id=track_id)
            db.add(row)
        sums, counts = fresh.arrays()
        row.track_length_m, row.bin_m = fresh.track_length, 10.0
        row.sums, row.counts, row.points = sums, counts, fresh.segments()
        row.coverage, row.ready = fresh.coverage, fresh.ready
        await db.commit()
