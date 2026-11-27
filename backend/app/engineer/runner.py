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
Urgent ones go out immediately. On top of that, the silence rules:

1. on a qualifying flying lap only urgent calls go out; the rest waits for the cool-down lap;
2. at most one call per sector (in the pits the engineer may talk more);
3. no repeating a topic said in the last laps;
4. when the driver asked for quiet, only decisions (box, safety car, rain, damage) go out;
5. at most two unrequested calls per race lap.

A question from the driver is always answered, at once.
"""

import asyncio
import dataclasses
import itertools
import json
import logging
import time
from collections import deque

from app.billing import plans
from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.engineer.engine import EngineerRequest, RaceEngineer, merge
from app.engineer.history import Trigger
from app.engineer.memory import WeekendMemory
from app.engineer.setup_sheet import setup_values
from app.engineer.traces import TraceCollector
from app.engineer.variety import Variety
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
MAX_UNASKED_PER_LAP = 2  # race laps: unrequested non-urgent calls
STALE_INFO_S = 45.0  # an info call still waiting after this long (game seconds) is old news
QUALI_TYPES = range(5, 15)
# Moments that are decisions: they still go out when the driver asked for quiet.
DECISION_TRIGGERS = ("safety_car", "rain_forecast", "damage", "pitted", "penalty", "race_start", "session_end",
                     "rival_overtake", "blue_flag")


class EngineerRunner:
    def __init__(self, tenant_id: int, mode: str, game_session_id: int | None = None, provider=None):
        self.tenant_id = tenant_id
        self.mode = mode
        self.game_session_id = game_session_id
        self.provider = provider or get_provider()
        self.engineer = RaceEngineer()
        # Live only: every lap's speed/throttle/brake trace, kept as it arrives so BOX never re-reads the capture.
        self.traces: TraceCollector | None = TraceCollector() if mode == "live" else None
        # track id -> the corner map stored for it, so the corners keep their numbers across sessions
        self.stored_corners: dict[int, list[dict]] = {}
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
        # Where the car is, for the silence rules.
        self._lap = 0
        self._sector = 0
        self._flying_quali = False
        self._in_pits = False
        self._released: tuple[int, int] | None = None  # (lap, sector) of the last non-urgent call
        self._unasked: dict[int, int] = {}  # lap -> unrequested non-urgent calls delivered
        self._last_setup: dict | None = None
        # The weekend memory and how to call the driver; loaded by the ingest when the session opens.
        self.memory: WeekendMemory = WeekendMemory()
        self.radio_name: str | None = None
        self.conversation: list[dict] = []  # the driver's questions and the answers, this session
        self.variety = Variety()  # rotates what the routine radio talks about
        self.engineer.memory = self.memory
        # The plan: a live session uses one race per 45-minute block, Pro (AI) or alert radio
        # (rules), see billing/plans.py.
        self._ai_session: int | None = None
        self._ai_started = 0.0
        self._charged: dict[tuple[int, int], str] = {}  # (session, block) -> "ia" | "avisos"
        self._ai_denied_until = 0.0
        self._radio_denied_until = 0.0
        self._told_no_radio: int | None = None  # the session where the driver heard the radio is off

    @property
    def provider_name(self) -> str:
        now = time.monotonic()
        if self._radio_denied_until > now:
            return "sin radio (sin carreras)"
        if self._ai_denied_until > now and not isinstance(self.provider, RulesProvider):
            return "reglas (sin carreras con IA)"
        return self.provider.name

    async def _access(self) -> str | None:
        """Who speaks in this block of the session: "ia" (Pro), "avisos" (the rules radio) or None.

        Each block is charged once to the player's plan; a denial is looked at again after two
        minutes, in case a pack was bought meanwhile.
        """
        rules_only = isinstance(self.provider, RulesProvider)
        if self.mode != "live" or not settings.PLAN_LIMITS:
            return "avisos" if rules_only else "ia"
        if self.game_session_id is None:
            return None
        now = time.monotonic()
        if self._ai_session != self.game_session_id:
            self._ai_session, self._ai_started = self.game_session_id, now
        key = (self.game_session_id, int((now - self._ai_started) // (plans.RACE_MINUTES * 60)))
        had = self._charged.get(key)
        if had == "ia" or (had == "avisos" and (rules_only or self._ai_denied_until > now)):
            return had
        if not rules_only and self._ai_denied_until <= now:
            if await self._charge(key, pro=True):
                self._charged[key], self._ai_denied_until, self._radio_denied_until = "ia", 0.0, 0.0
                return "ia"
            self._ai_denied_until = now + 120
        if had == "avisos":
            return had
        if self._radio_denied_until > now:
            return None
        if await self._charge(key, pro=False):
            self._charged[key], self._radio_denied_until = "avisos", 0.0
            return "avisos"
        self._radio_denied_until = now + 120
        return None

    async def _charge(self, key: tuple[int, int], *, pro: bool) -> bool:
        try:
            async with AsyncSessionLocal() as db:
                return await plans.charge_race(db, self.tenant_id, key[0], key[1], pro=pro) is not None
        except Exception:
            logger.exception("could not charge a race", extra={"tenant_id": self.tenant_id})
            return False

    def _known_pro(self) -> bool:
        """Whether this block is already known to be the Pro engineer's, without asking the plan."""
        if isinstance(self.provider, RulesProvider):
            return False
        if self.mode != "live" or not settings.PLAN_LIMITS:
            return True
        if self._ai_session != self.game_session_id:
            return False
        block = int((time.monotonic() - self._ai_started) // (plans.RACE_MINUTES * 60))
        return self._charged.get((self.game_session_id, block)) == "ia"

    async def _ai_ok(self) -> bool:
        return await self._access() == "ia"

    def _no_radio(self, request: EngineerRequest) -> None:
        """Out of races: say it once per session, then stay quiet."""
        if self._told_no_radio == self.game_session_id:
            return
        self._told_no_radio = self.game_session_id
        text = (f"Ya usaste las {plans.FREE_RADIO_RACES_PER_MONTH} carreras con radio del mes. "
                "Con la suscripción la radio de avisos no tiene límite.")
        self._deliver(self._message(request, Advice({"radio": text, "prioridad": "info", "tema": "plan"},
                                                    "aviso inmediato", 0)))

    @property
    def _two_lanes(self) -> bool:
        return hasattr(self.provider, "radio")

    def reset(self) -> None:
        """Start over (a new game session, or a replay rewound)."""
        self.engineer = RaceEngineer()
        if self.traces is not None:
            self.traces = TraceCollector()
        self._pending = self._pending_radio = None
        self._outbox.clear()
        self._last_deep_lap = None
        self.messages.clear()  # another session's radio must never show up in this one
        self._released = None
        self._unasked.clear()
        self._last_setup = None
        self.conversation = []
        self.variety = Variety()
        self.engineer.memory = self.memory
        self.engineer.radio_name = self.radio_name

    def set_memory(self, memory: WeekendMemory, radio_name: str | None) -> None:
        self.memory = self.engineer.memory = memory
        self.radio_name = self.engineer.radio_name = radio_name

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
        elif packet.name == "lap_data":
            self._track_position(packet, live)
        elif packet.name == "car_setups":
            self._track_setup(packet)
        coach = self.engineer.history.corners
        track_id = getattr(live, "track_id", None)
        if not coach.corners and track_id in self.stored_corners:
            coach.seed(self.stored_corners[track_id])
        request = self.engineer.observe(packet, live)
        if self.traces is not None:
            self.traces.observe(packet, live)
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

    def _track_position(self, packet: Packet, live: LiveSession) -> None:
        laps = packet.body["lap_data"]
        if packet.player_car_index >= len(laps):
            return
        me = laps[packet.player_car_index]
        self._lap, self._sector = int(me["current_lap_num"]), int(me["sector"])
        self._in_pits = int(me["pit_status"]) != 0 or int(me["driver_status"]) == 0
        session = live.last.get("session")
        quali = session is not None and int(session.body["session_type"]) in QUALI_TYPES
        self._flying_quali = quali and int(me["driver_status"]) == 1 and not self._in_pits

    def _track_setup(self, packet: Packet) -> None:
        values = setup_values(packet)
        if values is None or values == self._last_setup:
            return
        if self._last_setup is not None:
            self.memory.note_setup(self._last_setup, values, self._lap or None)
        self._last_setup = values

    def _on_straight(self) -> bool:
        return self._straight_since is not None and self._game_time - self._straight_since >= STRAIGHT_S

    def _flush_outbox(self) -> None:
        if not self._outbox:
            return
        # Old news is dropped rather than read late.
        self._outbox = [(t, m) for t, m in self._outbox
                        if not (m.get("prioridad") == "info" and self._game_time - t > STALE_INFO_S)]
        if not self._outbox:
            return
        quiet = time.monotonic() - self._last_packet_wall >= QUIET_RELEASE_S
        if self._flying_quali and not quiet:
            return  # a flying lap: everything waits for the cool-down lap
        if not self._in_pits and not quiet and self._released == (self._lap, self._sector):
            return  # one call per sector
        if self._on_straight() or quiet or self._in_pits or self._game_time - self._outbox[0][0] >= RADIO_HOLD_S:
            # The most important waiting call goes out; the rest wait for the next sector.
            rank = {"importante": 0, "info": 1}
            best = min(range(len(self._outbox)), key=lambda i: (rank.get(self._outbox[i][1].get("prioridad"), 1), i))
            _, message = self._outbox.pop(best)
            self._released = (self._lap, self._sector)
            self._publish(message)

    def _publish(self, message: dict) -> None:
        self.messages.append(message)
        if message.get("radio"):
            self.memory.said(message.get("tema"), message["radio"], message.get("lap"))

    def _deliver(self, message: dict, asked: bool = False) -> None:
        """Hand a message to the dashboard: at once if urgent, asked for or silent, else
        on the next straight once the silence rules allow it.

        The voice starts being made right away, so it is ready when the straight comes.
        """
        if message.get("radio") and not asked and message.get("prioridad") != "urgente":
            reason = self._hold_back(message)
            if reason:
                message["silenciado"] = reason
                message["radio_silenciada"] = message["radio"]
                message["radio"] = None  # the pit wall keeps the analysis; the driver hears nothing
        if message.get("radio"):
            key = voice_cache.request(message["radio"])
            if key:
                message["audio"] = f"/api/engineer/radio/{key}.mp3"
        if not message.get("radio") or asked or message.get("prioridad") == "urgente":
            self._publish(message)
            return
        self._unasked[self._lap] = self._unasked.get(self._lap, 0) + 1
        self._outbox.append((self._game_time, message))
        self._flush_outbox()

    def _hold_back(self, message: dict) -> str | None:
        """Why a non-urgent call should not be said, if it should not."""
        decision = any(k in DECISION_TRIGGERS for k in message.get("triggers", []))
        if self.memory.silenced and not decision:
            return "el piloto pidió silencio"
        if not decision and self.memory.said_recently(message.get("tema"), message.get("lap")):
            return "ya se dijo hace poco"
        if not decision and self._unasked.get(self._lap, 0) >= MAX_UNASKED_PER_LAP and not self._in_pits:
            return "ya hubo dos mensajes en esta vuelta"
        return None

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
        said = request.urgent and self._known_pro()
        if said:
            self._immediate(request)
        self._busy = True
        asyncio.create_task(self._ask(request, said))

    def _immediate(self, request: EngineerRequest) -> None:
        """An instant rules call for urgent moments, while the AI works out the full decision."""
        response = rules_response(request)
        if not response.get("radio"):
            return
        advice = Advice(response, "aviso inmediato", 0)
        self._say(request, advice)  # the AI sees it and confirms or corrects it

    async def _ask_radio(self, request: EngineerRequest) -> None:
        try:
            access = await self._access()
            if access is None:
                self._no_radio(request)
                self._busy_radio = False
                self.dispatch()
                return
            if access == "ia":
                brief = self.variety.brief([t.kind for t in request.triggers], json.loads(request.facts_json))
                if brief:
                    request = dataclasses.replace(request, brief=brief)
                advice = await self.provider.radio(request)
            else:
                advice = Advice(rules_response(request), "reglas", 0)
        except Exception as e:
            logger.warning("engineer radio call failed", extra={"tenant_id": self.tenant_id, "error": str(e)})
        else:
            self._say(request, advice)
            await self._store(request, advice)
        self._busy_radio = False
        self.dispatch()

    async def _ask(self, request: EngineerRequest, said: bool = False) -> None:
        try:
            access = await self._access()
            if access is None:
                self._no_radio(request)
                self._busy = False
                self.dispatch()
                return
            if access == "ia":
                if request.urgent and not said:
                    self._immediate(request)  # the rules call goes out now; the AI confirms or corrects it
                advice = await self.provider.advise(request)
            else:
                advice = Advice(rules_response(request), "reglas", 0)
        except Exception as e:  # a failed call must never stop the session
            logger.warning("engineer call failed", extra={"tenant_id": self.tenant_id, "error": str(e)})
            self._busy = False
            self.dispatch()
            return
        if request.quiet:
            advice.response["radio"] = None  # a pit-wall refresh: the radio lane already spoke
        plan = advice.response.get("estrategia")
        if plan and any(t.kind == "race_start" for t in request.triggers) or (
                plan and plan.get("vuelta_box") is not None):
            self.memory.set_plan({**plan, "vuelta": request.lap})
        self._say(request, advice)
        await self._store(request, advice)
        self._busy = False
        self.dispatch()

    def _say(self, request: EngineerRequest, advice: Advice) -> None:
        """Deliver a call, then remember only what the driver will hear: a call the silence rules held
        back is kept for the pit wall and stored as such, never as said."""
        message = self._message(request, advice)
        self._deliver(message)
        if message.get("silenciado"):
            advice.response = {**advice.response, "radio": None, "silenciado": message["silenciado"],
                               "radio_silenciada": message.get("radio_silenciada")}
        self.engineer.remember(request, advice.response)

    async def ask(self, question: str, live: LiveSession | None) -> dict:
        """The driver asks; the answer goes out on the radio at once, whatever the silence rules."""
        from app.engineer import talk

        question = question.strip()[:500]
        started = time.monotonic()
        quick = talk.quick_answer(self, question)
        if quick is not None:
            advice = Advice({"radio": quick, "prioridad": "info", "tema": "respuesta"}, "aviso inmediato",
                            int((time.monotonic() - started) * 1000))
        elif hasattr(self.provider, "talk") and live is not None and await self._ai_ok():
            try:
                advice = await self.provider.talk(self, live, question)
            except Exception as e:
                logger.warning("engineer talk failed", extra={"tenant_id": self.tenant_id, "error": str(e)})
                advice = Advice({"radio": "No te pude responder, repetime.", "prioridad": "info",
                                 "tema": "respuesta"}, "reglas", 0)
        elif settings.PLAN_LIMITS and self.mode == "live" and not isinstance(self.provider, RulesProvider):
            # Talking is the Pro engineer's: the alert radio does not converse.
            advice = Advice({"radio": "Para hablar con el ingeniero necesitás una carrera con el ingeniero Pro. "
                                      "La cargás en Ajustes, Plan.", "prioridad": "info", "tema": "respuesta"},
                            "aviso inmediato", 0)
        else:
            advice = Advice({"radio": talk.rules_answer(self, live, question) if live is not None
                             else "No me llegan datos tuyos ahora.", "prioridad": "info", "tema": "respuesta"},
                            "reglas", int((time.monotonic() - started) * 1000))
        self.conversation.append({"pregunta": question, "respuesta": advice.response.get("radio"),
                                  "vuelta": self._lap or None})
        request = EngineerRequest([Trigger("pregunta", self._game_time, self._lap or None)], self._game_time,
                                  self._lap or None, [question], "", "")
        message = {**self._message(request, advice), "pregunta": question}
        self._deliver(message, asked=True)
        await self._store(request, advice)
        return message

    def _message(self, request: EngineerRequest, advice: Advice) -> dict:
        return {
            "id": next(_ids),
            "sesion_id": self.game_session_id,
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
