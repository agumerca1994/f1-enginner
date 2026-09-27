// Mirrors backend/app/live/snapshot.py. Every section is optional: a lossy
// console link means some packets may not have arrived yet.

export type Wheels = { rear_left: number; rear_right: number; front_left: number; front_right: number };

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
  };
  driver?: { name: string; team: string; race_number: number; cars_in_session: number };
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
  };
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
