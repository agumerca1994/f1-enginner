"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { sessionName } from "@/components/dashboard/Cards";
import { RequireAuth } from "@/components/RequireAuth";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

type GameSession = {
  id: number;
  session_uid: string;
  game_version: string | null;
  track: string | null;
  session_type: string | null;
  total_laps: number | null;
  online: boolean | null;
  started_at: string;
  last_packet_at: string | null;
  ended_at: string | null;
  packets_received: number;
  has_recording: boolean;
};

export default function SessionsPage() {
  return (
    <RequireAuth>
      <Sessions />
    </RequireAuth>
  );
}

function Sessions() {
  const { credentials } = useAuth();
  const [sessions, setSessions] = useState<GameSession[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setSessions(await api<GameSession[]>("/api/sessions", await credentials()));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error");
      }
    })();
  }, [credentials]);

  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Sesiones</h1>
        <Link href="/" className="text-sm text-accent underline">
          Volver al dashboard
        </Link>
      </div>
      <p className="mt-1 text-sm text-muted">Cada sesión que corriste con el bridge queda grabada: podés volver a verla con todos los datos.</p>

      {error && <p className="mt-4 text-sm text-danger">{error}</p>}
      {sessions?.length === 0 && (
        <p className="mt-8 rounded-2xl border border-dashed border-line p-6 text-center text-muted">
          Todavía no hay sesiones. Corré una con el bridge encendido y va a aparecer acá.
        </p>
      )}

      <ul className="mt-6 space-y-2">
        {sessions?.map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-panel p-4">
            <div className="min-w-0">
              <div className="truncate font-semibold">{s.track ?? "Pista desconocida"}</div>
              <div className="text-sm text-muted">
                {s.session_type ? sessionName(s.session_type) : "Sesión"}
                {s.total_laps ? ` · ${s.total_laps} vueltas` : ""}
                {s.online ? " · online" : ""}
              </div>
              <div className="num mt-0.5 text-xs text-muted">
                {new Date(s.started_at).toLocaleString("es-AR", { dateStyle: "medium", timeStyle: "short", hour12: false })}
                {" · "}
                {s.packets_received.toLocaleString("es-AR")} datos
              </div>
            </div>
            {s.has_recording ? (
              <Link href={`/replay/${s.id}`} className="shrink-0 rounded-xl bg-fg px-4 py-2 text-sm font-semibold text-bg hover:opacity-90">
                Ver repetición
              </Link>
            ) : (
              <span className="shrink-0 text-xs text-muted">Sin grabación</span>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}
