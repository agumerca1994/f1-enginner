"""Decides when the engineer speaks and builds what the language model receives.

The engineer is called once per completed lap and on important moments (safety
car, rain on the way, damage, a penalty, a pit stop, the start and the end). It
always receives the whole picture, so it can also choose to stay silent.
"""

import json
from dataclasses import dataclass, field
from functools import cache
from pathlib import Path

from app.engineer import analysis
from app.engineer.history import SessionHistory, Trigger
from app.live.state import LiveSession
from app.telemetry.registry import Packet

MANUAL = Path(__file__).parent / "prompts" / "manual_es.md"
# Immediate triggers of the same kind closer than this are merged into one call.
DEBOUNCE_S = 15.0

TRIGGER_TEXT = {
    "session_start": "Arranca la sesión: dale al piloto el plan inicial.",
    "lap_completed": "El piloto completó la vuelta {lap}.",
    "safety_car": "Cambio de safety car: {from} → {to}.",
    "rain_forecast": "El pronóstico marca {rain_percent}% de lluvia en los próximos 15 minutos.",
    "damage": "El auto sufrió daño nuevo: {parts}.",
    "penalty": "Nueva penalización o advertencia: {penalties_s}s de penalización, {warnings} advertencias.",
    "pitted": "El piloto acaba de parar en boxes (parada {stops}).",
    "session_end": "Terminó la sesión: hacé un resumen breve para el piloto.",
}


@cache
def system_prompt() -> str:
    return MANUAL.read_text(encoding="utf-8")


@dataclass
class EngineerRequest:
    triggers: list[Trigger]
    session_time: float
    lap: int | None
    system: str
    user: str


@dataclass
class RaceEngineer:
    history: SessionHistory = field(default_factory=SessionHistory)
    recent_radio: list[dict] = field(default_factory=list)
    _last_call: dict[str, float] = field(default_factory=dict)

    def observe(self, packet: Packet, live: LiveSession) -> EngineerRequest | None:
        """Feed one packet; return a request when the engineer should be consulted now."""
        triggers = self.history.observe(packet, live)
        due = [t for t in triggers if t.kind == "lap_completed" or self._not_recent(t)]
        if not due:
            return None
        for t in due:
            self._last_call[t.kind] = t.session_time
        return self.build_request(due, live)

    def _not_recent(self, t: Trigger) -> bool:
        last = self._last_call.get(t.kind)
        return last is None or t.session_time - last >= DEBOUNCE_S

    def build_request(self, triggers: list[Trigger], live: LiveSession) -> EngineerRequest:
        facts = analysis.build(live, self.history)
        moments = [TRIGGER_TEXT[t.kind].format(lap=t.lap, **t.detail) for t in triggers]
        user = "\n".join([
            "## Momento",
            *[f"- {m}" for m in moments],
            "",
            "## Tus mensajes de radio anteriores (del más viejo al más nuevo)",
            json.dumps(self.recent_radio[-6:], ensure_ascii=False) if self.recent_radio else "Ninguno todavía.",
            "",
            "## Datos de la sesión",
            json.dumps(facts, ensure_ascii=False, separators=(",", ":")),
        ])
        return EngineerRequest(triggers, triggers[-1].session_time, triggers[-1].lap, system_prompt(), user)

    def remember(self, request: EngineerRequest, response: dict) -> None:
        """Keep what the engineer said, so it does not repeat itself."""
        if response.get("radio"):
            self.recent_radio.append({"vuelta": request.lap, "radio": response["radio"],
                                      "prioridad": response.get("prioridad")})
