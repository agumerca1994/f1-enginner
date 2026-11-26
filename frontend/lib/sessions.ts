"use client";

import { useEffect, useRef, useState } from "react";

import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { SetupSuggestion } from "@/lib/box";

export type GameSession = {
  id: number;
  session_uid: string;
  track: string | null;
  track_id: number | null;
  session_type: string | null;
  total_laps: number | null;
  started_at: string;
  ended_at: string | null;
  has_recording: boolean;
};

export type Loss = { curva: number; sector: number; apex_m: number; perdida_s: number; texto: string; vuelta: number; referencia: { car: number; lap: number } };
export type Driving = { curva: number; problema: string; texto: string };

export type RunReport = {
  tanda: number;
  vueltas: { vuelta: number; tiempo_s: number | null; valida: boolean; mejor: boolean }[];
  mejor_vuelta: number | null;
  mejor_vuelta_s: number | null;
  compuesto: string | null;
  sugerencias_reglaje: SetupSuggestion[];
  conduccion: Driving[];
  contra_tanda_anterior?: { cambios_de_reglaje: { parametro: string; antes: number; despues: number }[]; mejor_vuelta_diferencia_s: number | null } | null;
  perdidas: Loss[];
  mas_rapido_s: number | null;
};

export type Summary = {
  sesion: { id: number; pista: string | null; track_id: number | null; tipo: string | null; inicio: string; en_curso: boolean };
  resultado: number | null;
  largada: number | null;
  carrera: boolean;
  clasificacion_oficial: boolean;
  mejor_vuelta: number | null;
  mejor_vuelta_s: number | null;
  vueltas: number;
  posiciones: { vuelta: number; pos: number }[];
  texto: string;
  perdidas: Loss[];
  bien: { titulo: string; texto: string }[];
  proxima: { reglaje: SetupSuggestion[]; conduccion: Driving[] };
  tarjeta: { clima: string | null; lluvia: boolean; temp_pista: number | null; equipo: string | null; pilotos: number | null; nombre: string; juego: number };
};

export type CircuitRow = { id: number; pista: string; sesiones: number; ultima: string; mejor_vuelta_s: number | null };
export type Circuit = {
  id: number;
  pista: string;
  largo_m: number | null;
  curvas: number | null;
  mejor_vuelta_s: number | null;
  notas: string[];
  sesiones: { id: number; tipo: string | null; inicio: string; vueltas: number | null }[];
};

export const SESSION_ES: Record<string, string> = {
  Race: "Carrera", "Race 2": "Carrera 2", "Race 3": "Carrera 3", Sprint: "Sprint", "Sprint Shootout 1": "Clasificación sprint 1", "Sprint Shootout 2": "Clasificación sprint 2", "Sprint Shootout 3": "Clasificación sprint 3",
  "Practice 1": "Práctica 1", "Practice 2": "Práctica 2", "Practice 3": "Práctica 3", "Short Practice": "Práctica corta",
  "Qualifying 1": "Clasificación 1", "Qualifying 2": "Clasificación 2", "Qualifying 3": "Clasificación 3", "Short Qualifying": "Clasificación corta",
  "One-Shot Qualifying": "Clasificación a una vuelta", "Time Trial": "Contrarreloj",
};

export const sessionEs = (t: string | null | undefined) => (t ? SESSION_ES[t] ?? t : "Sesión");

/** 116.883 → "1:56,883". */
export function lapS(s: number | null | undefined): string {
  if (s == null) return "—";
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(3).padStart(6, "0").replace(".", ",")}`;
}

export const dec = (v: number, d = 2) => v.toFixed(d).replace(".", ",");

/** "24 nov" in Spanish. */
export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("es-AR", { day: "numeric", month: "short" }).replace(".", "");
}

/** The recorded session behind the live one (matched by the game's session id). */
export function useLiveSessionId(sessionUid: string | null | undefined): number | null {
  const { credentials } = useAuth();
  const [id, setId] = useState<number | null>(null);
  useEffect(() => {
    if (!sessionUid) return;
    let cancelled = false;
    const look = async () => {
      try {
        const all = await api<GameSession[]>("/api/sessions?all=true", await credentials());
        const found = all.find((s) => s.session_uid === sessionUid);
        if (!cancelled) setId(found?.id ?? null);
        return !!found;
      } catch {
        return false;
      }
    };
    // A session that just started may not be listed yet: look again for a while.
    let tries = 0;
    let timer: ReturnType<typeof setTimeout>;
    const loop = async () => {
      if ((await look()) || cancelled || ++tries > 10) return;
      timer = setTimeout(loop, 6000);
    };
    loop();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [sessionUid, credentials]);
  return id;
}

/** GET a JSON resource, refetched when `key` changes; null while loading or on error. */
export function useApi<T>(path: string | null, key?: unknown): { data: T | null; error: string | null; loading: boolean } {
  const { credentials } = useAuth();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const r = await api<T>(path, await credentials());
        if (!cancelled) {
          setData(r);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, key, credentials]);
  return { data, error, loading };
}

/** The last value that was not null or empty: a packet lost on the way never blanks what is on screen. */
export function useSticky<T>(value: T | null | undefined, reset?: unknown): T | null {
  const kept = useRef<{ value: T | null; reset: unknown }>({ value: null, reset });
  if (kept.current.reset !== reset) kept.current = { value: null, reset };
  const empty = value == null || (Array.isArray(value) && value.length === 0);
  if (!empty) kept.current.value = value as T;
  return kept.current.value;
}
