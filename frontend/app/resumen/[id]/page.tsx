"use client";

import Link from "next/link";
import { use, useState } from "react";

import { RequireAuth } from "@/components/RequireAuth";
import { ShareCard } from "@/components/session/ShareCard";
import { RadioDock } from "@/components/ui/RadioDock";
import { CornerThumb } from "@/components/ui/TrackOutline";
import { academyEntry } from "@/lib/academy";
import type { Comparison } from "@/lib/box";
import { dec, lapS, sessionEs, shortDate, useApi, type Loss, type Summary } from "@/lib/sessions";

export default function SummaryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <RequireAuth>
      <SessionSummary id={Number(id)} />
    </RequireAuth>
  );
}

/**
 * How a session went, written by code from the recording: the result, the lap
 * that changed it, where time went with the trace beside it, what went well and
 * what to try next. The engineer reads it out; nobody types here.
 */
function SessionSummary({ id }: { id: number }) {
  const { data: s, error, loading } = useApi<Summary>(`/api/sessions/${id}/summary`);
  const [sharing, setSharing] = useState(false);
  if (error) return <main className="mx-auto max-w-[900px] px-4 pt-6 text-muted">No se pudo armar el resumen: esta sesión no tiene grabación o no se pudo leer.</main>;
  if (!s) return <main className="mx-auto max-w-[900px] px-4 pt-6 text-muted">{loading ? "Armando el resumen…" : ""}</main>;

  const positions = s.posiciones;
  const lo = Math.min(...positions.map((p) => p.pos), 99);
  const hi = Math.max(...positions.map((p) => p.pos), 1);
  return (
    <main className="mx-auto flex max-w-[1100px] flex-col gap-5 px-[max(1rem,env(safe-area-inset-left))] pt-4 lg:px-7 lg:pt-6">
      <div className="flex items-center justify-between text-[0.9rem]">
        <Link href={s.sesion.track_id != null ? `/circuitos/${s.sesion.track_id}` : "/circuitos"} className="text-muted">‹ {s.sesion.pista ?? "Circuitos"}</Link>
        <div className="flex items-center gap-3">
          <span className="eyebrow">{shortDate(s.sesion.inicio)}</span>
          {s.vueltas > 0 && (
            <button type="button" onClick={() => setSharing(true)} className="btn-primary px-4 py-2 text-[0.85rem]">
              Compartir
            </button>
          )}
        </div>
      </div>
      {sharing && <ShareCard summary={s} onClose={() => setSharing(false)} />}

      <header>
        <span className="eyebrow">Resumen · {sessionEs(s.sesion.tipo)} en {s.sesion.pista ?? "la pista"} · {s.vueltas} {s.vueltas === 1 ? "vuelta" : "vueltas"}</span>
        <div className="mt-1 flex flex-wrap items-end gap-x-6 gap-y-2">
          <span className="display text-[6rem] leading-[0.82] lg:text-[7.5rem]">{s.resultado ? `P${s.resultado}` : "—"}</span>
          <div className="pb-2 text-[0.95rem] leading-relaxed text-muted">
            {s.largada ? <>Largaste <b className="text-fg">{s.largada}°</b><br /></> : null}
            Mejor vuelta <b className="text-fg">{lapS(s.mejor_vuelta_s)}</b>
            {!s.clasificacion_oficial && s.carrera && <><br /><span className="text-dim">la grabación no llegó a la bandera</span></>}
          </div>
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          {positions.length > 1 && (
            <section className="card px-4 py-4">
              <div className="flex justify-between"><h2 className="eyebrow">Tu posición vuelta a vuelta</h2><span className="eyebrow">V{positions[0].vuelta} → V{positions[positions.length - 1].vuelta}</span></div>
              <div className="mt-3 flex h-28 items-end gap-1.5">
                {positions.map((p, i) => {
                  const worse = i > 0 && p.pos > positions[i - 1].pos;
                  const better = i > 0 && p.pos < positions[i - 1].pos;
                  return (
                    <div key={p.vuelta} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
                      <span className={`display text-[0.95rem] not-italic ${worse ? "text-accent-ink" : better ? "text-ok" : ""}`}>P{p.pos}</span>
                      <span className={`w-full rounded ${worse ? "bg-accent" : better ? "bg-ok" : "bg-line"}`} style={{ height: `${hi === lo ? 60 : 25 + (75 * (hi - p.pos)) / (hi - lo)}%` }} />
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          <section className="paper flex flex-col gap-3 px-5 py-5">
            <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-accent" /><span className="title text-[1.05rem]">El ingeniero</span></div>
            <p className="text-[1.05rem] leading-relaxed">{s.texto}</p>
          </section>

          {s.bien.length > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className="eyebrow">Lo que salió bien</h2>
              <div className="card flex flex-col gap-2 px-4 py-4 text-[0.95rem]">
                {s.bien.map((b) => (
                  <span key={b.titulo}><b className="text-best">{b.titulo}:</b> {b.texto}</span>
                ))}
              </div>
            </section>
          )}

          {(s.proxima.reglaje.length > 0 || s.proxima.conduccion.length > 0) && (
            <section className="flex flex-col gap-2">
              <h2 className="eyebrow">Para la próxima en {s.sesion.pista}</h2>
              {s.proxima.reglaje.map((x) => (
                <Link key={x.parametro} href={`/reglaje?s=${id}&p=${x.parametro}`} className="card flex items-center justify-between gap-3 px-4 py-3.5 hover:bg-panel-2">
                  <span className="text-[0.95rem]">{academyEntry(x.parametro)?.title ?? x.parametro}</span>
                  <span className="title num text-[1.3rem] whitespace-nowrap">{x.valor_actual} → <span className="text-accent-ink">{x.valor_sugerido}</span></span>
                </Link>
              ))}
              {s.proxima.conduccion.map((d) => (
                <div key={d.curva} className="card flex items-start gap-3 px-4 py-3.5">
                  <span className="shrink-0 rounded border border-warn/40 px-1.5 py-0.5 font-mono text-[0.65rem] text-warn">MANEJO</span>
                  <span className="text-[0.92rem] leading-snug text-soft-fg">{d.texto}</span>
                </div>
              ))}
            </section>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          <h2 className="eyebrow">Lo que más te costó</h2>
          {s.perdidas.length === 0 && <div className="card px-4 py-4 text-[0.95rem] text-muted">No hay datos suficientes para comparar curva por curva.</div>}
          {s.perdidas.map((l, i) => (
            <LossCard key={l.curva} loss={l} rank={i + 1} sid={id} trackId={s.sesion.track_id} detailed={i === 0} />
          ))}
          <div className="grid grid-cols-2 gap-2">
            <Link href={`/replay/${id}`} className="btn px-3 py-3 text-center text-[0.92rem]">Volver a verla</Link>
            <Link href={`/box?s=${id}`} className="btn px-3 py-3 text-center text-[0.92rem]">Toda la telemetría</Link>
          </div>
        </div>
      </div>
      <RadioDock text={s.texto} label="Te cuento cómo te fue" />
      <div className="h-2" />
    </main>
  );
}

function LossCard({ loss, rank, sid, trackId, detailed }: { loss: Loss; rank: number; sid: number; trackId: number | null; detailed: boolean }) {
  return (
    <section className="card flex flex-col gap-3 px-4 py-4">
      <div className="flex items-center gap-3">
        <CornerThumb trackId={trackId} corner={loss.curva} className="h-12 w-[72px] shrink-0" />
        <span className="title min-w-0 flex-1 text-[1.4rem]">{rank} · Curva {loss.curva}</span>
        <span className="display text-[1.4rem] whitespace-nowrap not-italic text-accent-ink">−{dec(loss.perdida_s)} s</span>
      </div>
      {detailed && <CornerTrace sid={sid} loss={loss} />}
      <p className="text-[0.92rem] leading-snug text-soft-fg">{loss.texto}</p>
      <Link href={`/box?s=${sid}`} className="text-[0.85rem] text-accent-ink">Ver la vuelta completa ›</Link>
    </section>
  );
}

/** Speed through the corner, the player's lap against the reference, from the recorded traces. */
function CornerTrace({ sid, loss }: { sid: number; loss: Loss }) {
  return <TraceFromCompare sid={sid} loss={loss} />;
}

function TraceFromCompare({ sid, loss }: { sid: number; loss: Loss }) {
  const { data: ov } = useApi<{ vueltas: { car: number; vuelta: number }[] }>(`/api/sessions/${sid}/box`);
  const me = ov?.vueltas[0]?.car;
  const a = `${loss.referencia.car}:${loss.referencia.lap}`;
  const b = me != null ? `${me}:${loss.vuelta}` : null;
  const { data: cmp } = useApi<Comparison>(b ? `/api/sessions/${sid}/box/compare?a=${a}&b=${b}` : null);
  const row = cmp?.curvas.find((c) => c.curva === loss.curva);
  if (!cmp || !row) return <div className="h-[110px]" />;
  const bin = cmp.traza_a.bin_m;
  const from = Math.max(0, Math.floor((row.entrada_m - 120) / bin));
  const to = Math.floor((row.salida_m + 120) / bin);
  const sa = cmp.traza_a.speed.slice(from, to);
  const sb = cmp.traza_b.speed.slice(from, to);
  const vals = [...sa, ...sb].filter((v): v is number => v != null);
  if (vals.length < 4) return null;
  const min = Math.min(...vals) - 10, max = Math.max(...vals) + 10;
  const W = 340, H = 110;
  const pts = (arr: (number | null)[]) =>
    arr.map((v, i) => (v == null ? null : `${((i / Math.max(1, arr.length - 1)) * W).toFixed(1)},${(H - 6 - ((v - min) / (max - min)) * (H - 12)).toFixed(1)}`)).filter(Boolean).join(" ");
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-[110px] w-full" role="img" aria-label={`Velocidad en la curva ${loss.curva}: tu vuelta contra la referencia`}>
        <line x1="0" y1={H - 4} x2={W} y2={H - 4} stroke="var(--color-line)" />
        <polyline points={pts(sa)} fill="none" stroke="var(--color-best)" strokeWidth="3" strokeLinejoin="round" />
        <polyline points={pts(sb)} fill="none" stroke="var(--color-fg)" strokeWidth="3" strokeLinejoin="round" />
      </svg>
      <figcaption className="mt-1 flex gap-4 text-[0.78rem] text-muted">
        <span><span className="mr-1.5 inline-block h-[3px] w-3 bg-best align-middle" />{cmp.a.piloto ? cmp.a.piloto.charAt(0) + cmp.a.piloto.slice(1).toLowerCase() : "referencia"}</span>
        <span><span className="mr-1.5 inline-block h-[3px] w-3 bg-fg align-middle" />vos, vuelta {loss.vuelta}</span>
        <span className="ml-auto">velocidad</span>
      </figcaption>
    </figure>
  );
}
