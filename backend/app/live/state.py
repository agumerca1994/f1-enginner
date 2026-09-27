"""In-memory live state: the latest packet of each type per player.

Connection-agnostic by design: nothing assumes consecutive packets or a fixed
rate. Each value is the last one received, reported with its age, so a lossy
link degrades freshness instead of breaking anything.

One process holds the state for now; a Redis-backed store can replace
`LiveStore` behind the same interface when there is more than one worker.
"""

import time
from collections import deque
from dataclasses import dataclass, field

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

    def update(self, packet: Packet) -> None:
        now = time.monotonic()
        self.last[packet.name] = packet
        self.last_at[packet.name] = now
        self.updated_at = now
        self.packets += 1
        if packet.name == "event":
            code, details = registry.event_details(packet)
            if code != "BUTN":  # button presses are noise for the engineer
                self.events.append({"code": code, "session_time": packet.session_time, **details})

    def age(self, name: str) -> float | None:
        at = self.last_at.get(name)
        return None if at is None else time.monotonic() - at

    def age_since_update(self) -> float:
        return time.monotonic() - self.updated_at


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
