"""Runs the race engineer for one viewer of a session, live or replayed.

Packets feed the engineer's history all the time (it costs nothing); only when
the assistant is active are its requests sent to the provider. One request is
in flight at a time: moments that arrive meanwhile are merged into the next
one, so a slow model never builds a backlog of stale questions.
"""

import asyncio
import itertools
import logging
from collections import deque

from app.core.database import AsyncSessionLocal
from app.engineer.engine import EngineerRequest, RaceEngineer, merge
from app.engineer.providers import Advice, RulesProvider, get_provider, rules_response
from app.live.state import LiveSession
from app.models import EngineerMessage
from app.telemetry.registry import Packet

logger = logging.getLogger(__name__)
_ids = itertools.count(1)


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
        self._pending: EngineerRequest | None = None
        self._busy = False

    @property
    def provider_name(self) -> str:
        return self.provider.name

    def reset(self) -> None:
        """Start over (a new game session, or a replay rewound)."""
        self.engineer = RaceEngineer()
        self._pending = None

    def discard_pending(self) -> None:
        """Forget moments collected while jumping through a replay: only playback speaks."""
        self._pending = None

    def messages_after(self, message_id: int) -> list[dict]:
        return [m for m in self.messages if m["id"] > message_id]

    def observe(self, packet: Packet, live: LiveSession) -> EngineerRequest | None:
        if self.session_uid != packet.session_uid:
            self.session_uid = packet.session_uid
            self.reset()
        request = self.engineer.observe(packet, live)
        if request is not None and self.active:
            self._pending = merge(self._pending, request) if self._pending else request
        return request

    def dispatch(self) -> None:
        """Send the waiting request, if any and nothing is in flight. Call from the event loop."""
        if self._busy or self._pending is None or not self.active:
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
        self.messages.append(self._message(request, advice))

    async def _ask(self, request: EngineerRequest) -> None:
        try:
            advice = await self.provider.advise(request)
        except Exception as e:  # a failed call must never stop the session
            logger.warning("engineer call failed", extra={"tenant_id": self.tenant_id, "error": str(e)})
            self._busy = False
            self.dispatch()
            return
        self.engineer.remember(request, advice.response)
        message = self._message(request, advice)
        self.messages.append(message)
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
