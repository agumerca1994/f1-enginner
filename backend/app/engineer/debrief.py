"""Written by code, read by the player: where the time went and how a session went.

The box screen and the session summary show these. No language model is involved,
so they cost nothing and say the same thing every time for the same data; the
engineer only reads them out.
"""

from __future__ import annotations

import statistics
from typing import Any

from app.engineer import box
from app.engineer.review import SessionReview
from app.engineer.setup_advice import session_advice

MIN_LOSS_S = 0.05  # less than this in a corner is noise, not a lesson
TOP_LOSSES = 3

_ISSUE_TEXT = {
    "sobreviraje": "Se te va la cola.",
    "patinaje_traccion": "Patina atrás al acelerar a la salida.",
    "subviraje": "El auto no gira en la entrada y abrís la trazada.",
    "bloqueo_delantero": "Bloqueás adelante al frenar.",
    "bloqueo_trasero": "Bloqueás atrás al frenar.",
    "fuera_de_pista": "Te vas de la pista.",
}


def _corner_text(row: dict[str, Any], against: str) -> str:
    """One plain sentence on why a corner was slower, from the pass's problems and the trace differences."""
    parts = []
    issues = (row.get("b") or {}).get("problemas") or []
    if issues and issues[0] in _ISSUE_TEXT:
        parts.append(_ISSUE_TEXT[issues[0]])
    brake = row.get("b_frena_mas_tarde_m")
    vmin = row.get("b_velocidad_minima_kmh")
    throttle = row.get("b_acelera_mas_tarde_m")
    if brake is not None and brake <= -8:
        parts.append(f"Frenás {round(-brake)} m antes que {against}.")
    elif vmin is not None and vmin <= -4:
        parts.append(f"Pasás {round(-vmin)} km/h más lento por el vértice que {against}.")
    elif throttle is not None and throttle >= 10:
        parts.append(f"Acelerás a fondo {round(throttle)} m más tarde que {against}.")
    if not parts:
        parts.append(f"Perdés tiempo contra {against} en toda la curva.")
    return " ".join(parts[:2])


def losses(r: SessionReview, target: tuple[int, int], reference: tuple[int, int], against: str) -> list[dict[str, Any]]:
    """The corners where `target` lost most against `reference`, worst first."""
    cmp = box.comparison(r, reference, target, arrays=False)
    if cmp is None or cmp.get("datos_insuficientes"):
        return []
    rows = [row for row in cmp["curvas"] if (row.get("diferencia_s") or 0) >= MIN_LOSS_S]
    rows.sort(key=lambda row: -row["diferencia_s"])
    return [
        {
            "curva": row["curva"], "sector": row["sector"], "apex_m": row["apex_m"],
            "perdida_s": round(row["diferencia_s"], 2), "texto": _corner_text(row, against),
            "vuelta": target[1], "referencia": {"car": reference[0], "lap": reference[1]},
        }
        for row in rows[:TOP_LOSSES]
    ]


def _reference(r: SessionReview, exclude: tuple[int, int] | None) -> tuple[tuple[int, int], str] | None:
    """The fastest other car's best lap, else the player's own best."""
    tr = r.traces
    if tr is None:
        return None
    refs = tr.references(limit=1)
    if refs:
        t = refs[0]
        entry = tr.names.get(t.car)
        name = (entry[0] if isinstance(entry, tuple) else entry) or ""
        name = name.title() if name.isupper() else name
        return (t.car, t.lap), (f"{name}, el más rápido" if name else "el más rápido")
    best = tr.best.get(tr.player) if tr.player is not None else None
    if best is not None and (tr.player, best.lap) != exclude:
        return (tr.player, best.lap), "tu mejor vuelta"
    return None


def run_report(r: SessionReview) -> dict[str, Any] | None:
    """The box screen: the player's last run, where its best lap lost time and what to change."""
    overview = box.overview(r)
    runs = overview.get("tandas") or []
    tr = r.traces
    if not runs or tr is None or tr.player is None:
        return None
    run = runs[-1]
    best_lap = run.get("mejor_vuelta")
    laps = [lap for lap in overview["vueltas"] if lap["vuelta"] in run["vueltas"]]
    out: dict[str, Any] = {
        "tanda": run["tanda"],
        "vueltas": [{"vuelta": lap["vuelta"], "tiempo_s": lap["tiempo_s"], "valida": lap["valida"], "mejor": lap["vuelta"] == best_lap}
                    for lap in laps],
        "mejor_vuelta": best_lap,
        "mejor_vuelta_s": run.get("mejor_vuelta_s"),
        "compuesto": next((lap["compuesto"] for lap in reversed(laps) if lap["compuesto"]), None),
        "sugerencias_reglaje": run.get("sugerencias_reglaje") or [],
        "conduccion": run.get("conduccion") or [],
        "contra_tanda_anterior": run.get("contra_tanda_anterior"),
        "perdidas": [],
        "mas_rapido_s": None,
    }
    if best_lap is not None:
        target = (tr.player, best_lap)
        ref = _reference(r, target)
        if ref is not None:
            (car, lap), label = ref
            out["perdidas"] = losses(r, target, (car, lap), label)
            t = tr.trace(car, lap)
            if t is not None and t.time_ms:
                out["mas_rapido_s"] = round(t.time_ms / 1000, 3)
    return out


def summary(r: SessionReview, session_type: str | None) -> dict[str, Any]:
    """The session summary: result, lap-by-lap positions, where time went, what went well and what to try next."""
    laps = [pl for pl in r.laps if pl.time_ms]
    clean = [pl for pl in laps if not (pl.invalid or pl.pitted or pl.safety_car) and pl.lap > 1]
    best = min(clean or laps, key=lambda pl: pl.time_ms, default=None)
    me = next((row for row in (r.classification or []) if row.get("es_el_jugador")), None)
    race = (session_type or "").lower().startswith("race") or (session_type or "").lower().startswith("sprint")
    positions = [{"vuelta": pl.lap, "pos": pl.position} for pl in r.laps if pl.position]
    result = me["pos"] if me else (positions[-1]["pos"] if positions else None)
    grid = me.get("largo") if me else None

    # The lap that changed the result most, for one line of story.
    swing = None
    for prev, cur in zip(positions, positions[1:]):
        change = cur["pos"] - prev["pos"]
        if swing is None or abs(change) > abs(swing[1]):
            swing = (cur["vuelta"], change)

    tr = r.traces
    lost: list[dict[str, Any]] = []
    if best is not None and tr is not None and tr.player is not None:
        ref = _reference(r, (tr.player, best.lap))
        if ref is not None:
            lost = losses(r, (tr.player, best.lap), ref[0], ref[1])

    text = []
    if race and result and grid:
        verb = "terminaste" if me else "ibas"
        text.append(f"Largaste {grid}° y {verb} {result}°.")
    elif race and result:
        text.append(f"Ibas {result}° cuando terminó la grabación.")
    elif result:
        text.append(f"Terminaste {result}° la sesión.")
    if race and swing and abs(swing[1]) >= 2:
        text.append(f"En la vuelta {swing[0]} {'perdiste' if swing[1] > 0 else 'ganaste'} {abs(swing[1])} lugares.")
    if best is not None:
        text.append(f"Tu mejor vuelta fue la {best.lap}, en {_lap(best.time_ms)}.")
    if lost:
        text.append(f"Donde más tiempo dejaste fue la curva {lost[0]['curva']}, {_dec(lost[0]['perdida_s'], 2)} s.")

    good = []
    if len(clean) >= 3:
        spread = statistics.pstdev(pl.time_ms for pl in clean) / 1000
        if spread <= 0.6:
            good.append({"titulo": "Vueltas parejas", "texto": f"Tus vueltas limpias variaron apenas ±{_dec(spread, 1)} s."})
    if best is not None and best.sectors_ms and all(best.sectors_ms):
        others = [pl for pl in clean if pl.sectors_ms and all(pl.sectors_ms)]
        for i in range(3):
            fastest = min(others or [best], key=lambda pl: pl.sectors_ms[i])
            if fastest.lap != best.lap:
                good.append({"titulo": f"Tu mejor sector {i + 1}", "texto": f"{_dec(fastest.sectors_ms[i] / 1000, 3)} en la vuelta {fastest.lap}."})
                break
    if me and grid and result and result < grid:
        good.append({"titulo": "Remontada", "texto": f"Ganaste {grid - result} lugares desde la largada."})

    runs = session_advice(r, *_setups(r)) if tr is not None else []
    last = runs[-1] if runs else {}
    return {
        "resultado": result,
        "largada": grid,
        "carrera": race,
        "clasificacion_oficial": me is not None,
        "mejor_vuelta": best.lap if best else None,
        "mejor_vuelta_s": round(best.time_ms / 1000, 3) if best else None,
        "vueltas": len(laps),
        "posiciones": positions,
        "texto": " ".join(text) or "Todavía no hay vueltas completas para contar.",
        "perdidas": lost,
        "bien": good[:3],
        "proxima": {
            "reglaje": (last.get("sugerencias_reglaje") or [])[:2],
            "conduccion": (last.get("conduccion") or [])[:2],
        },
        "stints": r.stints,
    }


def card(r: SessionReview) -> dict[str, Any]:
    """What the shareable card shows beside the summary: the weather it was driven in, the team and the field."""
    weathers = [pl.weather for pl in r.laps if pl.weather]
    temps = [pl.track_temp for pl in r.laps if pl.track_temp is not None]
    me = next((row for row in (r.classification or []) if row.get("es_el_jugador")), None)
    return {
        "clima": statistics.mode(weathers) if weathers else None,
        "lluvia": any(w in ("Light rain", "Heavy rain", "Storm") for w in weathers),
        "temp_pista": round(statistics.median(temps)) if temps else None,
        "equipo": me.get("equipo") if me else None,
        "pilotos": len(r.classification) if r.classification else None,
    }


def _setups(r: SessionReview) -> tuple[list[dict], dict[int, str]]:
    ov = box.overview(r)
    return ov.get("reglajes") or [], {lap["vuelta"]: lap["reglaje"] for lap in ov.get("vueltas") or [] if lap.get("reglaje")}


def _dec(value: float, digits: int) -> str:
    return f"{value:.{digits}f}".replace(".", ",")


def _lap(ms: int) -> str:
    s = ms / 1000
    return f"{int(s // 60)}:{s % 60:06.3f}".replace(".", ",")
