/** Types and helpers for the BOX tab (GET /api/sessions/{id}/box and /box/compare). */

export type SetupValues = Record<string, number | Record<string, number>>;

export type BoxLap = {
  car: number;
  vuelta: number;
  tiempo_s: number | null;
  sectores_s: (number | null)[] | null;
  valida: boolean;
  box: boolean;
  mejor: boolean;
  cobertura: number;
  reglaje: string | null;
  compuesto: string | null;
  edad_gomas: number | null;
  combustible_kg: number | null;
  temp_pista: number | null;
  clima: string | null;
  problemas_por_curva: Record<string, string[]>;
};

export type BoxRef = {
  car: number;
  lap: number;
  piloto: string | null;
  equipo: string | null;
  tiempo_s: number | null;
  cobertura: number;
};

export type BoxCorner = { curva: number; sector: number; entrada_m: number; apex_m: number; salida_m: number };

export type SetupSuggestion = {
  problema: string;
  evidencia: string;
  parametro: string;
  valor_actual: number;
  valor_sugerido: number;
  efecto: string;
  compromiso: string;
  confianza: "alta" | "media";
};

export type Run = {
  tanda: number;
  vueltas: number[];
  vueltas_limpias: number[];
  reglaje: string | null;
  mejor_vuelta: number | null;
  mejor_vuelta_s: number | null;
  problemas_pct: Record<string, number>;
  gomas: {
    temp_superficie_del_c: number;
    temp_superficie_tras_c: number;
    desgaste_por_vuelta_del_pct: number | null;
    desgaste_por_vuelta_tras_pct: number | null;
  } | null;
  velocidad_punta: { tuya_kmh: number; rivales_kmh: number } | null;
  sugerencias_reglaje: SetupSuggestion[];
  conduccion: { curva: number; problema: string; texto: string }[];
  nota?: string;
  contra_tanda_anterior?: {
    cambios_de_reglaje: { parametro: string; antes: number; despues: number }[];
    mejor_vuelta_diferencia_s: number | null;
    problemas_antes_pct: Record<string, number>;
  };
};

export type BoxOverview = {
  sesion: { id: number; pista: string | null; track_id: number | null; tipo: string | null; inicio: string; en_curso: boolean };
  largo_pista_m: number | null;
  sectores_m: number[] | null;
  vueltas: BoxLap[];
  reglajes: { id: string; valores: SetupValues; vueltas: number[] }[];
  referencias: BoxRef[];
  curvas: BoxCorner[];
  tandas: Run[];
};

export type Trace = {
  car: number;
  lap: number;
  time_s: number | null;
  coverage: number;
  bin_m: number;
  speed: (number | null)[];
  throttle: (number | null)[];
  brake: (number | null)[];
  gear: (number | null)[];
  times: [number, number][]; // [lap distance m, lap time ms]
};

export type CornerSide = {
  frena_en_m: number | null;
  velocidad_minima_kmh: number | null;
  acelera_a_fondo_en_m: number | null;
  tiempo_s: number | null;
  muestras: number;
  problemas: string[] | null;
};

export type CornerRow = BoxCorner & {
  a: CornerSide;
  b: CornerSide;
  diferencia_s: number | null;
  b_frena_mas_tarde_m: number | null;
  b_velocidad_minima_kmh: number | null;
  b_acelera_mas_tarde_m: number | null;
};

export type Comparison = {
  a: BoxRef & { es_el_jugador: boolean };
  b: BoxRef & { es_el_jugador: boolean };
  diferencia_s: number | null;
  curvas: CornerRow[];
  traza_a: Trace;
  traza_b: Trace;
};

/** A lap is addressed as "car:lap" in the API. */
export const lapKey = (car: number, lap: number) => `${car}:${lap}`;

const MAX_TIME_GAP_M = 120;

/** Lap time in seconds at distance d, or null across a hole in the data. */
export function timeAt(times: [number, number][], d: number): number | null {
  if (times.length < 2 || d < times[0][0] || d > times[times.length - 1][0]) return null;
  let lo = 0;
  let hi = times.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid][0] <= d) lo = mid;
    else hi = mid;
  }
  const [d0, t0] = times[lo];
  const [d1, t1] = times[hi];
  if (d1 - d0 > MAX_TIME_GAP_M) return null;
  return (d1 > d0 ? t0 + ((t1 - t0) * (d - d0)) / (d1 - d0) : t0) / 1000;
}

/** Per bin: time of `mine` minus time of `ref` at the same distance (positive = mine is behind). */
export function deltaTrace(mine: Trace, ref: Trace): (number | null)[] {
  return mine.speed.map((_, i) => {
    const d = i * mine.bin_m + mine.bin_m / 2;
    const a = timeAt(mine.times, d);
    const b = timeAt(ref.times, d);
    return a == null || b == null ? null : a - b;
  });
}

export const COMPOUND_ES: Record<string, string> = {
  Soft: "Blandos",
  Medium: "Medios",
  Hard: "Duros",
  Intermediate: "Intermedios",
  Wet: "Lluvia",
};

export const ISSUE_ES: Record<string, string> = {
  bloqueo_delantero: "bloqueo adelante",
  bloqueo_trasero: "bloqueo atrás",
  patinaje_traccion: "patina al salir",
  sobreviraje: "se va de cola",
  subviraje: "no gira (subviraje)",
  fuera_de_pista: "fuera de pista",
};

export const SETUP_ES: [string, string, string?][] = [
  ["aleron_delantero", "Alerón delantero"],
  ["aleron_trasero", "Alerón trasero"],
  ["diferencial_acelerando_pct", "Diferencial acelerando", "%"],
  ["diferencial_soltando_pct", "Diferencial soltando", "%"],
  ["camber_del", "Camber delantero", "°"],
  ["camber_tras", "Camber trasero", "°"],
  ["convergencia_del", "Convergencia delantera", "°"],
  ["convergencia_tras", "Convergencia trasera", "°"],
  ["suspension_del", "Suspensión delantera"],
  ["suspension_tras", "Suspensión trasera"],
  ["barra_antivuelco_del", "Barra antivuelco delantera"],
  ["barra_antivuelco_tras", "Barra antivuelco trasera"],
  ["altura_del", "Altura delantera"],
  ["altura_tras", "Altura trasera"],
  ["presion_frenos_pct", "Presión de frenos", "%"],
  ["reparto_frenada_pct", "Reparto de frenada", "%"],
  ["freno_motor_pct", "Freno motor", "%"],
  ["lastre", "Lastre"],
];

export const PRESSURE_ES: [string, string][] = [
  ["del_izq", "Presión del. izq."],
  ["del_der", "Presión del. der."],
  ["tras_izq", "Presión tras. izq."],
  ["tras_der", "Presión tras. der."],
];

const num = (v: number, digits = 2) => v.toLocaleString("es-AR", { maximumFractionDigits: digits });

/**
 * What the corner says about the player's lap (B) against the reference (A),
 * in plain words: where the time goes and the visible cause.
 */
export function cornerAdvice(row: CornerRow): string[] {
  const out: string[] = [];
  const brake = row.b_frena_mas_tarde_m;
  if (brake != null && Math.abs(brake) >= 10) {
    out.push(brake < 0 ? `frenás ${num(-brake, 0)} m antes` : `frenás ${num(brake, 0)} m más tarde`);
  }
  const vmin = row.b_velocidad_minima_kmh;
  if (vmin != null && Math.abs(vmin) >= 3) {
    out.push(vmin < 0 ? `pasás ${num(-vmin, 0)} km/h más lento por el vértice` : `pasás ${num(vmin, 0)} km/h más rápido por el vértice`);
  }
  const thr = row.b_acelera_mas_tarde_m;
  if (thr != null && Math.abs(thr) >= 15) {
    out.push(thr > 0 ? `acelerás a fondo ${num(thr, 0)} m más tarde` : `acelerás a fondo ${num(-thr, 0)} m antes`);
  }
  for (const p of row.b.problemas ?? []) out.push(ISSUE_ES[p] ?? p);
  return out;
}

export function secondsText(s: number, sign = true): string {
  const v = num(Math.abs(s), 3);
  if (!sign) return `${v} s`;
  return `${s > 0 ? "+" : s < 0 ? "−" : ""}${v} s`;
}

const PARAM_EXTRA: Record<string, string> = {
  presion_del: "Presión delanteras",
  presion_tras: "Presión traseras",
  presion_del_izq: "Presión del. izq.",
  presion_del_der: "Presión del. der.",
  presion_tras_izq: "Presión tras. izq.",
  presion_tras_der: "Presión tras. der.",
  combustible_kg: "Combustible",
};

export function paramName(key: string): string {
  return SETUP_ES.find(([k]) => k === key)?.[1] ?? PARAM_EXTRA[key] ?? key;
}

export function paramValue(key: string, v: number | null | undefined): string {
  if (v == null) return "—";
  const unit = key.startsWith("presion_") && !key.startsWith("presion_frenos") ? " psi" : (SETUP_ES.find(([k]) => k === key)?.[2] ?? "");
  return `${v.toLocaleString("es-AR", { maximumFractionDigits: 2 })}${unit}`;
}
