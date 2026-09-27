"""A compact, JSON-ready view of the player's race, built from the live state.

This is what the dashboard shows and what the engineer agent reads. Every
section carries `age_s`, the seconds since its source packet arrived.
"""

from typing import Any

from app.live.state import LiveSession
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
            "time_left_s": int(s["session_time_left"]),
            "safety_car": c.SAFETY_CAR_STATUS.get(int(s["safety_car_status"]), "Unknown"),
            "online": bool(s["network_game"]),
            "paused": bool(s["game_paused"]),
            "pit_window_ideal_lap": int(s["pit_stop_window_ideal_lap"]) or None,
            "pit_window_latest_lap": int(s["pit_stop_window_latest_lap"]) or None,
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

    if player is None:
        return out

    if (p := live.last.get("participants")) is not None:
        me = p.body["participants"][player]
        out["driver"] = {
            "name": me["name"].decode("utf-8", "replace"),
            "team": c.TEAMS.get(int(me["team_id"]), f"Team {int(me['team_id'])}"),
            "race_number": int(me["race_number"]),
            "cars_in_session": int(p.body["num_active_cars"]),
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
        }

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
        }

    out["track"] = _track(live)
    out["cars"] = _cars(live, player)
    out["events"] = list(live.events)[-10:]
    return out


RESULT_STATUS = {0: "invalid", 1: "inactive", 2: "active", 3: "finished", 4: "dnf", 5: "dsq", 6: "not_classified", 7: "retired"}


def _track(live: LiveSession) -> dict[str, Any] | None:
    session = live.last.get("session")
    if session is None or live.layout is None:
        return None
    b = session.body
    return {
        "id": live.track_id,
        "length_m": int(b["track_length"]),
        "sector2_m": round(float(b["sector2_lap_distance_start"]), 1),
        "sector3_m": round(float(b["sector3_lap_distance_start"]), 1),
        # Rounded so the dashboard refetches the outline only when it grew noticeably.
        "layout_coverage": round(live.layout.coverage * 20) / 20,
        "layout_ready": live.layout.ready,
    }


def _cars(live: LiveSession, player: int) -> list[dict[str, Any]]:
    """Every car in the session, ordered by position. Fields a restricted online
    player does not share are None, not zero."""
    laps = live.last.get("lap_data")
    if laps is None:
        return []
    participants = live.last.get("participants")
    motion = live.last.get("motion")
    status = live.last.get("car_status")
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
        }
        if participants is not None:
            pp = participants.body["participants"][i]
            car.update(
                name=pp["name"].decode("utf-8", "replace") or None,
                team_id=int(pp["team_id"]),
                team=c.TEAMS.get(int(pp["team_id"])),
                race_number=int(pp["race_number"]),
                ai=bool(pp["ai_controlled"]),
            )
        if status is not None:
            st = status.body["car_status_data"][i]
            visual = int(st["visual_tyre_compound"])
            if visual in c.VISUAL_COMPOUNDS:  # 0 when the player restricts their telemetry
                car.update(tyre=c.VISUAL_COMPOUNDS[visual], tyre_age_laps=int(st["tyres_age_laps"]))
        if motion is not None:
            m = motion.body["car_motion_data"][i]
            car.update(x=round(float(m["world_position_x"]), 1), z=round(float(m["world_position_z"]), 1))
        cars.append(car)
    cars.sort(key=lambda car: car["position"])
    return cars
