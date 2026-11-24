"""The BOX tab: a session's laps, the setup each one ran and lap-against-lap traces.

Built on the session review (one replay of the captures, cached), shared by the
web API and the MCP connector so both read the same numbers.
"""

import warnings
from typing import Any

import numpy as np

from app.engineer import analysis, setup_advice
from app.engineer.corners import BIN_M as CORNER_BIN_M
from app.engineer.corners import Corner, CornerCoach
from app.engineer.review import SessionReview
from app.engineer.traces import BIN_M, LapTrace, compare, trace_json

# Setup fields that tell two setups apart; the planned fuel load is shown per lap instead.
_IGNORED_SETUP_KEYS = {"combustible_kg"}


def corner_map(r: SessionReview) -> list[Corner]:
    """The corners the engineer found; if the session was too short for that, mapped from the best trace."""
    coach = r.corners
    if coach is None:
        return []
    if coach.corners or coach.track_length is None or r.traces is None:
        return coach.corners
    best = max(r.traces.best.values(), key=lambda t: t.coverage, default=None)
    if best is None:
        return []
    step = int(CORNER_BIN_M // BIN_M)
    n = len(best.speed) // step * step
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)  # bins with no sample stay NaN
        v = np.nanmean(best.speed[:n].reshape(-1, step), axis=1)
    return CornerCoach._map(coach, v)


def _setup_key(values: dict[str, Any] | None) -> tuple | None:
    if values is None:
        return None
    return tuple(sorted((k, str(v)) for k, v in values.items() if k not in _IGNORED_SETUP_KEYS))


def setups(r: SessionReview) -> tuple[list[dict[str, Any]], dict[int, str]]:
    """Distinct setups in the order they were first run, labelled A, B, C… and the label of each lap."""
    out: list[dict[str, Any]] = []
    by_key: dict[tuple, str] = {}
    lap_setup: dict[int, str] = {}
    for lap, t in sorted(r.traces.player_laps.items()):
        key = _setup_key(t.setup)
        if key is None:
            continue
        if key not in by_key:
            label = chr(ord("A") + len(out)) if len(out) < 26 else str(len(out) + 1)
            by_key[key] = label
            out.append({"id": label, "valores": t.setup, "vueltas": []})
        label = by_key[key]
        lap_setup[lap] = label
        next(s for s in out if s["id"] == label)["vueltas"].append(lap)
    return out, lap_setup


def _ref(t: LapTrace, names: dict) -> dict[str, Any]:
    driver, team = names.get(t.car, (None, None))
    return {"car": t.car, "lap": t.lap, "piloto": driver, "equipo": team,
            "tiempo_s": t.time_ms / 1000 if t.time_ms else None, "cobertura": round(t.coverage, 3)}


def overview(r: SessionReview) -> dict[str, Any]:
    tr = r.traces
    if tr is None or tr.track_length is None:
        return {"vueltas": [], "reglajes": [], "referencias": [], "curvas": [], "tandas": [], "largo_pista_m": None}
    setup_list, lap_setup = setups(r)
    info = {pl.lap: pl for pl in r.laps}
    best = tr.best.get(tr.player)
    coach = r.corners
    laps = []
    for n, t in sorted(tr.player_laps.items()):
        pl = info.get(n)
        laps.append({
            "car": t.car,
            "vuelta": n,
            "tiempo_s": t.time_ms / 1000 if t.time_ms else None,
            "sectores_s": [analysis._s(x) for x in pl.sectors_ms] if pl and pl.sectors_ms else None,
            "valida": t.valid,
            "box": t.pitted,
            "mejor": best is not None and best.lap == n,
            "cobertura": round(t.coverage, 3),
            "reglaje": lap_setup.get(n),
            "compuesto": pl.compound if pl else None,
            "edad_gomas": pl.tyre_age if pl else None,
            "combustible_kg": round(pl.fuel_kg, 1) if pl and pl.fuel_kg is not None else None,
            "temp_pista": pl.track_temp if pl else None,
            "clima": pl.weather if pl else None,
            "problemas_por_curva": {
                str(k): p.issues() for k, p in (coach.passes.get(n, {}) if coach else {}).items() if p.issues()
            },
        })
    return {
        "largo_pista_m": tr.track_length,
        "sectores_m": [0, coach.sector2_m, coach.sector3_m] if coach and coach.sector2_m else None,
        "vueltas": laps,
        "reglajes": setup_list,
        "referencias": [_ref(t, tr.names) for t in tr.references()],
        "tandas": setup_advice.session_advice(r, setup_list, lap_setup),
        "curvas": [{"curva": k.number, "sector": k.sector, "entrada_m": round(k.entry_m),
                    "apex_m": round(k.apex_m), "salida_m": round(k.exit_m)} for k in corner_map(r)],
    }


# A lap with less of the track covered than this cannot be compared corner by corner.
MIN_COMPARE_COVERAGE = 0.5


def comparison(r: SessionReview, a: tuple[int, int], b: tuple[int, int], arrays: bool = True) -> dict[str, Any] | None:
    """Lap B against lap A, each given as (car slot, lap number). None if either has no trace."""
    tr = r.traces
    if tr is None:
        return None
    ta, tb = tr.trace(*a), tr.trace(*b)
    if ta is None or tb is None:
        return None
    rows = compare(ta, tb, corner_map(r))
    coach = r.corners
    for row in rows:
        for side, t in (("a", ta), ("b", tb)):
            p = coach.passes.get(t.lap, {}).get(row["curva"]) if coach and t.car == tr.player else None
            row[side]["problemas"] = p.issues() if p else None
    out: dict[str, Any] = {
        "a": _ref(ta, tr.names) | {"es_el_jugador": ta.car == tr.player},
        "b": _ref(tb, tr.names) | {"es_el_jugador": tb.car == tr.player},
        "diferencia_s": round((tb.time_ms - ta.time_ms) / 1000, 3) if ta.time_ms and tb.time_ms else None,
        "curvas": rows,
    }
    thin = [side for side, t in (("A", ta), ("B", tb)) if t.coverage < MIN_COMPARE_COVERAGE]
    if thin:
        # Too few samples to say where the time goes: keep the lap times, not the corner verdicts.
        out["datos_insuficientes"] = (f"La vuelta {' y '.join(thin)} tiene menos de la mitad de la pista con datos "
                                      "(llegó poca telemetría): la comparación curva por curva no es confiable.")
        for row in rows:
            row["diferencia_s"] = None
    if arrays:
        out["traza_a"], out["traza_b"] = trace_json(ta), trace_json(tb)
    return out
