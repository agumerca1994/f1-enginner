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
    "race_start": ("Arranca la carrera. Antes de meterte en la pelea, bajá la estrategia de paradas "
                   "completa: cuántas paradas, con qué compuestos y en qué ventana de vueltas, apoyándote "
                   "en las vueltas totales, el pronóstico (y qué hacer si llega la lluvia), la vida útil de "
                   "los juegos de neumáticos y la regla de dos compuestos. Comprometé un plan base aunque "
                   "todavía no tengas ritmo real; lo ajustás en las primeras vueltas."),
    "lap_completed": "El piloto completó la vuelta {lap}.",
    "safety_car": "Cambio de safety car: {from} → {to}.",
    "rain_forecast": "El pronóstico marca {rain_percent}% de lluvia en los próximos 15 minutos.",
    "damage": "El auto sufrió daño nuevo: {parts}.",
    "penalty": "Nueva penalización o advertencia: {penalties_s}s de penalización, {warnings} advertencias.",
    "sector_completed": "Cerró el sector {sector} en {tiempo_s}s (delta {delta_s}s vs su mejor). Comentario corto, sin frenar la vuelta.",
    "blue_flag": "Bandera azul: viene un auto más rápido a doblarlo, avisale que lo deje pasar.",
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
    moments: list[str]
    radio_json: str
    facts_json: str
    system: str = field(default_factory=lambda: system_prompt())

    @property
    def user(self) -> str:
        return "\n".join([
            "## Momento",
            *[f"- {m}" for m in self.moments],
            "",
            "## Tus mensajes de radio anteriores (del más viejo al más nuevo)",
            self.radio_json,
            "",
            "## Datos de la sesión",
            self.facts_json,
        ])

    @property
    def urgent(self) -> bool:
        """Moments where a few seconds matter: the driver hears a rules call at once, then the AI's."""
        for t in self.triggers:
            if t.kind in ("damage", "rain_forecast"):
                return True
            if t.kind == "safety_car" and t.detail.get("to") in ("Full safety car", "Virtual safety car"):
                return True
        return False

    @property
    def deep(self) -> bool:
        """Moments that deserve the stronger model: anything but a routine lap or a sector note."""
        return any(t.kind not in ("lap_completed", "sector_completed") for t in self.triggers)


def merge(older: "EngineerRequest", newer: "EngineerRequest") -> "EngineerRequest":
    """Two requests waiting for the model: keep every moment, with the newest data."""
    return EngineerRequest(
        triggers=older.triggers + newer.triggers,
        session_time=newer.session_time,
        lap=newer.lap,
        moments=older.moments + [m for m in newer.moments if m not in older.moments],
        radio_json=newer.radio_json,
        facts_json=newer.facts_json,
    )


@dataclass
class RaceEngineer:
    history: SessionHistory = field(default_factory=SessionHistory)
    recent_radio: list[dict] = field(default_factory=list)
    # What the player learned at this track before (loaded when a race opens).
    prior_knowledge: dict | None = None
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
        facts = analysis.build(live, self.history, prior=self.prior_knowledge)
        return EngineerRequest(
            triggers=triggers,
            session_time=triggers[-1].session_time,
            lap=triggers[-1].lap,
            moments=[TRIGGER_TEXT[t.kind].format(lap=t.lap, **t.detail) for t in triggers],
            radio_json=json.dumps(self.recent_radio[-6:], ensure_ascii=False) if self.recent_radio else "Ninguno todavía.",
            facts_json=json.dumps(facts, ensure_ascii=False, separators=(",", ":")),
        )

    def remember(self, request: EngineerRequest, response: dict) -> None:
        """Keep what the engineer said, so it does not repeat itself."""
        if response.get("radio"):
            self.recent_radio.append({"vuelta": request.lap, "radio": response["radio"],
                                      "prioridad": response.get("prioridad")})
