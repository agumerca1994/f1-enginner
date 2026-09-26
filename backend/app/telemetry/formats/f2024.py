"""Packet layouts for UDP packet format 2024 (EA SPORTS F1 24).

Every structure is a packed little-endian numpy dtype that mirrors the C
structs of the official specification, with fields renamed to snake_case.
`SIZES` holds the datagram sizes from the specification; tests assert that
each dtype matches them exactly.
"""

import numpy as np

u8, i8, u16, i16, u32, u64, f32, f64 = "<u1", "<i1", "<u2", "<i2", "<u4", "<u8", "<f4", "<f8"
NUM_CARS = 22

HEADER = np.dtype([
    ("packet_format", u16),
    ("game_year", u8),
    ("game_major_version", u8),
    ("game_minor_version", u8),
    ("packet_version", u8),
    ("packet_id", u8),
    ("session_uid", u64),
    ("session_time", f32),
    ("frame_identifier", u32),
    ("overall_frame_identifier", u32),
    ("player_car_index", u8),
    ("secondary_player_car_index", u8),
])

# --- 0 Motion ---------------------------------------------------------------
CAR_MOTION = np.dtype([
    ("world_position_x", f32), ("world_position_y", f32), ("world_position_z", f32),
    ("world_velocity_x", f32), ("world_velocity_y", f32), ("world_velocity_z", f32),
    ("world_forward_dir_x", i16), ("world_forward_dir_y", i16), ("world_forward_dir_z", i16),
    ("world_right_dir_x", i16), ("world_right_dir_y", i16), ("world_right_dir_z", i16),
    ("g_force_lateral", f32), ("g_force_longitudinal", f32), ("g_force_vertical", f32),
    ("yaw", f32), ("pitch", f32), ("roll", f32),
])
MOTION = np.dtype([("car_motion_data", CAR_MOTION, (NUM_CARS,))])

# --- 1 Session --------------------------------------------------------------
MARSHAL_ZONE = np.dtype([("zone_start", f32), ("zone_flag", i8)])
WEATHER_FORECAST_SAMPLE = np.dtype([
    ("session_type", u8), ("time_offset", u8), ("weather", u8),
    ("track_temperature", i8), ("track_temperature_change", i8),
    ("air_temperature", i8), ("air_temperature_change", i8),
    ("rain_percentage", u8),
])
SESSION = np.dtype([
    ("weather", u8), ("track_temperature", i8), ("air_temperature", i8),
    ("total_laps", u8), ("track_length", u16), ("session_type", u8), ("track_id", i8),
    ("formula", u8), ("session_time_left", u16), ("session_duration", u16),
    ("pit_speed_limit", u8), ("game_paused", u8), ("is_spectating", u8),
    ("spectator_car_index", u8), ("sli_pro_native_support", u8),
    ("num_marshal_zones", u8), ("marshal_zones", MARSHAL_ZONE, (21,)),
    ("safety_car_status", u8), ("network_game", u8),
    ("num_weather_forecast_samples", u8),
    ("weather_forecast_samples", WEATHER_FORECAST_SAMPLE, (64,)),
    ("forecast_accuracy", u8), ("ai_difficulty", u8),
    ("season_link_identifier", u32), ("weekend_link_identifier", u32),
    ("session_link_identifier", u32),
    ("pit_stop_window_ideal_lap", u8), ("pit_stop_window_latest_lap", u8),
    ("pit_stop_rejoin_position", u8),
    ("steering_assist", u8), ("braking_assist", u8), ("gearbox_assist", u8),
    ("pit_assist", u8), ("pit_release_assist", u8), ("ers_assist", u8),
    ("drs_assist", u8), ("dynamic_racing_line", u8), ("dynamic_racing_line_type", u8),
    ("game_mode", u8), ("rule_set", u8), ("time_of_day", u32), ("session_length", u8),
    ("speed_units_lead_player", u8), ("temperature_units_lead_player", u8),
    ("speed_units_secondary_player", u8), ("temperature_units_secondary_player", u8),
    ("num_safety_car_periods", u8), ("num_virtual_safety_car_periods", u8),
    ("num_red_flag_periods", u8),
    ("equal_car_performance", u8), ("recovery_mode", u8), ("flashback_limit", u8),
    ("surface_type", u8), ("low_fuel_mode", u8), ("race_starts", u8),
    ("tyre_temperature", u8), ("pit_lane_tyre_sim", u8), ("car_damage", u8),
    ("car_damage_rate", u8), ("collisions", u8), ("collisions_off_for_first_lap_only", u8),
    ("mp_unsafe_pit_release", u8), ("mp_off_for_griefing", u8),
    ("corner_cutting_stringency", u8), ("parc_ferme_rules", u8),
    ("pit_stop_experience", u8), ("safety_car", u8), ("safety_car_experience", u8),
    ("formation_lap", u8), ("formation_lap_experience", u8), ("red_flags", u8),
    ("affects_licence_level_solo", u8), ("affects_licence_level_mp", u8),
    ("num_sessions_in_weekend", u8), ("weekend_structure", u8, (12,)),
    ("sector2_lap_distance_start", f32), ("sector3_lap_distance_start", f32),
])

# --- 2 Lap Data -------------------------------------------------------------
LAP_DATA = np.dtype([
    ("last_lap_time_in_ms", u32), ("current_lap_time_in_ms", u32),
    ("sector1_time_ms_part", u16), ("sector1_time_minutes_part", u8),
    ("sector2_time_ms_part", u16), ("sector2_time_minutes_part", u8),
    ("delta_to_car_in_front_ms_part", u16), ("delta_to_car_in_front_minutes_part", u8),
    ("delta_to_race_leader_ms_part", u16), ("delta_to_race_leader_minutes_part", u8),
    ("lap_distance", f32), ("total_distance", f32), ("safety_car_delta", f32),
    ("car_position", u8), ("current_lap_num", u8), ("pit_status", u8),
    ("num_pit_stops", u8), ("sector", u8), ("current_lap_invalid", u8),
    ("penalties", u8), ("total_warnings", u8), ("corner_cutting_warnings", u8),
    ("num_unserved_drive_through_pens", u8), ("num_unserved_stop_go_pens", u8),
    ("grid_position", u8), ("driver_status", u8), ("result_status", u8),
    ("pit_lane_timer_active", u8), ("pit_lane_time_in_lane_in_ms", u16),
    ("pit_stop_timer_in_ms", u16), ("pit_stop_should_serve_pen", u8),
    ("speed_trap_fastest_speed", f32), ("speed_trap_fastest_lap", u8),
])
LAP = np.dtype([
    ("lap_data", LAP_DATA, (NUM_CARS,)),
    ("time_trial_pb_car_idx", u8),
    ("time_trial_rival_car_idx", u8),
])

# --- 3 Event ----------------------------------------------------------------
# The body is a 4-char code followed by a 12-byte union; see EVENT_DETAILS.
EVENT = np.dtype([("event_string_code", "S4"), ("event_details", u8, (12,))])

EVENT_DETAILS = {
    "FTLP": np.dtype([("vehicle_idx", u8), ("lap_time", f32)]),
    "RTMT": np.dtype([("vehicle_idx", u8)]),
    "TMPT": np.dtype([("vehicle_idx", u8)]),
    "RCWN": np.dtype([("vehicle_idx", u8)]),
    "PENA": np.dtype([
        ("penalty_type", u8), ("infringement_type", u8), ("vehicle_idx", u8),
        ("other_vehicle_idx", u8), ("time", u8), ("lap_num", u8), ("places_gained", u8),
    ]),
    "SPTP": np.dtype([
        ("vehicle_idx", u8), ("speed", f32), ("is_overall_fastest_in_session", u8),
        ("is_driver_fastest_in_session", u8), ("fastest_vehicle_idx_in_session", u8),
        ("fastest_speed_in_session", f32),
    ]),
    "STLG": np.dtype([("num_lights", u8)]),
    "DTSV": np.dtype([("vehicle_idx", u8)]),
    "SGSV": np.dtype([("vehicle_idx", u8)]),
    "FLBK": np.dtype([("flashback_frame_identifier", u32), ("flashback_session_time", f32)]),
    "BUTN": np.dtype([("button_status", u32)]),
    "OVTK": np.dtype([("overtaking_vehicle_idx", u8), ("being_overtaken_vehicle_idx", u8)]),
    "SCAR": np.dtype([("safety_car_type", u8), ("event_type", u8)]),
    "COLL": np.dtype([("vehicle1_idx", u8), ("vehicle2_idx", u8)]),
}
# Codes without details: SSTA session started, SEND session ended, DRSE/DRSD DRS
# enabled/disabled, CHQF chequered flag, LGOT lights out, RDFL red flag.

# --- 4 Participants ---------------------------------------------------------
PARTICIPANT = np.dtype([
    ("ai_controlled", u8), ("driver_id", u8), ("network_id", u8), ("team_id", u8),
    ("my_team", u8), ("race_number", u8), ("nationality", u8), ("name", "S48"),
    ("your_telemetry", u8), ("show_online_names", u8), ("tech_level", u16),
    ("platform", u8),
])
PARTICIPANTS = np.dtype([
    ("num_active_cars", u8),
    ("participants", PARTICIPANT, (NUM_CARS,)),
])

# --- 5 Car Setups -----------------------------------------------------------
CAR_SETUP = np.dtype([
    ("front_wing", u8), ("rear_wing", u8), ("on_throttle", u8), ("off_throttle", u8),
    ("front_camber", f32), ("rear_camber", f32), ("front_toe", f32), ("rear_toe", f32),
    ("front_suspension", u8), ("rear_suspension", u8), ("front_anti_roll_bar", u8),
    ("rear_anti_roll_bar", u8), ("front_suspension_height", u8),
    ("rear_suspension_height", u8), ("brake_pressure", u8), ("brake_bias", u8),
    ("engine_braking", u8),
    ("rear_left_tyre_pressure", f32), ("rear_right_tyre_pressure", f32),
    ("front_left_tyre_pressure", f32), ("front_right_tyre_pressure", f32),
    ("ballast", u8), ("fuel_load", f32),
])
CAR_SETUPS = np.dtype([
    ("car_setups", CAR_SETUP, (NUM_CARS,)),
    ("next_front_wing_value", f32),
])

# --- 6 Car Telemetry --------------------------------------------------------
# Wheel arrays are ordered RL, RR, FL, FR.
CAR_TELEMETRY = np.dtype([
    ("speed", u16), ("throttle", f32), ("steer", f32), ("brake", f32),
    ("clutch", u8), ("gear", i8), ("engine_rpm", u16), ("drs", u8),
    ("rev_lights_percent", u8), ("rev_lights_bit_value", u16),
    ("brakes_temperature", u16, (4,)),
    ("tyres_surface_temperature", u8, (4,)),
    ("tyres_inner_temperature", u8, (4,)),
    ("engine_temperature", u16),
    ("tyres_pressure", f32, (4,)),
    ("surface_type", u8, (4,)),
])
TELEMETRY = np.dtype([
    ("car_telemetry_data", CAR_TELEMETRY, (NUM_CARS,)),
    ("mfd_panel_index", u8),
    ("mfd_panel_index_secondary_player", u8),
    ("suggested_gear", i8),
])

# --- 7 Car Status -----------------------------------------------------------
CAR_STATUS = np.dtype([
    ("traction_control", u8), ("anti_lock_brakes", u8), ("fuel_mix", u8),
    ("front_brake_bias", u8), ("pit_limiter_status", u8),
    ("fuel_in_tank", f32), ("fuel_capacity", f32), ("fuel_remaining_laps", f32),
    ("max_rpm", u16), ("idle_rpm", u16), ("max_gears", u8), ("drs_allowed", u8),
    ("drs_activation_distance", u16),
    ("actual_tyre_compound", u8), ("visual_tyre_compound", u8), ("tyres_age_laps", u8),
    ("vehicle_fia_flags", i8),
    ("engine_power_ice", f32), ("engine_power_mguk", f32),
    ("ers_store_energy", f32), ("ers_deploy_mode", u8),
    ("ers_harvested_this_lap_mguk", f32), ("ers_harvested_this_lap_mguh", f32),
    ("ers_deployed_this_lap", f32),
    ("network_paused", u8),
])
STATUS = np.dtype([("car_status_data", CAR_STATUS, (NUM_CARS,))])

# --- 8 Final Classification -------------------------------------------------
FINAL_CLASSIFICATION_DATA = np.dtype([
    ("position", u8), ("num_laps", u8), ("grid_position", u8), ("points", u8),
    ("num_pit_stops", u8), ("result_status", u8),
    ("best_lap_time_in_ms", u32), ("total_race_time", f64),
    ("penalties_time", u8), ("num_penalties", u8), ("num_tyre_stints", u8),
    ("tyre_stints_actual", u8, (8,)), ("tyre_stints_visual", u8, (8,)),
    ("tyre_stints_end_laps", u8, (8,)),
])
FINAL_CLASSIFICATION = np.dtype([
    ("num_cars", u8),
    ("classification_data", FINAL_CLASSIFICATION_DATA, (NUM_CARS,)),
])

# --- 9 Lobby Info -----------------------------------------------------------
LOBBY_INFO_DATA = np.dtype([
    ("ai_controlled", u8), ("team_id", u8), ("nationality", u8), ("platform", u8),
    ("name", "S48"), ("car_number", u8), ("your_telemetry", u8),
    ("show_online_names", u8), ("tech_level", u16), ("ready_status", u8),
])
LOBBY_INFO = np.dtype([
    ("num_players", u8),
    ("lobby_players", LOBBY_INFO_DATA, (NUM_CARS,)),
])

# --- 10 Car Damage ----------------------------------------------------------
CAR_DAMAGE_DATA = np.dtype([
    ("tyres_wear", f32, (4,)), ("tyres_damage", u8, (4,)), ("brakes_damage", u8, (4,)),
    ("front_left_wing_damage", u8), ("front_right_wing_damage", u8),
    ("rear_wing_damage", u8), ("floor_damage", u8), ("diffuser_damage", u8),
    ("sidepod_damage", u8), ("drs_fault", u8), ("ers_fault", u8),
    ("gear_box_damage", u8), ("engine_damage", u8),
    ("engine_mguh_wear", u8), ("engine_es_wear", u8), ("engine_ce_wear", u8),
    ("engine_ice_wear", u8), ("engine_mguk_wear", u8), ("engine_tc_wear", u8),
    ("engine_blown", u8), ("engine_seized", u8),
])
CAR_DAMAGE = np.dtype([("car_damage_data", CAR_DAMAGE_DATA, (NUM_CARS,))])

# --- 11 Session History -----------------------------------------------------
LAP_HISTORY_DATA = np.dtype([
    ("lap_time_in_ms", u32),
    ("sector1_time_ms_part", u16), ("sector1_time_minutes_part", u8),
    ("sector2_time_ms_part", u16), ("sector2_time_minutes_part", u8),
    ("sector3_time_ms_part", u16), ("sector3_time_minutes_part", u8),
    ("lap_valid_bit_flags", u8),  # 0x01 lap, 0x02 s1, 0x04 s2, 0x08 s3 valid
])
TYRE_STINT_HISTORY_DATA = np.dtype([
    ("end_lap", u8), ("tyre_actual_compound", u8), ("tyre_visual_compound", u8),
])
SESSION_HISTORY = np.dtype([
    ("car_idx", u8), ("num_laps", u8), ("num_tyre_stints", u8),
    ("best_lap_time_lap_num", u8), ("best_sector1_lap_num", u8),
    ("best_sector2_lap_num", u8), ("best_sector3_lap_num", u8),
    ("lap_history_data", LAP_HISTORY_DATA, (100,)),
    ("tyre_stints_history_data", TYRE_STINT_HISTORY_DATA, (8,)),
])

# --- 12 Tyre Sets -----------------------------------------------------------
TYRE_SET_DATA = np.dtype([
    ("actual_tyre_compound", u8), ("visual_tyre_compound", u8), ("wear", u8),
    ("available", u8), ("recommended_session", u8), ("life_span", u8),
    ("usable_life", u8), ("lap_delta_time", i16), ("fitted", u8),
])
TYRE_SETS = np.dtype([
    ("car_idx", u8),
    ("tyre_set_data", TYRE_SET_DATA, (20,)),
    ("fitted_idx", u8),
])

# --- 13 Motion Ex (player car only) -----------------------------------------
MOTION_EX = np.dtype([
    ("suspension_position", f32, (4,)), ("suspension_velocity", f32, (4,)),
    ("suspension_acceleration", f32, (4,)), ("wheel_speed", f32, (4,)),
    ("wheel_slip_ratio", f32, (4,)), ("wheel_slip_angle", f32, (4,)),
    ("wheel_lat_force", f32, (4,)), ("wheel_long_force", f32, (4,)),
    ("height_of_cog_above_ground", f32),
    ("local_velocity_x", f32), ("local_velocity_y", f32), ("local_velocity_z", f32),
    ("angular_velocity_x", f32), ("angular_velocity_y", f32), ("angular_velocity_z", f32),
    ("angular_acceleration_x", f32), ("angular_acceleration_y", f32),
    ("angular_acceleration_z", f32),
    ("front_wheels_angle", f32), ("wheel_vert_force", f32, (4,)),
    ("front_aero_height", f32), ("rear_aero_height", f32),
    ("front_roll_angle", f32), ("rear_roll_angle", f32), ("chassis_yaw", f32),
])

# --- 14 Time Trial ----------------------------------------------------------
TIME_TRIAL_DATA_SET = np.dtype([
    ("car_idx", u8), ("team_id", u8),
    ("lap_time_in_ms", u32), ("sector1_time_in_ms", u32),
    ("sector2_time_in_ms", u32), ("sector3_time_in_ms", u32),
    ("traction_control", u8), ("gearbox_assist", u8), ("anti_lock_brakes", u8),
    ("equal_car_performance", u8), ("custom_setup", u8), ("valid", u8),
])
TIME_TRIAL = np.dtype([
    ("player_session_best_data_set", TIME_TRIAL_DATA_SET),
    ("personal_best_data_set", TIME_TRIAL_DATA_SET),
    ("rival_data_set", TIME_TRIAL_DATA_SET),
])

# packet id -> (name, body dtype)
PACKETS: dict[int, tuple[str, np.dtype]] = {
    0: ("motion", MOTION),
    1: ("session", SESSION),
    2: ("lap_data", LAP),
    3: ("event", EVENT),
    4: ("participants", PARTICIPANTS),
    5: ("car_setups", CAR_SETUPS),
    6: ("car_telemetry", TELEMETRY),
    7: ("car_status", STATUS),
    8: ("final_classification", FINAL_CLASSIFICATION),
    9: ("lobby_info", LOBBY_INFO),
    10: ("car_damage", CAR_DAMAGE),
    11: ("session_history", SESSION_HISTORY),
    12: ("tyre_sets", TYRE_SETS),
    13: ("motion_ex", MOTION_EX),
    14: ("time_trial", TIME_TRIAL),
}

# Datagram sizes (header included) from the F1 24 specification.
SIZES = {
    0: 1349, 1: 753, 2: 1285, 3: 45, 4: 1350, 5: 1133, 6: 1352, 7: 1239,
    8: 1020, 9: 1306, 10: 953, 11: 1460, 12: 231, 13: 237, 14: 101,
}
