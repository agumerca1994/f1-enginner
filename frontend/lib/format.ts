export function lapTime(ms: number | null | undefined): string {
  if (ms == null || ms <= 0) return "—";
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const t = ms % 1000;
  return `${m}:${String(s).padStart(2, "0")}.${String(t).padStart(3, "0")}`;
}

export function gap(ms: number | null | undefined): string {
  if (ms == null || ms <= 0) return "—";
  return `+${(ms / 1000).toFixed(3)}`;
}

/** 0 = fine, 1 = watch, 2 = act. */
export type Level = 0 | 1 | 2;

export function levelClass(level: Level): string {
  return level === 2 ? "text-danger" : level === 1 ? "text-warn" : "text-ok";
}

export function wearLevel(percent: number): Level {
  return percent >= 60 ? 2 : percent >= 40 ? 1 : 0;
}

export function damageLevel(percent: number): Level {
  return percent >= 50 ? 2 : percent >= 20 ? 1 : 0;
}

/** Tyre surface temperature window for dry compounds, roughly 80–105 °C. */
export function tyreTempLevel(c: number): Level {
  return c > 115 || c < 65 ? 2 : c > 105 || c < 80 ? 1 : 0;
}

export const EVENT_LABELS: Record<string, string> = {
  SSTA: "Inicio de sesión",
  SEND: "Fin de sesión",
  FTLP: "Vuelta rápida",
  RTMT: "Abandono",
  DRSE: "DRS habilitado",
  DRSD: "DRS deshabilitado",
  TMPT: "Compañero en boxes",
  CHQF: "Bandera a cuadros",
  RCWN: "Ganador",
  PENA: "Penalización",
  SPTP: "Trampa de velocidad",
  STLG: "Luces de largada",
  LGOT: "¡Largada!",
  DTSV: "Drive-through cumplido",
  SGSV: "Stop & go cumplido",
  FLBK: "Flashback",
  RDFL: "Bandera roja",
  OVTK: "Adelantamiento",
  SCAR: "Safety car",
  COLL: "Choque",
};

export const WEATHER_ES: Record<string, string> = {
  Clear: "Despejado",
  "Light cloud": "Algo nublado",
  Overcast: "Nublado",
  "Light rain": "Lluvia leve",
  "Heavy rain": "Lluvia fuerte",
  Storm: "Tormenta",
};

/** Fill colour for a tyre from its surface temperature: cold blue, in window green, hot amber/red. */
export function tyreTempColor(c: number): string {
  if (c < 65) return "#3b82f6";
  if (c < 80) return "#38bdf8";
  if (c <= 105) return "#34d399";
  if (c <= 115) return "#fbbf24";
  return "#f43f5e";
}

/** Brake discs work roughly between 400 and 900 °C. */
export function brakeTempColor(c: number): string {
  if (c < 300) return "#3b82f6";
  if (c <= 900) return "#34d399";
  if (c <= 1050) return "#fbbf24";
  return "#f43f5e";
}

/** Part colour by damage: untouched parts stay neutral so damage stands out. */
export function damageColor(percent: number): string {
  if (percent <= 0) return "#2a3441";
  if (percent < 20) return "#7c6a2a";
  if (percent < 50) return "#fbbf24";
  return "#f43f5e";
}
