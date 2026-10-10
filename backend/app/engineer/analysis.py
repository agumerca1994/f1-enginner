"""Turns the live state and the lap history into the facts the engineer reasons about.

Code measures; the engineer interprets. Everything here is arithmetic on
telemetry (paces, trends, projections, where the car would rejoin after a
stop) so the model never has to crunch raw numbers, and every figure carries
enough context (sample size, estimated or measured) to judge how much to trust it.
"""

import statistics
from typing import Any

from app.engineer.history import PlayerLap, SessionHistory, pit_loss_samples
from app.live import snapshot
from app.live.state import LiveSession
from app.telemetry import constants as c

WHEELS = ("tras_izq", "tras_der", "del_izq", "del_der")
# The game's names, in the words an engineer uses on the radio.
ERS_MODE_ES = {"None": "recarga (sin desplegar)", "Medium": "normal", "Hotlap": "vuelta rápida", "Overtake": "adelantamiento"}
FUEL_MIX_ES = {"Lean": "pobre", "Standard": "estándar", "Rich": "rica", "Max": "máxima"}
# Time lost with a pit stop at racing speed, when this track's real value is
# unknown. Under a safety car the field is slow, so a stop costs about half.
DEFAULT_PIT_LOSS_S = 22.0
SAFETY_CAR_PIT_FACTOR = 0.5
VSC_PIT_FACTOR = 0.65


def build(live: LiveSession, history: SessionHistory, prior: dict[str, Any] | None = None) -> dict[str, Any]:
    snap = snapshot.build(live)
    session = snap.get("session") or {}
    lap = snap.get("lap") or {}
    player_idx = next((car["index"] for car in snap.get("cars", []) if car["is_player"]), None)
    laps = _dedupe(history.player_laps)
    total = session.get("total_laps") or 0
    current = lap.get("lap")

    facts: dict[str, Any] = {
        "sesion": {
            "pista": session.get("track"),
            "tipo": session.get("type"),
            "vuelta_actual": current,
            "vueltas_totales": total or None,
            "vueltas_restantes": (total - current + 1) if total and current else None,
            "safety_car": session.get("safety_car"),
            "clima": session.get("weather"),
            "temp_pista": session.get("track_temperature_c"),
            "temp_aire": session.get("air_temperature_c"),
            "pronostico": session.get("forecast"),
            "ventana_box_juego": [session.get("pit_window_ideal_lap"), session.get("pit_window_latest_lap")],
            "zonas_con_bandera": [z for z in session.get("marshal_zones") or [] if z.get("bandera") in ("yellow", "red")],
            "online": session.get("online"),
        },
        "piloto": _player(snap, history, laps),
        "ritmo": _pace(laps, history, player_idx),
        "sectores": _sectores(snap, history, laps),
        "neumaticos": _tyres(snap, laps),
        "combustible": _fuel(snap, laps, total, current),
        "rivales": _rivals(snap, history),
        "estrategia_calculos": _strategy(snap, history, laps, session),
        "reglaje_actual": _setup(live),
        "eventos_recientes": _events(history, snap.get("cars") or []),
        "calidad_datos": {
            "recepcion_telemetria": snap["link"].get("reception"),
            "vueltas_registradas": [pl.lap for pl in laps],
            "nota": "Con recepción baja algunos valores pueden tener segundos de antigüedad y faltar vueltas.",
        },
    }
    if prior:
        facts["conocimiento_previo"] = {
            **prior,
            "nota": "Ritmo y degradación aprendidos en sesiones anteriores en esta pista. Son una referencia "
                    "para planificar; validá con el ritmo real de esta carrera.",
        }
    return facts


def _dedupe(laps: list[PlayerLap]) -> list[PlayerLap]:
    """A flashback can replay laps; keep the last record of each lap number."""
    by_lap: dict[int, PlayerLap] = {}
    for record in laps:
        by_lap[record.lap] = record
    return [by_lap[k] for k in sorted(by_lap)]


def _player(snap: dict, history: SessionHistory, laps: list[PlayerLap]) -> dict[str, Any]:
    lap = snap.get("lap") or {}
    st = snap.get("status") or {}
    car = snap.get("car") or {}
    driver = snap.get("driver") or {}
    return {
        "piloto": driver.get("name"),
        "equipo": driver.get("team"),
        "posicion": lap.get("position"),
        "largo": lap.get("grid_position"),
        "gap_adelante_s": _s(lap.get("gap_ahead_ms")),
        "gap_lider_s": _s(lap.get("gap_leader_ms")),
        "paradas": lap.get("pit_stops"),
        "en_boxes": lap.get("pit") != "On track",
        "penalizacion_s": lap.get("penalties_s"),
        "advertencias": lap.get("warnings"),
        "vuelta_invalida": lap.get("lap_invalid"),
        "bandera_fia": st.get("fia_flag"),
        "fuera_de_pista_ult_vuelta_pct": laps[-1].off_track_pct if laps else None,
        "fuerzas_g_ult_vuelta": {"lateral_max": laps[-1].peak_lat_g, "frenada_max": laps[-1].peak_brake_g} if laps else None,
        "deslizamiento_ult_vuelta": {
            "patinaje_max": laps[-1].peak_slip_ratio,  # alto en frenada = bloqueo; en aceleración = patinada
            "angulo_delantero_max": laps[-1].peak_front_slip,  # más alto que el trasero = subviraje
            "angulo_trasero_max": laps[-1].peak_rear_slip,     # más alto que el delantero = sobreviraje
        } if laps else None,
        "compuestos_usados": history.compounds_used,
        "ers": {"bateria_pct": st.get("ers_percent"), "modo": ERS_MODE_ES.get(st.get("ers_mode"), st.get("ers_mode")),
                "desplegado_ultima_vuelta_mj": laps[-1].ers_deployed_mj if laps else None},
        "reparto_frenada_pct": st.get("brake_bias"),
        "mezcla_combustible": FUEL_MIX_ES.get(st.get("fuel_mix"), st.get("fuel_mix")),
        "drs_disponible": st.get("drs_allowed"),
        "temp_motor_c": car.get("engine_temperature_c"),
        "danos_pct": {k: v for k, v in (snap.get("damage") or {}).items()
                      if k not in ("age_s", "tyres_wear_percent")},
    }


def _clean(laps: list[PlayerLap]) -> list[PlayerLap]:
    """Laps representative of race pace: timed, valid, green flag, no pit, not lap 1."""
    return [pl for pl in laps if pl.time_ms and not pl.safety_car and not pl.pitted and not pl.invalid and pl.lap > 1]


def _pace(laps: list[PlayerLap], history: SessionHistory, player_idx: int | None) -> dict[str, Any]:
    clean = _clean(laps)
    last3 = clean[-3:]
    field_best = [
        min((cl.time_ms for cl in car_laps if cl.time_ms and cl.lap > 1 and not cl.safety_car), default=None)
        for idx, car_laps in history.car_laps.items() if idx != player_idx
    ]
    field_best = [b for b in field_best if b]
    return {
        "vueltas": [
            {"vuelta": pl.lap, "tiempo_s": _s(pl.time_ms), "pos": pl.position, "gomas": f"{pl.compound}/{pl.tyre_age}",
             "sc": pl.safety_car, "box": pl.pitted, "invalida": pl.invalid}
            for pl in laps[-8:]
        ],
        "promedio_ultimas_3_limpias_s": _s(statistics.mean(pl.time_ms for pl in last3)) if len(last3) == 3 else None,
        "mejor_vuelta_s": _s(min((pl.time_ms for pl in clean), default=None)),
        "consistencia_desvio_s": round(statistics.pstdev(pl.time_ms for pl in last3) / 1000, 3) if len(last3) >= 2 else None,
        "mejor_vuelta_del_resto_s": _s(min(field_best)) if field_best else None,
        "nota": "Vueltas limpias: sin safety car, sin box, válidas y desde la vuelta 2.",
    }


def _sectores(snap: dict, history: SessionHistory, laps: list[PlayerLap]) -> dict[str, Any] | None:
    """Live sector progress, personal bests and the theoretical lap, so the engineer
    can read the lap sector by sector instead of only when it ends."""
    lap = snap.get("lap") or {}
    best = history.best_sectors
    s1_now, s2_now = lap.get("sector1_ms"), lap.get("sector2_ms")
    ll = history.last_lap_sectors

    def delta(now_ms, best_ms):
        return None if now_ms is None or best_ms is None else round((now_ms - best_ms) / 1000, 3)

    if not best and not ll and s1_now is None:
        return None  # nothing crossed yet

    teorica = _s(sum(best[i] for i in (1, 2, 3))) if all(best.get(i) for i in (1, 2, 3)) else None
    ultima = None
    if ll:
        ultima = {
            "numero": laps[-1].lap if laps else None,
            "s1_s": _s(ll[0]), "s2_s": _s(ll[1]), "s3_s": _s(ll[2]),
            "total_s": _s(sum(x for x in ll if x)) if all(ll) else None,
        }
    return {
        "vuelta_en_curso": {
            "numero": lap.get("lap"),
            "sector_actual": lap.get("sector"),
            "s1_s": _s(s1_now), "s2_s": _s(s2_now), "s3_s": None,
            "vs_mi_mejor": {"s1_s": delta(s1_now, best.get(1)), "s2_s": delta(s2_now, best.get(2)), "s3_s": None},
        },
        "mis_mejores_s": {f"s{i}": _s(best.get(i)) for i in (1, 2, 3)},
        "vuelta_teorica_s": teorica,
        "mi_mejor_vuelta_s": _s(min((pl.time_ms for pl in _clean(laps)), default=None)),
        "ultima_vuelta": ultima,
        "nota": "Parciales del juego. S3 se calcula al cerrar la vuelta (total − S1 − S2). Con recepción baja puede faltar alguno.",
    }


def _tyres(snap: dict, laps: list[PlayerLap]) -> dict[str, Any]:
    st = snap.get("status") or {}
    car = snap.get("car") or {}
    damage = snap.get("damage") or {}
    wear = damage.get("tyres_wear_percent") or {}
    stint = [pl for pl in laps if pl.compound == st.get("tyre") and pl.wear]
    # Only the laps since the last tyre change belong to the current stint.
    for i in range(len(stint) - 1, 0, -1):
        if (stint[i].tyre_age or 0) < (stint[i - 1].tyre_age or 0):
            stint = stint[i:]
            break
    rate = None
    if len(stint) >= 2 and stint[-1].tyre_age != stint[0].tyre_age:
        span = (stint[-1].tyre_age or 0) - (stint[0].tyre_age or 0) or (stint[-1].lap - stint[0].lap)
        rate = [round((b - a) / span, 2) for a, b in zip(stint[0].wear, stint[-1].wear)]
    worst_now = max(wear.values()) if wear else None
    worst_rate = max(rate) if rate else None
    return {
        "compuesto": st.get("tyre"),
        "compuesto_real": st.get("tyre_compound"),
        "edad_vueltas": st.get("tyre_age_laps"),
        "desgaste_pct": {w: round(v, 1) for w, v in zip(WHEELS, wear.values())} if wear else None,
        "desgaste_por_vuelta_pct": dict(zip(WHEELS, rate)) if rate else None,
        "vueltas_hasta_60pct": _laps_until(worst_now, worst_rate, 60),
        "vueltas_hasta_70pct": _laps_until(worst_now, worst_rate, 70),
        "temp_superficie_promedio_ultima_vuelta_c": dict(zip(WHEELS, laps[-1].surface_temp_avg)) if laps and laps[-1].surface_temp_avg else None,
        "temp_interna_promedio_ultima_vuelta_c": dict(zip(WHEELS, laps[-1].inner_temp_avg)) if laps and laps[-1].inner_temp_avg else None,
        "temp_interna_promedio_por_vuelta_c": [
            {"vuelta": pl.lap, **dict(zip(WHEELS, pl.inner_temp_avg))} for pl in laps[-5:] if pl.inner_temp_avg
        ],
        "temp_superficie_instantanea_c": dict(zip(WHEELS, (car.get("tyres_surface_temperature_c") or {}).values())) or None,
        "presion_psi": dict(zip(WHEELS, (car.get("tyres_pressure_psi") or {}).values())) or None,
        "temp_frenos_c": dict(zip(WHEELS, (car.get("brakes_temperature_c") or {}).values())) or None,
        "muestras_del_stint": len(stint),
    }


def _laps_until(now: float | None, rate: float | None, target: float) -> float | None:
    if now is None or not rate or rate <= 0:
        return None
    return round(max(0.0, (target - now) / rate), 1)


def _fuel(snap: dict, laps: list[PlayerLap], total: int, current: int | None) -> dict[str, Any]:
    st = snap.get("status") or {}
    green = [pl for pl in laps if pl.fuel_kg is not None and not pl.safety_car]
    per_lap = None
    if len(green) >= 2:
        pairs = [(a, b) for a, b in zip(green, green[1:]) if b.lap == a.lap + 1]
        if pairs:
            per_lap = round(statistics.mean(a.fuel_kg - b.fuel_kg for a, b in pairs), 3)
    spare = st.get("fuel_remaining_laps")
    return {
        "kg": st.get("fuel_kg"),
        "alcanza_hasta_el_final": None if spare is None else spare >= 0,
        "vueltas_de_sobra": spare,
        "consumo_kg_por_vuelta_verde": per_lap,
        "nota": "vueltas_de_sobra es el dato del juego: positivo = sobra combustible para esa cantidad de vueltas "
                "además de terminar la carrera; negativo = faltan. Solo hay que ahorrar si es negativo o muy cercano a 0.",
    }


def _rivals(snap: dict, history: SessionHistory) -> dict[str, Any]:
    cars = snap.get("cars") or []
    me = next((car for car in cars if car["is_player"]), None)
    if me is None:
        return {}
    by_pos = {car["position"]: car for car in cars}

    def describe(car: dict) -> dict[str, Any]:
        laps = [cl for cl in history.car_laps.get(car["index"], []) if cl.time_ms and cl.lap > 1 and not cl.safety_car]
        recent = laps[-3:]
        return {
            "pos": car["position"],
            "piloto": car["name"],
            "equipo": car["team"],
            "gomas": f"{car['tyre']}/{car['tyre_age_laps']}" if car["tyre"] else "desconocido",
            "paradas": car["pit_stops"],
            "en_boxes": car["pit"] != "On track",
            "ultima_s": _s(car["last_lap_ms"]),
            "promedio_ult3_s": _s(statistics.mean(cl.time_ms for cl in recent)) if len(recent) == 3 else None,
            "gap_al_lider_s": _s(car["gap_leader_ms"]),
            "tendencia_gap_con_piloto": _gap_trend(history, me, car),
        }

    return {
        "adelante": [describe(by_pos[p]) for p in range(me["position"] - 2, me["position"]) if p in by_pos],
        "atras": [describe(by_pos[p]) for p in range(me["position"] + 1, me["position"] + 3) if p in by_pos],
        "lider": describe(by_pos[1]) if 1 in by_pos and me["position"] != 1 else None,
        "paradas_del_resto": {"sin_parar": sum(1 for car in cars if not car["is_player"] and car["pit_stops"] == 0),
                              "con_1_o_mas": sum(1 for car in cars if not car["is_player"] and car["pit_stops"] > 0)},
    }


def _gap_trend(history: SessionHistory, me: dict, other: dict) -> str | None:
    """How the gap to another car changed over the last laps, from gaps to the leader."""
    mine = {cl.lap: cl.gap_leader_ms for cl in history.car_laps.get(me["index"], [])}
    theirs = {cl.lap: cl.gap_leader_ms for cl in history.car_laps.get(other["index"], [])}
    common = sorted(set(mine) & set(theirs))[-4:]
    if len(common) < 2:
        return None
    first, last = common[0], common[-1]
    delta = ((theirs[last] - mine[last]) - (theirs[first] - mine[first])) / 1000
    per_lap = delta / (last - first)
    direction = "se agranda" if abs((theirs[last] - mine[last])) > abs((theirs[first] - mine[first])) else "se achica"
    return f"{direction} {abs(per_lap):.2f} s/vuelta (vueltas {first}-{last})"


def _strategy(snap: dict, history: SessionHistory, laps: list[PlayerLap], session: dict) -> dict[str, Any]:
    cars = snap.get("cars") or []
    me = next((car for car in cars if car["is_player"]), None)
    sc = session.get("safety_car")
    samples = pit_loss_samples(history.car_laps)
    green_loss = statistics.median(samples) if samples else DEFAULT_PIT_LOSS_S
    factor = SAFETY_CAR_PIT_FACTOR if sc == "Full safety car" else VSC_PIT_FACTOR if sc == "Virtual safety car" else 1.0
    pit_loss = round(green_loss * factor, 1)
    dry = [x for x in history.compounds_used if x in ("Soft", "Medium", "Hard")]
    out = {
        "perdida_box_s": pit_loss,
        "perdida_box_origen": (f"medida en esta sesión ({len(samples)} paradas en verde)" if samples
                               else "estimación genérica, sin paradas medidas todavía")
                              + (" y reducida por el safety car" if factor < 1 else ""),
        "si_para_ahora": _rejoin(cars, me, pit_loss, laps, session),
        "regla_dos_compuestos": {
            "compuestos_secos_usados": sorted(set(dry)),
            "cumplida": len(set(dry)) >= 2,
            "aplica": session.get("type", "").startswith("Race") and session.get("weather") in ("Clear", "Light cloud", "Overcast"),
        },
        "juegos_de_neumaticos": _tyre_sets(history),
    }
    if factor < 1:
        # Under a safety car most of the field stops too: then the player keeps
        # roughly their place instead of dropping behind everyone who stayed out.
        out["si_para_ahora_y_paran_todos"] = _rejoin(cars, me, pit_loss, laps, session, everyone_stops=True)
    return out


def _tyre_sets(history: SessionHistory) -> list[dict] | None:
    """The player's sets, identical ones grouped: compound, wear, count and the game's pace delta."""
    body = history.tyre_sets
    if body is None:
        return None
    groups: dict[tuple, dict] = {}
    for ts in body["tyre_set_data"]:
        compound = c.VISUAL_COMPOUNDS.get(int(ts["visual_tyre_compound"]))
        if compound is None or not (int(ts["available"]) or int(ts["fitted"])):
            continue
        key = (compound, int(ts["wear"]), bool(ts["fitted"]))
        group = groups.setdefault(key, {
            "compuesto": compound, "desgaste_pct": key[1], "puesto": key[2], "cantidad": 0,
            "vida_util_vueltas": int(ts["usable_life"]),
            "delta_ritmo_s": round(int(ts["lap_delta_time"]) / 1000, 2),
        })
        group["cantidad"] += 1
    return list(groups.values())


def _rejoin(cars: list[dict], me: dict | None, pit_loss: float, laps: list[PlayerLap], session: dict,
            everyone_stops: bool = False) -> dict | None:
    """Where the player would come out after a stop now.

    Uses each car's total distance (always current) rather than the game's gaps
    to the leader, which only refresh at timing lines and can be a sector old.
    Distance is turned into time with the player's recent lap time.
    """
    track_m = (snapshot_track_length(session) or 0)
    lap_times = [pl.time_ms for pl in _clean(laps)[-3:]] or [pl.time_ms for pl in laps if pl.time_ms][-1:]
    if me is None or not track_m or not lap_times:
        return None
    speed = track_m / (statistics.mean(lap_times) / 1000)  # metres per second at race pace
    lost_m = pit_loss * speed
    my_pos_m = me["total_distance_m"] - lost_m
    others = []
    for car in cars:
        if car["is_player"] or car["result"] != "active":
            continue
        pos_m = car["total_distance_m"]
        if everyone_stops and car["pit_stops"] == 0 and car["pit"] == "On track":
            pos_m -= lost_m  # assume the ones who have not stopped yet also stop now
        others.append((car, pos_m))
    ahead = [(car, m) for car, m in others if m > my_pos_m]
    behind = [(car, m) for car, m in others if m <= my_pos_m]
    nearest_ahead = min(ahead, key=lambda cm: cm[1], default=None)
    nearest_behind = max(behind, key=lambda cm: cm[1], default=None)
    return {
        "posicion_estimada_al_salir": len(ahead) + 1,
        "auto_delante_al_salir": nearest_ahead[0]["name"] if nearest_ahead else None,
        "distancia_al_de_adelante_s": round((nearest_ahead[1] - my_pos_m) / speed, 1) if nearest_ahead else None,
        "auto_detras_al_salir": nearest_behind[0]["name"] if nearest_behind else None,
        "distancia_al_de_atras_s": round((my_pos_m - nearest_behind[1]) / speed, 1) if nearest_behind else None,
    }


def snapshot_track_length(session: dict) -> float | None:
    return session.get("track_length_m")


def _events(history: SessionHistory, cars: list[dict]) -> list[dict]:
    """Recent events with driver names instead of the game's car slots."""
    names = {car["index"]: ("VOS" if car["is_player"] else car["name"]) for car in cars}
    out = []
    for e in history.events[-8:]:
        item = {"evento": e["code"], "vuelta": e.get("lap")}
        for key, value in e.items():
            if key.endswith("_idx"):
                item[key.removesuffix("_idx").replace("vehicle", "auto")] = names.get(value, f"auto {value}")
            elif key not in ("code", "lap", "session_time"):
                item[key] = round(value, 3) if isinstance(value, float) else value
        out.append(item)
    return out


def _setup(live: LiveSession) -> dict[str, Any] | None:
    packet = live.last.get("car_setups")
    if packet is None:
        return None
    s = packet.body["car_setups"][packet.player_car_index]
    return {
        "aleron_delantero": int(s["front_wing"]), "aleron_trasero": int(s["rear_wing"]),
        "diferencial_acelerando_pct": int(s["on_throttle"]), "diferencial_soltando_pct": int(s["off_throttle"]),
        "camber_del": round(float(s["front_camber"]), 2), "camber_tras": round(float(s["rear_camber"]), 2),
        "convergencia_del": round(float(s["front_toe"]), 2), "convergencia_tras": round(float(s["rear_toe"]), 2),
        "suspension_del": int(s["front_suspension"]), "suspension_tras": int(s["rear_suspension"]),
        "barra_antivuelco_del": int(s["front_anti_roll_bar"]), "barra_antivuelco_tras": int(s["rear_anti_roll_bar"]),
        "altura_del": int(s["front_suspension_height"]), "altura_tras": int(s["rear_suspension_height"]),
        "presion_frenos_pct": int(s["brake_pressure"]), "reparto_frenada_pct": int(s["brake_bias"]),
        "freno_motor_pct": int(s["engine_braking"]),
        "presiones_psi": {"tras_izq": round(float(s["rear_left_tyre_pressure"]), 1),
                          "tras_der": round(float(s["rear_right_tyre_pressure"]), 1),
                          "del_izq": round(float(s["front_left_tyre_pressure"]), 1),
                          "del_der": round(float(s["front_right_tyre_pressure"]), 1)},
        "lastre": int(s["ballast"]),
    }


def _s(ms) -> float | None:
    return None if not ms else round(ms / 1000, 3)
