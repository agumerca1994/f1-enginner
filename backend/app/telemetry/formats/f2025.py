"""Packet layouts of the 2025 UDP format (F1 25, packet_format 2025).

Same header and same layouts as 2024 except for the packets redefined here,
checked against the F1 25 specification's change list and a real capture.
"""

import numpy as np

from app.telemetry.formats import f2024
from app.telemetry.formats.f2024 import NUM_CARS, f32, u8, u16, u32

HEADER = f2024.HEADER
EVENT_DETAILS = f2024.EVENT_DETAILS

# --- 4 Participants: names shrink to 32 bytes; livery colours are new ------
LIVERY_COLOUR = np.dtype([("red", u8), ("green", u8), ("blue", u8)])
PARTICIPANT = np.dtype([
    ("ai_controlled", u8), ("driver_id", u8), ("network_id", u8), ("team_id", u8),
    ("my_team", u8), ("race_number", u8), ("nationality", u8), ("name", "S32"),
    ("your_telemetry", u8), ("show_online_names", u8), ("tech_level", u16),
    ("platform", u8), ("num_colours", u8), ("livery_colours", LIVERY_COLOUR, (4,)),
])
PARTICIPANTS = np.dtype([
    ("num_active_cars", u8),
    ("participants", PARTICIPANT, (NUM_CARS,)),
])

# --- 8 Final Classification: result_reason is new --------------------------
FINAL_CLASSIFICATION_DATA = np.dtype([
    ("position", u8), ("num_laps", u8), ("grid_position", u8), ("points", u8),
    ("num_pit_stops", u8), ("result_status", u8), ("result_reason", u8),
    ("best_lap_time_in_ms", u32), ("total_race_time", "<f8"),
    ("penalties_time", u8), ("num_penalties", u8), ("num_tyre_stints", u8),
    ("tyre_stints_actual", u8, (8,)), ("tyre_stints_visual", u8, (8,)),
    ("tyre_stints_end_laps", u8, (8,)),
])
FINAL_CLASSIFICATION = np.dtype([
    ("num_cars", u8),
    ("classification_data", FINAL_CLASSIFICATION_DATA, (NUM_CARS,)),
])

# --- 9 Lobby Info: names shrink to 32 bytes ---------------------------------
LOBBY_INFO_DATA = np.dtype([
    ("ai_controlled", u8), ("team_id", u8), ("nationality", u8), ("platform", u8),
    ("name", "S32"), ("car_number", u8), ("your_telemetry", u8),
    ("show_online_names", u8), ("tech_level", u16), ("ready_status", u8),
])
LOBBY_INFO = np.dtype([
    ("num_players", u8),
    ("lobby_players", LOBBY_INFO_DATA, (NUM_CARS,)),
])

# --- 10 Car Damage: tyre blisters, in the middle of the record --------------
CAR_DAMAGE_DATA = np.dtype([
    ("tyres_wear", f32, (4,)), ("tyres_damage", u8, (4,)), ("brakes_damage", u8, (4,)),
    ("tyre_blisters", u8, (4,)),
    ("front_left_wing_damage", u8), ("front_right_wing_damage", u8),
    ("rear_wing_damage", u8), ("floor_damage", u8), ("diffuser_damage", u8),
    ("sidepod_damage", u8), ("drs_fault", u8), ("ers_fault", u8),
    ("gear_box_damage", u8), ("engine_damage", u8),
    ("engine_mguh_wear", u8), ("engine_es_wear", u8), ("engine_ce_wear", u8),
    ("engine_ice_wear", u8), ("engine_mguk_wear", u8), ("engine_tc_wear", u8),
    ("engine_blown", u8), ("engine_seized", u8),
])
CAR_DAMAGE = np.dtype([("car_damage_data", CAR_DAMAGE_DATA, (NUM_CARS,))])

# --- 13 Motion Ex: chassis pitch and camber appended -------------------------
MOTION_EX = np.dtype(
    f2024.MOTION_EX.descr
    + [("chassis_pitch", f32), ("wheel_camber", f32, (4,)), ("wheel_camber_gain", f32, (4,))]
)

# --- 15 Lap Positions (new): the position of every car at the start of each lap
LAP_POSITIONS = np.dtype([
    ("num_laps", u8), ("lap_start", u8),
    ("position_for_vehicle_idx", u8, (50, NUM_CARS)),
])

# packet id -> (name, body dtype)
PACKETS: dict[int, tuple[str, np.dtype]] = {
    **f2024.PACKETS,
    4: ("participants", PARTICIPANTS),
    8: ("final_classification", FINAL_CLASSIFICATION),
    9: ("lobby_info", LOBBY_INFO),
    10: ("car_damage", CAR_DAMAGE),
    13: ("motion_ex", MOTION_EX),
    15: ("lap_positions", LAP_POSITIONS),
}

# Datagram sizes (header included) from the F1 25 specification.
SIZES = {
    **f2024.SIZES,
    4: 1284, 8: 1042, 9: 954, 10: 1041, 13: 273, 15: 1131,
}
