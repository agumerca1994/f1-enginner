"""What happens to the telemetry one bridge connection sends.

Packets update the in-memory live state immediately. The database is touched
only on session changes and on a periodic flush, never once per packet.
"""

import json
import logging
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import utcnow
from app.core.config import settings
from app.ingest.protocol import ProtocolError, decode_batch
from app.live.state import LiveStore
from app.models import Device, GameSession, SessionCapture
from app.telemetry import capture, registry

logger = logging.getLogger(__name__)

FLUSH_EVERY_S = 5.0


class _OpenSession:
    def __init__(self, game_session: GameSession, writer: capture.Writer, capture_row: SessionCapture):
        self.game_session = game_session
        self.writer = writer
        self.capture_row = capture_row
        self.received = 0
        self.last_packet_at: datetime | None = None
        self.ended = False


class IngestConnection:
    def __init__(self, device: Device, store: LiveStore, capture_dir: str | None = None):
        self.device = device
        self.store = store
        self.capture_dir = Path(capture_dir or settings.CAPTURE_DIR)
        self.connected_at = time.time()
        self.sessions: dict[int, _OpenSession] = {}
        self.rejected = Counter()
        self.bad_batches = 0
        self.hello: dict = {}
        self.heartbeat: dict = {}
        self._last_flush = time.monotonic()
        self._logged_rejections: set[str] = set()

    # --- messages -----------------------------------------------------------

    @staticmethod
    def is_bye(text: str) -> bool:
        try:
            msg = json.loads(text)
        except ValueError:
            return False
        return isinstance(msg, dict) and msg.get("type") == "bye"

    async def handle_text(self, db: AsyncSession, text: str) -> None:
        try:
            msg = json.loads(text)
        except json.JSONDecodeError:
            return
        if not isinstance(msg, dict):
            return
        if msg.get("type") == "hello":
            self.hello = msg
            self.device.bridge_version = str(msg.get("bridge_version") or "")[:40] or self.device.bridge_version
            self.device.os = str(msg.get("os") or "")[:40] or self.device.os
            self.device.arch = str(msg.get("arch") or "")[:40] or self.device.arch
        elif msg.get("type") == "heartbeat":
            self.heartbeat = msg
            reception = msg.get("reception")
            if isinstance(reception, (int, float)):
                self.device.last_reception = float(reception)
            if (live := self.store.get(self.device.tenant_id)) is not None:
                self._apply_link(live)
        await self.maybe_flush(db)

    def _apply_link(self, live) -> None:
        """Copy the bridge's latest view of the console link onto the live session."""
        reception = self.heartbeat.get("reception")
        if isinstance(reception, (int, float)):
            live.reception = float(reception)
        if self.heartbeat.get("source"):
            live.source = str(self.heartbeat["source"])[:64]

    async def handle_batch(self, db: AsyncSession, payload: bytes) -> None:
        try:
            records = decode_batch(payload)
        except ProtocolError as e:
            self.bad_batches += 1
            self._log_once(f"batch:{e}", "rejected a batch from a bridge", error=str(e))
            return

        for received_ns, data in records:
            try:
                packet = registry.parse(data)
            except registry.PacketError as e:
                self.rejected[str(e)] += 1
                self._log_once(f"packet:{e}", "rejected a telemetry packet", error=str(e))
                continue

            live = self.store.session_for(self.device.tenant_id, self.device.id, packet)
            live.update(packet)
            if live.reception is None:  # a new live session starts without the link info
                self._apply_link(live)

            if packet.session_uid == 0:  # menus: no session to file it under
                continue
            open_session = self.sessions.get(packet.session_uid)
            if open_session is None:
                open_session = await self._open_session(db, packet)
            open_session.writer.write(received_ns, data)
            open_session.received += 1
            open_session.last_packet_at = datetime.fromtimestamp(received_ns / 1e9, timezone.utc)
            self._apply_metadata(open_session, packet)

        await self.maybe_flush(db)

    # --- sessions -----------------------------------------------------------

    async def _open_session(self, db: AsyncSession, packet: registry.Packet) -> _OpenSession:
        uid_hex = f"{packet.session_uid:016x}"
        game_session = await db.scalar(
            select(GameSession).where(
                GameSession.tenant_id == self.device.tenant_id, GameSession.session_uid == uid_hex
            )
        )
        if game_session is None:
            h = packet.header
            game_session = GameSession(
                tenant_id=self.device.tenant_id,
                device_id=self.device.id,
                session_uid=uid_hex,
                packet_format=packet.packet_format,
                game_version=f"{int(h['game_year'])} v{int(h['game_major_version'])}.{int(h['game_minor_version']):02d}",
                player_car_index=packet.player_car_index,
            )
            db.add(game_session)
            await db.flush()
            logger.info("game session started", extra={"tenant_id": self.device.tenant_id, "session_uid": uid_hex})

        path = self.capture_dir / str(self.device.tenant_id) / f"{uid_hex}-{int(self.connected_at)}.f1cap.zst"
        writer = capture.Writer(path, {
            "bridge_version": self.hello.get("bridge_version") or self.device.bridge_version or "",
            "host": f"device-{self.device.id}",
            "listen_addr": "uplink",
            "started_at": utcnow().isoformat(),
            "note": f"received by the server for session {uid_hex}",
        })
        capture_row = SessionCapture(game_session_id=game_session.id, path=str(path))
        db.add(capture_row)
        await db.commit()
        opened = _OpenSession(game_session, writer, capture_row)
        self.sessions[packet.session_uid] = opened
        return opened

    @staticmethod
    def _apply_metadata(open_session: _OpenSession, packet: registry.Packet) -> None:
        gs = open_session.game_session
        if packet.name == "session":
            b = packet.body
            gs.track_id = int(b["track_id"])
            gs.session_type = int(b["session_type"])
            gs.total_laps = int(b["total_laps"])
            gs.network_game = int(b["network_game"])
        elif packet.name == "event":
            code, _ = registry.event_details(packet)
            if code == "SEND":
                open_session.ended = True

    # --- persistence --------------------------------------------------------

    async def maybe_flush(self, db: AsyncSession) -> None:
        if time.monotonic() - self._last_flush >= FLUSH_EVERY_S:
            await self.flush(db)

    async def flush(self, db: AsyncSession) -> None:
        self._last_flush = time.monotonic()
        now = utcnow()
        self.device.last_seen_at = now
        rejected = sum(self.rejected.values())
        for s in self.sessions.values():
            gs = s.game_session
            gs.packets_received = (gs.packets_received or 0) + s.received
            gs.packets_rejected = (gs.packets_rejected or 0) + rejected
            s.capture_row.records = s.writer.records
            if s.last_packet_at:
                gs.last_packet_at = s.last_packet_at
            if s.ended and gs.ended_at is None:
                gs.ended_at = now
            s.received = 0
        self.rejected.clear()
        await db.commit()

    async def close(self, db: AsyncSession) -> None:
        for s in self.sessions.values():
            s.writer.close()
            s.capture_row.closed_at = utcnow()
        await self.flush(db)
        self.sessions.clear()

    def _log_once(self, key: str, message: str, **extra) -> None:
        if key in self._logged_rejections:
            return
        self._logged_rejections.add(key)
        logger.warning(message, extra={"tenant_id": self.device.tenant_id, "device_id": self.device.id, **extra})
