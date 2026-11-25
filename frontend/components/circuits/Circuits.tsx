"use client";

import Link from "next/link";
import { useState } from "react";

import { RadioDock } from "@/components/ui/RadioDock";
import { TrackOutline } from "@/components/ui/TrackOutline";
import { academyEntry } from "@/lib/academy";
import type { SetupValues } from "@/lib/box";
import { lapS, sessionEs, shortDate, useApi, type Circuit, type CircuitRow, type Summary } from "@/lib/sessions";

type BaseSetup = {
  pista: string | null;
  caracteristicas: { nota: string };
  valores: SetupValues;
  nota: string;
  tu_mejor: { valores: SetupValues; vuelta_s: number; compuesto: string | null } | null;
};

const KEY_SETTINGS = ["aleron_delantero", "aleron_trasero", "diferencial_acelerando_pct", "barra_antivuelco_del", "reparto_frenada_pct", "presion_del_izq"];

function value(v: SetupValues, key: string): number | null {
  const direct = v[key];
  if (typeof direct === "number") return direct;
  for (const group of Object.values(v)) if (typeof group === "object" && group && typeof (group as Record<string, number>)[key] === "number") return (group as Record<string, number>)[key];
  return null;
}

/**
 * The team's library: every track the player has driven, and for each one the
 * setup to load in the game, what their sessions taught and the sessions
 * themselves. Everything here is written by code; the engineer only reads it.
 */
export function Circuits({ selected }: { selected?: number }) {
  const { data: mine } = useApi<CircuitRow[]>("/api/setup/circuits");
  const { data: all } = useApi<{ id: number; pista: string }[]>("/api/setup/tracks");
  const [showAll, setShowAll] = useState(false);
  const current = selected ?? mine?.[0]?.id;
  const others = (all ?? []).filter((t) => !mine?.some((m) => m.id === t.id));

  const item = (id: number, name: string, detail: string, best: number | null) => (
    <Link
      key={id}
      href={`/circuitos/${id}`}
      aria-current={id === current ? "page" : undefined}
      className={`flex items-center gap-3 rounded-[10px] px-3 py-2.5 ${id === current ? "bg-panel-2 shadow-[inset_3px_0_0_var(--color-accent)]" : "hover:bg-panel"}`}
    >
      <span className="min-w-0 flex-1">
        <span className="title block truncate text-[1.2rem]">{name}</span>
        <span className="text-[0.8rem] text-dim">{detail}</span>
      </span>
      {best != null && <span className="title num text-[1.05rem] normal-case text-soft-fg">{lapS(best).slice(0, -2)}</span>}
    </Link>
  );

  return (
    <main className="mx-auto grid max-w-[1600px] gap-0 lg:grid-cols-[300px_minmax(0,1fr)]">
      <nav className={`flex flex-col gap-1 border-line px-[max(1rem,env(safe-area-inset-left))] py-4 lg:border-r lg:px-4 ${selected != null ? "hidden lg:flex" : ""}`} aria-label="Tus circuitos">
        <h1 className="eyebrow mb-1 px-1">Tus circuitos</h1>
        {mine?.length === 0 && <p className="px-1 text-[0.9rem] text-muted">Todavía no corriste ninguno. Elegí una pista para ver su reglaje base.</p>}
        {mine?.map((c) => item(c.id, c.pista, `${c.sesiones} ${c.sesiones === 1 ? "sesión" : "sesiones"} · ${shortDate(c.ultima)}`, c.mejor_vuelta_s))}
        <button type="button" onClick={() => setShowAll((v) => !v)} className="mt-2 px-1 text-left text-[0.88rem] text-accent-ink">
          {showAll ? "Ocultar los demás" : `Ver los ${(all?.length ?? 0) || "demás"} circuitos`}
        </button>
        {showAll && others.map((t) => item(t.id, t.pista, "sin correr · reglaje base", null))}
      </nav>
      {current != null ? <CircuitDetail id={current} /> : <div />}
    </main>
  );
}

function CircuitDetail({ id }: { id: number }) {
  const { data: c } = useApi<Circuit>(`/api/setup/circuits/${id}`);
  const [wet, setWet] = useState(false);
  const [useBase, setUseBase] = useState(false);
  const { data: setup } = useApi<BaseSetup>(`/api/setup/base?track_id=${id}&lluvia=${wet}`);
  const lastRecorded = c?.sesiones[0];
  const { data: last } = useApi<Summary>(lastRecorded ? `/api/sessions/${lastRecorded.id}/summary` : null);
  const hot = last?.perdidas.map((l) => l.curva) ?? [];
  const values = setup ? (!useBase && setup.tu_mejor ? setup.tu_mejor.valores : setup.valores) : null;

  return (
    <section className="flex min-w-0 flex-col gap-5 px-[max(1rem,env(safe-area-inset-left))] py-5 lg:px-7" aria-label={c?.pista ?? "Circuito"}>
      <Link href="/circuitos" className="text-[0.9rem] text-muted lg:hidden">‹ Tus circuitos</Link>
      <header className="flex flex-wrap items-end gap-x-8 gap-y-3">
        <div>
          <span className="eyebrow">
            {c?.largo_m ? `${c.largo_m.toLocaleString("es-AR")} m` : ""}
            {c?.curvas ? ` · ${c.curvas} curvas` : ""}
          </span>
          <h1 className="display mt-1 text-[3rem] uppercase lg:text-[3.8rem]">{c?.pista ?? "…"}</h1>
        </div>
        <div className="flex gap-7 pb-1.5">
          <div><div className="text-[0.8rem] text-dim">Tu mejor vuelta</div><div className="display text-[1.8rem] not-italic text-best">{lapS(c?.mejor_vuelta_s)}</div></div>
          <div><div className="text-[0.8rem] text-dim">Sesiones</div><div className="display text-[1.8rem] not-italic">{c?.sesiones.length ?? "—"}</div></div>
        </div>
      </header>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <figure className="card flex flex-col gap-2 px-4 py-4">
          <TrackOutline trackId={id} highlight={hot} thick className="aspect-[1000/640] w-full" label={`Trazado de ${c?.pista ?? "la pista"}`} />
          <figcaption className="text-[0.82rem] text-muted">
            Trazado armado con la telemetría de todos los jugadores.{hot.length ? " En rojo, las curvas donde más tiempo dejaste la última vez." : ""}
          </figcaption>
        </figure>

        <div className="flex min-w-0 flex-col gap-4">
          <div className="card flex flex-col gap-3 px-4 py-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="eyebrow">Reglaje para cargar en el juego</h2>
              <div className="flex rounded-[8px] bg-bg p-[3px]" role="group" aria-label="Condición">
                {[false, true].map((w) => (
                  <button key={String(w)} type="button" aria-pressed={wet === w} onClick={() => setWet(w)} className={`h-7 rounded-[6px] px-3 text-[0.82rem] ${wet === w ? "bg-fg font-semibold text-bg" : "text-muted"}`}>
                    {w ? "Lluvia" : "Seco"}
                  </button>
                ))}
              </div>
            </div>
            <p className="text-[0.9rem] text-soft-fg">
              {setup?.tu_mejor && !useBase ? (
                <>Tu mejor reglaje acá ({lapS(setup.tu_mejor.vuelta_s)}). <button type="button" className="text-accent-ink" onClick={() => setUseBase(true)}>Usar el base</button></>
              ) : (
                <>El reglaje base de la pista. {setup?.tu_mejor && <button type="button" className="text-accent-ink" onClick={() => setUseBase(false)}>Usar el tuyo</button>}</>
              )}
            </p>
            {values && (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {KEY_SETTINGS.map((k) => {
                  const v = value(values, k);
                  if (v == null) return null;
                  const e = academyEntry(k);
                  return (
                    <Link key={k} href={`/reglaje?p=${k}`} className="rounded-[10px] bg-bg px-3 py-2.5 hover:bg-panel-2">
                      <div className="truncate text-[0.78rem] text-dim">{e?.title ?? k}</div>
                      <div className="display text-[1.4rem] not-italic">{Number.isInteger(v) ? v : v.toFixed(1).replace(".", ",")}{e?.unit === "%" ? "%" : ""}</div>
                    </Link>
                  );
                })}
              </div>
            )}
            <Link href="/reglaje" className="text-[0.9rem] text-accent-ink">Ver todos los ajustes con el auto en 3D ›</Link>
          </div>
          {c && c.notas.length > 0 && (
            <div className="card flex flex-col gap-2 px-4 py-4">
              <h2 className="eyebrow">Lo que sabemos de vos acá</h2>
              {c.notas.map((n) => (
                <span key={n} className="text-[0.92rem] leading-snug text-soft-fg">· {n}</span>
              ))}
            </div>
          )}
        </div>
      </div>

      {c && c.sesiones.length > 0 && (
        <div className="flex flex-col gap-2">
          <h2 className="eyebrow">Tus sesiones en {c.pista}</h2>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {c.sesiones.map((g) => (
              <Link key={g.id} href={`/resumen/${g.id}`} className="card flex items-center justify-between gap-3 px-4 py-3 hover:bg-panel-2">
                <span>
                  <span className="block font-semibold">{sessionEs(g.tipo)} · {shortDate(g.inicio)}</span>
                  {g.vueltas ? <span className="text-[0.8rem] text-dim">{g.vueltas} vueltas</span> : null}
                </span>
                <span className="text-accent-ink">Resumen ›</span>
              </Link>
            ))}
          </div>
        </div>
      )}
      <RadioDock text={setup?.caracteristicas.nota ?? null} />
    </section>
  );
}
