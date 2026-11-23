"""Setup advice per run: what the car does, measured, and which setup change addresses it.

A run (tanda) is a stretch of laps on one setup between visits to the pits. For
each run the rules measure the car's behaviour on its clean laps: understeer and
oversteer by corner speed, lock-ups, wheelspin, tyre temperature and wear by axle,
and top speed against the fastest cars. Each finding with enough evidence maps
to one setup change, in the game's own units and within its ranges, with what it
costs. A problem concentrated in one corner is a driving note, not a setup one:
the setup changes the whole lap.

Every run of every recorded session is computed from the captures, so the
history is never lost: opening an old session shows the advice it got.
"""

import statistics
from dataclasses import dataclass, field
from typing import Any

import numpy as np

from app.engineer import analysis
from app.engineer.review import SessionReview

# Game ranges for the settings the advice can move (EA SPORTS F1 24 setup screen).
RANGES: dict[str, tuple[float, float, float]] = {  # key: (min, max, step)
    "aleron_delantero": (0, 50, 1),
    "aleron_trasero": (0, 50, 1),
    "diferencial_acelerando_pct": (10, 100, 5),
    "diferencial_soltando_pct": (10, 100, 5),
    "suspension_del": (1, 41, 1),
    "suspension_tras": (1, 41, 1),
    "barra_antivuelco_del": (1, 21, 1),
    "barra_antivuelco_tras": (1, 21, 1),
    "presion_frenos_pct": (80, 100, 1),
    "reparto_frenada_pct": (50, 70, 1),
    "freno_motor_pct": (0, 100, 10),
    "presion_del": (22.5, 29.5, 0.1),
    "presion_tras": (20.5, 26.5, 0.1),
}

SLOW_KMH = 120  # corner classes by minimum speed
FAST_KMH = 200
MIN_PASSES = 3  # passes of a corner class needed to judge it
ISSUE_SHARE = 0.35  # share of passes with the issue to call it a trait of the car
ONE_CORNER_SHARE = 0.7  # this share of the occurrences in one corner = a driving note
AXLE_TEMP_GAP_C = 8.0  # surface temperature gap between axles worth acting on
HOT_SURFACE_C = 105.0
TOP_SPEED_GAP_KMH = 6.0
MAX_SUGGESTIONS = 3


@dataclass
class Run:
    number: int
    laps: list[int]
    setup: str | None
    clean_laps: list[int] = field(default_factory=list)


# Settings the driver changes from the wheel during a lap: changing them does not start a new run.
WHEEL_SETTINGS = {"reparto_frenada_pct", "diferencial_acelerando_pct"}


def _garage_key(setup: dict[str, Any] | None) -> tuple | None:
    if setup is None:
        return None
    return tuple(sorted((k, str(v)) for k, v in setup.items() if k not in WHEEL_SETTINGS))


def runs(r: SessionReview, lap_setup: dict[int, str]) -> list[Run]:
    """Split the player's laps into runs: a new one after a pit visit (in-lap then out-lap) or a garage setup change."""
    traces = r.traces.player_laps if r.traces else {}
    out: list[Run] = []
    prev = None
    for n in sorted(traces):
        t = traces[n]
        setup = lap_setup.get(n)
        garage_changed = (prev is not None and prev.setup is not None and t.setup is not None
                          and _garage_key(prev.setup) != _garage_key(t.setup))
        new = (
            not out
            or garage_changed
            or (prev is not None and prev.pitted and t.pitted)  # in-lap, then out of the pits again
            or n != out[-1].laps[-1] + 1
        )
        if new:
            out.append(Run(len(out) + 1, [], setup))
        run = out[-1]
        run.laps.append(n)
        run.setup = run.setup or setup
        if t.valid and not t.pitted and t.time_ms and n > 1:
            run.clean_laps.append(n)
        prev = t
    return out


# --- measuring ------------------------------------------------------------------


def _speed_class(min_kmh: float | None) -> str | None:
    if min_kmh is None:
        return None
    return "lentas" if min_kmh < SLOW_KMH else "rapidas" if min_kmh >= FAST_KMH else "medias"


def behaviour(r: SessionReview, laps: list[int]) -> dict[str, Any]:
    """Issues per corner class and per corner over these laps, from the corner-by-corner passes."""
    coach = r.corners
    by_class: dict[str, dict[str, Any]] = {}
    by_corner: dict[str, dict[int, int]] = {}
    if coach is None:
        return {"por_tipo": {}, "por_curva": {}}
    for lap in laps:
        for number, p in coach.passes.get(lap, {}).items():
            cls = _speed_class(p.min_kmh)
            if cls is None:
                continue
            row = by_class.setdefault(cls, {"pasadas": 0, "curvas": set()})
            row["pasadas"] += 1
            row["curvas"].add(number)
            for issue in p.issues():
                row[issue] = row.get(issue, 0) + 1
                by_corner.setdefault(issue, {})
                by_corner[issue][number] = by_corner[issue].get(number, 0) + 1
    for row in by_class.values():
        row["curvas"] = sorted(row["curvas"])
    return {"por_tipo": by_class, "por_curva": by_corner}


def _axle(values: list[float] | None) -> tuple[float, float] | None:
    """(front, rear) mean from wheel values in the order RL, RR, FL, FR."""
    if not values:
        return None
    return (values[2] + values[3]) / 2, (values[0] + values[1]) / 2


def tyres(r: SessionReview, laps: list[int]) -> dict[str, Any] | None:
    rows = [pl for pl in r.laps if pl.lap in laps]
    temps = [a for pl in rows if (a := _axle(pl.surface_temp_avg))]
    if not temps:
        return None
    front = statistics.mean(t[0] for t in temps)
    rear = statistics.mean(t[1] for t in temps)
    wear_rows = [pl for pl in rows if pl.wear]
    wear = None
    if len(wear_rows) >= 2:
        first, last = _axle(wear_rows[0].wear), _axle(wear_rows[-1].wear)
        n = wear_rows[-1].lap - wear_rows[0].lap
        if n > 0:
            wear = (round((last[0] - first[0]) / n, 2), round((last[1] - first[1]) / n, 2))
    return {
        "temp_superficie_del_c": round(front, 1), "temp_superficie_tras_c": round(rear, 1),
        "desgaste_por_vuelta_del_pct": wear[0] if wear else None,
        "desgaste_por_vuelta_tras_pct": wear[1] if wear else None,
    }


def top_speed(r: SessionReview, laps: list[int]) -> dict[str, Any] | None:
    tr = r.traces
    # The median over the laps, so one lap with a tow does not count as the car's top speed.
    mine = [float(np.nanmax(t.speed)) for n in laps if (t := tr.player_laps.get(n)) is not None
            and np.isfinite(t.speed).any()]
    refs = [float(np.nanmax(t.speed)) for t in tr.references(limit=5) if np.isfinite(t.speed).any()]
    if not mine or len(refs) < 2:
        return None
    return {"tuya_kmh": round(statistics.median(mine)), "rivales_kmh": round(statistics.median(refs))}


# --- advice ---------------------------------------------------------------------


def _change(setup: dict[str, Any], key: str, delta: float) -> tuple[Any, Any] | None:
    """(current, suggested) for a setting, clamped to the game's range; None if it cannot move that way."""
    if key in ("presion_del", "presion_tras"):
        p = setup.get("presiones_psi") or {}
        wheels = ("del_izq", "del_der") if key == "presion_del" else ("tras_izq", "tras_der")
        if not all(w in p for w in wheels):
            return None
        current = round((p[wheels[0]] + p[wheels[1]]) / 2, 1)
    else:
        current = setup.get(key)
    if current is None or key not in RANGES:
        return None
    lo, hi, step = RANGES[key]
    suggested = min(hi, max(lo, current + delta))
    suggested = round(round(suggested / step) * step, 1) if step < 1 else int(round(suggested / step) * step)
    if suggested == current:
        return None
    return current, suggested


def _driving_corner(by_corner: dict[int, int]) -> int | None:
    total = sum(by_corner.values())
    if total < 2:
        return None
    corner, n = max(by_corner.items(), key=lambda kv: kv[1])
    return corner if n / total >= ONE_CORNER_SHARE else None


# (issue, class) -> setup changes in order of preference, with what they fix and what they cost.
_RULES: list[tuple[str, tuple[str, ...], list[tuple[str, float, str, str]]]] = [
    ("subviraje", ("lentas", "medias"), [
        ("barra_antivuelco_del", -2, "Ablandar la barra delantera deja que el tren delantero agarre más en las curvas lentas.",
         "El auto se inclina más y responde un poco más lento en los cambios de dirección."),
        ("diferencial_acelerando_pct", -10, "Un diferencial más abierto al acelerar ayuda a que el auto gire en la salida.",
         "Puede patinar un poco más la rueda interna al salir."),
    ]),
    ("subviraje", ("rapidas",), [
        ("aleron_delantero", 2, "Más alerón delantero da más carga adelante en las curvas rápidas.",
         "Un poco menos de velocidad punta y la cola puede quedar más suelta."),
    ]),
    ("sobreviraje", ("rapidas",), [
        ("aleron_trasero", 2, "Más alerón trasero asienta la cola en las curvas rápidas.",
         "Perdés algo de velocidad en las rectas."),
    ]),
    ("sobreviraje", ("lentas", "medias"), [
        ("barra_antivuelco_tras", -2, "Ablandar la barra trasera da más agarre atrás en las curvas lentas.",
         "El auto se vuelve un poco más perezoso para entrar."),
    ]),
    ("patinaje_traccion", ("lentas", "medias", "rapidas"), [
        ("diferencial_acelerando_pct", -10, "Con el diferencial más abierto las ruedas traseras patinan menos al acelerar.",
         "En las salidas muy lentas puede costar un poco más de tracción en línea recta."),
        ("suspension_tras", -3, "Una suspensión trasera más blanda copia mejor el piso y mejora la tracción.",
         "El auto se mueve más en los cambios de apoyo."),
    ]),
    ("bloqueo_delantero", ("lentas", "medias", "rapidas"), [
        ("reparto_frenada_pct", -2, "Mover el reparto hacia atrás le saca trabajo a las ruedas delanteras al frenar.",
         "Si te pasás, la cola se vuelve inestable en la frenada."),
        ("presion_frenos_pct", -3, "Menos presión de frenos hace más fácil dosificar sin bloquear.",
         "Tenés que pisar más fuerte para frenar igual de corto."),
    ]),
    ("bloqueo_trasero", ("lentas", "medias", "rapidas"), [
        ("reparto_frenada_pct", 2, "Mover el reparto hacia adelante estabiliza la cola al frenar.",
         "Las delanteras quedan más cerca del bloqueo."),
        ("freno_motor_pct", -10, "Menos freno motor evita que se bloqueen las traseras al soltar el acelerador.",
         "El auto frena un poco menos solo al levantar."),
    ]),
]

_ISSUE_ES = {
    "subviraje": "no gira (subviraje)", "sobreviraje": "se le va la cola", "patinaje_traccion": "patina al acelerar",
    "bloqueo_delantero": "bloquea adelante", "bloqueo_trasero": "bloquea atrás", "fuera_de_pista": "se va de pista",
}
_CLASS_ES = {"lentas": "curvas lentas", "medias": "curvas medias", "rapidas": "curvas rápidas"}


def advise(setup: dict[str, Any] | None, beh: dict[str, Any], tyre: dict[str, Any] | None,
           speed: dict[str, Any] | None) -> tuple[list[dict], list[dict]]:
    """(setup suggestions, driving notes) for one run."""
    findings: list[tuple[float, str, list, str]] = []  # (strength, issue text, rule changes, evidence)
    driving: list[dict] = []
    seen_driving: set[tuple[str, int]] = set()
    for issue, classes, changes in _RULES:
        rows = [(cls, beh["por_tipo"][cls]) for cls in classes if cls in beh["por_tipo"]]
        passes = sum(row["pasadas"] for _, row in rows)
        hits = sum(row.get(issue, 0) for _, row in rows)
        if passes < MIN_PASSES or hits == 0:
            continue
        corner = _driving_corner(beh["por_curva"].get(issue, {}))
        share = hits / passes
        if corner is not None:
            if (issue, corner) not in seen_driving:
                seen_driving.add((issue, corner))
                driving.append({"curva": corner, "problema": issue,
                                "texto": f"En la curva {corner} {_ISSUE_ES[issue]}: es en esa curva sola, así que es "
                                         f"de manejo más que de reglaje. {_DRIVING_TIP[issue]}"})
            continue
        if share >= ISSUE_SHARE:
            where = " y ".join(_CLASS_ES[c] for c, row in rows if row.get(issue))
            findings.append((share, f"{_ISSUE_ES[issue].capitalize()} en {where}", changes,
                             f"{hits} de {passes} pasadas"))

    if tyre:
        gap = tyre["temp_superficie_tras_c"] - tyre["temp_superficie_del_c"]
        if gap >= AXLE_TEMP_GAP_C and tyre["temp_superficie_tras_c"] >= HOT_SURFACE_C:
            findings.append((0.4, "Las traseras se recalientan", [
                ("presion_tras", -0.4, "Bajar la presión de las traseras ayuda a que no se recalienten.",
                 "Con menos presión el auto responde un poco más blando."),
                ("diferencial_acelerando_pct", -10, "Menos patinaje al acelerar también calienta menos las traseras.",
                 "Un poco menos de tracción pura en las salidas lentas."),
            ], f"{tyre['temp_superficie_tras_c']}° atrás contra {tyre['temp_superficie_del_c']}° adelante"))
        elif -gap >= AXLE_TEMP_GAP_C and tyre["temp_superficie_del_c"] >= HOT_SURFACE_C:
            findings.append((0.4, "Las delanteras se recalientan", [
                ("presion_del", -0.4, "Bajar la presión de las delanteras ayuda a que no se recalienten.",
                 "La dirección se siente un poco más pesada y lenta."),
            ], f"{tyre['temp_superficie_del_c']}° adelante contra {tyre['temp_superficie_tras_c']}° atrás"))

    if speed:
        gap = speed["rivales_kmh"] - speed["tuya_kmh"]
        if gap >= TOP_SPEED_GAP_KMH:
            findings.append((0.3, "Te falta velocidad en las rectas", [
                ("aleron_trasero", -2, "Menos alerón trasero baja la resistencia en las rectas.",
                 "Menos carga atrás: la cola se mueve más en las curvas rápidas. Si la sacás, bajá también "
                 "el delantero para no desbalancear el auto."),
            ], f"{speed['tuya_kmh']} km/h contra {speed['rivales_kmh']} de los más rápidos"))

        elif -gap >= 2 * TOP_SPEED_GAP_KMH:
            # Spare straight-line speed buys downforce: on the end that lacks grip.
            totals = _issue_totals(beh)
            front = totals.get("subviraje", 0) >= totals.get("sobreviraje", 0) + totals.get("patinaje_traccion", 0)
            key = "aleron_delantero" if front else "aleron_trasero"
            findings.append((0.3, "Te sobra velocidad en las rectas", [
                (key, 2, f"Tenés velocidad de sobra: más alerón {'delantero' if front else 'trasero'} te da agarre "
                         f"{'adelante' if front else 'atrás'} en las curvas, que es donde te falta.",
                 "Perdés un poco de esa ventaja en las rectas."),
            ], f"{speed['tuya_kmh']} km/h contra {speed['rivales_kmh']} de los más rápidos"))

    findings.sort(key=lambda f: -f[0])
    suggestions: list[dict] = []
    used: set[str] = set()
    for strength, problem, changes, evidence in findings:
        if len(suggestions) >= MAX_SUGGESTIONS:
            break
        for key, delta, effect, cost in changes:
            if key in used or setup is None:
                continue
            moved = _change(setup, key, delta)
            if moved is None:
                continue
            used.add(key)
            suggestions.append({
                "problema": problem, "evidencia": evidence, "parametro": key,
                "valor_actual": moved[0], "valor_sugerido": moved[1],
                "efecto": effect, "compromiso": cost, "confianza": "alta" if strength >= 0.5 else "media",
            })
            break
    return suggestions, driving


_DRIVING_TIP = {
    "subviraje": "Probá entrar un poco más lento y girar una sola vez, sin acelerar hasta ver la salida.",
    "sobreviraje": "Probá ser más suave con el volante y con el acelerador a la salida.",
    "patinaje_traccion": "Acelerá de forma progresiva y esperá a enderezar el volante antes de ir a fondo.",
    "bloqueo_delantero": "Frená un poco antes y soltá el freno de a poco mientras girás.",
    "bloqueo_trasero": "Bajá los cambios más despacio y frená un poco antes.",
    "fuera_de_pista": "Dejá un poco más de margen en la salida.",
}


def _changed_settings(a: dict[str, Any] | None, b: dict[str, Any] | None) -> list[dict]:
    if not a or not b:
        return []
    out = []
    for k, v in b.items():
        if k == "presiones_psi":
            for w, x in (v or {}).items():
                y = (a.get("presiones_psi") or {}).get(w)
                if y is not None and x != y:
                    out.append({"parametro": f"presion_{w}", "antes": y, "despues": x})
        elif a.get(k) != v:
            out.append({"parametro": k, "antes": a.get(k), "despues": v})
    return out


def _issue_totals(beh: dict[str, Any]) -> dict[str, float]:
    """Share of passes with each issue over the whole run."""
    rows = beh["por_tipo"].values()
    passes = sum(r["pasadas"] for r in rows)
    if not passes:
        return {}
    totals: dict[str, int] = {}
    for r in rows:
        for k, v in r.items():
            if k in _ISSUE_ES:
                totals[k] = totals.get(k, 0) + v
    return {k: round(v / passes, 2) for k, v in totals.items()}


def session_advice(r: SessionReview, setups: list[dict], lap_setup: dict[int, str]) -> list[dict]:
    """Every run of the session with its measurements, the setup advice and how it compares with the run before."""
    values = {s["id"]: s["valores"] for s in setups}
    times = {n: t.time_ms for n, t in (r.traces.player_laps.items() if r.traces else [])}
    out: list[dict] = []
    for run in runs(r, lap_setup):
        laps = run.clean_laps or [n for n in run.laps if not r.traces.player_laps[n].pitted]
        beh = behaviour(r, laps)
        tyre = tyres(r, laps)
        speed = top_speed(r, laps)
        setup = values.get(run.setup)
        suggestions, driving = advise(setup, beh, tyre, speed) if run.clean_laps else ([], [])
        best_lap = min((n for n in run.clean_laps if times.get(n)), key=lambda n: times[n], default=None)
        best = times[best_lap] if best_lap is not None else None
        row = {
            "tanda": run.number,
            "vueltas": run.laps,
            "vueltas_limpias": run.clean_laps,
            "reglaje": run.setup,
            "mejor_vuelta": best_lap,
            "mejor_vuelta_s": analysis._s(best),
            "comportamiento": {
                cls: {k: v for k, v in row.items()} for cls, row in beh["por_tipo"].items()
            },
            "problemas_pct": _issue_totals(beh),
            "gomas": tyre,
            "velocidad_punta": speed,
            "sugerencias_reglaje": suggestions,
            "conduccion": driving,
        }
        if not run.clean_laps:
            row["nota"] = "Sin vueltas limpias en esta tanda (vuelta de salida o de entrada): no alcanza para opinar."
        if out:
            prev = out[-1]
            changed = _changed_settings(values.get(prev["reglaje"]), setup) if prev["reglaje"] != run.setup else []
            delta = (round(row["mejor_vuelta_s"] - prev["mejor_vuelta_s"], 3)
                     if row["mejor_vuelta_s"] and prev["mejor_vuelta_s"] else None)
            row["contra_tanda_anterior"] = {
                "cambios_de_reglaje": changed,
                "mejor_vuelta_diferencia_s": delta,
                "problemas_antes_pct": prev["problemas_pct"],
            }
        out.append(row)
    return out
