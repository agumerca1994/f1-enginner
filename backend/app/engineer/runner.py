"""Runs the race engineer for one viewer of a session, live or replayed.

Packets feed the engineer's history all the time (it costs nothing); only when
the assistant is active are its requests sent to the provider.

With an AI provider there are two lanes, each with one request in flight
(moments that arrive meanwhile are merged into the next one):

- the radio lane: a quick, cheap model writes the radio call for routine
  moments (a lap, a sector, corner coaching, a worn tyre) right when they happen;
- the strategy lane: the full call (strategy, driving, setup and analysis for
  the pit wall) on important moments, which may speak, and every few laps
  without speaking, to keep the pit wall current.

Radio calls are not read out at once: like a real engineer they wait for the
next straight (full throttle, no brake, wheel straight), at most RADIO_HOLD_S.
Urgent ones go out immediately.
"""

import asyncio
import itertools
import logging
import time
from collections import deque

from app.core.database import AsyncSessionLocal
from app.engineer.engine import EngineerRequest, RaceEngineer, merge
from app.engineer.providers import Advice, RulesProvider, get_provider, rules_response
from app.engineer.voice import voice_cache
from app.live.state import LiveSession
from app.models import EngineerMessage
from app.telemetry.registry import Packet

logger = logging.getLogger(__name__)
_ids = itertools.count(1)

RADIO_HOLD_S = 15.0  # longest a non-urgent call waits for a straight (game seconds)
QUIET_RELEASE_S = 2.0  # no packets for this long (pause, session over, link down): nothing to disturb
STRAIGHT_S = 0.6  # this long flat out and straight counts as a straight
DEEP_EVERY_LAPS = 3  # the quiet pit-wall refresh on routine laps


class EngineerRunner:
    def __init__(self, tenant_id: int, mode: str, game_session_id: int | None = None, provider=None):
        self.tenant_id = tenant_id
        self.mode = mode
        self.game_session_id = game_session_id
        self.provider = provider or get_provider()
        self.engineer = RaceEngineer()
        self.session_uid: int | None = None
        self.active = False
        self.messages: deque[dict] = deque(maxlen=40)
        self._pending: EngineerRequest | None = None  # strategy lane (and everything, without AI)
        self._pending_radio: EngineerRequest | None = None
        self._busy = False
        self._busy_radio = False
        self._last_deep_lap: int | None = None
        # Radio calls waiting for a straight: (game time queued, message).
        self._outbox: list[tuple[float, dict]] = []
        self._straight_since: float | None = None
        self._game_time = 0.0
        self._last_packet_wall = 0.0

    @property
    def provider_name(self) -> str:
        return self.provider.name

    @property
    def _two_lanes(self) -> bool:
        return hasattr(self.provider, "radio")

    def reset(self) -> None:
        """Start over (a new game session, or a replay rewound)."""
        self.engineer = RaceEngineer()
        self._pending = self._pending_radio = None
        self._outbox.clear()
        self._last_deep_lap = None

    def discard_pending(self) -> None:
        """Forget moments collected while jumping through a replay: only playback speaks."""
        self._pending = self._pending_radio = None
        self._outbox.clear()

    def messages_after(self, message_id: int) -> list[dict]:
        self._flush_outbox()  # the viewer polls this: a quiet session still gets its last calls
        return [m for m in self.messages if m["id"] > message_id]

    def observe(self, packet: Packet, live: LiveSession) -> EngineerRequest | None:
        if self.session_uid != packet.session_uid:
            self.session_uid = packet.session_uid
            self.reset()
        self._game_time = packet.session_time
        self._last_packet_wall = time.monotonic()
        if packet.name == "car_telemetry":
            self._track_straight(packet)
        request = self.engineer.observe(packet, live)
        if request is not None and self.active:
            self._queue(request)
        self._flush_outbox()
        return request

    def _queue(self, request: EngineerRequest) -> None:
        if not self._two_lanes or request.deep:
            self._pending = merge(self._pending, request) if self._pending else request
            return
        self._pending_radio = merge(self._pending_radio, request) if self._pending_radio else request
        lap = request.lap or 0
        laps = [t for t in request.triggers if t.kind == "lap_completed"]
        if laps and (self._last_deep_lap is None or lap - self._last_deep_lap >= DEEP_EVERY_LAPS):
            self._last_deep_lap = lap
            quiet = EngineerRequest(**{**request.__dict__, "quiet": True})
            self._pending = merge(self._pending, quiet) if self._pending else quiet

    # --- when to speak --------------------------------------------------------------

    def _track_straight(self, packet: Packet) -> None:
        t = packet.body["car_telemetry_data"][packet.player_car_index] \
            if packet.player_car_index < len(packet.body["car_telemetry_data"]) else None
        if t is None:
            return
        stopped = int(t["speed"]) < 5  # grid, garage or pit box: nothing to disturb
        flat = float(t["throttle"]) > 0.85 and float(t["brake"]) < 0.05 and abs(float(t["steer"])) < 0.12
        if stopped:
            self._straight_since = packet.session_time - STRAIGHT_S
        elif flat:
            self._straight_since = self._straight_since if self._straight_since is not None else packet.session_time
        else:
            self._straight_since = None

    def _on_straight(self) -> bool:
        return self._straight_since is not None and self._game_time - self._straight_since >= STRAIGHT_S

    def _flush_outbox(self) -> None:
        if not self._outbox:
            return
        quiet = time.monotonic() - self._last_packet_wall >= QUIET_RELEASE_S
        if self._on_straight() or quiet or self._game_time - self._outbox[0][0] >= RADIO_HOLD_S:
            for _, message in self._outbox:
                self.messages.append(message)
            self._outbox.clear()

    def _deliver(self, message: dict) -> None:
        """Hand a message to the dashboard: at once if urgent or silent, else on the next straight.

        The voice starts being made right away, so it is ready when the straight comes.
        """
        if message.get("radio"):
            key = voice_cache.request(message["radio"])
            if key:
                message["audio"] = f"/api/engineer/radio/{key}.mp3"
        if not message.get("radio") or message.get("prioridad") == "urgente":
            self.messages.append(message)
            return
        self._outbox.append((self._game_time, message))
        self._flush_outbox()

    # --- asking -----------------------------------------------------------------------

    def dispatch(self) -> None:
        """Send the waiting requests, if any and their lane is free. Call from the event loop."""
        if not self.active:
            return
        if not self._busy_radio and self._pending_radio is not None:
            request, self._pending_radio = self._pending_radio, None
            self._busy_radio = True
            asyncio.create_task(self._ask_radio(request))
        if self._busy or self._pending is None:
            return
        request, self._pending = self._pending, None
        if request.urgent and not isinstance(self.provider, RulesProvider):
            self._immediate(request)
        self._busy = True
        asyncio.create_task(self._ask(request))

    def _immediate(self, request: EngineerRequest) -> None:
        """An instant rules call for urgent moments, while the AI works out the full decision."""
        response = rules_response(request)
        if not response.get("radio"):
            return
        advice = Advice(response, "aviso inmediato", 0)
        self.engineer.remember(request, response)  # the AI sees it and confirms or corrects it
        self._deliver(self._message(request, advice))

    async def _ask_radio(self, request: EngineerRequest) -> None:
        try:
            advice = await self.provider.radio(request)
        except Exception as e:
            logger.warning("engineer radio call failed", extra={"tenant_id": self.tenant_id, "error": str(e)})
        else:
            self.engineer.remember(request, advice.response)
            self._deliver(self._message(request, advice))
            await self._store(request, advice)
        self._busy_radio = False
        self.dispatch()

    async def _ask(self, request: EngineerRequest) -> None:
        try:
            advice = await self.provider.advise(request)
        except Exception as e:  # a failed call must never stop the session
            logger.warning("engineer call failed", extra={"tenant_id": self.tenant_id, "error": str(e)})
            self._busy = False
            self.dispatch()
            return
        if request.quiet:
            advice.response["radio"] = None  # a pit-wall refresh: the radio lane already spoke
        self.engineer.remember(request, advice.response)
        self._deliver(self._message(request, advice))
        await self._store(request, advice)
        self._busy = False
        self.dispatch()

    def _message(self, request: EngineerRequest, advice: Advice) -> dict:
        return {
            "id": next(_ids),
            "session_time": round(request.session_time, 1),
            "lap": request.lap,
            "triggers": [t.kind for t in request.triggers],
            "provider": advice.provider,
            "latency_ms": advice.latency_ms,
            "cost_usd": advice.cost_usd,
            **advice.response,
        }

    async def _store(self, request: EngineerRequest, advice: Advice) -> None:
        try:
            async with AsyncSessionLocal() as db:
                db.add(EngineerMessage(
                    tenant_id=self.tenant_id, game_session_id=self.game_session_id, mode=self.mode,
                    lap=request.lap, triggers=[t.kind for t in request.triggers], response=advice.response,
                    provider=advice.provider, usage=advice.usage or None, cost_usd=advice.cost_usd,
                    latency_ms=advice.latency_ms,
                ))
                await db.commit()
        except Exception:
            logger.exception("could not store an engineer message", extra={"tenant_id": self.tenant_id})

    def state(self) -> dict:
        self._flush_outbox()
        return {"active": self.active, "provider": self.provider_name, "messages": list(self.messages)}


class EngineerHub:
    """One live engineer per player, fed by the ingest of their bridge."""

    def __init__(self) -> None:
        self._runners: dict[int, EngineerRunner] = {}

    def runner(self, tenant_id: int) -> EngineerRunner:
        if tenant_id not in self._runners:
            self._runners[tenant_id] = EngineerRunner(tenant_id, "live")
        return self._runners[tenant_id]

    def clear(self) -> None:
        self._runners.clear()


engineer_hub = EngineerHub()
