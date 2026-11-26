"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useState } from "react";

import { Leaderboard } from "@/components/circuits/Leaderboard";
import { RequireAuth } from "@/components/RequireAuth";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { circuitName } from "@/lib/gp";
import { joinLink, type GroupDetail } from "@/lib/groups";
import { lapS, shortDate, useApi } from "@/lib/sessions";

export default function GroupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <RequireAuth>
      <Group id={Number(id)} />
    </RequireAuth>
  );
}

const field = "rounded-[var(--radius-control)] border border-line bg-panel-2 px-3 py-2 text-[0.92rem] focus:border-accent focus:outline-none";

/** One group: the round's board, who leads each track, the invite and the members. */
function Group({ id }: { id: number }) {
  const { credentials } = useAuth();
  const router = useRouter();
  const [rev, setRev] = useState(0);
  const { data: g, error } = useApi<GroupDetail>(`/api/groups/${id}`, rev);
  const { data: tracks } = useApi<{ id: number; pista: string }[]>(g?.admin ? "/api/setup/tracks" : null);
  const [note, setNote] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [roundTrack, setRoundTrack] = useState<string>("");
  const [roundUntil, setRoundUntil] = useState("");
  const [name, setName] = useState("");

  if (error) return <main className="mx-auto max-w-[900px] px-4 pt-6 text-muted">Ese grupo no existe o ya no estás en él. <Link href="/grupos" className="text-accent-ink">Ver tus grupos</Link></main>;
  if (!g) return <main className="mx-auto max-w-[900px] px-4 pt-6 text-muted">Cargando…</main>;

  const call = async (path: string, method: string, body?: object) => {
    await api(path, await credentials(), { method, body });
    setRev((r) => r + 1);
  };

  const invite = async () => {
    const url = joinLink(g.codigo);
    const text = `Sumate a "${g.nombre}" y comparemos vueltas: ${url}`;
    try {
      if (navigator.share) await navigator.share({ title: g.nombre, text, url });
      else {
        await navigator.clipboard.writeText(text);
        setNote("Copiado. Pegalo en el grupo de WhatsApp.");
      }
    } catch {
      /* the share sheet was closed */
    }
  };

  const me = g.miembros.find((m) => m.soy_yo);

  return (
    <main className="mx-auto flex max-w-[1100px] flex-col gap-5 px-[max(1rem,env(safe-area-inset-left))] py-5 lg:px-7 lg:py-7">
      <Link href="/grupos" className="text-[0.9rem] text-muted">‹ Grupos</Link>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <span className="eyebrow">Grupo · {g.miembros.length} {g.miembros.length === 1 ? "piloto" : "pilotos"}</span>
          <h1 className="display mt-1 text-[3rem] uppercase leading-[0.9] lg:text-[3.8rem]">{g.nombre}</h1>
        </div>
        <div className="flex flex-col items-start gap-1 sm:items-end">
          <button type="button" onClick={() => void invite()} className="btn-primary px-5 py-2.5">Invitar</button>
          <span className="text-[0.8rem] text-dim">
            Código <b className="font-mono tracking-wider text-fg">{g.codigo}</b>
          </span>
          {note && <span className="text-[0.8rem] text-ok">{note}</span>}
        </div>
      </header>

      {g.fecha ? (
        <section className="flex flex-col gap-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="title text-[1.4rem]">
              Pista de la fecha: <Link href={`/circuitos/${g.fecha.track_id}`} className="text-accent-ink">{circuitName(g.fecha.track_id, g.fecha.pista)}</Link>
            </h2>
            {g.fecha.hasta && <span className="eyebrow">Hasta el {shortDate(g.fecha.hasta)}</span>}
          </div>
          <Leaderboard trackId={g.fecha.track_id} grupo={g.id} />
        </section>
      ) : (
        <section className="card px-4 py-4 text-[0.92rem] text-muted">
          {g.admin ? "Elegí la pista de la fecha abajo y todo el grupo ve esa clasificación primero." : "Todavía no hay pista de la fecha. La elige el admin del grupo."}
        </section>
      )}

      <section className="card flex flex-col gap-1 px-4 py-4">
        <h2 className="eyebrow mb-2">Quién manda en cada pista</h2>
        {g.pistas.length === 0 ? (
          <p className="text-[0.92rem] text-muted">Todavía nadie del grupo marcó una vuelta válida. Las vueltas entran solas cuando corren.</p>
        ) : (
          <div className="flex flex-col divide-y divide-line">
            {g.pistas.map((t) => (
              <Link key={t.track_id} href={`/circuitos/${t.track_id}?grupo=${g.id}`} className="flex items-center gap-3 py-2.5 hover:text-accent-ink">
                <span className="min-w-0 flex-1">
                  <span className="title block truncate text-[1.1rem]">{circuitName(t.track_id, t.pista)}</span>
                  <span className="block text-[0.75rem] text-dim">
                    {t.categoria === "sin_ayudas" ? "Sin ayudas" : "Con ayudas"} · {t.clima === "seco" ? "seco" : "lluvia"}{t.juego_nombre ? ` · ${t.juego_nombre}` : ""}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end text-right">
                  <span className={`text-[0.92rem] font-semibold ${t.lider.soy_yo ? "text-accent-ink" : "text-fg"}`}>
                    {t.lider.soy_yo ? "Vos" : t.lider.nombre} <span className="font-mono text-[0.85rem] font-normal text-best">{lapS(t.lider.tiempo_ms / 1000)}</span>
                  </span>
                  <span className="text-[0.78rem] text-dim">{t.mi_pos ? <>Vos P{t.mi_pos} de {t.pilotos}</> : `${t.pilotos} ${t.pilotos === 1 ? "piloto" : "pilotos"}`}</span>
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="card flex flex-col gap-2 px-4 py-4">
          <h2 className="eyebrow mb-1">Pilotos</h2>
          {g.miembros.map((m) => (
            <div key={m.id} className="flex items-center gap-2 text-[0.95rem]">
              <span className={`flex-1 ${m.soy_yo ? "font-semibold text-accent-ink" : ""}`}>
                {m.nombre}
                {m.soy_yo && <span className="ml-2 text-[0.75rem]">vos</span>}
              </span>
              {m.admin && <span className="eyebrow">admin</span>}
              {g.admin && !m.soy_yo && (
                <button
                  type="button"
                  onClick={() => confirm(`¿Sacar a ${m.nombre} del grupo?`) && void call(`/api/groups/${g.id}/members/${m.id}`, "DELETE")}
                  className="text-[0.8rem] text-dim hover:text-danger"
                >
                  Sacar
                </button>
              )}
            </div>
          ))}
          {me && (
            <button
              type="button"
              onClick={async () => {
                if (!confirm("¿Salir del grupo?")) return;
                await api(`/api/groups/${g.id}/members/${me.id}`, await credentials(), { method: "DELETE" });
                router.push("/grupos");
              }}
              className="mt-3 self-start text-[0.85rem] text-dim hover:text-danger"
            >
              Salir del grupo
            </button>
          )}
        </section>

        {g.admin && (
          <section className="card flex flex-col gap-3 px-4 py-4">
            <h2 className="eyebrow">Admin</h2>
            <form
              className="flex flex-col gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!roundTrack) return;
                void call(`/api/groups/${g.id}`, "PATCH", {
                  pista_fecha: Number(roundTrack),
                  hasta: roundUntil ? new Date(`${roundUntil}T23:59:00`).toISOString() : null,
                });
              }}
            >
              <span className="text-[0.9rem]">Pista de la fecha</span>
              <div className="flex flex-wrap gap-2">
                <select value={roundTrack} onChange={(e) => setRoundTrack(e.target.value)} className={`${field} w-full min-w-0 sm:w-auto sm:flex-1`} aria-label="Pista">
                  <option value="">Elegí una pista</option>
                  {(tracks ?? []).map((t) => (
                    <option key={t.id} value={t.id}>{circuitName(t.id, t.pista)}</option>
                  ))}
                </select>
                <input type="date" value={roundUntil} onChange={(e) => setRoundUntil(e.target.value)} className={field} aria-label="Hasta" />
                <button type="submit" disabled={!roundTrack} className="btn-ink px-4 py-2 disabled:opacity-40">Guardar</button>
              </div>
              {g.fecha && (
                <button type="button" onClick={() => void call(`/api/groups/${g.id}`, "PATCH", { pista_fecha: -1 })} className="self-start text-[0.82rem] text-dim hover:text-fg">
                  Quitar la fecha
                </button>
              )}
            </form>
            {editing ? (
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (name.trim().length < 2) return;
                  void call(`/api/groups/${g.id}`, "PATCH", { nombre: name.trim() }).then(() => setEditing(false));
                }}
              >
                <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className={`${field} min-w-0 flex-1`} aria-label="Nombre del grupo" />
                <button type="submit" className="btn-ink px-4 py-2">Guardar</button>
              </form>
            ) : (
              <button type="button" onClick={() => { setName(g.nombre); setEditing(true); }} className="self-start text-[0.85rem] text-accent-ink">
                Cambiar el nombre
              </button>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
