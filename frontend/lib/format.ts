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
