"""Assetto Corsa Competizione telemetry, as the Windows bridge records it.

ACC does not send UDP telemetry like the F1 games. The bridge reads it on the
player's PC from two sources and wraps each read in a record that starts with
b"ACC" and a kind byte:

- b"P", b"G", b"S": a copy of the shared-memory pages `acpmf_physics`,
  `acpmf_graphics` and `acpmf_static` (the player's own car), laid out as in
  Kunos' ACC Shared Memory Documentation v1.8.12: C structs packed to 4 bytes,
  strings as fixed wchar_t arrays.
- b"B": one message of the ACC broadcasting protocol (every car on track),
  received by the bridge on 127.0.0.1 and passed on unchanged.

Samples of the other Assetto Corsa games use the same records: the original and
Rally publish `acpmf_*` pages with their own layouts (the static page's
`smVersion`/`acVersion` tell them apart) and EVO's `acevo_pmf_*` pages come as
b"p", b"g", b"s". None of them is decoded yet.

Nothing here has been checked against a real ACC recording yet: the layouts
follow the documentation and the offsets an existing overlay asserts
(`playerCarID` at 1216, `penalty` at 1228, `iDeltaLapTime` at 1360).
"""

import struct
from dataclasses import dataclass, field
from typing import Any

import numpy as np

MAGIC = b"ACC"
KIND_PHYSICS, KIND_GRAPHICS, KIND_STATIC, KIND_BROADCAST = b"P", b"G", b"S", b"B"

i32, f32, u16 = np.int32, np.float32, np.uint16


def _wstr(n: int):
    return (u16, (n,))


PHYSICS = np.dtype([
    ("packet_id", i32), ("gas", f32), ("brake", f32), ("fuel", f32), ("gear", i32), ("rpm", i32),
    ("steer_angle", f32), ("speed_kmh", f32), ("velocity", f32, (3,)), ("acc_g", f32, (3,)),
    ("wheel_slip", f32, (4,)), ("wheel_load", f32, (4,)), ("wheels_pressure", f32, (4,)),
    ("wheel_angular_speed", f32, (4,)), ("tyre_wear", f32, (4,)), ("tyre_dirty_level", f32, (4,)),
    ("tyre_core_temperature", f32, (4,)), ("camber_rad", f32, (4,)), ("suspension_travel", f32, (4,)),
    ("drs", f32), ("tc", f32), ("heading", f32), ("pitch", f32), ("roll", f32), ("cg_height", f32),
    ("car_damage", f32, (5,)), ("number_of_tyres_out", i32), ("pit_limiter_on", i32), ("abs", f32),
    ("kers_charge", f32), ("kers_input", f32), ("auto_shifter_on", i32), ("ride_height", f32, (2,)),
    ("turbo_boost", f32), ("ballast", f32), ("air_density", f32), ("air_temp", f32), ("road_temp", f32),
    ("local_angular_vel", f32, (3,)), ("final_ff", f32), ("performance_meter", f32),
    ("engine_brake", i32), ("ers_recovery_level", i32), ("ers_power_level", i32), ("ers_heat_charging", i32),
    ("ers_is_charging", i32), ("kers_current_kj", f32), ("drs_available", i32), ("drs_enabled", i32),
    ("brake_temp", f32, (4,)), ("clutch", f32), ("tyre_temp_i", f32, (4,)), ("tyre_temp_m", f32, (4,)),
    ("tyre_temp_o", f32, (4,)), ("is_ai_controlled", i32), ("tyre_contact_point", f32, (4, 3)),
    ("tyre_contact_normal", f32, (4, 3)), ("tyre_contact_heading", f32, (4, 3)), ("brake_bias", f32),
    ("local_velocity", f32, (3,)), ("p2p_activations", i32), ("p2p_status", i32), ("current_max_rpm", i32),
    ("mz", f32, (4,)), ("fx", f32, (4,)), ("fy", f32, (4,)), ("slip_ratio", f32, (4,)), ("slip_angle", f32, (4,)),
    ("tc_in_action", i32), ("abs_in_action", i32), ("suspension_damage", f32, (4,)), ("tyre_temp", f32, (4,)),
    ("water_temp", f32), ("brake_pressure", f32, (4,)), ("front_brake_compound", i32),
    ("rear_brake_compound", i32), ("pad_life", f32, (4,)), ("disc_life", f32, (4,)), ("ignition_on", i32),
    ("starter_engine_on", i32), ("is_engine_running", i32), ("kerb_vibration", f32),
    ("slip_vibrations", f32), ("g_vibrations", f32), ("abs_vibrations", f32),
], align=True)

GRAPHICS = np.dtype([
    ("packet_id", i32), ("status", i32), ("session", i32),
    ("current_time", *_wstr(15)), ("last_time", *_wstr(15)), ("best_time", *_wstr(15)), ("split", *_wstr(15)),
    ("completed_laps", i32), ("position", i32), ("i_current_time", i32), ("i_last_time", i32),
    ("i_best_time", i32), ("session_time_left", f32), ("distance_traveled", f32), ("is_in_pit", i32),
    ("current_sector_index", i32), ("last_sector_time", i32), ("number_of_laps", i32),
    ("tyre_compound", *_wstr(33)), ("replay_time_multiplier", f32), ("normalized_car_position", f32),
    ("active_cars", i32), ("car_coordinates", f32, (60, 3)), ("car_id", i32, (60,)), ("player_car_id", i32),
    ("penalty_time", f32), ("flag", i32), ("penalty", i32), ("ideal_line_on", i32), ("is_in_pit_lane", i32),
    ("surface_grip", f32), ("mandatory_pit_done", i32), ("wind_speed", f32), ("wind_direction", f32),
    ("is_setup_menu_visible", i32), ("main_display_index", i32), ("secondary_display_index", i32),
    ("tc", i32), ("tc_cut", i32), ("engine_map", i32), ("abs", i32), ("fuel_x_lap", f32), ("rain_lights", i32),
    ("flashing_lights", i32), ("lights_stage", i32), ("exhaust_temperature", f32), ("wiper_lv", i32),
    ("driver_stint_total_time_left", i32), ("driver_stint_time_left", i32), ("rain_tyres", i32),
    ("session_index", i32), ("used_fuel", f32), ("delta_lap_time", *_wstr(15)), ("i_delta_lap_time", i32),
    ("estimated_lap_time", *_wstr(15)), ("i_estimated_lap_time", i32), ("is_delta_positive", i32),
    ("i_split", i32), ("is_valid_lap", i32), ("fuel_estimated_laps", f32), ("track_status", *_wstr(33)),
    ("missing_mandatory_pits", i32), ("clock", f32), ("direction_lights_left", i32),
    ("direction_lights_right", i32), ("global_yellow", i32), ("global_yellow1", i32), ("global_yellow2", i32),
    ("global_yellow3", i32), ("global_white", i32), ("global_green", i32), ("global_chequered", i32),
    ("global_red", i32), ("mfd_tyre_set", i32), ("mfd_fuel_to_add", f32), ("mfd_tyre_pressure_lf", f32),
    ("mfd_tyre_pressure_rf", f32), ("mfd_tyre_pressure_lr", f32), ("mfd_tyre_pressure_rr", f32),
    ("track_grip_status", i32), ("rain_intensity", i32), ("rain_intensity_in_10min", i32),
    ("rain_intensity_in_30min", i32), ("current_tyre_set", i32), ("strategy_tyre_set", i32),
    ("gap_ahead", i32), ("gap_behind", i32),
], align=True)

STATIC = np.dtype([
    ("sm_version", *_wstr(15)), ("ac_version", *_wstr(15)), ("number_of_sessions", i32), ("num_cars", i32),
    ("car_model", *_wstr(33)), ("track", *_wstr(33)), ("player_name", *_wstr(33)),
    ("player_surname", *_wstr(33)), ("player_nick", *_wstr(33)), ("sector_count", i32),
    ("max_torque", f32), ("max_power", f32), ("max_rpm", i32), ("max_fuel", f32),
    ("suspension_max_travel", f32, (4,)), ("tyre_radius", f32, (4,)), ("max_turbo_boost", f32),
    ("deprecated_1", f32), ("deprecated_2", f32), ("penalties_enabled", i32), ("aid_fuel_rate", f32),
    ("aid_tire_rate", f32), ("aid_mechanical_damage", f32), ("allow_tyre_blankets", f32),
    ("aid_stability", f32), ("aid_auto_clutch", i32), ("aid_auto_blip", i32), ("has_drs", i32),
    ("has_ers", i32), ("has_kers", i32), ("kers_max_j", f32), ("engine_brake_settings_count", i32),
    ("ers_power_controller_count", i32), ("track_spline_length", f32), ("track_configuration", *_wstr(33)),
    ("ers_max_j", f32), ("is_timed_race", i32), ("has_extra_lap", i32), ("car_skin", *_wstr(33)),
    ("reversed_grid_positions", i32), ("pit_window_start", i32), ("pit_window_end", i32), ("is_online", i32),
    ("dry_tyres_name", *_wstr(33)), ("wet_tyres_name", *_wstr(33)),
], align=True)

PAGES = {KIND_PHYSICS: ("physics", PHYSICS), KIND_GRAPHICS: ("graphics", GRAPHICS), KIND_STATIC: ("static", STATIC)}

STATUS = {0: "off", 1: "replay", 2: "live", 3: "pause"}
SESSION_TYPES = {-1: "unknown", 0: "practice", 1: "qualify", 2: "race", 3: "hotlap", 4: "time_attack",
                 5: "drift", 6: "drag", 7: "hotstint", 8: "hotlap_superpole"}
FLAGS = {0: None, 1: "blue", 2: "yellow", 3: "black", 4: "white", 5: "chequered", 6: "penalty", 7: "green", 8: "orange"}


def wstr(arr) -> str:
    """A fixed wchar_t array as text, up to the first NUL."""
    raw = np.asarray(arr, dtype="<u2").tobytes().decode("utf-16-le", "replace")
    return raw.split("\x00", 1)[0]


class AccError(ValueError):
    pass


# Below this the page cannot be the documented struct at all.
MIN_PAGE_BYTES = {KIND_PHYSICS: 64, KIND_GRAPHICS: 1232, KIND_STATIC: 404}


@dataclass
class AccRecord:
    kind: str  # physics, graphics, static or broadcast
    body: Any  # a numpy record for pages, a dict for broadcast messages
    short_by: int = 0  # bytes the page lacked against the documentation, filled with zeros


def parse(data: bytes) -> AccRecord:
    """Decode one record written by the bridge.

    Pages longer than the documented struct are cut (a newer game appends
    fields). Shorter ones are padded with zeros and say by how much: the
    documentation leaves the size of `trackConfiguration` in the static page
    open (references disagree, 784 or 820 bytes), and a real recording settles it.
    """
    if len(data) < 4 or data[:3] != MAGIC:
        raise AccError("not an ACC record")
    kind, payload = data[3:4], data[4:]
    if kind in PAGES:
        name, dtype = PAGES[kind]
        if len(payload) < MIN_PAGE_BYTES[kind]:
            raise AccError(f"{name} page too short: {len(payload)} bytes")
        short = max(0, dtype.itemsize - len(payload))
        buf = payload[: dtype.itemsize] + bytes(short)
        return AccRecord(name, np.frombuffer(buf, dtype=dtype)[0], short)
    if kind == KIND_BROADCAST:
        return AccRecord("broadcast", parse_broadcast(payload))
    raise AccError(f"unknown ACC record kind {kind!r}")


# --- broadcasting protocol (Kunos ACC broadcasting SDK, protocol version 4) -------

REGISTRATION_RESULT, REALTIME_UPDATE, REALTIME_CAR_UPDATE = 1, 2, 3
ENTRY_LIST, TRACK_DATA, ENTRY_LIST_CAR, BROADCASTING_EVENT = 4, 5, 6, 7

CAR_LOCATIONS = {0: None, 1: "track", 2: "pitlane", 3: "pit_entry", 4: "pit_exit"}
SESSION_PHASES = {0: None, 1: "starting", 2: "pre_formation", 3: "formation", 4: "pre_session",
                  5: "session", 6: "session_over", 7: "post_session", 8: "result_ui"}
BROADCAST_SESSION_TYPES = {0: "practice", 4: "qualifying", 9: "superpole", 10: "race", 11: "hotlap",
                           12: "hotstint", 13: "hotlap_superpole", 14: "replay"}
EVENT_TYPES = {0: None, 1: "green_flag", 2: "session_over", 3: "penalty_message", 4: "accident",
               5: "lap_completed", 6: "best_session_lap", 7: "best_personal_lap"}


@dataclass
class _Reader:
    b: bytes
    at: int = 0

    def take(self, fmt: str):
        size = struct.calcsize(fmt)
        if self.at + size > len(self.b):
            raise AccError("truncated broadcasting message")
        v = struct.unpack_from(fmt, self.b, self.at)
        self.at += size
        return v[0] if len(v) == 1 else v

    def string(self) -> str:
        n = self.take("<H")
        if self.at + n > len(self.b):
            raise AccError("truncated string")
        s = self.b[self.at:self.at + n].decode("utf-8", "replace")
        self.at += n
        return s

    def lap(self) -> dict[str, Any]:
        ms, car, driver, count = self.take("<iHHB")
        splits = [self.take("<i") for _ in range(count)]
        invalid, valid_for_best, outlap, inlap = self.take("<BBBB")
        valid = lambda v: v if 0 < v < 2**31 - 1 else None  # noqa: E731 - INT32_MAX means "no time"
        return {"ms": valid(ms), "car_index": car, "driver_index": driver,
                "splits_ms": [valid(s) for s in splits], "invalid": bool(invalid),
                "valid_for_best": bool(valid_for_best), "outlap": bool(outlap), "inlap": bool(inlap)}


def parse_broadcast(b: bytes) -> dict[str, Any]:
    r = _Reader(b)
    msg = r.take("<B")
    if msg == REGISTRATION_RESULT:
        conn, ok, readonly = r.take("<iBB")
        return {"type": "registration", "connection_id": conn, "success": bool(ok), "readonly": bool(readonly),
                "error": r.string()}
    if msg == REALTIME_UPDATE:
        event, session, stype, phase, t, end, focus = r.take("<HHBBffi")
        out = {"type": "realtime", "event_index": event, "session_index": session,
               "session_type": BROADCAST_SESSION_TYPES.get(stype, stype), "phase": SESSION_PHASES.get(phase, phase),
               "session_time_ms": t, "session_end_time_ms": end, "focused_car_index": focus,
               "camera_set": r.string(), "camera": r.string(), "hud_page": r.string()}
        out["replay"] = bool(r.take("<B"))
        if out["replay"]:
            out["replay_session_time"], out["replay_remaining_time"] = r.take("<ff")
        out["time_of_day_s"] = r.take("<f")
        amb, track, clouds, rain, wet = r.take("<BBBBB")
        out.update(ambient_temp_c=amb, track_temp_c=track, clouds=clouds / 10, rain_level=rain / 10, wetness=wet / 10)
        out["best_session_lap"] = r.lap()
        return out
    if msg == REALTIME_CAR_UPDATE:
        car, driver, drivers, gear, x, y, yaw, loc, kmh, pos, cup_pos, track_pos, spline, laps, delta = \
            r.take("<HHBbfffBHHHHfHi")
        return {"type": "car", "car_index": car, "driver_index": driver, "driver_count": drivers,
                "gear": gear - 1 if gear > 0 else gear,  # the protocol sends gear + 1 (0 = reverse)
                "world_x": x, "world_y": y, "yaw": yaw, "location": CAR_LOCATIONS.get(loc, loc), "speed_kmh": kmh,
                "position": pos, "cup_position": cup_pos, "track_position": track_pos, "spline": spline,
                "laps": laps, "delta_ms": delta, "best_lap": r.lap(), "last_lap": r.lap(), "current_lap": r.lap()}
    if msg == ENTRY_LIST:
        conn, n = r.take("<iH")
        return {"type": "entry_list", "connection_id": conn, "car_indexes": [r.take("<H") for _ in range(n)]}
    if msg == TRACK_DATA:
        conn = r.take("<i")
        name = r.string()
        track_id, meters = r.take("<ii")
        cameras = {}
        for _ in range(r.take("<B")):
            set_name = r.string()
            cameras[set_name] = [r.string() for _ in range(r.take("<B"))]
        huds = [r.string() for _ in range(r.take("<B"))]
        return {"type": "track", "connection_id": conn, "track": name, "track_id": track_id,
                "track_meters": meters, "camera_sets": cameras, "hud_pages": huds}
    if msg == ENTRY_LIST_CAR:
        car, model = r.take("<HB")
        team = r.string()
        number, cup, current_driver, nationality = r.take("<iBBH")
        drivers = []
        for _ in range(r.take("<B")):
            first, last, short = r.string(), r.string(), r.string()
            category, nat = r.take("<BH")
            drivers.append({"first_name": first, "last_name": last, "short_name": short,
                            "category": category, "nationality": nat})
        return {"type": "entry", "car_index": car, "car_model": model, "team": team, "race_number": number,
                "cup_category": cup, "current_driver_index": current_driver, "nationality": nationality,
                "drivers": drivers}
    if msg == BROADCASTING_EVENT:
        etype = r.take("<B")
        text = r.string()
        t, car = r.take("<ii")
        return {"type": "event", "event": EVENT_TYPES.get(etype, etype), "message": text, "time_ms": t, "car_index": car}
    raise AccError(f"unknown broadcasting message {msg}")


@dataclass
class AccSession:
    """What a recording says, summed up: used by the tests and by the sample summary."""
    pages: dict[str, int] = field(default_factory=dict)
    messages: dict[str, int] = field(default_factory=dict)
    track: str | None = None
    car_model: str | None = None
    cars: set[int] = field(default_factory=set)

    def add(self, rec: AccRecord) -> None:
        if rec.kind == "broadcast":
            t = rec.body["type"]
            self.messages[t] = self.messages.get(t, 0) + 1
            if t == "track":
                self.track = rec.body["track"]
            elif t in ("car", "entry"):
                self.cars.add(rec.body["car_index"])
        else:
            self.pages[rec.kind] = self.pages.get(rec.kind, 0) + 1
            if rec.kind == "static":
                self.track = self.track or wstr(rec.body["track"]) or None
                self.car_model = wstr(rec.body["car_model"]) or None
