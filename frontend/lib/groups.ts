export type GroupRound = { track_id: number; pista: string; hasta: string | null };
export type GroupRow = { id: number; nombre: string; miembros: number; admin: boolean; fecha: GroupRound | null };
export type GroupTrack = {
  track_id: number;
  pista: string;
  juego: number;
  juego_nombre: string | null;
  categoria: string;
  clima: string;
  pilotos: number;
  lider: { nombre: string; tiempo_ms: number; soy_yo: boolean };
  mi_pos: number | null;
};
export type GroupDetail = {
  id: number;
  nombre: string;
  codigo: string;
  admin: boolean;
  fecha: GroupRound | null;
  miembros: { id: number; nombre: string; admin: boolean; soy_yo: boolean }[];
  pistas: GroupTrack[];
};

/** The link that opens the join screen for a group's code. */
export const joinLink = (code: string) => `${typeof window !== "undefined" ? window.location.origin : ""}/grupos/unirse/${code}`;
