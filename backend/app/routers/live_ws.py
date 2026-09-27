"""Pushes the player's live snapshot to the dashboard.

Browsers cannot set headers on a WebSocket, so the first message must be
{"type": "auth", "token": "<Firebase ID token>"} (or a dev email with AUTH_DEV_MODE).
The server then sends {"type": "snapshot", "data": {...}} whenever the live state
changed, at most every PUSH_INTERVAL_S, and {"type": "idle"} while nothing arrives.
"""

import asyncio
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, status

from app.core.auth import authenticate_token
from app.core.database import AsyncSessionLocal
from app.engineer.runner import engineer_hub
from app.live import snapshot
from app.live.state import live_store

logger = logging.getLogger(__name__)
router = APIRouter(tags=["live"])

PUSH_INTERVAL_S = 0.2
IDLE_EVERY_S = 5.0


@router.websocket("/live/v1")
async def live_ws(ws: WebSocket):
    await ws.accept()
    try:
        first = await asyncio.wait_for(ws.receive_json(), timeout=10)
    except (asyncio.TimeoutError, WebSocketDisconnect, ValueError):
        await ws.close(code=status.WS_1008_POLICY_VIOLATION, reason="auth expected")
        return
    async with AsyncSessionLocal() as db:
        user = await authenticate_token(
            db, token=first.get("token") if isinstance(first, dict) else None,
            dev_email=first.get("dev_user") if isinstance(first, dict) else None,
        )
    if user is None:
        await ws.close(code=status.WS_1008_POLICY_VIOLATION, reason="invalid credentials")
        return

    tenant_id = user.tenant_id
    await ws.send_json({"type": "ready"})
    last_sent_update = None
    idle_for = 0.0
    engineer = engineer_hub.runner(tenant_id)
    await ws.send_json({"type": "engineer_state", **engineer.state()})
    sent_state = (engineer.active, engineer.provider_name)
    last_message = engineer.messages[-1]["id"] if engineer.messages else 0
    snapshot_failed = False
    try:
        while True:
            # The race engineer: new advice and on/off changes.
            for message in engineer.messages_after(last_message):
                await ws.send_json({"type": "engineer_message", "message": message})
                last_message = message["id"]
            if (engineer.active, engineer.provider_name) != sent_state:
                sent_state = (engineer.active, engineer.provider_name)
                await ws.send_json({"type": "engineer_state", "active": engineer.active, "provider": engineer.provider_name})
            state = live_store.get(tenant_id)
            if state is not None and state.updated_at != last_sent_update:
                last_sent_update = state.updated_at
                idle_for = 0.0
                try:
                    data = snapshot.build(state)
                except Exception:
                    # Unexpected game data must not cut the player's dashboard: skip this frame.
                    if not snapshot_failed:
                        logger.exception("could not build a live snapshot", extra={"tenant_id": tenant_id})
                    snapshot_failed = True
                else:
                    await ws.send_json({"type": "snapshot", "data": data})
            else:
                idle_for += PUSH_INTERVAL_S
                if idle_for >= IDLE_EVERY_S:
                    idle_for = 0.0
                    age = None if state is None else round(state.age_since_update(), 1)
                    await ws.send_json({"type": "idle", "seconds_since_last_packet": age})
            await asyncio.sleep(PUSH_INTERVAL_S)
    except (WebSocketDisconnect, RuntimeError):
        pass
