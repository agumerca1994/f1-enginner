"""In-memory live state: the latest packet of each type per player.

Connection-agnostic by design: nothing assumes consecutive packets or a fixed
rate. Each value is the last one received, reported with its age, so a lossy
link degrades freshness instead of breaking anything.

One process holds the state for now; a Redis-backed store can replace
`LiveStore` behind the same interface when there is more than one worker.
"""

import time
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass, field

from app.live.track_layout import LayoutBuilder
from app.telemetry import registry
from app.telemetry.registry import Packet


@dataclass
class LiveSession:
    tenant_id: int
    device_id: int
    session_uid: int
    packet_format: int
    last: dict[str, Packet] = field(default_factory=dict)
    last_at: dict[str, float] = field(default_factory=dict)  # monotonic seconds
    events: deque = field(default_factory=lambda: deque(maxlen=50))
    reception: float | None = None
    source: str | None = None
    packets: int = 0
    rejected: int = 0
    started_at: float = field(default_factory=time.monotonic)
    updated_at: float = field(default_factory=time.monotonic)
    # Best lap per car index, from SessionHistory packets (they cycle through the cars).
    best_lap_ms: dict[int, int] = field(default_factory=dict)
    # Circuit outline built from every car's position; loaded and saved by the ingest service.
    track_id: int | None = None
    layout: LayoutBuilder | None = None
    layout_loaded: bool = False
    build_layout: bool = True
    # Replays run on the race's own clock so data ages read as they did live.
    clock: Callable[[], float] = time.monotonic

    def __post_init__(self) -> None:
        self.started_at = self.updated_at = self.clock()

    def update(self, packet: Packet) -> None:
        now = self.clock()
        self.last[packet.name] = packet
        self.last_at[packet.name] = now
        self.updated_at = now
        self.packets += 1
        if packet.name == "event":
            code, details = registry.event_details(packet)
            if code != "BUTN":  # button presses are noise for the engineer
                self.events.append({"code": code, "session_time": packet.session_time, **details})
        elif packet.name == "session":
            track_id, length = int(packet.body["track_id"]), int(packet.body["track_length"])
            if track_id != self.track_id and length > 0:
                self.track_id = track_id
                self.layout = LayoutBuilder(length) if self.build_layout else None
                self.layout_loaded = False
        elif packet.name == "session_history":
            self._record_best_lap(packet)
        elif packet.name == "motion":
            self._feed_layout(motion=packet, lap=self.last.get("lap_data"))
        elif packet.name == "lap_data":
            self._feed_layout(motion=self.last.get("motion"), lap=packet)

    def active_cars(self) -> list[int]:
        """Indices of the cars taking part in the session.

        The game keeps each car in a fixed slot (0-21). When a car retires,
        `num_active_cars` drops but the other slots do not move, so the count
        cannot be used as a range: the player can sit in slot 19 of a 19-car field.
        """
        laps = self.last.get("lap_data")
        if laps is None:
            return list(range(22))
        # result_status 0 = invalid, 1 = inactive (an unused slot).
        return [i for i in range(22) if int(laps.body["lap_data"][i]["result_status"]) >= 2]

    def _feed_layout(self, motion: Packet | None, lap: Packet | None) -> None:
        # Pair each new Motion or LapData packet with the latest of the other kind;
        # the lap-distance correction for the time between them keeps both pairings consistent.
        if self.layout is None or motion is None or lap is None:
            return
        self.layout.add_frame(motion.body, lap.body, motion.session_time, lap.session_time, self.active_cars())

    def _record_best_lap(self, packet: Packet) -> None:
        b = packet.body
        car, lap_num = int(b["car_idx"]), int(b["best_lap_time_lap_num"])
        if 0 < lap_num <= 100:
            ms = int(b["lap_history_data"][lap_num - 1]["lap_time_in_ms"])
            if ms > 0:
                self.best_lap_ms[car] = ms

    def age(self, name: str) -> float | None:
        at = self.last_at.get(name)
        return None if at is None else self.clock() - at

    def age_since_update(self) -> float:
        return self.clock() - self.updated_at


class LiveStore:
    def __init__(self) -> None:
        self._by_tenant: dict[int, LiveSession] = {}

    def get(self, tenant_id: int) -> LiveSession | None:
        return self._by_tenant.get(tenant_id)

    def all(self) -> list[LiveSession]:
        return list(self._by_tenant.values())

    def session_for(self, tenant_id: int, device_id: int, packet: Packet) -> LiveSession:
        """The tenant's live session, replaced when the game starts a new one."""
        current = self._by_tenant.get(tenant_id)
        if current is None or current.session_uid != packet.session_uid:
            current = LiveSession(tenant_id, device_id, packet.session_uid, packet.packet_format)
            self._by_tenant[tenant_id] = current
        return current

    def clear(self) -> None:
        self._by_tenant.clear()


live_store = LiveStore()
