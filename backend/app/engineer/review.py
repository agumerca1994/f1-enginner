"""A whole recorded session read back after the fact: every lap, the stints and the result.

The live engineer only sees the last few laps; a review replays the captures
through the same live state and history, so its figures match what the engineer
would have computed, and adds what only makes sense once the session is over.
Reading a full race takes a second or two, so results are cached per capture set.
"""

import os
import statistics
from collections import OrderedDict
from dataclasses import dataclass
from typing import Any

from app.engineer import analysis
from app.engineer.engine import RaceEngineer
from app.engineer.history import PlayerLap
from app.live.snapshot import RESULT_STATUS
from app.live.state import LiveSession
from app.replay.player import ReplayPlayer, ReplaySource
from app.telemetry import constants as c

_CACHE_SIZE = 8
_cache: OrderedDict[tuple, "SessionReview"] = OrderedDict()


@dataclass
class SessionReview:
    facts: dict[str, Any]  # what the engineer's analysis says at the end of the session
    laps: list[PlayerLap]
    stints: list[dict[str, Any]]
    classification: list[dict[str, Any]] | None
    duration_s: float

    def lap(self, number: int) -> PlayerLap | None:
        return next((pl for pl in self.laps if pl.lap == number), None)


def review(paths: list[str]) -> SessionReview | None:
    """Replay the captures of one session to the end. CPU-bound: run it in a thread."""
    key = tuple(sorted((p, _mtime(p)) for p in paths))
    if key in _cache:
        _cache.move_to_end(key)
        return _cache[key]

    source = ReplaySource(paths)
    if not source.files:
        return None
    state: dict[str, Any] = {"engineer": RaceEngineer(), "uid": None}

    def observe(packet, live: LiveSession) -> None:
        if state["uid"] != packet.session_uid:  # a capture can hold a menu or a previous session
            state["uid"], state["engineer"] = packet.session_uid, RaceEngineer()
        state["engineer"].observe(packet, live)

    player = ReplayPlayer(source, on_packet=observe)
    player.seek(float("inf"))
    if player.live is None:
        return None
    history = state["engineer"].history
    laps = analysis._dedupe(history.player_laps)
    result = SessionReview(
        facts=analysis.build(player.live, history),
        laps=laps,
        stints=stints(laps),
        classification=classification(player.live),
        duration_s=round(player.live.updated_at, 1),  # the replay clock at the last packet
    )
    _cache[key] = result
    while len(_cache) > _CACHE_SIZE:
        _cache.popitem(last=False)
    return result


def _mtime(path: str) -> float:
    try:
        return os.path.getmtime(path)
    except OSError:
        return 0.0


def lap_row(pl: PlayerLap) -> dict[str, Any]:
    """One lap of the player, in the same words the engineer uses."""
    return {
        "vuelta": pl.lap,
        "tiempo_s": analysis._s(pl.time_ms),
        "pos": pl.position,
        "compuesto": pl.compound,
        "edad_gomas": pl.tyre_age,
        "desgaste_pct": _wheels(pl.wear),
        "temp_superficie_c": _wheels(pl.surface_temp_avg),
        "temp_interna_c": _wheels(pl.inner_temp_avg),
        "combustible_kg": _round(pl.fuel_kg, 2),
        "margen_combustible_vueltas": _round(pl.fuel_margin_laps, 2),
        "ers_pct": _round(pl.ers_percent, 1),
        "ers_desplegado_mj": _round(pl.ers_deployed_mj, 2),
        "safety_car": pl.safety_car,
        "box": pl.pitted,
        "invalida": pl.invalid,
        "temp_pista": pl.track_temp,
        "clima": pl.weather,
    }


def stints(laps: list[PlayerLap]) -> list[dict[str, Any]]:
    """Runs on one set of tyres: a new compound or a younger set starts a new stint."""
    groups: list[list[PlayerLap]] = []
    for pl in laps:
        prev = groups[-1][-1] if groups else None
        new_set = prev is not None and (
            pl.compound != prev.compound
            or (pl.tyre_age is not None and prev.tyre_age is not None and pl.tyre_age < prev.tyre_age)
        )
        if prev is None or new_set:
            groups.append([pl])
        else:
            groups[-1].append(pl)

    out = []
    for group in groups:
        clean = analysis._clean(group)
        times = [pl.time_ms / 1000 for pl in clean]
        slope = None
        if len(clean) >= 3:
            slope = statistics.linear_regression([pl.lap for pl in clean], times).slope
        wear = [statistics.mean(pl.wear) for pl in group if pl.wear]
        out.append({
            "compuesto": group[0].compound,
            "vueltas": [group[0].lap, group[-1].lap],
            "cantidad_vueltas": len(group),
            "edad_gomas_al_inicio": group[0].tyre_age,
            "vueltas_limpias": len(clean),
            "ritmo_promedio_s": round(statistics.mean(times), 3) if times else None,
            "mejor_vuelta_s": round(min(times), 3) if times else None,
            "degradacion_s_por_vuelta": round(slope, 3) if slope is not None else None,
            "desgaste_medio_pct": [round(wear[0], 1), round(wear[-1], 1)] if wear else None,
            "desgaste_por_vuelta_pct": round((wear[-1] - wear[0]) / (len(wear) - 1), 2) if len(wear) >= 2 else None,
        })
    return out


def classification(live: LiveSession) -> list[dict[str, Any]] | None:
    """The game's final result, if the recording reached it."""
    packet = live.last.get("final_classification")
    if packet is None:
        return None
    participants = live.last.get("participants")
    rows = []
    for i in range(int(packet.body["num_cars"])):
        car = packet.body["classification_data"][i]
        if int(car["position"]) == 0:
            continue
        name = team = None
        if participants is not None:
            pp = participants.body["participants"][i]
            name = pp["name"].decode("utf-8", "replace") or None
            team = c.TEAMS.get(int(pp["team_id"]))
        n_stints = int(car["num_tyre_stints"])
        rows.append({
            "pos": int(car["position"]),
            "piloto": name,
            "equipo": team,
            "es_el_jugador": i == packet.player_car_index,
            "largo": int(car["grid_position"]),
            "vueltas": int(car["num_laps"]),
            "puntos": int(car["points"]),
            "estado": RESULT_STATUS.get(int(car["result_status"])),
            "mejor_vuelta_s": analysis._s(int(car["best_lap_time_in_ms"])),
            "tiempo_total_s": round(float(car["total_race_time"]), 3) or None,
            "penalizacion_s": int(car["penalties_time"]),
            "paradas": int(car["num_pit_stops"]),
            "stints": [
                {"compuesto": c.VISUAL_COMPOUNDS.get(int(car["tyre_stints_visual"][k])),
                 "hasta_vuelta": int(car["tyre_stints_end_laps"][k])}
                for k in range(min(n_stints, 8))
            ],
        })
    return sorted(rows, key=lambda r: r["pos"])


def _wheels(values) -> dict[str, float] | None:
    if not values:
        return None
    return {k: round(float(v), 1) for k, v in zip(analysis.WHEELS, values)}


def _round(value, digits: int):
    return None if value is None else round(value, digits)
