"""The engineer demo in Plans: ask the Pro engineer about a frozen moment of a real race.

The race is a moment of a recorded session (`demo_race.json`, built by
`scripts/build_demo_race.py`): the same talk prompt, model and tools as in a race, but the
tools read that moment instead of the live state, and nothing is written. Questions are
capped per player and per day; past the cap, or without an AI key, a scripted answer about
the same race keeps the demo working.
"""

import json
import logging
import time
import unicodedata
from datetime import date
from functools import cache
from pathlib import Path
from typing import Any

import anthropic

from app.core.config import settings
from app.engineer import talk
from app.engineer.providers import FALLBACK_MODELS, TALK_MODEL, cost

logger = logging.getLogger(__name__)

RACE_FILE = Path(__file__).parent / "demo_race.json"
PER_PLAYER_PER_DAY = 5
PER_DAY_TOTAL = 300
MAX_HISTORY = 4  # earlier turns of this demo sent back, so follow-ups make sense

READ_ONLY_TOOLS = ("estado_breve", "analisis_curva", "sector", "incidentes", "neumaticos", "estrategia",
                   "reglaje", "comparar_vueltas")
TOOLS = [t for t in talk.TOOLS if t["name"] in READ_ONLY_TOOLS]

DEMO_NOTE = """

# Esta conversación es una demo

El piloto todavía no está corriendo: está en la página de planes probando cómo le respondés. La carrera es
un momento real congelado (Austin, vuelta 4 de 6, con lluvia) y le respondés como si estuviera en esa
vuelta, en pista. Si pregunta algo que no tiene que ver con la carrera o con el juego, contestá en una frase
que acá sos su ingeniero y ofrecé algo de esta carrera (las gomas, Gasly atrás, la lluvia). No hables de
precios ni de la app."""


@cache
def race() -> dict[str, Any]:
    return json.loads(RACE_FILE.read_text(encoding="utf-8"))


def run_tool(name: str, args: dict) -> dict[str, Any]:
    r = race()
    if name in ("estado_breve", "neumaticos", "reglaje", "incidentes"):
        return r[name]
    if name == "estrategia":
        stop = args.get("vuelta_parada")
        return r["estrategia"].get(str(stop)) or r["estrategia"]["ahora"]
    if name == "analisis_curva":
        n = str(args.get("numero"))
        return r["curvas"].get(n) or {"error": f"No tengo la curva {n}: en este circuito tengo marcadas "
                                               f"de la 1 a la {len(r['curvas'])}."}
    if name == "sector":
        return r["sectores"].get(str(args.get("n"))) or {"error": "Los sectores son 1, 2 y 3."}
    if name == "comparar_vueltas":
        a, b = sorted((int(args.get("a") or 0), int(args.get("b") or 0)))
        return r["vueltas"].get(f"{a}-{b}") or {"error": f"Tengo de la vuelta 1 a la {r['estado_breve']['vuelta']}."}
    return {"error": f"herramienta desconocida: {name}"}


def user_message(question: str, radio_name: str | None) -> str:
    return "\n".join([
        "## Pregunta del piloto", question, "",
        "## Estado breve ahora", json.dumps(race()["estado_breve"], ensure_ascii=False, separators=(",", ":")), "",
        "## Memoria del fin de semana",
        json.dumps({"nombre_radio": radio_name, "reportes_piloto": [], "plan_carrera": None},
                   ensure_ascii=False, separators=(",", ":")),
    ])


# --- scripted answers: past the cap, without a key, or if the model fails -------------------

def _fold(text: str) -> str:
    return unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode().lower()


SCRIPTED = [
    (("paro", "parar", "parada", "box", "estrategia", "entro"), "No paramos. Quedan dos vueltas y la parada cuesta 22 segundos: "
                                           "saldrías último. Los intermedios aguantan de sobra."),
    (("goma", "neumat", "desgast", "temperatura"), "Intermedios al 2 por ciento, se gastan uno por vuelta. "
                                                   "Están bien, cuidá la trasera izquierda en las curvas lentas."),
    (("gasly", "atras", "detras", "defend"), "Gasly a dos décimas y media, te descuenta seis décimas por vuelta. "
                                             "Defendé la frenada de la 1 por dentro."),
    (("verstappen", "adelante", "pas", "ataca"), "Verstappen a medio segundo, te pasó en esta vuelta. "
                                                 "Lo tenés: atacalo en la frenada de la 1."),
    (("lluvia", "llueve", "clima", "agua"), "Llovizna, y el pronóstico la mantiene los próximos diez minutos. "
                                            "Seguís con intermedios."),
    (("toque", "choc", "sancion", "penal", "advertencia"), "En la vuelta 3 tocaste a Norris y te dieron una "
                                                           "advertencia. Después rozaste a Verstappen: dejá aire."),
    (("curva", "pierd", "frena"), "En la 1 perdés medio segundo: bloqueás adelante y atrás en la frenada. "
                                  "Frená un poco antes y soltá progresivo."),
]
SCRIPTED_DEFAULT = ("Vas octavo, quedan dos vueltas. Verstappen a medio segundo adelante y Gasly a dos décimas "
                    "y media atrás.")


def scripted_answer(question: str) -> str:
    folded = _fold(question)
    for keys, answer in SCRIPTED:
        if any(k in folded for k in keys):
            return answer
    return SCRIPTED_DEFAULT


# --- the caps ---------------------------------------------------------------------------

class DemoLimits:
    """Questions per player and per day, in memory (a restart forgives the day: fine for a demo)."""

    def __init__(self) -> None:
        self.day = date.today()
        self.by_user: dict[int, int] = {}
        self.total = 0

    def _roll(self) -> None:
        if date.today() != self.day:
            self.day, self.by_user, self.total = date.today(), {}, 0

    def left(self, user_id: int) -> int:
        self._roll()
        if self.total >= PER_DAY_TOTAL:
            return 0
        return max(0, PER_PLAYER_PER_DAY - self.by_user.get(user_id, 0))

    def take(self, user_id: int) -> None:
        self._roll()
        self.by_user[user_id] = self.by_user.get(user_id, 0) + 1
        self.total += 1


limits = DemoLimits()
_client: anthropic.AsyncAnthropic | None = None


def _model() -> str:
    return settings.ENGINEER_TALK_MODEL or TALK_MODEL


async def _ai_answer(question: str, history: list[dict], radio_name: str | None) -> tuple[str | None, dict]:
    global _client
    _client = _client or anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY, timeout=30.0, max_retries=1)
    messages: list[dict] = []
    for turn in history[-MAX_HISTORY:]:
        messages += [{"role": "user", "content": turn["pregunta"][:300]},
                     {"role": "assistant", "content": (turn.get("respuesta") or "(sin respuesta)")[:600]}]
    messages.append({"role": "user", "content": user_message(question, radio_name)})
    usage = {"input": 0, "output": 0, "cache_read": 0, "cache_write": 0}
    model = _model()
    response = None
    for _ in range(talk.MAX_TOOL_ROUNDS + 1):
        params: dict = {
            "model": model, "max_tokens": 1500,
            "system": [{"type": "text", "text": talk.talk_system() + DEMO_NOTE, "cache_control": {"type": "ephemeral"}}],
            "tools": TOOLS, "messages": messages, "output_config": {"effort": "low"},
        }
        if model.startswith(FALLBACK_MODELS):
            response = await _client.beta.messages.create(
                betas=["server-side-fallback-2026-07-01"], extra_body={"fallbacks": "default"}, **params)
        else:
            response = await _client.messages.create(**params)
        for k, attr in (("input", "input_tokens"), ("output", "output_tokens"),
                        ("cache_read", "cache_read_input_tokens"), ("cache_write", "cache_creation_input_tokens")):
            usage[k] += getattr(response.usage, attr, 0) or 0
        calls = [b for b in response.content if b.type == "tool_use"]
        if response.stop_reason != "tool_use" or not calls:
            break
        messages.append({"role": "assistant", "content": response.content})
        messages.append({"role": "user", "content": [
            {"type": "tool_result", "tool_use_id": c.id,
             "content": json.dumps(run_tool(c.name, dict(c.input or {})), ensure_ascii=False, default=str)}
            for c in calls]})
    text = "".join(b.text for b in response.content if b.type == "text") if response else ""
    return talk.clean_answer(text), usage


async def ask(user_id: int, radio_name: str | None, question: str, history: list[dict]) -> dict[str, Any]:
    """One demo question: the Pro engineer while the player has questions left, the script after."""
    question = question.strip()[:300]
    left = limits.left(user_id)
    started = time.monotonic()
    answer, source = None, "guion"
    if left > 0 and settings.ANTHROPIC_API_KEY:
        try:
            answer, usage = await _ai_answer(question, history, radio_name)
            limits.take(user_id)
            left -= 1
            source = "ia"
            logger.info("engineer demo answered", extra={
                "user_id": user_id, "model": _model(), "cost_usd": cost(_model(), usage),
                "latency_ms": int((time.monotonic() - started) * 1000)})
        except Exception as e:
            logger.warning("engineer demo failed", extra={"user_id": user_id, "error": str(e)})
    if not answer:
        answer, source = scripted_answer(question), "guion"
    return {"radio": answer, "fuente": source, "restantes": left}
