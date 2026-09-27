"""Replays a recorded session through the same live state the dashboard uses.

The server keeps one capture file per bridge connection and session. A source
chains them on one timeline (seconds since the first datagram); the player
feeds records into a fresh LiveSession up to any point in time. Going back
rebuilds the state from the start, which takes a second or two for a full race.
"""

from collections.abc import Iterator
from dataclasses import dataclass
from datetime import datetime

from app.live.state import LiveSession
from app.live.track_layout import LayoutBuilder
from app.telemetry import capture, registry

_LAYOUT_PACKETS = {0, 1, 2, 4}  # motion, session, lap data, participants
# A session can be recorded in several pieces (bridge reconnections, a game
# left in the menus). Longer silences are shortened so the replay has no dead air.
MAX_SILENCE_S = 10.0
COLLAPSED_SILENCE_S = 1.0


@dataclass(frozen=True)
class _File:
    path: str
    start_ns: int


class ReplaySource:
    def __init__(self, paths: list[str]):
        files = []
        for path in paths:
            try:
                meta, _ = capture.read(path)
            except (OSError, ValueError):
                continue  # a missing or unreadable file must not break the others
            started = datetime.fromisoformat(str(meta.get("started_at", "")).replace("Z", "+00:00"))
            files.append(_File(path, int(started.timestamp() * 1e9)))
        files.sort(key=lambda f: f.start_ns)
        self.files = files
        self.t0_ns = files[0].start_ns if files else 0

    def records(self) -> Iterator[tuple[float, bytes]]:
        """(seconds on the replay timeline, datagram) across every file, in order."""
        last_raw, last, removed = 0.0, 0.0, 0.0
        for f in self.files:
            try:
                _, recs = capture.read(f.path)
                for r in recs:
                    raw = (f.start_ns + r.offset_ns - self.t0_ns) / 1e9
                    if raw - last_raw > MAX_SILENCE_S:
                        removed += raw - last_raw - COLLAPSED_SILENCE_S
                    last_raw = max(last_raw, raw)
                    t = max(last, raw - removed)
                    last = t
                    yield t, r.data
            except (OSError, ValueError):
                continue

    def scan(self) -> tuple[float, int, LayoutBuilder | None]:
        """Duration, record count and a track outline built from the whole session."""
        duration, count = 0.0, 0
        builder: LayoutBuilder | None = None
        last_lap = None
        active = list(range(22))
        for t, data in self.records():
            duration, count = t, count + 1
            if len(data) < 7 or data[6] not in _LAYOUT_PACKETS:
                continue
            try:
                p = registry.parse(data)
            except registry.PacketError:
                continue
            if p.name == "session" and builder is None and int(p.body["track_length"]) > 0:
                builder = LayoutBuilder(int(p.body["track_length"]))
            elif p.name == "participants":
                active = list(range(min(int(p.body["num_active_cars"]), 22)))
            elif p.name == "lap_data":
                last_lap = p
            elif p.name == "motion" and builder is not None and last_lap is not None:
                builder.add_frame(p.body, last_lap.body, p.session_time, last_lap.session_time, active)
        return duration, count, builder


class ReplayPlayer:
    def __init__(self, source: ReplaySource):
        self.source = source
        self.t = 0.0
        self._reset()

    def _reset(self) -> None:
        self.t = 0.0
        self.live: LiveSession | None = None
        self._records = self.source.records()
        self._next: tuple[float, bytes] | None = next(self._records, None)

    def seek(self, t: float) -> None:
        """Move to t seconds: forward by feeding records, backward by rebuilding."""
        if t < self.t:
            self._reset()
        while self._next is not None and self._next[0] <= t:
            rec_t, data = self._next
            self.t = rec_t  # packets are stamped with their own time, so ages stay honest
            self._feed(data)
            self._next = next(self._records, None)
        self.t = t

    @property
    def finished(self) -> bool:
        return self._next is None

    def _feed(self, data: bytes) -> None:
        try:
            packet = registry.parse(data)
        except registry.PacketError:
            return
        if packet.session_uid == 0:
            return
        if self.live is None or self.live.session_uid != packet.session_uid:
            self.live = LiveSession(
                tenant_id=0, device_id=0, session_uid=packet.session_uid, packet_format=packet.packet_format,
                build_layout=False, clock=lambda: self.t,
            )
        self.live.update(packet)
