export type Product = { id: "suscripcion" | "paquete5" | "paquete12"; titulo: string; usd: number; ars: number; carreras: number };
export type Billing = {
  plan: "gratis" | "suscripcion" | "cortesia";
  hasta: string | null;
  renovacion: string | null;
  creditos: number;
  /** Pro races left from the new-account trial. */
  prueba: number;
  carreras_mes: { incluidas: number; usadas: number };
  /** The alert radio's races this month; incluidas null = no limit. */
  avisos_mes: { incluidas: number | null; usadas: number };
  limites: boolean;
  puede: { ingeniero_ia: boolean; radio: boolean; mcp: boolean; pantallas: number | null };
  productos: Product[];
  carreras_por_mes: number;
  avisos_por_mes: number;
  prueba_inicial: number;
  minutos_por_carrera: number;
  pagos: "mercadopago" | "simulado" | null;
  /** A subscription checkout was started and not confirmed yet. */
  suscripcion_pendiente: boolean;
};


/** Pro races the account can use now (subscription's month, trial and packs); null = no limit. */
export function proRaces(b: Billing): number | null {
  if (b.plan === "cortesia") return null;
  return b.creditos + b.prueba + Math.max(0, b.carreras_mes.incluidas - b.carreras_mes.usadas);
}

/** The plans' names as players see them. */
export const PLAN_NAMES: Record<Billing["plan"], string> = { gratis: "Debut", suscripcion: "Temporada", cortesia: "Pase libre" };

const left = (n: number) => `${n} ${n === 1 ? "carrera" : "carreras"}`;

/** One plain line: what the player has left. */
export function planLine(b: Billing): string {
  if (b.plan === "cortesia" || !b.limites) return "Todo incluido: el ingeniero Pro en todas tus carreras.";
  const pro = proRaces(b) ?? 0;
  const radio = b.avisos_mes.incluidas == null ? null : Math.max(0, b.avisos_mes.incluidas - b.avisos_mes.usadas);
  const proText = pro > 0 ? `Te quedan ${left(pro)} con el ingeniero Pro` : "No te quedan carreras con el ingeniero Pro";
  if (radio == null) return `${proText}. La radio de avisos está en todas tus carreras.`;
  return `${proText} y ${left(radio)} con radio de avisos este mes.`;
}
