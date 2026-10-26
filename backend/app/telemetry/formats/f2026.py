"""Packet layouts of the 2026 UDP format (F1 25 with the 2026 Season Pack, packet_format 2026).

Arrays hold 24 cars instead of 22. Built on the 2025 layouts with the changes of
the 2026 specification, and checked against a real capture:

- driver, network and team ids are 16 bits (Participants, LobbyInfo, TimeTrial);
- Motion sends the g-forces quantised as int16 (thousandths of a g, judging by a real
  capture); `DECODE` turns them back into floats so readers see the 2024 layout;
- CarTelemetry's engine temperature is 8 bits;
- CarStatus adds the ERS harvest limit per lap;
- Session adds active-aero and DRS zones, start reaction time and a few assists;
- CarTelemetry2 (id 16) is new: active aero, overtake mode and 2026 regulations.
"""

import numpy as np

from app.telemetry.formats import f2024, f2025
from app.telemetry.formats.f2024 import f32, i16, u8, u16, u32

NUM_CARS = 24

HEADER = f2024.HEADER
EVENT_DETAILS = f2024.EVENT_DETAILS


def _fields(dtype: np.dtype, replace: dict | None = None, after: dict | None = None) -> list:
    """The fields of a record dtype, with some types replaced and new fields inserted
    after the named ones."""
    replace, after = replace or {}, after or {}
    out = []
    for name, *spec in dtype.descr:
        out.append((name, *replace[name]) if name in replace else (name, *spec))
        out.extend(after.get(name, []))
    return out


def _cars(name: str, record: np.dtype, *extra) -> np.dtype:
    return np.dtype([(name, record, (NUM_CARS,)), *extra])


# --- 0 Motion: g-forces arrive quantised; DECODE restores the 2024 floats ---
G_FORCE_SCALE = 1000.0
CAR_MOTION_RAW = np.dtype(_fields(f2024.CAR_MOTION, replace={
    "g_force_lateral": (i16,), "g_force_longitudinal": (i16,), "g_force_vertical": (i16,),
}))
MOTION_RAW = _cars("car_motion_data", CAR_MOTION_RAW)
MOTION = _cars("car_motion_data", f2024.CAR_MOTION)


def _decode_motion(raw: np.void) -> np.void:
    out = np.zeros(1, dtype=MOTION)[0]
    cars, src = out["car_motion_data"], raw["car_motion_data"]
    for name in CAR_MOTION_RAW.names:
        cars[name] = src[name] / G_FORCE_SCALE if name.startswith("g_force") else src[name]
    return out


# --- 1 Session ---------------------------------------------------------------
AERO_ZONE = np.dtype([("zone_start", f32), ("zone_end", f32)])
SESSION = np.dtype(f2024.SESSION.descr + [
    ("active_aero_track_status", u8),
    ("num_active_aero_zones_full", u8), ("active_aero_zones_full", AERO_ZONE, (8,)),
    ("num_active_aero_zones_partial", u8), ("active_aero_zones_partial", AERO_ZONE, (8,)),
    ("num_drs_zones", u8), ("drs_zones", AERO_ZONE, (4,)),
    ("start_reaction_time", f32),
    ("anti_lock_brakes_assist", u8), ("traction_control_assist", u8),
    ("dynamic_racing_line_hi_vis", u8), ("dynamic_racing_line_colour_blind", u8),
    ("recurring_rewind_prompt", u8),
])

# --- 2 Lap Data --------------------------------------------------------------
LAP = _cars("lap_data", f2024.LAP_DATA, ("time_trial_pb_car_idx", u8), ("time_trial_rival_car_idx", u8))

# --- 4 Participants: 16-bit ids ----------------------------------------------
PARTICIPANT = np.dtype(_fields(f2025.PARTICIPANT, replace={
    "driver_id": (u16,), "network_id": (u16,), "team_id": (u16,),
}))
PARTICIPANTS = np.dtype([("num_active_cars", u8), ("participants", PARTICIPANT, (NUM_CARS,))])

# --- 5 Car Setups ------------------------------------------------------------
CAR_SETUPS = _cars("car_setups", f2024.CAR_SETUP, ("next_front_wing_value", f32))

# --- 6 Car Telemetry: 8-bit engine temperature -------------------------------
CAR_TELEMETRY = np.dtype(_fields(f2024.CAR_TELEMETRY, replace={"engine_temperature": (u8,)}))
TELEMETRY = _cars(
    "car_telemetry_data", CAR_TELEMETRY,
    ("mfd_panel_index", u8), ("mfd_panel_index_secondary_player", u8), ("suggested_gear", "<i1"),
)

# --- 7 Car Status: ERS harvest limit per lap ---------------------------------
CAR_STATUS = np.dtype(_fields(f2024.CAR_STATUS, after={
    "ers_harvested_this_lap_mguh": [("ers_harvest_limit_per_lap", f32)],
}))
STATUS = _cars("car_status_data", CAR_STATUS)

# --- 8 Final Classification ----------------------------------------------------
FINAL_CLASSIFICATION = np.dtype([
    ("num_cars", u8), ("classification_data", f2025.FINAL_CLASSIFICATION_DATA, (NUM_CARS,)),
])

# --- 9 Lobby Info: 16-bit team id --------------------------------------------
LOBBY_INFO_DATA = np.dtype(_fields(f2025.LOBBY_INFO_DATA, replace={"team_id": (u16,)}))
LOBBY_INFO = np.dtype([("num_players", u8), ("lobby_players", LOBBY_INFO_DATA, (NUM_CARS,))])

# --- 10 Car Damage -------------------------------------------------------------
CAR_DAMAGE = _cars("car_damage_data", f2025.CAR_DAMAGE_DATA)

# --- 14 Time Trial: 16-bit team id -------------------------------------------
TIME_TRIAL_DATA_SET = np.dtype(_fields(f2024.TIME_TRIAL_DATA_SET, replace={"team_id": (u16,)}))
TIME_TRIAL = np.dtype([
    ("player_session_best_data_set", TIME_TRIAL_DATA_SET),
    ("personal_best_data_set", TIME_TRIAL_DATA_SET),
    ("rival_data_set", TIME_TRIAL_DATA_SET),
])

# --- 15 Lap Positions ----------------------------------------------------------
LAP_POSITIONS = np.dtype([
    ("num_laps", u8), ("lap_start", u8), ("position_for_vehicle_idx", u8, (50, NUM_CARS)),
])

# --- 16 Car Telemetry 2 (new): 2026 regulations ------------------------------
CAR_TELEMETRY_2 = np.dtype([
    ("active_aero_mode", u8),  # 0 = corner, 1 = straight
    ("active_aero_available", u8),
    ("active_aero_activation_distance", u16),  # metres until available, 0 = not available
    ("overtake_available", u8),
    ("overtake_active", u8),
    ("overtake_activation_distance", u16),
    ("regulations_2026", u8),  # 0 = pre-2026, 1 = 2026 regulations
    ("driving_wrong_way", u8),
])
TELEMETRY_2 = _cars("car_telemetry_2_data", CAR_TELEMETRY_2)

# packet id -> (name, body dtype as read off the wire)
PACKETS: dict[int, tuple[str, np.dtype]] = {
    0: ("motion", MOTION_RAW),
    1: ("session", SESSION),
    2: ("lap_data", LAP),
    3: ("event", f2024.EVENT),
    4: ("participants", PARTICIPANTS),
    5: ("car_setups", CAR_SETUPS),
    6: ("car_telemetry", TELEMETRY),
    7: ("car_status", STATUS),
    8: ("final_classification", FINAL_CLASSIFICATION),
    9: ("lobby_info", LOBBY_INFO),
    10: ("car_damage", CAR_DAMAGE),
    11: ("session_history", f2024.SESSION_HISTORY),
    12: ("tyre_sets", f2024.TYRE_SETS),
    13: ("motion_ex", f2025.MOTION_EX),
    14: ("time_trial", TIME_TRIAL),
    15: ("lap_positions", LAP_POSITIONS),
    16: ("car_telemetry_2", TELEMETRY_2),
}

# packet id -> function turning the wire record into the layout readers expect
DECODE = {0: _decode_motion}

# Datagram sizes (header included). All but 8, 9 and 14 were seen in a real capture.
SIZES = {
    0: 1325, 1: 926, 2: 1399, 3: 45, 4: 1470, 5: 1233, 6: 1448, 7: 1445,
    8: 1134, 9: 1062, 10: 1133, 11: 1460, 12: 231, 13: 273, 14: 104, 15: 1231, 16: 269,
}
