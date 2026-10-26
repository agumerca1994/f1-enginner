"""A compact, JSON-ready view of the player's race, built from the live state.

This is what the dashboard shows and what the engineer agent reads. Every
section carries `age_s`, the seconds since its source packet arrived.
"""

from typing import Any

from app.live.state import LiveSession
from app.live.timing import forecast
from app.telemetry import constants as c

WHEELS = ("rear_left", "rear_right", "front_left", "front_right")


def _wheels(values) -> dict[str, float]:
    return {w: round(float(v), 1) for w, v in zip(WHEELS, values)}


def _ms(minutes: int, ms: int) -> int:
    return int(minutes) * 60_000 + int(ms)


def _age(live: LiveSession, name: str) -> float | None:
    age = live.age(name)
    return None if age is None else round(age, 2)


def build(live: LiveSession) -> dict[str, Any]:
    player = None
    for name in ("car_telemetry", "lap_data", "car_status"):
        if name in live.last:
            player = live.last[name].player_car_index
            break
    if player is not None and not 0 <= player < live.slots():
        player = None  # 255 while spectating or in menus: there is no player car to show

    out: dict[str, Any] = {
        "session_uid": f"{live.session_uid:016x}",
        "packet_format": live.packet_format,
        "link": {
            "reception": live.reception,
            "source": live.source,
            "packets": live.packets,
            "rejected": live.rejected,
        },
    }

    if (p := live.last.get("session")) is not None:
        s = p.body
        out["session"] = {
            "age_s": _age(live, "session"),
            "track": c.TRACKS.get(int(s["track_id"]), f"Track {int(s['track_id'])}"),
            "type": c.SESSION_TYPES.get(int(s["session_type"]), "Unknown"),
            "weather": c.WEATHER.get(int(s["weather"]), "Unknown"),
            "track_temperature_c": int(s["track_temperature"]),
            "air_temperature_c": int(s["air_temperature"]),
            "total_laps": int(s["total_laps"]),
            "track_length_m": int(s["track_length"]),
            "time_left_s": int(s["session_time_left"]),
            "safety_car": c.SAFETY_CAR_STATUS.get(int(s["safety_car_status"]), "Unknown"),
            "online": bool(s["network_game"]),
            "paused": bool(s["game_paused"]),
            "pit_window_ideal_lap": int(s["pit_stop_window_ideal_lap"]) or None,
            "pit_window_latest_lap": int(s["pit_stop_window_latest_lap"]) or None,
            "marshal_zones": [
                {"inicio_pct": round(float(z["zone_start"]) * 100, 1), "bandera": c.FIA_FLAGS.get(int(z["zone_flag"]))}
                for z in s["marshal_zones"][: int(s["num_marshal_zones"])]
            ],
            "forecast": [
                {
                    "in_minutes": int(f["time_offset"]),
                    "weather": c.WEATHER.get(int(f["weather"]), "Unknown"),
                    "rain_percent": int(f["rain_percentage"]),
                }
                for f in s["weather_forecast_samples"][: int(s["num_weather_forecast_samples"])]
                if int(f["session_type"]) == int(s["session_type"])
            ],
        }
        if "active_aero_zones_full" in s.dtype.names:  # the 2026 format
            out["session"].update(_aero_zones(s))

    if player is None:
        return _common(out, live, player)

    if (p := live.last.get("participants")) is not None:
        me = p.body["participants"][player]
        out["driver"] = {
            "name": me["name"].decode("utf-8", "replace"),
            "team": c.TEAMS.get(int(me["team_id"]), f"Team {int(me['team_id'])}"),
            "race_number": int(me["race_number"]),
            "cars_in_session": int(p.body["num_active_cars"]),
            "livery_color": _livery(me),
        }

    if (p := live.last.get("lap_data")) is not None:
        lap = p.body["lap_data"][player]
        out["lap"] = {
            "age_s": _age(live, "lap_data"),
            "position": int(lap["car_position"]),
            "lap": int(lap["current_lap_num"]),
            "current_lap_ms": int(lap["current_lap_time_in_ms"]),
            "last_lap_ms": int(lap["last_lap_time_in_ms"]) or None,
            "sector": int(lap["sector"]) + 1,
            "sector1_ms": _ms(lap["sector1_time_minutes_part"], lap["sector1_time_ms_part"]) or None,
            "sector2_ms": _ms(lap["sector2_time_minutes_part"], lap["sector2_time_ms_part"]) or None,
            "gap_ahead_ms": _ms(lap["delta_to_car_in_front_minutes_part"], lap["delta_to_car_in_front_ms_part"]),
            "gap_leader_ms": _ms(lap["delta_to_race_leader_minutes_part"], lap["delta_to_race_leader_ms_part"]),
            "lap_distance_m": round(float(lap["lap_distance"]), 1),
            "lap_invalid": bool(lap["current_lap_invalid"]),
            "pit": c.PIT_STATUS.get(int(lap["pit_status"]), "Unknown"),
            "pit_stops": int(lap["num_pit_stops"]),
            "penalties_s": int(lap["penalties"]),
            "warnings": int(lap["total_warnings"]),
            "grid_position": int(lap["grid_position"]),
            # Against the best complete clean lap seen this session, at the same lap distance.
            "delta_best_ms": live.timing.delta.delta_ms(lap),
            "delta_reference_lap": live.timing.delta.reference_lap,
        }
        out.update(_timing(live, p.body["lap_data"], player))

    if (p := live.last.get("car_telemetry")) is not None:
        t = p.body["car_telemetry_data"][player]
        out["car"] = {
            "age_s": _age(live, "car_telemetry"),
            "speed_kmh": int(t["speed"]),
            "gear": int(t["gear"]),
            "rpm": int(t["engine_rpm"]),
            "throttle": round(float(t["throttle"]), 3),
            "brake": round(float(t["brake"]), 3),
            "steer": round(float(t["steer"]), 3),
            "drs_open": bool(t["drs"]),
            "suggested_gear": int(p.body["suggested_gear"]) or None,  # 0 = no suggestion
            "rev_lights_percent": int(t["rev_lights_percent"]),
            "engine_temperature_c": int(t["engine_temperature"]),
            "brakes_temperature_c": _wheels(t["brakes_temperature"]),
            "tyres_surface_temperature_c": _wheels(t["tyres_surface_temperature"]),
            "tyres_inner_temperature_c": _wheels(t["tyres_inner_temperature"]),
            "tyres_pressure_psi": _wheels(t["tyres_pressure"]),
            "surface": {w: c.SURFACE_TYPES.get(int(v)) for w, v in zip(WHEELS, t["surface_type"])},
        }

    if (p := live.last.get("car_status")) is not None:
        s = p.body["car_status_data"][player]
        out["status"] = {
            "age_s": _age(live, "car_status"),
            "fuel_kg": round(float(s["fuel_in_tank"]), 2),
            "fuel_capacity_kg": round(float(s["fuel_capacity"]), 1),
            "fuel_remaining_laps": round(float(s["fuel_remaining_laps"]), 2),
            "fuel_mix": c.FUEL_MIX.get(int(s["fuel_mix"]), "Unknown"),
            "tyre": c.VISUAL_COMPOUNDS.get(int(s["visual_tyre_compound"]), "Unknown"),
            "tyre_compound": c.ACTUAL_COMPOUNDS.get(int(s["actual_tyre_compound"]), "Unknown"),
            "tyre_age_laps": int(s["tyres_age_laps"]),
            "ers_percent": round(100 * float(s["ers_store_energy"]) / c.ERS_MAX_ENERGY, 1),
            "ers_mode": c.ERS_DEPLOY_MODES.get(int(s["ers_deploy_mode"]), "Unknown"),
            "drs_allowed": bool(s["drs_allowed"]),
            "brake_bias": int(s["front_brake_bias"]),
            "max_rpm": int(s["max_rpm"]),
            "fia_flag": c.FIA_FLAGS.get(int(s["vehicle_fia_flags"])),
            "ers_deployed_lap_mj": round(float(s["ers_deployed_this_lap"]) / 1e6, 2),
            "ers_harvested_lap_mj": round(
                (float(s["ers_harvested_this_lap_mguk"]) + float(s["ers_harvested_this_lap_mguh"])) / 1e6, 2),
            # 2026 format only: how much energy the regulations let the car recover per lap.
            "ers_harvest_limit_mj": round(float(s["ers_harvest_limit_per_lap"]) / 1e6, 2)
            if "ers_harvest_limit_per_lap" in s.dtype.names else None,
        }

    if (p := live.last.get("car_damage")) is not None:
        d = p.body["car_damage_data"][player]
        out["damage"] = {
            "age_s": _age(live, "car_damage"),
            "tyres_wear_percent": _wheels(d["tyres_wear"]),
            "front_left_wing": int(d["front_left_wing_damage"]),
            "front_right_wing": int(d["front_right_wing_damage"]),
            "rear_wing": int(d["rear_wing_damage"]),
            "floor": int(d["floor_damage"]),
            "diffuser": int(d["diffuser_damage"]),
            "sidepod": int(d["sidepod_damage"]),
            "gearbox": int(d["gear_box_damage"]),
            "engine": int(d["engine_damage"]),
            "drs_fault": bool(d["drs_fault"]),
            "ers_fault": bool(d["ers_fault"]),
            # 2025 format onwards; None before.
            "tyre_blisters_percent": _wheels(d["tyre_blisters"]) if "tyre_blisters" in d.dtype.names else None,
        }

    if (p := live.last.get("motion")) is not None and player is not None:
        m = p.body["car_motion_data"][player]
        out["motion"] = {
            "age_s": _age(live, "motion"),
            "g_lateral": round(float(m["g_force_lateral"]), 2),
            "g_longitudinal": round(float(m["g_force_longitudinal"]), 2),
            "g_vertical": round(float(m["g_force_vertical"]), 2),
            "yaw": round(float(m["yaw"]), 3),
            "pitch": round(float(m["pitch"]), 3),
            "roll": round(float(m["roll"]), 3),
        }

    if (p := live.last.get("car_telemetry_2")) is not None:  # 2026 regulations
        a = p.body["car_telemetry_2_data"][player]
        out["aero"] = {
            "age_s": _age(live, "car_telemetry_2"),
            "regulations_2026": bool(a["regulations_2026"]),
            "active_aero_mode": "straight" if int(a["active_aero_mode"]) else "corner",
            "active_aero_available": bool(a["active_aero_available"]),
            "active_aero_in_m": int(a["active_aero_activation_distance"]) or None,
            "overtake_available": bool(a["overtake_available"]),
            "overtake_active": bool(a["overtake_active"]),
            "overtake_in_m": int(a["overtake_activation_distance"]) or None,
            "wrong_way": bool(a["driving_wrong_way"]),
        }

    return _common(out, live, player)


def _common(out: dict[str, Any], live: LiveSession, player: int | None) -> dict[str, Any]:
    """Sections that exist with or without a player car: the dashboard always expects them."""
    out["track"] = _track(live)
    out["cars"] = _cars(live, player)
    out["events"] = list(live.events)[-10:]
    return out


def _aero_zones(s) -> dict[str, Any]:
    """Active-aero and DRS zones of the 2026 format, as percentages of the lap."""
    def zones(items, count, kind=None):
        out = []
        for z in items[:count]:
            zone = {"inicio_pct": round(float(z["zone_start"]) * 100, 1), "fin_pct": round(float(z["zone_end"]) * 100, 1)}
            out.append({**zone, "tipo": kind} if kind else zone)
        return out

    reaction = float(s["start_reaction_time"])
    return {
        "active_aero_zones": zones(s["active_aero_zones_full"], int(s["num_active_aero_zones_full"]), "total")
        + zones(s["active_aero_zones_partial"], int(s["num_active_aero_zones_partial"]), "parcial"),
        "drs_zones": zones(s["drs_zones"], int(s["num_drs_zones"])),
        "start_reaction_s": round(reaction, 3) if reaction > 0 else None,
    }


def _livery(participant) -> str | None:
    """The car's main livery colour as #rrggbb (2025 format onwards), else None."""
    if "livery_colours" not in participant.dtype.names or not int(participant["num_colours"]):
        return None
    r, g, b = (int(x) for x in participant["livery_colours"][0])
    return f"#{r:02x}{g:02x}{b:02x}"


RACE_SESSIONS = frozenset({15, 16, 17})


def _timing(live: LiveSession, laps, player: int) -> dict[str, Any]:
    """Relatives, catch forecasts against the cars around and the sector review."""
    session = live.last.get("session")
    if session is None:
        return {}
    s = session.body
    race = int(s["session_type"]) in RACE_SESSIONS
    me = laps[player]
    lap_now = int(me["current_lap_num"])
    ref_ms = live.timing.delta.best_ms or int(me["last_lap_time_in_ms"]) or live.best_lap_ms.get(player)
    out: dict[str, Any] = {
        "relatives": live.timing.relatives(laps, player, float(s["track_length"]), ref_ms, race),
        "sector_review": _sector_review(live.player_history, race),
    }
    if race:
        total = int(s["total_laps"])
        laps_left = total - lap_now + 1 if total else None
        by_pos = {int(laps[i]["car_position"]): i for i in live.active_cars() if int(laps[i]["result_status"]) == 2}
        position = int(me["car_position"])
        my_pace = live.timing.pace_s(player, lap_now)

        def gap_ms(lap) -> int:
            return _ms(lap["delta_to_car_in_front_minutes_part"], lap["delta_to_car_in_front_ms_part"])

        def side(idx: int | None, gap: int, me_chasing: bool) -> dict[str, Any] | None:
            if idx is None:
                return None
            if abs(float(laps[idx]["total_distance"]) - float(me["total_distance"])) >= float(s["track_length"]):
                return None  # a lap or more apart: not a fight on track
            pace = live.timing.pace_s(idx, lap_now)
            gap_s = gap / 1000 if gap > 0 else None
            pursuer, target = (my_pace, pace) if me_chasing else (pace, my_pace)
            return {"index": idx, "gap_s": gap_s, "pace_s": pace, **forecast(gap_s, pursuer, target, laps_left)}

        ahead, behind = by_pos.get(position - 1), by_pos.get(position + 1)
        out["pace"] = {
            "my_pace_s": my_pace,
            "ahead": side(ahead, gap_ms(me), True),
            "behind": side(behind, gap_ms(laps[behind]) if behind is not None else 0, False),
        }
    return out


def _sector_review(history, race: bool, count: int = 2) -> list[dict[str, Any]]:
    """The last laps' sectors against the best clean lap before each of them.

    Built from the player's SessionHistory, which the game resends all session, so
    it survives lost packets. In and out laps (around a tyre change) and the race's
    first lap never serve as the reference.
    """
    if history is None:
        return []
    stints = history["tyre_stints_history_data"][: int(history["num_tyre_stints"])]
    pit_laps = set()
    for st in stints[:-1]:
        pit_laps |= {int(st["end_lap"]), int(st["end_lap"]) + 1}
    laps = []
    for k, h in enumerate(history["lap_history_data"][: int(history["num_laps"])]):
        ms = int(h["lap_time_in_ms"])
        if ms <= 0:
            continue
        sectors = [_ms(h[f"sector{i}_time_minutes_part"], h[f"sector{i}_time_ms_part"]) for i in (1, 2, 3)]
        flags = int(h["lap_valid_bit_flags"])
        number = k + 1
        clean = bool(flags & 0x01) and number not in pit_laps and not (race and number == 1) and all(sectors)
        laps.append({"lap": number, "time_ms": ms, "sectors_ms": sectors, "valid": bool(flags & 0x01), "clean": clean})
    rows = []
    for pos in range(len(laps) - 1, max(-1, len(laps) - 1 - count), -1):
        lap = laps[pos]
        ref = min((lp for lp in laps[:pos] if lp["clean"]), key=lambda lp: lp["time_ms"], default=None)
        rows.append({
            **lap,
            "reference_lap": ref["lap"] if ref else None,
            "sector_deltas_ms": [a - b if a and lap["valid"] else None for a, b in zip(lap["sectors_ms"], ref["sectors_ms"])]
            if ref else None,
        })
    return rows


RESULT_STATUS = {0: "invalid", 1: "inactive", 2: "active", 3: "finished", 4: "dnf", 5: "dsq", 6: "not_classified", 7: "retired"}


def _track(live: LiveSession) -> dict[str, Any] | None:
    session = live.last.get("session")
    if session is None:
        return None
    b = session.body
    return {
        "id": int(b["track_id"]),
        "length_m": int(b["track_length"]),
        "sector2_m": round(float(b["sector2_lap_distance_start"]), 1),
        "sector3_m": round(float(b["sector3_lap_distance_start"]), 1),
        # Rounded so the dashboard refetches the outline only when it grew noticeably.
        "layout_coverage": round(live.layout.coverage * 20) / 20 if live.layout else 1.0,
        "layout_ready": live.layout.ready if live.layout else True,
    }


def _cars(live: LiveSession, player: int | None) -> list[dict[str, Any]]:
    """Every car in the session, ordered by position. Fields a restricted online
    player does not share are None, not zero."""
    laps = live.last.get("lap_data")
    if laps is None:
        return []
    participants = live.last.get("participants")
    motion = live.last.get("motion")
    status = live.last.get("car_status")
    aero = live.last.get("car_telemetry_2")
    cars = []
    for i in live.active_cars():
        lap = laps.body["lap_data"][i]
        result = RESULT_STATUS.get(int(lap["result_status"]), "invalid")
        if result in ("invalid", "inactive") or int(lap["car_position"]) == 0:
            continue
        car: dict[str, Any] = {
            "index": i,
            "is_player": i == player,
            "position": int(lap["car_position"]),
            "lap": int(lap["current_lap_num"]),
            "lap_distance_m": round(float(lap["lap_distance"]), 1),
            "total_distance_m": round(float(lap["total_distance"]), 1),
            "gap_ahead_ms": _ms(lap["delta_to_car_in_front_minutes_part"], lap["delta_to_car_in_front_ms_part"]),
            "gap_leader_ms": _ms(lap["delta_to_race_leader_minutes_part"], lap["delta_to_race_leader_ms_part"]),
            "last_lap_ms": int(lap["last_lap_time_in_ms"]) or None,
            "best_lap_ms": live.best_lap_ms.get(i),
            "pit": c.PIT_STATUS.get(int(lap["pit_status"]), "Unknown"),
            "pit_stops": int(lap["num_pit_stops"]),
            "penalties_s": int(lap["penalties"]),
            "result": result,
            "name": None,
            "team": None,
            "team_id": None,
            "race_number": None,
            "ai": None,
            "tyre": None,
            "tyre_age_laps": None,
            "x": None,
            "z": None,
            "color": None,
            "overtake_active": None,
            "active_aero_mode": None,
        }
        if participants is not None:
            pp = participants.body["participants"][i]
            car.update(
                name=pp["name"].decode("utf-8", "replace") or None,
                team_id=int(pp["team_id"]),
                team=c.TEAMS.get(int(pp["team_id"])),
                race_number=int(pp["race_number"]),
                ai=bool(pp["ai_controlled"]),
                color=_livery(pp),
            )
        if status is not None:
            st = status.body["car_status_data"][i]
            visual = int(st["visual_tyre_compound"])
            if visual in c.VISUAL_COMPOUNDS:  # 0 when the player restricts their telemetry
                car.update(tyre=c.VISUAL_COMPOUNDS[visual], tyre_age_laps=int(st["tyres_age_laps"]))
        if aero is not None:
            a = aero.body["car_telemetry_2_data"][i]
            car.update(overtake_active=bool(a["overtake_active"]),
                       active_aero_mode="straight" if int(a["active_aero_mode"]) else "corner")
        if motion is not None:
            m = motion.body["car_motion_data"][i]
            car.update(x=round(float(m["world_position_x"]), 1), z=round(float(m["world_position_z"]), 1))
        cars.append(car)
    cars.sort(key=lambda car: car["position"])
    return cars
