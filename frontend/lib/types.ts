// Mirrors backend/app/live/snapshot.py. Every section is optional: a lossy
// console link means some packets may not have arrived yet.

export type Wheels = { rear_left: number; rear_right: number; front_left: number; front_right: number };
export type WheelSurfaces = { rear_left: string | null; rear_right: string | null; front_left: string | null; front_right: string | null };

export type Snapshot = {
  session_uid: string;
  packet_format: number;
  link: { reception: number | null; source: string | null; packets: number; rejected: number };
  session?: {
    age_s: number | null;
    track: string;
    type: string;
    weather: string;
    track_temperature_c: number;
    air_temperature_c: number;
    total_laps: number;
    time_left_s: number;
    safety_car: string;
    online: boolean;
    paused: boolean;
    pit_window_ideal_lap: number | null;
    pit_window_latest_lap: number | null;
    forecast: { in_minutes: number; weather: string; rain_percent: number }[];
    marshal_zones: { inicio_pct: number; bandera: string | null }[];
    // 2026 format only.
    active_aero_zones?: { inicio_pct: number; fin_pct: number; tipo: "total" | "parcial" }[];
    drs_zones?: { inicio_pct: number; fin_pct: number }[];
    start_reaction_s?: number | null;
  };
  driver?: { name: string; team: string; race_number: number; cars_in_session: number; livery_color: string | null };
  lap?: {
    age_s: number | null;
    position: number;
    lap: number;
    current_lap_ms: number;
    last_lap_ms: number | null;
    sector: number;
    sector1_ms: number | null;
    sector2_ms: number | null;
    gap_ahead_ms: number;
    gap_leader_ms: number;
    lap_distance_m: number;
    lap_invalid: boolean;
    pit: string;
    pit_stops: number;
    penalties_s: number;
    warnings: number;
    grid_position: number;
    /** Against the best complete clean lap of the session at the same point; null = no reference yet. */
    delta_best_ms: number | null;
    delta_reference_lap: number | null;
  };
  relatives?: { ahead: RelativeRow[]; behind: RelativeRow[] };
  /** Race only: catch forecasts against the cars right ahead and behind in position. */
  pace?: { my_pace_s: number | null; ahead: PaceSide | null; behind: PaceSide | null };
  sector_review?: SectorReviewRow[];
  car?: {
    age_s: number | null;
    speed_kmh: number;
    gear: number;
    rpm: number;
    throttle: number;
    brake: number;
    steer: number;
    drs_open: boolean;
    suggested_gear: number | null;
    rev_lights_percent: number;
    engine_temperature_c: number;
    brakes_temperature_c: Wheels;
    tyres_surface_temperature_c: Wheels;
    tyres_inner_temperature_c: Wheels;
    tyres_pressure_psi: Wheels;
    surface: WheelSurfaces;
  };
  status?: {
    age_s: number | null;
    fuel_kg: number;
    fuel_capacity_kg: number;
    fuel_remaining_laps: number;
    fuel_mix: string;
    tyre: string;
    tyre_compound: string;
    tyre_age_laps: number;
    ers_percent: number;
    ers_mode: string;
    drs_allowed: boolean;
    brake_bias: number;
    max_rpm: number;
    fia_flag: string | null;
    ers_deployed_lap_mj: number;
    ers_harvested_lap_mj: number;
    ers_harvest_limit_mj: number | null; // 2026 format only
  };
  motion?: {
    age_s: number | null;
    g_lateral: number;
    g_longitudinal: number;
    g_vertical: number;
    yaw: number;
    pitch: number;
    roll: number;
  };
  damage?: {
    age_s: number | null;
    tyres_wear_percent: Wheels;
    front_left_wing: number;
    front_right_wing: number;
    rear_wing: number;
    floor: number;
    diffuser: number;
    sidepod: number;
    gearbox: number;
    engine: number;
    drs_fault: boolean;
    ers_fault: boolean;
    tyre_blisters_percent: Wheels | null; // 2025 format onwards
  };
  // 2026 regulations (CarTelemetry2), only in the 2026 packet format.
  aero?: {
    age_s: number | null;
    regulations_2026: boolean;
    active_aero_mode: "corner" | "straight";
    active_aero_available: boolean;
    active_aero_in_m: number | null;
    overtake_available: boolean;
    overtake_active: boolean;
    overtake_in_m: number | null;
    wrong_way: boolean;
  };
  track?: {
    id: number;
    length_m: number;
    sector2_m: number;
    sector3_m: number;
    layout_coverage: number;
    layout_ready: boolean;
  } | null;
  cars?: CarRow[];
  events: ({ code: string; session_time: number } & Record<string, number | string>)[];
};

export type RelativeRow = {
  index: number;
  distance_m: number;
  gap_s: number | null;
  /** True when the gap is distance over lap pace, not measured from the car's trace. */
  estimated: boolean;
  /** lapped: a lap or more down on the player; lapping: a lap or more up. */
  relation: "lapped" | "lapping" | null;
  pit: boolean;
};

export type PaceSide = {
  index: number;
  gap_s: number | null;
  pace_s: number | null;
  state: "waiting" | "stable" | "opening" | "catching" | "after_finish";
  closing_s_per_lap: number | null;
  laps_to_catch: number | null;
};

export type SectorReviewRow = {
  lap: number;
  time_ms: number;
  sectors_ms: number[];
  valid: boolean;
  clean: boolean;
  reference_lap: number | null;
  sector_deltas_ms: (number | null)[] | null;
};

export type CarRow = {
  index: number;
  is_player: boolean;
  position: number;
  lap: number;
  lap_distance_m: number;
  gap_ahead_ms: number;
  gap_leader_ms: number;
  last_lap_ms: number | null;
  best_lap_ms: number | null;
  pit: string;
  pit_stops: number;
  penalties_s: number;
  result: string;
  name: string | null;
  team: string | null;
  team_id: number | null;
  race_number: number | null;
  ai: boolean | null;
  tyre: string | null;
  tyre_age_laps: number | null;
  x: number | null;
  z: number | null;
  color: string | null; // the game's livery colour (2025 format onwards)
  overtake_active: boolean | null; // 2026 format only
  active_aero_mode: "corner" | "straight" | null;
};

export type TrackLayout = {
  track_id: number;
  length_m: number;
  coverage: number;
  ready: boolean;
  segments: [number, number][][];
};

export type EngineerMessage = {
  id: number;
  session_time: number;
  lap: number | null;
  triggers: string[];
  provider: string;
  latency_ms: number;
  cost_usd: number;
  radio: string | null;
  prioridad: "info" | "importante" | "urgente";
  estrategia: {
    plan: string;
    vuelta_box: number | null;
    ventana_box: number[] | null;
    proximo_compuesto: string | null;
    alternativa: string;
    certeza: "baja" | "media" | "alta";
  };
  manejo: string[];
  reglaje: { parametro: string; cambio: string; motivo: string }[];
  analisis: string;
};

export type EngineerState = {
  active: boolean;
  provider: string | null;
  messages: EngineerMessage[];
};
