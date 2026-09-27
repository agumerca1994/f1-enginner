import asyncio
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, status

from app.core.auth import device_from_token
from app.core.database import AsyncSessionLocal
from app.ingest.service import IngestConnection
from app.live.state import live_store

logger = logging.getLogger(__name__)
router = APIRouter(tags=["ingest"])


@router.websocket("/ingest/v1")
async def ingest(ws: WebSocket):
    auth = ws.headers.get("authorization", "")
    token = auth[7:].strip() if auth.lower().startswith("bearer ") else None

    # One database session for the life of the connection: a bridge sends for
    # hours and the service writes only on session changes and periodic flushes.
    async with AsyncSessionLocal() as db:
        device = await device_from_token(db, token)
        if device is None:
            await ws.close(code=status.WS_1008_POLICY_VIOLATION, reason="invalid device token")
            return
        await ws.accept()
        await ws.send_json({"type": "welcome", "device_id": device.id})
        conn = IngestConnection(device, live_store)
        log_extra = {"tenant_id": device.tenant_id, "device_id": device.id}
        logger.info("bridge connected", extra=log_extra)
        closed = False
        try:
            while True:
                msg = await ws.receive()
                if msg["type"] == "websocket.disconnect":
                    break
                if msg.get("bytes") is not None:
                    await conn.handle_batch(db, msg["bytes"])
                elif msg.get("text") is not None:
                    if conn.is_bye(msg["text"]):
                        # Clean shutdown: save everything, then tell the bridge it may exit.
                        await conn.close(db)
                        closed = True
                        await ws.send_json({"type": "goodbye"})
                        await ws.close()
                        break
                    await conn.handle_text(db, msg["text"])
        except WebSocketDisconnect:
            pass
        except Exception:
            logger.exception("ingest connection failed", extra=log_extra)
            raise
        finally:
            if not closed:
                # Shielded: a cancelled connection (server shutdown, abrupt close)
                # must still close its capture file and save its counters.
                await asyncio.shield(conn.close(db))
            logger.info("bridge disconnected", extra=log_extra)
