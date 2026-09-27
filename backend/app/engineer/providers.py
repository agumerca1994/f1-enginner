"""Who answers as the race engineer.

`RulesProvider` needs no AI: it turns the same facts into radio calls with
fixed rules. It is the free tier and what runs until an API key is set.
`AnthropicProvider` asks Claude, with the engineer's manual cached and a
JSON schema that guarantees the answer's shape.
"""

import json
import logging
import time
from dataclasses import dataclass, field

import anthropic

from app.core.config import settings
from app.engineer.engine import EngineerRequest

logger = logging.getLogger(__name__)

RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "radio": {"type": ["string", "null"]},
        "prioridad": {"type": "string", "enum": ["info", "importante", "urgente"]},
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
    "required": ["radio", "prioridad", "estrategia", "manejo", "reglaje", "analisis"],
    "additionalProperties": False,
}

# US$ per million tokens (input, output), from Anthropic's price list of June 2026.
# Cache reads cost ~10% of input and 5-minute cache writes ~125%.
PRICES = {
    "claude-haiku-4-5": (1.0, 5.0),
    "claude-sonnet-5": (2.0, 10.0),
    "claude-opus-5": (5.0, 25.0),
    "claude-opus-5-5": (4.0, 20.0),
}
TIERS = {
    "standard": ("claude-haiku-4-5", "claude-sonnet-5"),
    "pro": ("claude-sonnet-5", "claude-opus-5"),
}


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
    def __init__(self, api_key: str, tier: str = "standard", fast_model: str = "", deep_model: str = ""):
        default_fast, default_deep = TIERS.get(tier, TIERS["standard"])
        self.fast_model = fast_model or default_fast
        self.deep_model = deep_model or default_deep
        self.client = anthropic.AsyncAnthropic(api_key=api_key, timeout=60.0, max_retries=2)
        self.name = f"claude ({tier})"

    async def advise(self, request: EngineerRequest) -> Advice:
        model = self.deep_model if request.deep else self.fast_model
        params: dict = {
            "model": model,
            "max_tokens": 4096,
            # The manual is the same on every call: cache it.
            "system": [{"type": "text", "text": request.system, "cache_control": {"type": "ephemeral"}}],
            "messages": [{"role": "user", "content": request.user}],
            "output_config": {"format": {"type": "json_schema", "schema": RESPONSE_SCHEMA}},
        }
        if not model.startswith("claude-haiku"):
            # Radio calls must be quick; strategy calls may think a bit more.
            params["output_config"]["effort"] = "medium" if request.deep else "low"
        started = time.monotonic()
        if model.startswith("claude-opus-5"):
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
                                 settings.ENGINEER_FAST_MODEL, settings.ENGINEER_DEEP_MODEL)
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
        pick = min(fits or options, key=lambda s: s["delta_ritmo_s"], default=None)
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
        radio = f"Relargada: batería al {ers:.0f}%, usá Overtake en la recta para defenderte." if ers is not None else "Relargada, atento."
        priority = "importante"
    elif "damage" in kinds:
        parts = request.triggers[-1].detail.get("parts", {})
        worst = max(parts.values(), default=0)
        radio = f"Daño: {', '.join(parts)} al {worst}%." + (" Paramos a cambiar el alerón." if worst >= 50 and "wing" in " ".join(parts) else " Seguimos, te aviso si perdemos ritmo.")
        priority = "urgente" if worst >= 50 else "importante"
    elif "rain_forecast" in kinds:
        radio = "Viene lluvia en los próximos 15 minutos: preparate para intermedios."
        priority = "importante"
    elif "penalty" in kinds:
        radio = f"Ojo con los límites de pista: vas {pl.get('advertencias')} advertencias." if not pl.get("penalizacion_s") else f"Tenemos {pl['penalizacion_s']} segundos de penalización."
        priority = "importante"
    elif "pitted" in kinds:
        radio = "Buena parada. Dos vueltas para darle temperatura a las gomas nuevas."
    elif "session_end" in kinds:
        radio = f"Bandera a cuadros, terminamos P{pl.get('posicion')}. Buen trabajo."
    elif "session_start" in kinds:
        radio = f"Largamos P{pl.get('posicion')} con {ne.get('compuesto')}." + (
            f" Hay que parar una vez, la ventana es de la {window[0]} a la {window[-1]}." if owes_stop and window else "")
    else:  # a routine lap: speak only when something needs attention
        if ers is not None and ers < 15:
            radio, priority = f"Batería al {ers:.0f}%: una vuelta en modo None o medio para recargar.", "importante"
        elif margin is not None and margin < 0:
            radio, priority = f"Combustible justo: nos faltan {abs(margin):.1f} vueltas, levantá antes de frenar.", "importante"
        elif wear >= 60 or (to60 is not None and left is not None and to60 < left and to60 < 3):
            radio, priority = f"Las gomas están al {wear:.0f}% de desgaste: se viene la caída de rendimiento.", "importante"
        elif owes_stop and left is not None and left <= 3:
            radio, priority = "Todavía debemos la parada obligatoria: box esta vuelta.", "urgente"
        elif owes_stop and window and se.get("vuelta_actual") == window[0]:
            radio = f"Se abrió la ventana de boxes. Si paramos ahora salimos P{rejoin.get('posicion_estimada_al_salir')}."

    if radio and priority != "urgente" and _said_recently(request, radio):
        radio = None  # the same advice twice in a row gets ignored; keep it for the panel
    if ers is not None and ers < 15:
        driving.append("Batería baja: modo None o medio una vuelta para recargar.")
    if margin is not None and margin < 0:
        driving.append("Ahorro de combustible: levantar antes de las frenadas largas.")

    pit_window = window if owes_stop and window else None
    return {
        "radio": radio,
        "prioridad": priority,
        "estrategia": {
            "plan": ("Parada obligatoria pendiente" + (f" por {next_compound}" if next_compound else "")) if owes_stop
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
    parts = [f"P{pl.get('posicion')}"]
    if pl.get("gap_adelante_s"):
        parts.append(f"a {pl['gap_adelante_s']:.1f} s del de adelante")
    if ri.get("promedio_ultimas_3_limpias_s"):
        parts.append(f"ritmo {ri['promedio_ultimas_3_limpias_s']:.1f} s")
    if ne.get("compuesto"):
        wear = max((ne.get("desgaste_pct") or {}).values(), default=0)
        parts.append(f"{ne['compuesto']} de {ne.get('edad_vueltas')} vueltas con {wear:.0f}% de desgaste")
    return ", ".join(parts) + "."
