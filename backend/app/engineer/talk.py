"""Talking to the engineer: the driver asks, the engineer answers on the radio.

This is what made the spoken sessions with the MCP work: the driver asks
("estatus", "¿cómo me fue en la 3?", "¿cuándo paro?"), the engineer looks up
only what it needs with small tools, remembers what the driver reported and
answers with one idea. Code still does every calculation; the model chooses
what to say and says it. The same small tools back the public MCP.

Some requests need no model at all and are answered at once: "anotalo" saves
the report, "alto" / "no me hables" asks for quiet, "hablame" lifts it.
"""

import json
import logging
import re
import time
import unicodedata
from functools import cache
from pathlib import Path
from typing import Any

from app.engineer import analysis
from app.engineer.setup_sheet import setup_values  # noqa: F401
from app.engineer.traces import compare as compare_traces
from app.live import snapshot

logger = logging.getLogger(__name__)

TALK_PROMPT = Path(__file__).parent / "prompts" / "talk_es.md"
MAX_TOOL_ROUNDS = 4
HISTORY_TURNS = 6


@cache
def talk_system() -> str:
    return TALK_PROMPT.read_text(encoding="utf-8")


def _fold(text: str) -> str:
    return unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode().lower().strip()


# --- the tools ---------------------------------------------------------------------------

def _age(snap: dict) -> float | None:
    ages = [b.get("age_s") for b in (snap.get("lap"), snap.get("status"), snap.get("session")) if b]
    ages = [a for a in ages if a is not None]
    return round(max(ages), 1) if ages else None


def brief_status(runner, live) -> dict[str, Any]:
    """Position, lap, gaps and their trend, tyres, battery, fuel, weather, damage: the radio "status"."""
    if live is None:
        return {"en_vivo": False, "nota": "No llega telemetría."}
    f = analysis.build(live, runner.engineer.history, prior=runner.engineer.prior_knowledge)
    snap = snapshot.build(live)
    se, pl, ne, co, ri = f["sesion"], f["piloto"], f["neumaticos"], f["combustible"], f["rivales"]
    ahead = (ri.get("adelante") or [None])[-1]
    behind = (ri.get("atras") or [None])[0]
    wear = ne.get("desgaste_pct") or {}
    rain = [p for p in se.get("pronostico") or [] if p.get("rain_percent", 0) >= 20][:2]
    return {
        "sesion": se.get("tipo"),
        "pista": se.get("pista"),
        "vuelta": se.get("vuelta_actual"),
        "vueltas_restantes": se.get("vueltas_restantes"),
        "tiempo_restante_s": se.get("tiempo_restante_s"),
        "posicion": pl.get("posicion"),
        "en_boxes": pl.get("en_boxes"),
        "paradas": pl.get("paradas"),
        "adelante": {"piloto": ahead["piloto"], "gap_s": pl.get("gap_adelante_s"),
                     "tendencia": ahead.get("tendencia_gap_con_piloto")} if ahead else None,
        "atras": {"piloto": behind["piloto"], "tendencia": behind.get("tendencia_gap_con_piloto"),
                  "alcance": (ri.get("alcance") or {}).get("atras")} if behind else None,
        "gaps_por": pl.get("gaps_por"),
        "gomas": {"compuesto": ne.get("compuesto"), "edad_vueltas": ne.get("edad_vueltas"),
                  "desgaste_max_pct": max(wear.values()) if wear else None,
                  "goma_mas_gastada": max(wear, key=wear.get) if wear else None,
                  "desgaste_por_vuelta_max": ne.get("desgaste_por_vuelta_max")},
        "bateria_pct": (pl.get("ers") or {}).get("bateria_pct"),
        "combustible_vueltas_de_sobra": co.get("vueltas_de_sobra"),
        "clima": se.get("clima"),
        "lluvia_proxima": rain or None,
        "danos_mayores_5pct": {k: v for k, v in (pl.get("danos_pct") or {}).items() if isinstance(v, (int, float)) and v > 5},
        "penalizacion_s": pl.get("penalizacion_s"),
        "advertencias": pl.get("advertencias"),
        "sanciones_pendientes": f["incidentes"]["sanciones_pendientes"],
        "ultimas_sanciones": f["incidentes"]["mis_sanciones"][-3:],
        "ultimos_toques": f["incidentes"]["mis_toques"][-3:],
        "delta_vs_mejor_vuelta_s": ((f.get("sectores") or {}).get("vuelta_en_curso") or {}).get("delta_vs_mejor_vuelta_s"),
        "sector_actual": ((f.get("sectores") or {}).get("vuelta_en_curso") or {}).get("sector_actual"),
        "antiguedad_s": _age(snap),
        "recepcion": f["calidad_datos"]["recepcion_telemetria"],
    }


def corner_analysis(runner, number: int, laps: int = 3) -> dict[str, Any]:
    """One corner over the last laps against the best pass of the session: speeds, loss, issues."""
    coach = runner.engineer.history.corners
    corner = next((k for k in coach.corners if k.number == number), None)
    if corner is None:
        known = [k.number for k in coach.corners]
        return {"error": f"No conozco la curva {number}." + (f" Curvas: {known}." if known else
                                                             " Todavía no se mapearon las curvas.")}
    done = sorted(coach.passes)[-laps:]
    rows = [{"vuelta": lap, **coach.describe(lap, corner)} for lap in done if corner.number in coach.passes[lap]]
    return {
        "curva": number, "sector": corner.sector,
        "entrada_m": round(corner.entry_m), "apex_m": round(corner.apex_m), "salida_m": round(corner.exit_m),
        "vueltas": rows,
        "confianza": "baja" if len(rows) < 2 else "media" if len(rows) < 3 else "alta",
        "nota": "perdida_s contra el mejor paso propio por esa curva en la sesión. balance_deg positivo = subviraje, "
                "negativo = sobreviraje. Sin vueltas = la curva no tuvo datos suficientes (poca recepción).",
    }


def sector_analysis(runner, live, n: int) -> dict[str, Any]:
    """A sector of the last lap against the personal best, with its corners ordered by loss."""
    h = runner.engineer.history
    last = h.last_lap_sectors or [None, None, None]
    best = h.best_sectors.get(n)
    mine = last[n - 1] if 1 <= n <= 3 else None
    summary = h.corners.summary(last_laps=3) or {}
    corners = [r for r in summary.get("peores", []) if r["sector"] == n]
    lap_now = int(live.last["lap_data"].body["lap_data"][live.last["lap_data"].player_car_index]["current_lap_num"]) \
        if live is not None and live.last.get("lap_data") is not None else None
    return {
        "sector": n,
        "ultima_vuelta_s": analysis._s(mine),
        "mejor_propio_s": analysis._s(best),
        "diferencia_s": round((mine - best) / 1000, 3) if mine and best else None,
        "curvas_que_mas_pierden": corners,
        "vuelta_en_curso": lap_now,
        "nota": "El sector de la vuelta en curso todavía no cuenta hasta cruzarlo." if lap_now else None,
    }


def track_incidents(runner, live) -> dict[str, Any]:
    """Contacts with the player and who it was, sanctions and what is still to serve, passes,
    retirements and the rivals around who just stopped."""
    if live is None:
        return {"en_vivo": False}
    return {**analysis.incidents(snapshot.build(live), runner.engineer.history),
            "safety_car": (snapshot.build(live).get("session") or {}).get("safety_car")}


def tyres(runner, live) -> dict[str, Any]:
    f = analysis.build(live, runner.engineer.history)
    return {**f["neumaticos"], "juegos": f["estrategia_calculos"].get("juegos_de_neumaticos"),
            "antiguedad_s": _age(snapshot.build(live))}


def strategy(runner, live, stop_lap: int | None = None) -> dict[str, Any]:
    f = analysis.build(live, runner.engineer.history, prior=runner.engineer.prior_knowledge)
    out = {
        "sesion": {k: f["sesion"].get(k) for k in ("tipo", "vuelta_actual", "vueltas_restantes", "safety_car")},
        "calculos": f["estrategia_calculos"],
        "rivales": f["rivales"],
        "neumaticos": {k: f["neumaticos"].get(k) for k in ("compuesto", "edad_vueltas", "desgaste_por_vuelta_max",
                                                            "vueltas_hasta_60pct", "vueltas_hasta_70pct")},
        "plan_acordado": runner.memory.data.get("plan_carrera"),
    }
    if stop_lap is not None:
        out["pregunta_vuelta_parada"] = stop_lap
        out["nota"] = ("si_para_ahora es la posición al salir si para en esta vuelta; para otra vuelta, sumá lo que "
                       "cambian los gaps con la tendencia de cada rival.")
    return out


def setup_status(runner, live) -> dict[str, Any]:
    current = analysis._setup(live) if live is not None else None
    d = runner.memory.data
    return {
        "reglaje_leido_del_juego": current,
        "acordado_pendiente": [a for a in d["reglaje_acordado"] if a.get("estado") == "pendiente"],
        "historial": d["historial_reglaje"][-8:],
        "ajustes_en_carrera": (analysis.build(live, runner.engineer.history).get("ajustes_en_carrera")
                               if live is not None else None),
        "nota": "Compará el acordado con el leído del juego: si no coincide, avisá primero. En clasificación y "
                "carrera el reglaje de garaje está bloqueado, pero desde el volante se cambian el reparto de frenada "
                "y el diferencial al acelerar, y en una parada el alerón delantero.",
    }


def compare_laps(runner, lap_a: int, lap_b: int) -> dict[str, Any]:
    tr = runner.traces
    if tr is None or tr.player is None:
        return {"error": "No hay trazas de esta sesión en memoria."}
    a, b = tr.trace(tr.player, lap_a), tr.trace(tr.player, lap_b)
    missing = [n for n, t in ((lap_a, a), (lap_b, b)) if t is None]
    if missing:
        return {"error": f"No tengo la traza de la vuelta {missing}. Vueltas: {sorted(tr.player_laps)}."}
    thin = [n for n, t in ((lap_a, a), (lap_b, b)) if t.coverage < 0.5]
    rows = compare_traces(a, b, runner.engineer.history.corners.corners)
    rows.sort(key=lambda r: -abs(r.get("diferencia_s") or 0))
    return {
        "vuelta_a": lap_a, "vuelta_b": lap_b,
        "diferencia_s": round((b.time_ms - a.time_ms) / 1000, 3) if a.time_ms and b.time_ms else None,
        "curvas_con_mas_diferencia": rows[:5] if not thin else None,
        "datos_insuficientes": f"Vuelta {thin} con poca telemetría." if thin else None,
        "nota": "diferencia_s positiva = la vuelta B pierde ese tiempo.",
    }


TOOLS = [
    {"name": "estado_breve", "description": "Posición, vuelta, gaps adelante y atrás con tendencia, gomas, batería, "
     "combustible, clima próximo, daños y antigüedad del dato. Para 'estatus', '¿quién viene atrás?'.",
     "input_schema": {"type": "object", "properties": {}, "additionalProperties": False}},
    {"name": "analisis_curva", "description": "Una curva en las últimas vueltas contra el mejor paso propio: "
     "velocidades de entrada, mínima y salida, pérdida, problemas y balance. Para '¿cómo me fue en la 3?'.",
     "input_schema": {"type": "object", "properties": {
         "numero": {"type": "integer"}, "vueltas": {"type": "integer"}}, "required": ["numero"],
         "additionalProperties": False}},
    {"name": "sector", "description": "Un sector de la última vuelta contra el mejor propio y sus curvas ordenadas "
     "por pérdida. Para '¿dónde pierdo en el sector 1?'.",
     "input_schema": {"type": "object", "properties": {"n": {"type": "integer"}}, "required": ["n"],
                      "additionalProperties": False}},
    {"name": "incidentes", "description": "Lo que pasó en la pista: con quién chocó el piloto y cuándo, sus "
     "sanciones (motivo, segundos, stop and go o drive through pendientes), quién lo pasó y a quién pasó, abandonos, "
     "rivales cerca que pararon y toques entre otros. Para '¿quién me chocó?', '¿por qué me penalizaron?', "
     "'¿qué pasó adelante?'.",
     "input_schema": {"type": "object", "properties": {}, "additionalProperties": False}},
    {"name": "neumaticos", "description": "Desgaste y temperatura por goma (instantánea, como la ve el piloto en la "
     "pantalla, y promedio de la última vuelta), desgaste por vuelta (y la que más se "
     "gasta), vueltas hasta 60/70% y juegos disponibles.",
     "input_schema": {"type": "object", "properties": {}, "additionalProperties": False}},
    {"name": "estrategia", "description": "Pérdida en boxes medida, dónde sale si para ahora, rivales con gaps y "
     "tendencias, regla de dos compuestos, plan acordado. Para '¿cuándo paro?', 'calculame el undercut'.",
     "input_schema": {"type": "object", "properties": {"vuelta_parada": {"type": "integer"}},
                      "additionalProperties": False}},
    {"name": "reglaje", "description": "Reglaje leído del juego, cambios acordados pendientes e historial de "
     "cambios. Usalo antes de proponer un cambio de reglaje.",
     "input_schema": {"type": "object", "properties": {}, "additionalProperties": False}},
    {"name": "comparar_vueltas", "description": "Dos vueltas propias curva por curva. Útil tras un cambio de reglaje.",
     "input_schema": {"type": "object", "properties": {"a": {"type": "integer"}, "b": {"type": "integer"}},
                      "required": ["a", "b"], "additionalProperties": False}},
    {"name": "guardar_reporte", "description": "Anota lo que siente el piloto en el auto (tal cual lo dijo) y "
     "dónde, para cruzarlo con la telemetría en boxes.",
     "input_schema": {"type": "object", "properties": {"texto": {"type": "string"}, "zona": {"type": "string"}},
                      "required": ["texto"], "additionalProperties": False}},
    {"name": "actualizar_reporte", "description": "Marca un reporte del piloto como 'mejoró' o 'resuelto' (sólo si "
     "el piloto lo confirma o el dato mejoró dos vueltas seguidas).",
     "input_schema": {"type": "object", "properties": {"n": {"type": "integer"},
                                                       "estado": {"type": "string", "enum": ["abierto", "mejoró", "resuelto"]}},
                      "required": ["n", "estado"], "additionalProperties": False}},
    {"name": "acordar_reglaje", "description": "Registra un cambio de reglaje que el piloto aceptó, para verificar "
     "después que lo aplicó bien. Un parámetro por vez.",
     "input_schema": {"type": "object", "properties": {"parametro": {"type": "string"}, "valor": {"type": "number"},
                                                       "motivo": {"type": "string"}},
                      "required": ["parametro", "valor", "motivo"], "additionalProperties": False}},
]


def run_tool(runner, live, name: str, args: dict) -> dict[str, Any]:
    lap = runner._lap or None
    if name == "estado_breve":
        return brief_status(runner, live)
    if name == "analisis_curva":
        return corner_analysis(runner, int(args["numero"]), int(args.get("vueltas") or 3))
    if name == "sector":
        return sector_analysis(runner, live, int(args["n"]))
    if name == "incidentes":
        return track_incidents(runner, live)
    if name == "neumaticos":
        return tyres(runner, live)
    if name == "estrategia":
        return strategy(runner, live, args.get("vuelta_parada"))
    if name == "reglaje":
        return setup_status(runner, live)
    if name == "comparar_vueltas":
        return compare_laps(runner, int(args["a"]), int(args["b"]))
    if name == "guardar_reporte":
        return {"guardado": runner.memory.add_report(args["texto"], args.get("zona"), lap)}
    if name == "actualizar_reporte":
        r = runner.memory.set_report_state(int(args["n"]), args["estado"])
        return {"actualizado": r} if r else {"error": "No existe ese reporte."}
    if name == "acordar_reglaje":
        return {"acordado": runner.memory.agree_setup(args["parametro"], args["valor"], args["motivo"])}
    return {"error": f"herramienta desconocida: {name}"}


# --- requests that need no model -------------------------------------------------------

NOTE = re.compile(r"\b(anotalo|anota(lo)? para (boxes|el box)|anota esto|anota)\b")
QUIET = re.compile(r"^(alto|silencio|calla(te)?|no me (hables|des informacion|digas nada)( ahora)?)\b")
RESUME = re.compile(r"^(habla(me)?|volve a hablar(me)?|ya podes hablar)\b")


def quick_answer(runner, text: str) -> str | None:
    """Commands answered at once, without a model."""
    folded = _fold(text)
    if QUIET.search(folded):
        runner.memory.set_silence(True)
        return "Anotado, silencio."
    if RESUME.search(folded):
        runner.memory.set_silence(False)
        return "Dale, te vuelvo a hablar."
    if NOTE.search(folded):
        # "Anotalo para boxes: flota en la 1" -> the report is what is left once the command goes.
        report = re.sub(r"(?i)\b(anot[aá](lo)?( para (boxes|el box))?|anot[aá] esto)\b[:,.]?", "", text).strip(" ,.:")
        if report:
            runner.memory.add_report(report, None, runner._lap or None)
        return "Anotado."
    return None


def rules_answer(runner, live, text: str) -> str:
    """Without an AI key: a by-the-book status, whatever the question."""
    s = brief_status(runner, live)
    if not s.get("posicion"):
        return "No me llegan datos tuyos ahora."
    parts = [f"P{s['posicion']}"]
    if s.get("vueltas_restantes"):
        parts.append(f"quedan {s['vueltas_restantes']} vueltas")
    if (s.get("adelante") or {}).get("gap_s"):
        parts.append(f"a {s['adelante']['gap_s']:.1f} de {s['adelante']['piloto'].title()}".replace(".", ",", 1))
    g = s.get("gomas") or {}
    if g.get("desgaste_max_pct") is not None:
        parts.append(f"gomas al {g['desgaste_max_pct']:.0f}%")
    return ", ".join(parts) + "."


def user_message(runner, live, text: str) -> str:
    """The question with the short status and the memory, so most questions need no tool."""
    return "\n".join([
        "## Pregunta del piloto",
        text,
        "",
        "## Estado breve ahora",
        json.dumps(brief_status(runner, live), ensure_ascii=False, separators=(",", ":")),
        "",
        "## Memoria del fin de semana",
        json.dumps(runner.memory.summary(runner.radio_name), ensure_ascii=False, separators=(",", ":")),
    ])


def history_messages(conversation: list[dict]) -> list[dict]:
    """Earlier questions and answers of this session, as plain turns."""
    out = []
    for turn in conversation[-HISTORY_TURNS:]:
        out.append({"role": "user", "content": turn["pregunta"]})
        out.append({"role": "assistant", "content": turn["respuesta"] or "(sin respuesta)"})
    return out


def clean_answer(text: str) -> str | None:
    text = text.strip().strip('"“”').strip()
    return None if not text or text in ("-", "—", "null", "(silencio)") else text


def started() -> float:
    return time.monotonic()
