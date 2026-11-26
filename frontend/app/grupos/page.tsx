"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { RequireAuth } from "@/components/RequireAuth";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { circuitName } from "@/lib/gp";
import type { GroupRow } from "@/lib/groups";
import { useApi } from "@/lib/sessions";

export default function GroupsPage() {
  return (
    <RequireAuth>
      <Groups />
    </RequireAuth>
  );
}

const field = "min-w-0 flex-1 rounded-[var(--radius-control)] border border-line bg-panel-2 px-3 py-2.5 text-[0.95rem] focus:border-accent focus:outline-none";

/** Your groups, and the two ways into a new one: create it or join with a code. */
function Groups() {
  const { credentials } = useAuth();
  const router = useRouter();
  const { data } = useApi<{ grupos: GroupRow[] }>("/api/groups");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const go = async (path: string, body: object, fail: string) => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ id: number }>(path, await credentials(), { method: "POST", body });
      router.push(`/grupos/${r.id}`);
    } catch (e) {
      setError(e instanceof ApiError && e.status === 400 ? fail : "No se pudo. Probá de nuevo.");
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto flex max-w-[760px] flex-col gap-5 px-[max(1rem,env(safe-area-inset-left))] py-5 lg:py-8">
      <Link href="/circuitos" className="text-[0.9rem] text-muted">‹ Circuitos</Link>
      <header>
        <span className="eyebrow">Grupos y ligas</span>
        <h1 className="display mt-1 text-[2.8rem] uppercase">Corré contra los tuyos</h1>
        <p className="mt-2 text-muted">
          Armá un grupo con amigos, tu liga o la gente de tu local. Cada circuito tiene su clasificación del grupo, con la mejor vuelta válida de cada uno, y el admin elige la pista de la fecha.
        </p>
      </header>

      {data && data.grupos.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="eyebrow">Tus grupos</h2>
          {data.grupos.map((g) => (
            <Link key={g.id} href={`/grupos/${g.id}`} className="card flex items-center gap-3 px-4 py-3.5 hover:border-accent">
              <span className="min-w-0 flex-1">
                <span className="title block truncate text-[1.25rem]">{g.nombre}</span>
                <span className="text-[0.82rem] text-dim">
                  {g.miembros} {g.miembros === 1 ? "piloto" : "pilotos"}
                  {g.fecha ? ` · Fecha: ${circuitName(g.fecha.track_id, g.fecha.pista)}` : ""}
                  {g.admin ? " · sos admin" : ""}
                </span>
              </span>
              <span className="text-muted">›</span>
            </Link>
          ))}
        </section>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <form
          className="card flex flex-col gap-3 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim().length >= 2) void go("/api/groups", { nombre: name.trim() }, "No se pudo crear: llegaste al máximo de grupos.");
          }}
        >
          <span className="title text-[1.1rem]">Crear un grupo</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Los del martes" maxLength={60} className={field} />
          <button type="submit" disabled={busy || name.trim().length < 2} className="btn-primary px-4 py-2.5 disabled:opacity-40">Crear</button>
        </form>
        <form
          className="card flex flex-col gap-3 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (code.trim()) void go("/api/groups/join", { codigo: code.trim() }, "Ese código no es de ningún grupo, o el grupo está lleno.");
          }}
        >
          <span className="title text-[1.1rem]">Tengo un código</span>
          <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="G-XXXXXX" spellCheck={false} className={`${field} font-mono tracking-wider`} />
          <button type="submit" disabled={busy || !code.trim()} className="btn px-4 py-2.5 disabled:opacity-40">Unirme</button>
        </form>
      </div>
      {error && <p className="text-[0.9rem] text-danger">{error}</p>}
    </main>
  );
}
