"""A whole recorded session read back after the fact: every lap, the stints and the result.

The live engineer only sees the last few laps; a review replays the captures
through the same live state and history, so its figures match what the engineer
would have computed, and adds what only makes sense once the session is over.
Reading a full race takes a second or two, so results are cached per capture set.
"""

import asyncio
import os
import statistics
from collections import OrderedDict
from dataclasses import dataclass
from typing import Any

from app.engineer import analysis
from app.engineer.engine import RaceEngineer
from app.engineer.corners import CornerCoach
from app.engineer.history import PlayerLap
from app.engineer.traces import TraceCollector
from app.live.snapshot import RESULT_STATUS
from app.live.state import LiveSession
from app.replay.player import ReplayPlayer, ReplaySource
from app.telemetry import constants as c

_CACHE_SIZE = 8
_cache: OrderedDict[tuple, "SessionReview"] = OrderedDict()
# Reviews replay whole captures: one at a time, so a burst of calls cannot pin the CPU.
_lock = asyncio.Lock()


@dataclass
class SessionReview:
    facts: dict[str, Any]  # what the engineer's analysis says at the end of the session
    laps: list[PlayerLap]
    stints: list[dict[str, Any]]
    classification: list[dict[str, Any]] | None
    duration_s: float
    traces: TraceCollector | None = None  # speed/throttle/brake by lap distance, for the BOX tab
    corners: CornerCoach | None = None  # the corner map and every corner pass of the player

    def lap(self, number: int) -> PlayerLap | None:
        return next((pl for pl in self.laps if pl.lap == number), None)


def review(paths: list[str], corners: list[dict] | None = None) -> SessionReview | None:
    """Replay the captures of one session to the end. CPU-bound: run it in a thread.

    `corners` is the corner map stored for the track, so the numbering matches the map and other sessions.
    """
    key = (tuple(sorted((p, _mtime(p)) for p in paths)), repr(corners))
    if key in _cache:
        _cache.move_to_end(key)
        return _cache[key]

    source = ReplaySource(paths)
    if not source.files:
        return None
    state: dict[str, Any] = {"engineer": RaceEngineer(), "traces": TraceCollector(), "uid": None}

    def observe(packet, live: LiveSession) -> None:
        if state["uid"] != packet.session_uid:  # a capture can hold a menu or a previous session
            state["uid"], state["engineer"], state["traces"] = packet.session_uid, RaceEngineer(), TraceCollector()
            state["engineer"].history.corners.seed(corners)
        state["engineer"].observe(packet, live)
        state["traces"].observe(packet, live)

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
        traces=state["traces"],
        corners=history.corners,
    )
    _cache[key] = result
    while len(_cache) > _CACHE_SIZE:
        _cache.popitem(last=False)
    return result


def live_review(runner, live: LiveSession | None) -> SessionReview | None:
    """The session being driven now, from what the live runner already holds in memory: no capture to re-read."""
    traces = runner.traces
    if traces is None or traces.track_length is None:
        return None
    history = runner.engineer.history
    laps = analysis._dedupe(history.player_laps)
    return SessionReview(
        facts=analysis.build(live, history) if live is not None else {},
        laps=laps,
        stints=stints(laps),
        classification=classification(live) if live is not None else None,
        # The game clock: the live state's own clock is the server's, not the session's.
        duration_s=round(max((p.session_time for p in live.last.values()), default=0.0), 1) if live is not None else 0.0,
        traces=traces,
        corners=history.corners,
    )


async def review_for(tenant_id: int, session_id: int, paths: list[str], corners: list[dict] | None) -> SessionReview | None:
    """The live session from memory when it is the one asked for and memory holds it from the start; else the capture.

    After a server restart memory only has the laps since then, so the capture is read instead.
    """
    from app.engineer.runner import engineer_hub
    from app.live.state import live_store

    runner = engineer_hub.runner(tenant_id)
    if runner.game_session_id == session_id:
        r = live_review(runner, live_store.get(tenant_id))
        if r is not None and (not r.traces.player_laps or min(r.traces.player_laps) <= 2):
            return r
    return await review_async(paths, corners) if paths else None


async def review_async(paths: list[str], corners: list[dict] | None = None) -> SessionReview | None:
    async with _lock:
        return await asyncio.to_thread(review, paths, corners)


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
        "sectores_s": [analysis._s(x) for x in pl.sectors_ms] if pl.sectors_ms else None,
        "fuera_de_pista_pct": pl.off_track_pct,
        "g_lateral_max": pl.peak_lat_g,
        "g_frenada_max": pl.peak_brake_g,
        "patinaje_max": pl.peak_slip_ratio,
        "angulo_delantero_max": pl.peak_front_slip,
        "angulo_trasero_max": pl.peak_rear_slip,
        "adelantamiento_usado_pct": pl.overtake_pct,
        "ers_cosechado_mj": _round(pl.ers_harvested_mj, 2),
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
        return _classification_from_laps(live)
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


def _classification_from_laps(live: LiveSession) -> list[dict[str, Any]] | None:
    """The game sends its final classification once; on a lossy link it can be lost even
    though the chequered flag arrived. Then the last running order stands in for it,
    once the player has finished."""
    packet = live.last.get("lap_data")
    if packet is None or packet.player_car_index >= len(packet.body["lap_data"]):
        return None
    laps = packet.body["lap_data"]
    if int(laps[packet.player_car_index]["result_status"]) != 3:  # 3 = finished
        return None
    participants = live.last.get("participants")
    rows = []
    for i in live.active_cars():
        lap = laps[i]
        if int(lap["car_position"]) == 0 or int(lap["result_status"]) < 2:
            continue
        pp = participants.body["participants"][i] if participants is not None else None
        rows.append({
            "pos": int(lap["car_position"]),
            "piloto": (pp["name"].decode("utf-8", "replace") or None) if pp is not None else None,
            "equipo": c.TEAMS.get(int(pp["team_id"])) if pp is not None else None,
            "es_el_jugador": i == packet.player_car_index,
            "largo": int(lap["grid_position"]),
            "vueltas": int(lap["current_lap_num"]),
            "estado": RESULT_STATUS.get(int(lap["result_status"])),
            "mejor_vuelta_s": analysis._s(live.best_lap_ms.get(i)),
            "paradas": int(lap["num_pit_stops"]),
            "penalizacion_s": int(lap["penalties"]),
            "fuente": "último orden en pista (no llegó la clasificación oficial del juego)",
        })
    return sorted(rows, key=lambda r: r["pos"]) or None


def _wheels(values) -> dict[str, float] | None:
    if not values:
        return None
    return {k: round(float(v), 1) for k, v in zip(analysis.WHEELS, values)}


def _round(value, digits: int):
    return None if value is None else round(value, digits)
