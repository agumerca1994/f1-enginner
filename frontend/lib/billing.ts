export type Product = { id: "suscripcion" | "paquete5" | "paquete12"; titulo: string; usd: number; ars: number; carreras: number };
export type Billing = {
  plan: "gratis" | "suscripcion" | "cortesia";
  hasta: string | null;
  renovacion: string | null;
  creditos: number;
  carreras_mes: { incluidas: number; usadas: number };
  limites: boolean;
  puede: { ingeniero_ia: boolean; mcp: boolean; pantallas: number | null };
  productos: Product[];
  carreras_por_mes: number;
  minutos_por_carrera: number;
  pagos: "mercadopago" | "simulado" | null;
};

