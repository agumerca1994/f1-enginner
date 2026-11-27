"""Who answers as the race engineer.

`RulesProvider` needs no AI: it turns the same facts into radio calls with
fixed rules. It is the free tier and what runs until an API key is set.
`AnthropicProvider` asks Claude, with the engineer's manual cached and a
JSON schema that guarantees the answer's shape.
"""

import json
import logging
import math
import time
from dataclasses import dataclass, field
from functools import cache
from pathlib import Path

import anthropic

from app.core.config import settings
from app.engineer.analysis import REACH_STATES
from app.engineer.engine import EngineerRequest
from app.engineer.history import WHEEL_OF_PUNCTURE
from app.telemetry import constants as c

logger = logging.getLogger(__name__)

RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "radio": {"type": ["string", "null"]},
        "prioridad": {"type": "string", "enum": ["info", "importante", "urgente"]},
        "tema": {"type": ["string", "null"]},
        "estrategia": {
            "type": "object",
            "properties": {
                "plan": {"type": "string"},
                "vuelta_box": {"type": ["integer", "null"]},
                "ventana_box": {"type": ["array", "null"], "items": {"type": "integer"}},
                "proximo_compuesto": {"type": ["string", "null"]},
                "alternativa": {"type": "string"},
                "certeza": {"type": "string", "enum": ["baja", "media", "alta"]},
            },
            "required": ["plan", "vuelta_box", "ventana_box", "proximo_compuesto", "alternativa", "certeza"],
            "additionalProperties": False,
        },
        "manejo": {"type": "array", "items": {"type": "string"}},
        "reglaje": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"parametro": {"type": "string"}, "cambio": {"type": "string"}, "motivo": {"type": "string"}},
                "required": ["parametro", "cambio", "motivo"],
                "additionalProperties": False,
            },
        },
        "analisis": {"type": "string"},
    },
    "required": ["radio", "prioridad", "tema", "estrategia", "manejo", "reglaje", "analisis"],
    "additionalProperties": False,
}

RADIO_SCHEMA = {
    "type": "object",
    "properties": {
        "radio": {"type": ["string", "null"]},
        "prioridad": {"type": "string", "enum": ["info", "importante", "urgente"]},
        "tema": {"type": ["string", "null"]},
    },
    "required": ["radio", "prioridad", "tema"],
    "additionalProperties": False,
}

# US$ per million tokens (input, output), from Anthropic's price list of October 2026.
# Cache reads cost ~10% of input and 5-minute cache writes ~125%. Longest ids first:
# prices are matched by prefix.
PRICES = {
    "claude-haiku-5-5": (0.10, 0.50),
    "claude-sonnet-5-5": (2.0, 10.0),
    "claude-opus-5-5": (4.0, 20.0),
    "claude-haiku-4-5": (1.0, 5.0),
    "claude-sonnet-5": (2.0, 10.0),
    "claude-opus-5": (5.0, 25.0),
}
# (pit-wall model on routine laps, model for important moments). Pro adds Opus for
# the decisions that matter most.
TIERS = {
    "standard": ("claude-sonnet-5-5", "claude-sonnet-5-5"),
    "pro": ("claude-sonnet-5-5", "claude-opus-5-5"),
    # Like pro, but Opus only where the call can change the race: the plan at the start, damage,
    # punctures, safety cars, rain, the stop itself and the debrief. Informative moments
    # (penalties, blisters) go to Sonnet thinking harder: on the Losail replays Sonnet said the
    # same there, but held a broken front wing for four laps where Opus boxed at once.
    "economico": ("claude-sonnet-5-5", "claude-opus-5-5"),
}
KEY_MOMENTS = ("race_start", "session_end", "damage", "puncture", "safety_car", "rain_forecast", "pitted")
# The radio lane: short calls on every routine moment, so the cheapest model. It gets
# the full facts and a focused brief, which is what an earlier Haiku lacked when it
# misread the race state (docs/pruebas/ingeniero-ia-real-2026-09-27.md).
RADIO_MODEL = "claude-haiku-5-5"
# Models that take the server-side refusal fallback (Haiku has none).
FALLBACK_MODELS = ("claude-opus-5-5", "claude-sonnet-5-5")
RADIO_PROMPT = Path(__file__).parent / "prompts" / "radio_es.md"
# The driver's questions: quick, but it reasons over tools and memory, so Sonnet at low effort.
TALK_MODEL = "claude-sonnet-5-5"


@cache
def radio_system() -> str:
    return RADIO_PROMPT.read_text(encoding="utf-8")


@dataclass
class Advice:
    response: dict
    provider: str  # "reglas" or the model id
    latency_ms: int
    usage: dict = field(default_factory=dict)
    cost_usd: float = 0.0


class RulesProvider:
    name = "reglas"

    async def advise(self, request: EngineerRequest) -> Advice:
        started = time.monotonic()
        response = rules_response(request)
        return Advice(response, self.name, int((time.monotonic() - started) * 1000))


class AnthropicProvider:
    def __init__(self, api_key: str, tier: str = "standard", fast_model: str = "", deep_model: str = "",
                 radio_model: str = "", talk_model: str = ""):
        default_fast, default_deep = TIERS.get(tier, TIERS["standard"])
        self.fast_model = fast_model or default_fast
        self.deep_model = deep_model or default_deep
        self.radio_model = radio_model or RADIO_MODEL
        self.talk_model = talk_model or TALK_MODEL
        self.client = anthropic.AsyncAnthropic(api_key=api_key, timeout=60.0, max_retries=2)
        self.tier = tier
        self.name = f"claude ({tier})"

    def pick(self, request: EngineerRequest) -> tuple[str, str]:
        """The model and effort for a full call."""
        if not request.deep:
            return self.fast_model, "low"
        if self.tier == "economico" and not any(t.kind in KEY_MOMENTS for t in request.triggers):
            return self.fast_model, "medium"
        return self.deep_model, "medium"

    async def advise(self, request: EngineerRequest) -> Advice:
        """The full call: strategy, driving, setup and analysis for the pit wall, plus radio."""
        model, effort = self.pick(request)
        return await self._call(
            model,
            # The manual is the same on every call: cache it.
            system=[{"type": "text", "text": request.system, "cache_control": {"type": "ephemeral"}}],
            user=request.user,
            schema=RESPONSE_SCHEMA,
            effort=effort,
            max_tokens=4096,
        )

    async def radio(self, request: EngineerRequest) -> Advice:
        """Just the radio call, quick: the radio brief plus the manual, both cached."""
        return await self._call(
            self.radio_model,
            system=[{"type": "text", "text": request.system},
                    {"type": "text", "text": radio_system(), "cache_control": {"type": "ephemeral"}}],
            user=request.user,
            schema=RADIO_SCHEMA,
            effort="low",
            max_tokens=600,
        )

    async def talk(self, runner, live, question: str) -> Advice:
        """Answer the driver's question: the model may look things up with the small tools
        (and note reports or agreed changes in the memory) before answering in one radio line."""
        from app.engineer import talk

        messages = talk.history_messages(runner.conversation) + [
            {"role": "user", "content": talk.user_message(runner, live, question)}]
        usage = {"input": 0, "output": 0, "cache_read": 0, "cache_write": 0}
        started = time.monotonic()
        used: list[str] = []
        response = None
        for _ in range(talk.MAX_TOOL_ROUNDS + 1):
            params: dict = {
                "model": self.talk_model,
                "max_tokens": 2000,
                "system": [{"type": "text", "text": talk.talk_system(), "cache_control": {"type": "ephemeral"}}],
                "tools": talk.TOOLS,
                "messages": messages,
                "output_config": {"effort": "low"},
            }
            if self.talk_model.startswith(FALLBACK_MODELS):
                response = await self.client.beta.messages.create(
                    betas=["server-side-fallback-2026-07-01"], extra_body={"fallbacks": "default"}, **params)
            else:
                response = await self.client.messages.create(**params)
            for k, attr in (("input", "input_tokens"), ("output", "output_tokens"),
                            ("cache_read", "cache_read_input_tokens"), ("cache_write", "cache_creation_input_tokens")):
                usage[k] += getattr(response.usage, attr, 0) or 0
            if response.stop_reason == "refusal":
                raise RuntimeError("the model declined the question")
            calls = [b for b in response.content if b.type == "tool_use"]
            if response.stop_reason != "tool_use" or not calls:
                break
            messages.append({"role": "assistant", "content": response.content})
            results = []
            for call in calls:
                used.append(call.name)
                try:
                    out = talk.run_tool(runner, live, call.name, dict(call.input or {}))
                    results.append({"type": "tool_result", "tool_use_id": call.id,
                                    "content": json.dumps(out, ensure_ascii=False, default=str)})
                except Exception as e:  # a broken tool must not lose the answer
                    logger.warning("talk tool failed", extra={"tool": call.name, "error": str(e)})
                    results.append({"type": "tool_result", "tool_use_id": call.id, "is_error": True,
                                    "content": f"No se pudo: {e}"})
            messages.append({"role": "user", "content": results})
        text = "".join(b.text for b in response.content if b.type == "text") if response else ""
        model = response.model if response else self.talk_model
        return Advice({"radio": talk.clean_answer(text), "prioridad": "info", "tema": "respuesta",
                       "herramientas": used or None},
                      model, int((time.monotonic() - started) * 1000), usage, cost(model, usage))

    async def _call(self, model: str, *, system: list, user: str, schema: dict, effort: str, max_tokens: int) -> Advice:
        params: dict = {
            "model": model,
            "max_tokens": max_tokens,
            "system": system,
            "messages": [{"role": "user", "content": user}],
            "output_config": {"format": {"type": "json_schema", "schema": schema}, "effort": effort},
        }
        started = time.monotonic()
        if model.startswith(FALLBACK_MODELS):
            # Server-side fallback: if the model declines, the API retries on a fallback model.
            response = await self.client.beta.messages.create(
                betas=["server-side-fallback-2026-07-01"], extra_body={"fallbacks": "default"}, **params)
        else:
            response = await self.client.messages.create(**params)
        latency = int((time.monotonic() - started) * 1000)
        if response.stop_reason == "refusal":
            raise RuntimeError(f"the model declined: {getattr(response, 'stop_details', None)}")
        text = next(b.text for b in response.content if b.type == "text")
        usage = {
            "input": response.usage.input_tokens,
            "output": response.usage.output_tokens,
            "cache_read": response.usage.cache_read_input_tokens or 0,
            "cache_write": response.usage.cache_creation_input_tokens or 0,
        }
        return Advice(json.loads(text), response.model, latency, usage, cost(response.model, usage))


def cost(model: str, usage: dict) -> float:
    price_in, price_out = next((p for m, p in PRICES.items() if model.startswith(m)), (0.0, 0.0))
    total = (usage["input"] * price_in + usage["cache_read"] * price_in * 0.1
             + usage["cache_write"] * price_in * 1.25 + usage["output"] * price_out)
    return round(total / 1e6, 5)


def get_provider():
    if settings.ANTHROPIC_API_KEY:
        return AnthropicProvider(settings.ANTHROPIC_API_KEY, settings.ENGINEER_TIER,
                                 settings.ENGINEER_FAST_MODEL, settings.ENGINEER_DEEP_MODEL,
                                 settings.ENGINEER_RADIO_MODEL, settings.ENGINEER_TALK_MODEL)
    return RulesProvider()


# --- Rules --------------------------------------------------------------------

def rules_response(request: EngineerRequest) -> dict:
    """What a by-the-book engineer says, from the same facts the AI receives."""
    f = json.loads(request.facts_json)
    kinds = {t.kind for t in request.triggers}
    se, pl, ne, co, es = f["sesion"], f["piloto"], f["neumaticos"], f["combustible"], f["estrategia_calculos"]
    race = (se.get("tipo") or "").startswith("Race")
    left = se.get("vueltas_restantes")
    rule = es["regla_dos_compuestos"]
    owes_stop = race and rule["aplica"] and not rule["cumplida"]
    window = [w for w in se.get("ventana_box_juego") or [] if w]
    ers = (pl.get("ers") or {}).get("bateria_pct")
    margin = co.get("vueltas_de_sobra")
    wear = max((ne.get("desgaste_pct") or {}).values(), default=0)
    to60 = ne.get("vueltas_hasta_60pct")
    rejoin = es.get("si_para_ahora") or {}
    rejoin_all = es.get("si_para_ahora_y_paran_todos") or {}
    softs = [s for s in es.get("juegos_de_neumaticos") or [] if not s["puesto"] and s["desgaste_pct"] < 20]

    radio, priority, driving = None, "info", []
    next_compound = None
    if owes_stop:
        # The next dry compound must differ from the ones used: that is the rule.
        used = set(rule["compuestos_secos_usados"])
        options = [s for s in softs if s["compuesto"] in ("Soft", "Medium", "Hard") and s["compuesto"] not in used]
        fits = [s for s in options if left is None or s["vida_util_vueltas"] >= left]
        pick = min(fits or options, key=lambda s: s["delta_ritmo_vs_puesto_s"], default=None)
        next_compound = pick["compuesto"] if pick else next(x for x in ("Hard", "Medium", "Soft") if x not in used)

    if "safety_car" in kinds and se.get("safety_car") in ("Full safety car", "Virtual safety car"):
        stop_pos = rejoin_all.get("posicion_estimada_al_salir") or rejoin.get("posicion_estimada_al_salir")
        if owes_stop or wear > 40:
            radio = (f"¡Box, box! {'Safety car' if se['safety_car'] == 'Full safety car' else 'VSC'}: la parada cuesta "
                     f"unos {es['perdida_box_s']:.0f} segundos" + (f" y salís cerca del P{stop_pos}" if stop_pos else "") + ".")
            priority = "urgente"
        else:
            radio = "Safety car: no hace falta parar, cuidá la temperatura de las gomas."
            priority = "importante"
    elif "safety_car" in kinds:
        radio = f"Relargada: batería al {ers:.0f}%, usá el modo adelantamiento en la recta para defenderte." if ers is not None else "Relargada, atento."
        priority = "importante"
    elif "damage" in kinds:
        parts = next((t.detail.get("parts", {}) for t in request.triggers if t.kind == "damage"), {})
        flats = [WHEEL_OF_PUNCTURE[p] for p in parts if p in WHEEL_OF_PUNCTURE]
        parts = {p: v for p, v in parts.items() if p not in WHEEL_OF_PUNCTURE}
        worst = max(parts.values(), default=0)
        names = [c.DAMAGE_PARTS_ES.get(p, p) for p in parts]
        wing = any("wing" in p for p, v in parts.items() if v >= 50)
        if flats:
            radio = (f"¡Pinchazo en la {_y(flats)}! Box, box, entrá ahora y cuidá el auto hasta boxes."
                     + (" Cambiamos también el alerón." if wing else ""))
            priority = "urgente"
        else:
            radio = f"Daño en {_y(names)}, {worst}%." + (" Paramos a cambiar el alerón." if wing else " Seguimos, te aviso si perdemos ritmo.")
            priority = "urgente" if worst >= 50 else "importante"
    elif "rain_forecast" in kinds:
        radio = "Viene lluvia en los próximos 15 minutos: preparate para intermedios."
        priority = "importante"
    elif "penalty" in kinds:
        d = next(t.detail for t in request.triggers if t.kind == "penalty")
        pending = (f.get("incidentes") or {}).get("sanciones_pendientes") or {}
        if pending.get("stop_and_go") or pending.get("drive_through"):
            kind = "stop and go" if pending.get("stop_and_go") else "drive through"
            radio = f"Nos dieron un {kind}" + (f": {d['sancion'].split(' por ', 1)[1]}" if " por " in (d.get("sancion") or "") else "") \
                + ". Lo cumplimos en la próxima parada."
        elif pl.get("penalizacion_s"):
            radio = f"Tenemos {pl['penalizacion_s']} segundos de penalización."
        else:
            radio = f"Ojo con los límites de pista: llevás {_count(pl.get('advertencias'), 'advertencia', 'advertencias')}."
        priority = "importante"
    elif "rival_overtake" in kinds:
        d = next(t.detail for t in request.triggers if t.kind == "rival_overtake")
        radio, priority = f"{d['piloto'].title()} activó el modo adelantamiento a {_secs(d['gap_s'])} atrás: defendé la próxima recta.", "importante"
    elif "overtake_available" in kinds:
        d = next(t.detail for t in request.triggers if t.kind == "overtake_available")
        radio, priority = f"Tenés el modo adelantamiento, estás a {_secs(d['gap_s'])} del de adelante: usalo en la recta.", "importante"
    elif "blisters" in kinds:
        d = next(t.detail for t in request.triggers if t.kind == "blisters")
        radio = f"Ampollas en la goma {d['rueda']}, {d['pct']}%: bajá el deslizamiento en la salida de las curvas."
        priority = "importante" if d["pct"] >= 30 else "info"
    elif "blue_flag" in kinds:
        radio, priority = "Bandera azul: viene el líder a doblarte, dejalo pasar en la próxima recta.", "importante"
    elif "tyre_overuse" in kinds:  # rarer than a corner tip: it goes first when both come together
        radio, priority = _overuse_call(next(t.detail for t in request.triggers if t.kind == "tyre_overuse")), "importante"
    elif "corner_coaching" in kinds:
        radio, priority = _corner_call(next(t.detail for t in request.triggers if t.kind == "corner_coaching")), "importante"
    elif "sector_completed" in kinds:
        d = next((t.detail for t in request.triggers if t.kind == "sector_completed"), {})
        if d.get("mejor_personal"):
            radio = f"Mejor sector {d.get('sector')} de la tanda. Ahí estás."
        else:
            radio = f"Perdiste {_tenths(d.get('delta_s') or 0)} en el sector {d.get('sector')}, ahí tenés para buscar."
    elif "pitted" in kinds:
        radio = "Buena parada. Dos vueltas para darle temperatura a las gomas nuevas."
    elif "session_end" in kinds:
        radio = f"Bandera a cuadros, terminamos {_place(pl.get('posicion'))}. Buen trabajo."
    elif "session_start" in kinds:  # practice or qualifying: the position means nothing yet
        radio = f"Arrancamos la tanda con {c.COMPOUNDS_ES.get(ne.get('compuesto'), 'estas gomas')}. Radio check, te escucho."
    elif "race_start" in kinds:
        radio = f"Largamos {_place(pl.get('posicion'))} con {c.COMPOUNDS_ES.get(ne.get('compuesto'), 'estas gomas')}." + (
            f" Hay que parar una vez, la ventana es de la {window[0]} a la {window[-1]}." if owes_stop and window else "")
    else:  # a routine lap: speak only when something needs attention
        if ers is not None and ers < 15:
            radio, priority = f"Batería al {ers:.0f}%: hacé una vuelta sin desplegar ERS para recargar.", "importante"
        elif margin is not None and margin < 0:
            radio, priority = f"Combustible justo: nos faltan {abs(margin):.1f} vueltas, levantá antes de frenar.", "importante"
        elif wear >= 60 or (to60 is not None and left is not None and to60 < left and to60 < 3):
            radio, priority = f"Las gomas están al {wear:.0f}% de desgaste: se viene la caída de rendimiento.", "importante"
        elif owes_stop and left is not None and left <= 3:
            radio, priority = "Todavía debemos la parada obligatoria: box esta vuelta.", "urgente"
        elif owes_stop and window and se.get("vuelta_actual") == window[0]:
            radio = f"Se abrió la ventana de boxes. Si paramos ahora salimos P{rejoin.get('posicion_estimada_al_salir')}."
        elif (reach := _catch_call(f)) is not None:
            radio, priority = reach

    if radio and priority != "urgente" and _said_recently(request, radio):
        radio = None  # the same advice twice in a row gets ignored; keep it for the panel
    if ers is not None and ers < 15:
        driving.append("Batería baja: una vuelta sin desplegar ERS (modo recarga) para recuperarla.")
    if margin is not None and margin < 0:
        driving.append("Ahorro de combustible: levantar antes de las frenadas largas.")

    pit_window = window if owes_stop and window else None
    return {
        "radio": radio,
        "prioridad": priority,
        "tema": _topic(kinds, radio),
        "estrategia": {
            "plan": ("Parada obligatoria pendiente" + (f": falta poner {c.COMPOUNDS_ES.get(next_compound, next_compound)}"
                                                        if next_compound else "")) if owes_stop
                    else "Sin paradas pendientes: gestionar gomas hasta el final" if race else "Sesión sin estrategia de carrera",
            "vuelta_box": None,
            "ventana_box": pit_window,
            "proximo_compuesto": next_compound,
            "alternativa": "Modo reglas: sin comparación de alternativas (se activa con IA).",
            "certeza": "media",
        },
        "manejo": driving,
        "reglaje": [],
        "analisis": _summary(f),
    }


def _topic(kinds: set[str], radio: str | None) -> str | None:
    """A short key for what the call is about, so the same topic is not repeated."""
    if not radio:
        return None
    for kind in ("safety_car", "damage", "rain_forecast", "penalty", "rival_overtake", "overtake_available",
                 "blisters", "blue_flag", "tyre_overuse", "corner_coaching", "sector_completed", "pitted",
                 "session_end", "session_start", "race_start"):
        if kind in kinds:
            return kind
    head = radio.split(":")[0].lower()
    for word, topic in (("batería", "bateria"), ("combustible", "combustible"), ("gomas", "gomas"),
                        ("parada", "parada"), ("ventana", "parada"), ("descont", "alcance")):
        if word in head:
            return topic
    return "vuelta"


def _said_recently(request: EngineerRequest, radio: str) -> bool:
    """Whether the last two radio calls already started the same way."""
    try:
        recent = json.loads(request.radio_json)
    except ValueError:
        return False
    head = radio.split(":")[0]
    return any(r.get("radio", "").split(":")[0] == head for r in recent[-2:])


def _summary(f: dict) -> str:
    pl, ri, ne = f["piloto"], f["ritmo"], f["neumaticos"]
    parts = [f"P{pl['posicion']}"] if pl.get("posicion") else []
    if pl.get("gap_adelante_s"):
        parts.append(f"a {pl['gap_adelante_s']:.1f} s del de adelante")
    if ri.get("promedio_ultimas_3_limpias_s"):
        parts.append(f"ritmo {ri['promedio_ultimas_3_limpias_s']:.1f} s")
    if ne.get("compuesto"):
        wear = max((ne.get("desgaste_pct") or {}).values(), default=0)
        compound = c.COMPOUNDS_ES.get(ne["compuesto"], ne["compuesto"])
        parts.append(f"{compound} de {ne.get('edad_vueltas')} vueltas con {wear:.0f}% de desgaste")
    return (", ".join(parts) + ".") if parts else "Todavía sin datos suficientes."


def _y(items: list[str]) -> str:
    """Join with commas and a final "y": "a, b y c"."""
    return items[0] if len(items) == 1 else ", ".join(items[:-1]) + " y " + items[-1]


def _secs(value: float) -> str:
    """A gap as said on the radio: "0,3 segundos"."""
    return f"{value:.1f}".replace(".", ",") + " segundos"



CATCH_CALL_LAPS = 3  # say it when the gap closes within this many laps


def _catch_call(f: dict) -> tuple[str, str] | None:
    """A routine-lap call when the car behind will catch the player soon, or the player the one ahead."""
    reach = (f.get("rivales") or {}).get("alcance") or {}
    behind, ahead = reach.get("atras"), reach.get("adelante")
    for side, chasing in ((behind, False), (ahead, True)):
        if not side or side.get("estado") != REACH_STATES["catching"]:
            continue
        laps = side.get("vueltas_para_alcanzar")
        if laps is None or laps > CATCH_CALL_LAPS:
            continue
        closing, name = side.get("descuento_s_por_vuelta") or 0, (side.get("piloto") or "").title()
        n = max(1, math.ceil(laps))
        if chasing:
            return f"Le descontás {closing:.1f} por vuelta a {name}: en {n} vueltas lo tenés.", "info"
        return f"{name} te descuenta {closing:.1f} por vuelta: te alcanza en {n} vueltas. Cuidá las salidas.", "importante"
    return None


CORNER_TIPS = {
    "bloqueo_delantero": "bloqueás adelante en la frenada: frená más progresivo o balance de frenos un punto atrás",
    "bloqueo_trasero": "bloqueás atrás en la frenada: balance de frenos un punto adelante y soltá el freno antes de doblar",
    "patinaje_traccion": "patinás atrás en la salida: abrí el acelerador más suave hasta enderezar",
    "sobreviraje": "se te va la cola: soltá el freno más gradual mientras doblás",
    "subviraje": "el auto no gira: entrá un poco más lento y acelerá antes",
    "fuera_de_pista": "te vas de pista: ojo con los límites, que cuesta tiempo y advertencias",
}


NUMBERS_ES = {1: "una", 2: "dos", 3: "tres", 4: "cuatro", 5: "cinco", 6: "seis", 7: "siete", 8: "ocho", 9: "nueve"}


def _count(n, one: str, many: str) -> str:
    """'una advertencia', 'tres advertencias', as said aloud."""
    n = int(n or 0)
    return f"{NUMBERS_ES.get(n, n)} {one if n == 1 else many}"


def _tenths(seconds: float) -> str:
    if seconds < 0.95:
        n = max(1, round(seconds * 10))
        return "una décima" if n == 1 else f"{NUMBERS_ES.get(n, n)} décimas"
    if round(seconds, 1) == 1.0:
        return "un segundo"
    return f"{seconds:.1f} segundos".replace(".", ",")


def _corner_call(d: dict) -> str:
    """'Perdés cuatro décimas en la salida de la 3: patinás atrás...' from a corner note."""
    n = d["curva"]
    issue = next(iter(d.get("problemas_repetidos") or d.get("problemas") or []), None)
    loss = d.get("perdida_s")
    if issue:  # the tip already names the phase
        head = f"Perdés {_tenths(loss)} en la {n}" if loss and loss > 0 else f"En la {n}"
        return f"{head}: {CORNER_TIPS[issue]}."
    head = f"Perdés {_tenths(loss)} en la {d['donde_pierde'] or 'curva'} de la {n}" if loss and loss > 0 else f"En la {n}"
    now, best = d.get("velocidad_kmh") or {}, d.get("velocidad_mejor_paso_kmh") or {}
    if d.get("donde_pierde") == "salida" and now.get("salida") and best.get("salida"):
        return f"{head}: salís {best['salida'] - now['salida']} km/h más lento que en tu mejor paso, acelerá antes."
    if now.get("entrada") and best.get("entrada") and best["entrada"] > now["entrada"]:
        return f"{head}: llegás {best['entrada'] - now['entrada']} km/h más lento, frenás antes de lo necesario."
    return f"{head}: mirá esa curva, ahí está la diferencia con tu mejor vuelta."


def _overuse_call(d: dict) -> str:
    rueda = d["rueda"]
    text = (f"La goma {rueda} se gasta más que las otras: {d['pct_por_vuelta']:.1f} por ciento por vuelta "
            f"contra {d['resto_pct_por_vuelta']:.1f}.").replace(".", ",", 2)
    corners = d.get("curvas") or []
    if corners:
        where = " y la ".join(str(k["curva"]) for k in corners)
        issue = next((i for k in corners for i in k["problemas"]), None)
        text += f" La castigás en la {where}" + (f": {CORNER_TIPS[issue].split(':')[1].strip()}." if issue else ".")
    return text


PLACES = ("primeros", "segundos", "terceros", "cuartos", "quintos", "sextos", "séptimos", "octavos", "novenos", "décimos")


def _place(pos) -> str:
    """'cuartos', as an engineer says it; 'en el puesto 14' further back."""
    if isinstance(pos, int) and 1 <= pos <= len(PLACES):
        return PLACES[pos - 1]
    return f"en el puesto {pos}" if pos else "en carrera"
