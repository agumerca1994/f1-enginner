"use client";

import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

/** A piece placed on the grid, in whole cells from the top-left corner. */
export type Piece = { id: string; kind: PieceKind; x: number; y: number; w: number; h: number };
/** `aspect` is the screen's width over height, so the editor draws it like the real thing. */
export type Cockpit = { id: string; name: string; cols: number; rows: number; aspect?: number; pieces: Piece[] };

export const SCREENS: { name: string; aspect: number }[] = [
  { name: "Celular acostado", aspect: 2.16 },
  { name: "Celular parado", aspect: 0.46 },
  { name: "Tablet", aspect: 1.33 },
  { name: "Monitor o tele", aspect: 1.78 },
  { name: "Monitor ultra ancho", aspect: 2.37 },
];

export type PieceKind =
  | "marcha" | "luces" | "delta" | "tiempos" | "posicion" | "rivales" | "tabla" | "mapa"
  | "gomas" | "energia" | "combustible" | "danos" | "clima" | "pedales" | "radio" | "aero";

/** "apaisada": never taller than wide; "vertical": never wider than tall; "fina": one row high. */
export type Shape = "libre" | "apaisada" | "vertical" | "fina";

export type PieceSpec = {
  name: string;
  group: "Manejo" | "Tiempos" | "Rivales" | "Auto" | "Pista" | "Ingeniero";
  description: string;
  initial: [number, number];
  min: [number, number];
  shape: Shape;
  /** What it adds as it grows, for the editor. */
  sizes: { at: [number, number]; or?: [number, number]; shows: string }[];
};

export const PIECES: Record<PieceKind, PieceSpec> = {
  marcha: { name: "Marcha y velocidad", group: "Manejo", description: "La marcha en grande, la velocidad y las vueltas del motor.", initial: [2, 3], min: [1, 1], shape: "libre",
    sizes: [{ at: [1, 1], shows: "La marcha" }, { at: [2, 2], shows: "Marcha y velocidad" }, { at: [2, 3], shows: "Más las vueltas del motor" }] },
  luces: { name: "Luces de cambio", group: "Manejo", description: "Las luces del volante. Llegan unas cinco veces por segundo: son una guía.", initial: [8, 1], min: [3, 1], shape: "fina",
    sizes: [{ at: [3, 1], shows: "Las 15 luces" }] },
  delta: { name: "Delta", group: "Tiempos", description: "Cuánto ganás o perdés contra tu mejor vuelta, en el mismo punto de la pista.", initial: [3, 2], min: [2, 1], shape: "apaisada",
    sizes: [{ at: [2, 1], shows: "Solo el número" }, { at: [3, 2], shows: "Más la barra y la vuelta en curso" }, { at: [6, 2], shows: "Más cada sector" }] },
  tiempos: { name: "Tiempos y sectores", group: "Tiempos", description: "La vuelta en curso, la última, la mejor y cada sector.", initial: [4, 2], min: [2, 1], shape: "apaisada",
    sizes: [{ at: [2, 1], shows: "La vuelta en curso" }, { at: [4, 2], shows: "Más los tres sectores, la última y la mejor" }] },
  posicion: { name: "Posición y vuelta", group: "Tiempos", description: "Tu posición y la vuelta, o el tiempo que queda.", initial: [2, 1], min: [1, 1], shape: "libre",
    sizes: [{ at: [1, 1], shows: "La posición" }, { at: [2, 1], shows: "Posición y vuelta" }, { at: [2, 2], shows: "Más lo que ganaste o perdiste desde la largada" }] },
  rivales: { name: "Alrededor tuyo", group: "Rivales", description: "Los autos más cerca tuyo en la pista. Rojo si te atacan a menos de medio segundo.", initial: [3, 4], min: [2, 1], shape: "libre",
    sizes: [{ at: [2, 1], shows: "El que más importa: el que te ataca o el que tenés adelante" }, { at: [2, 2], shows: "El de adelante y el de atrás" }, { at: [3, 3], shows: "Cinco autos" }, { at: [3, 4], shows: "Siete autos y en cuántas vueltas lo alcanzás" }] },
  tabla: { name: "Tabla de posiciones", group: "Rivales", description: "Todos los autos, con su diferencia, gomas y paradas.", initial: [4, 6], min: [3, 3], shape: "vertical",
    sizes: [{ at: [3, 3], shows: "Los que están cerca tuyo" }, { at: [4, 6], shows: "Toda la tabla, con gomas" }] },
  mapa: { name: "Mapa", group: "Pista", description: "El circuito con todos los autos y las curvas numeradas.", initial: [3, 3], min: [2, 2], shape: "libre",
    sizes: [{ at: [2, 2], shows: "Trazado y autos" }, { at: [3, 3], shows: "Más las curvas numeradas" }] },
  gomas: { name: "Gomas", group: "Auto", description: "Temperatura y vida de cada goma, dibujadas sobre el auto.", initial: [2, 3], min: [2, 2], shape: "libre",
    sizes: [{ at: [2, 2], shows: "Solo el color" }, { at: [2, 3], or: [3, 2], shows: "Temperatura y vida" }, { at: [4, 3], shows: "Más presión, frenos, ampollas y compuesto" }] },
  energia: { name: "Energía", group: "Auto", description: "Batería, modo de despliegue y lo que cosechaste esta vuelta.", initial: [2, 2], min: [1, 1], shape: "libre",
    sizes: [{ at: [1, 1], shows: "El porcentaje" }, { at: [2, 2], shows: "Más el modo y la cosecha" }] },
  combustible: { name: "Combustible", group: "Auto", description: "Vueltas de más o de menos con lo que te queda.", initial: [2, 1], min: [1, 1], shape: "libre",
    sizes: [{ at: [1, 1], shows: "Vueltas de margen" }, { at: [2, 2], shows: "Más los kilos y la mezcla" }] },
  danos: { name: "Daños", group: "Auto", description: "Alerones, piso y motor. Se ilumina si algo se rompe.", initial: [2, 2], min: [1, 1], shape: "libre",
    sizes: [{ at: [1, 1], shows: "La peor parte" }, { at: [2, 2], shows: "Cada parte" }] },
  clima: { name: "Clima", group: "Pista", description: "Cómo está y el pronóstico de lluvia.", initial: [2, 1], min: [1, 1], shape: "libre",
    sizes: [{ at: [2, 1], shows: "Ahora y en 10 minutos" }, { at: [3, 2], shows: "El pronóstico completo" }] },
  pedales: { name: "Pedales", group: "Manejo", description: "Acelerador y freno.", initial: [1, 2], min: [1, 1], shape: "vertical",
    sizes: [{ at: [1, 2], shows: "Acelerador y freno" }] },
  radio: { name: "Radio", group: "Ingeniero", description: "Lo último que dijo el ingeniero y el botón para hablarle.", initial: [4, 2], min: [3, 1], shape: "apaisada",
    sizes: [{ at: [3, 1], shows: "La última frase" }, { at: [4, 2], shows: "Más la anterior y los botones" }] },
  aero: { name: "Aerodinámica activa", group: "Auto", description: "Reglamento 2026: modo del alerón y adelantamiento.", initial: [2, 1], min: [1, 1], shape: "libre",
    sizes: [{ at: [2, 1], shows: "Modo y adelantamiento disponible" }] },
};

let seq = 0;
export const pieceId = () => `p${Date.now().toString(36)}${(seq++).toString(36)}`;
const P = (kind: PieceKind, x: number, y: number, w: number, h: number): Piece => ({ id: `${kind}-${x}-${y}`, kind, x, y, w, h });

export const TEMPLATES: Cockpit[] = [
  { id: "volante", name: "Arriba del volante", cols: 8, rows: 4, aspect: 2.16, pieces: [
    P("luces", 0, 0, 8, 1), P("marcha", 0, 1, 2, 3), P("delta", 2, 1, 4, 2), P("gomas", 6, 1, 2, 3), P("posicion", 2, 3, 2, 1), P("rivales", 4, 3, 2, 1),
  ] },
  { id: "monitor", name: "Segundo monitor", cols: 12, rows: 6, aspect: 1.78, pieces: [
    P("mapa", 0, 0, 4, 4), P("delta", 4, 0, 4, 2), P("tiempos", 4, 2, 4, 2), P("rivales", 8, 0, 4, 4),
    P("gomas", 0, 4, 3, 2), P("energia", 3, 4, 2, 2), P("combustible", 5, 4, 2, 1), P("clima", 5, 5, 2, 1), P("radio", 7, 4, 5, 2),
  ] },
  { id: "celular", name: "Celular vertical", cols: 4, rows: 7, aspect: 0.46, pieces: [
    P("posicion", 0, 0, 2, 1), P("combustible", 2, 0, 2, 1), P("delta", 0, 1, 4, 2), P("rivales", 0, 3, 2, 2), P("gomas", 2, 3, 2, 2), P("tiempos", 0, 5, 4, 2),
  ] },
  { id: "tele", name: "Tele", cols: 12, rows: 6, aspect: 1.78, pieces: [P("tabla", 0, 0, 7, 6), P("mapa", 7, 0, 5, 4), P("clima", 7, 4, 5, 2)] },
];

/** Keeps a piece inside the grid and true to its minimum size and shape. */
export function fit(p: Piece, cols: number, rows: number): Piece {
  const spec = PIECES[p.kind];
  let w = Math.max(spec.min[0], Math.min(p.w, cols));
  let h = Math.max(spec.min[1], Math.min(p.h, rows));
  if (spec.shape === "fina") h = 1;
  if (spec.shape === "apaisada" && h > w) h = w;
  if (spec.shape === "vertical" && w > h) w = Math.max(spec.min[0], h);
  const x = Math.max(0, Math.min(p.x, cols - w));
  const y = Math.max(0, Math.min(p.y, rows - h));
  return { ...p, x, y, w, h };
}

export function overlaps(a: Piece, b: Piece): boolean {
  return a.id !== b.id && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** The first free spot for a new piece of this size, or null if the grid is full. */
export function freeSpot(c: Cockpit, w: number, h: number): { x: number; y: number } | null {
  for (let y = 0; y + h <= c.rows; y++)
    for (let x = 0; x + w <= c.cols; x++) {
      const probe = { id: "_", kind: "posicion" as PieceKind, x, y, w, h };
      if (!c.pieces.some((p) => overlaps(probe, p))) return { x, y };
    }
  return null;
}

/** The largest variant a piece reaches at its size (index into its spec's sizes). */
export function sizeLevel(p: Pick<Piece, "kind" | "w" | "h">): number {
  const sizes = PIECES[p.kind].sizes;
  let level = 0;
  sizes.forEach((s, i) => {
    if ((p.w >= s.at[0] && p.h >= s.at[1]) || (s.or && p.w >= s.or[0] && p.h >= s.or[1])) level = i;
  });
  return level;
}

const LOCAL_KEY = "cockpits";
const CHOSEN_KEY = "cockpit-elegido";

/** The player's cockpits: kept in their account (shared by every screen), the templates until they make one. */
export function useCockpits() {
  const { credentials } = useAuth();
  const [cockpits, setCockpits] = useState<Cockpit[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await api<{ cockpits: Cockpit[] }>("/api/screens/cockpits", await credentials());
        if (!cancelled) setCockpits(r.cockpits.length ? r.cockpits : TEMPLATES);
      } catch {
        let local: Cockpit[] | null = null;
        try {
          local = JSON.parse(localStorage.getItem(LOCAL_KEY) || "null");
        } catch {}
        if (!cancelled) setCockpits(local?.length ? local : TEMPLATES);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [credentials]);

  const save = useCallback(
    async (next: Cockpit[]) => {
      setCockpits(next);
      try {
        localStorage.setItem(LOCAL_KEY, JSON.stringify(next));
      } catch {}
      await api("/api/screens/cockpits", await credentials(), { method: "PUT", body: { cockpits: next } });
    },
    [credentials],
  );

  return { cockpits, save };
}

/** Which cockpit this device shows: the one picked here, else the one that suits its screen. */
export function chosenCockpit(cockpits: Cockpit[]): Cockpit {
  let id: string | null = null;
  try {
    id = localStorage.getItem(CHOSEN_KEY);
  } catch {}
  const picked = cockpits.find((c) => c.id === id);
  if (picked) return picked;
  const w = typeof window !== "undefined" ? window.innerWidth : 1440;
  const h = typeof window !== "undefined" ? window.innerHeight : 900;
  const want = w < 700 && h > w ? "celular" : w < 1000 ? "volante" : "monitor";
  return cockpits.find((c) => c.id === want) ?? cockpits[0];
}

export function chooseCockpit(id: string) {
  try {
    localStorage.setItem(CHOSEN_KEY, id);
  } catch {}
}
