"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { MINE_COLOR, REF_COLOR, TelemetryChart } from "@/components/box/TelemetryChart";
import { sessionName } from "@/components/dashboard/Cards";
import { TyreDot } from "@/components/ui/Tyres";
import { RequireAuth } from "@/components/RequireAuth";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import {
  type BoxLap,
  type BoxOverview,
  COMPOUND_ES,
  type Comparison,
  cornerAdvice,
  type CornerRow,
  ISSUE_ES,
  lapKey,
  paramName,
  paramValue,
  PRESSURE_ES,
  type Run,
  secondsText,
  SETUP_ES,
  type SetupValues,
  type Trace,
} from "@/lib/box";
import { lapTime } from "@/lib/format";

type GameSession = {
  id: number;
  track: string | null;
  session_type: string | null;
  started_at: string;
  ended_at: string | null;
  has_recording: boolean;
};

export default function BoxPage() {
  return (
    <RequireAuth>
      <Box />
    </RequireAuth>
  );
}

const LIVE = "live"; // the lap being driven now, drawn as it arrives
const LIVE_POLL_MS = 2000;
const ms = (s: number | null | undefined) => (s == null ? null : Math.round(s * 1000));
const when = (iso: string) =>
  new Date(iso).toLocaleString("es-AR", { dateStyle: "medium", timeStyle: "short", hour12: false });

function Box() {
  const { credentials } = useAuth();
  const [sessions, setSessions] = useState<GameSession[] | null>(null);
  const [sid, setSid] = useState<number | null>(null);
  const [overview, setOverview] = useState<BoxOverview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mine, setMine] = useState<string | null>(null);
  const [ref, setRef] = useState<string | null>(null);
  const [cmp, setCmp] = useState<Comparison | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [liveTrace, setLiveTrace] = useState<(Trace & { ultima_completa: number | null }) | null>(null);
  const [refTrace, setRefTrace] = useState<Trace | null>(null);
  const [bestKey, setBestKey] = useState<string | null>(null);

  // Sessions with a recording; the one in the URL (?s=) or the newest.
  useEffect(() => {
    (async () => {
      try {
        const all = await api<GameSession[]>("/api/sessions", await credentials());
        const recorded = all.filter((s) => s.has_recording);
        setSessions(recorded);
        const wanted = Number(new URLSearchParams(window.location.search).get("s"));
        setSid(recorded.find((s) => s.id === wanted)?.id ?? recorded[0]?.id ?? null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error");
      }
    })();
  }, [credentials]);

  useEffect(() => {
    if (sid == null) return;
    const url = new URL(window.location.href);
    url.searchParams.set("s", String(sid));
    window.history.replaceState(null, "", url);
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const ov = await api<BoxOverview>(`/api/sessions/${sid}/box`, await credentials());
        if (cancelled) return;
        setOverview(ov);
        // Keep the chosen laps on a refresh if they still exist; otherwise best lap against the fastest car.
        const keys = new Set([
          ...ov.vueltas.map((v) => lapKey(v.car, v.vuelta)),
          ...ov.referencias.map((r) => lapKey(r.car, r.lap)),
        ]);
        const best = ov.vueltas.find((v) => v.mejor) ?? ov.vueltas[ov.vueltas.length - 1];
        const mineKey = best ? lapKey(best.car, best.vuelta) : null;
        setBestKey(mineKey);
        // While the session is being driven the chart starts on the lap in progress.
        setMine((m) => (m && (keys.has(m) || m === LIVE) ? m : ov.sesion.en_curso ? LIVE : mineKey));
        const fallbackRef = ov.referencias[0]
          ? lapKey(ov.referencias[0].car, ov.referencias[0].lap)
          : ov.vueltas
              .filter((v) => lapKey(v.car, v.vuelta) !== mineKey && v.tiempo_s)
              .sort((a, b) => (a.tiempo_s ?? 1e9) - (b.tiempo_s ?? 1e9))
              .map((v) => lapKey(v.car, v.vuelta))[0] ?? null;
        // Live, the natural reference is the player's own best lap; afterwards, the fastest car.
        setRef((r) => (r && keys.has(r) ? r : ov.sesion.en_curso && mineKey ? mineKey : fallbackRef));
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sid, refresh, credentials]);

  // The lap in progress, polled while the chart shows it; a lap completed refreshes the laps and runs.
  useEffect(() => {
    if (sid == null || mine !== LIVE) {
      setLiveTrace(null);
      return;
    }
    let cancelled = false;
    let lastDone: number | null | undefined;
    const tick = async () => {
      try {
        const t = await api<Trace & { ultima_completa: number | null }>(`/api/sessions/${sid}/box/live`, await credentials());
        if (cancelled) return;
        setLiveTrace(t);
        if (lastDone !== undefined && t.ultima_completa !== lastDone) setRefresh((n) => n + 1);
        lastDone = t.ultima_completa;
      } catch {
        // Not being driven any more (or not yet a lap): go back to the best lap.
        if (!cancelled) setMine((m) => (m === LIVE ? bestKey : m));
      }
    };
    tick();
    const timer = setInterval(tick, LIVE_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [sid, mine, bestKey, credentials]);

  useEffect(() => {
    if (sid == null || mine !== LIVE || !ref) {
      setRefTrace(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const t = await api<Trace>(`/api/sessions/${sid}/box/trace?lap=${ref}`, await credentials());
        if (!cancelled) setRefTrace(t);
      } catch {
        if (!cancelled) setRefTrace(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sid, mine, ref, refresh, credentials]);

  useEffect(() => {
    if (sid == null || !mine || !ref || mine === ref || mine === LIVE) {
      setCmp(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        // A = the reference, B = the player's lap: positive differences are what the player loses.
        const c = await api<Comparison>(`/api/sessions/${sid}/box/compare?a=${ref}&b=${mine}`, await credentials());
        if (!cancelled) setCmp(c);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sid, mine, ref, credentials]);

  const session = sessions?.find((s) => s.id === sid);
  const mineLap = overview?.vueltas.find((v) => lapKey(v.car, v.vuelta) === mine) ?? null;
  const refLap = overview?.vueltas.find((v) => lapKey(v.car, v.vuelta) === ref) ?? null;

  const refLabel = useCallback(
    (key: string | null) => {
      if (key === LIVE) return liveTrace ? `Vuelta ${liveTrace.lap} en curso` : "Vuelta en curso";
      if (!overview || !key) return "—";
      const own = overview.vueltas.find((v) => lapKey(v.car, v.vuelta) === key);
      if (own) return `Vuelta ${own.vuelta} · ${lapTime(ms(own.tiempo_s))}`;
      const r = overview.referencias.find((x) => lapKey(x.car, x.lap) === key);
      return r ? `${r.piloto ?? `Auto ${r.car}`} (V${r.lap}) · ${lapTime(ms(r.tiempo_s))}` : "—";
    },
    [overview, liveTrace],
  );
  const lastDoneKey = overview?.vueltas.length
    ? lapKey(overview.vueltas[overview.vueltas.length - 1].car, overview.vueltas[overview.vueltas.length - 1].vuelta)
    : null;

  return (
    <main className="mx-auto max-w-[1600px] px-[max(1rem,env(safe-area-inset-left))] pb-10 pt-4 lg:px-7 lg:pt-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <span className="eyebrow block">
            {overview
              ? `${overview.sesion.pista ?? "Pista"} · ${overview.sesion.tipo ? sessionName(overview.sesion.tipo) : "Sesión"} · ${when(overview.sesion.inicio)}`
              : "Elegí una sesión grabada"}
          </span>
          <h1 className="display mt-1 text-[2.4rem] uppercase lg:text-[2.9rem]">Telemetría</h1>
        </div>
        <div className="mb-1 flex flex-wrap items-center gap-2">
          {sessions && sessions.length > 0 && (
            <select
              value={sid ?? ""}
              onChange={(e) => {
                setOverview(null);
                setCmp(null);
                setMine(null);
                setRef(null);
                setSid(Number(e.target.value));
              }}
              className="h-10 max-w-[18rem] rounded-[var(--radius-control)] border border-line bg-panel px-3 text-[0.88rem] text-fg"
              aria-label="Sesión"
            >
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.track ?? "Pista desconocida"} · {s.session_type ? sessionName(s.session_type) : "Sesión"} · {when(s.started_at)}
                </option>
              ))}
            </select>
          )}
          {session && !session.ended_at && (
            <button type="button" onClick={() => setRefresh((n) => n + 1)} disabled={loading} className="btn h-10 px-3.5 text-[0.88rem] text-muted hover:text-fg disabled:opacity-50">
              {loading ? "Actualizando…" : "Actualizar"}
            </button>
          )}
          <Link href={sid != null ? `/reglaje?s=${sid}` : "/reglaje"} className="btn flex h-10 items-center px-3.5 text-[0.88rem] text-muted hover:text-fg">
            Reglaje ›
          </Link>
        </div>
      </header>

      {error && <p className="mt-3 text-[0.9rem] text-warn">{error}</p>}
      {sessions?.length === 0 && (
        <p className="card mt-6 px-6 py-8 text-center text-muted">Todavía no hay sesiones grabadas. Corré una con el Bridge encendido y va a aparecer acá.</p>
      )}
      {loading && !overview && <p className="mt-8 text-center text-[0.9rem] text-muted">Leyendo la telemetría de la sesión…</p>}

      {overview && overview.vueltas.length === 0 && mine !== LIVE && (
        <p className="card mt-6 px-6 py-8 text-center text-muted">Esta sesión no tiene vueltas completas grabadas. Hace falta cruzar la línea al menos dos veces.</p>
      )}

      {overview && (overview.vueltas.length > 0 || mine === LIVE) && (
        <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)]">
          <div className="flex min-w-0 flex-col gap-4">
            <Panel
              title="Vuelta contra vuelta"
              right={
                <div className="flex flex-wrap items-center gap-2">
                  {mine === LIVE ? (
                    <>
                      <span className="flex items-center gap-1.5 text-[0.82rem] text-ok">
                        <span className="h-2 w-2 animate-pulse rounded-full bg-ok" aria-hidden /> En vivo
                      </span>
                      {lastDoneKey && (
                        <button type="button" onClick={() => setMine(lastDoneKey)} className="btn px-2.5 py-1.5 text-[0.82rem] text-muted hover:text-fg">
                          Comparar la última vuelta
                        </button>
                      )}
                    </>
                  ) : (
                    overview.sesion.en_curso && (
                      <button type="button" onClick={() => setMine(LIVE)} className="btn px-2.5 py-1.5 text-[0.82rem] text-muted hover:text-fg">
                        Ver en vivo
                      </button>
                    )
                  )}
                  <RefPicker overview={overview} mine={mine} value={ref} onChange={setRef} label={refLabel} />
                </div>
              }
            >
              {mine === LIVE && overview.largo_pista_m ? (
                liveTrace && refTrace ? (
                  <TelemetryChart
                    mine={liveTrace}
                    reference={refTrace}
                    corners={overview.curvas}
                    sectors={overview.sectores_m}
                    trackLength={overview.largo_pista_m}
                    mineLabel={`Vos · ${refLabel(LIVE)}`}
                    refLabel={`Referencia · ${refLabel(ref)}`}
                  />
                ) : (
                  <p className="py-12 text-center text-[0.9rem] text-muted">{liveTrace ? "Elegí una referencia para comparar mientras manejás." : "Esperando la vuelta en curso…"}</p>
                )
              ) : cmp && overview.largo_pista_m ? (
                <TelemetryChart
                  mine={cmp.traza_b}
                  reference={cmp.traza_a}
                  corners={overview.curvas}
                  sectors={overview.sectores_m}
                  trackLength={overview.largo_pista_m}
                  mineLabel={`Vos · ${refLabel(mine)}`}
                  refLabel={`Referencia · ${refLabel(ref)}`}
                />
              ) : (
                <p className="py-12 text-center text-[0.9rem] text-muted">
                  {mine && ref && mine !== ref ? "Cargando las vueltas…" : "Para comparar hace falta otra vuelta tuya o la de otro piloto."}
                </p>
              )}
              {mine === LIVE && (
                <p className="mt-2 text-[0.8rem] text-dim">
                  Se dibuja mientras manejás. La comparación curva por curva y las sugerencias se calculan al terminar cada vuelta: tocá &quot;Comparar la última vuelta&quot;.
                </p>
              )}
              {cmp && (cmp.traza_a.coverage < 0.8 || cmp.traza_b.coverage < 0.8) && (
                <p className="mt-2 text-[0.8rem] text-warn">Llegó poca telemetría de alguna de las dos vueltas: los tramos sin datos quedan en blanco.</p>
              )}
            </Panel>
            <LapsPanel overview={overview} mine={mine} refKey={ref} onMine={setMine} onRef={setRef} />
            {cmp && <CornersPanel rows={cmp.curvas} />}
          </div>
          <div className="flex min-w-0 flex-col gap-4">
            {cmp && <AdvicePanel cmp={cmp} />}
            <RunsPanel
              runs={overview.tandas}
              sessionId={overview.sesion.id}
              onBestLap={(lap) => {
                const v = overview.vueltas.find((x) => x.vuelta === lap);
                if (v) setMine(lapKey(v.car, v.vuelta));
              }}
            />
            <SetupPanel overview={overview} mine={mineLap} other={refLap} />
          </div>
        </div>
      )}
    </main>
  );
}

/** A block of the page: the eyebrow title, its controls on the right and its content. */
function Panel({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="card px-4 py-4 sm:px-5">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="eyebrow">{title}</h2>
        {right}
      </header>
      {children}
    </section>
  );
}

function RefPicker({
  overview,
  mine,
  value,
  onChange,
  label,
}: {
  overview: BoxOverview;
  mine: string | null;
  value: string | null;
  onChange: (k: string) => void;
  label: (k: string | null) => string;
}) {
  const own = overview.vueltas.filter((v) => lapKey(v.car, v.vuelta) !== mine && v.tiempo_s);
  return (
    <label className="flex items-center gap-2 text-[0.82rem] text-muted">
      <span className="hidden sm:inline">Comparar con</span>
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 max-w-[15rem] rounded-[8px] border border-line bg-bg px-2 text-[0.88rem] text-fg"
      >
        {overview.referencias.length > 0 && (
          <optgroup label="Mejor vuelta de cada piloto">
            {overview.referencias.map((r) => (
              <option key={lapKey(r.car, r.lap)} value={lapKey(r.car, r.lap)}>
                {label(lapKey(r.car, r.lap))}
              </option>
            ))}
          </optgroup>
        )}
        {own.length > 0 && (
          <optgroup label="Tus vueltas">
            {own.map((v) => (
              <option key={lapKey(v.car, v.vuelta)} value={lapKey(v.car, v.vuelta)}>
                {label(lapKey(v.car, v.vuelta))}
              </option>
            ))}
          </optgroup>
        )}
      </select>
    </label>
  );
}

function LapsPanel({
  overview,
  mine,
  refKey,
  onMine,
  onRef,
}: {
  overview: BoxOverview;
  mine: string | null;
  refKey: string | null;
  onMine: (k: string) => void;
  onRef: (k: string) => void;
}) {
  const multipleSetups = overview.reglajes.length > 1;
  return (
    <Panel title="Tus vueltas" right={<span className="text-[0.8rem] text-dim">Tocá una para analizarla</span>}>
      <div className="-mx-4 overflow-x-auto px-4 sm:-mx-5 sm:px-5">
        <table className="w-full min-w-[620px] text-[0.92rem]">
          <thead>
            <tr className="eyebrow text-left">
              <th className="pb-2 pr-2 font-normal">Vuelta</th>
              <th className="pb-2 pr-3 text-right font-normal">Tiempo</th>
              <th className="pb-2 pr-3 text-right font-normal">S1</th>
              <th className="pb-2 pr-3 text-right font-normal">S2</th>
              <th className="pb-2 pr-3 text-right font-normal">S3</th>
              <th className="pb-2 pr-2 font-normal">Gomas</th>
              {multipleSetups && <th className="pb-2 pr-2 font-normal">Reglaje</th>}
              <th className="pb-2 font-normal" />
            </tr>
          </thead>
          <tbody>
            {overview.vueltas.map((v) => {
              const key = lapKey(v.car, v.vuelta);
              const isMine = key === mine;
              const isRef = key === refKey;
              return (
                <tr key={key} onClick={() => onMine(key)} className={`cursor-pointer border-t border-panel-2 hover:bg-panel-2 ${isMine ? "bg-panel-2" : ""}`}>
                  <td className="py-2 pr-2">
                    <span className="flex items-center gap-2">
                      <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: isMine ? MINE_COLOR : isRef ? REF_COLOR : "transparent" }} aria-hidden />
                      <span className="title text-[1.05rem]">V{v.vuelta}</span>
                      {v.mejor && <span className="rounded border border-best/50 px-1.5 font-mono text-[0.62rem] text-best">MEJOR</span>}
                      {!v.valida && <span className="font-mono text-[0.62rem] text-warn">INVÁLIDA</span>}
                      {v.box && <span className="font-mono text-[0.62rem] text-dim">BOX</span>}
                      {v.cobertura < 0.6 && <span className="font-mono text-[0.62rem] text-warn" title="Llegó poca telemetría de esta vuelta">POCOS DATOS</span>}
                    </span>
                  </td>
                  <td className={`title num pr-3 text-right text-[1.05rem] normal-case ${v.mejor ? "text-best" : ""}`}>{lapTime(ms(v.tiempo_s))}</td>
                  {[0, 1, 2].map((k) => (
                    <td key={k} className="num pr-3 text-right text-muted">
                      {v.sectores_s?.[k] != null ? v.sectores_s[k]!.toFixed(3).replace(".", ",") : "—"}
                    </td>
                  ))}
                  <td className="pr-2 text-muted">
                    <span className="flex items-center gap-2 whitespace-nowrap">
                      {v.compuesto && <TyreDot compound={v.compuesto} filled size={12} />}
                      {v.compuesto ? (COMPOUND_ES[v.compuesto] ?? v.compuesto) : "—"}
                      {v.edad_gomas != null ? <span className="text-dim">· {v.edad_gomas} v.</span> : null}
                    </span>
                  </td>
                  {multipleSetups && <td className="pr-2">{v.reglaje ? <span className="title rounded bg-bg px-1.5 text-[0.95rem]">{v.reglaje}</span> : "—"}</td>}
                  <td className="text-right">
                    {!isMine && v.tiempo_s && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onRef(key);
                        }}
                        className={`rounded-[8px] border px-2 py-1 text-[0.78rem] ${isRef ? "border-best/60 text-best" : "border-line text-muted hover:text-fg"}`}
                      >
                        {isRef ? "Referencia" : "Usar de referencia"}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function CornersPanel({ rows }: { rows: CornerRow[] }) {
  const m = (v: number | null) => (v == null ? "—" : `${v.toLocaleString("es-AR")} m`);
  const kmh = (v: number | null) => (v == null ? "—" : `${v}`);
  return (
    <Panel title="Curva por curva" right={<span className="text-[0.8rem] text-dim">vos / referencia</span>}>
      <div className="-mx-4 overflow-x-auto px-4 sm:-mx-5 sm:px-5">
        <table className="w-full min-w-[640px] text-[0.9rem]">
          <thead>
            <tr className="eyebrow text-left">
              <th className="py-1.5 pr-2 font-normal">Curva</th>
              <th className="pr-2 text-right font-normal">Diferencia</th>
              <th className="pr-2 text-right font-normal">Frena en</th>
              <th className="pr-2 text-right font-normal">V. mínima</th>
              <th className="pr-2 text-right font-normal">A fondo en</th>
              <th className="font-normal">Qué pasó</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.curva} className="border-t border-panel-2 align-top">
                <td className="py-2 pr-2">
                  <span className="title text-[1.05rem]">Curva {r.curva}</span> <span className="font-mono text-[0.65rem] text-dim">S{r.sector}</span>
                </td>
                <td className={`title num pr-2 text-right text-[1.05rem] ${diffClass(r.diferencia_s)}`}>
                  {r.diferencia_s == null ? "—" : secondsText(r.diferencia_s)}
                </td>
                <td className="num pr-2 text-right">
                  {m(r.b.frena_en_m)} <span className="text-muted">/ {m(r.a.frena_en_m)}</span>
                </td>
                <td className="num pr-2 text-right">
                  {kmh(r.b.velocidad_minima_kmh)} <span className="text-muted">/ {kmh(r.a.velocidad_minima_kmh)}</span>
                </td>
                <td className="num pr-2 text-right">
                  {m(r.b.acelera_a_fondo_en_m)} <span className="text-muted">/ {m(r.a.acelera_a_fondo_en_m)}</span>
                </td>
                <td className="text-[0.82rem] text-muted">{(r.b.problemas ?? []).map((p) => ISSUE_ES[p] ?? p).join(", ") || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[0.8rem] text-dim">Diferencia positiva: perdés tiempo contra la referencia en esa curva. Son las mismas curvas numeradas del mapa.</p>
    </Panel>
  );
}

function diffClass(v: number | null): string {
  if (v == null || Math.abs(v) < 0.05) return "text-muted";
  return v > 0 ? "text-accent-ink" : "text-ok";
}

function AdvicePanel({ cmp }: { cmp: Comparison }) {
  const measured = cmp.curvas.filter((r) => r.diferencia_s != null);
  const losing = measured.filter((r) => r.diferencia_s! >= 0.05).sort((a, b) => b.diferencia_s! - a.diferencia_s!).slice(0, 3);
  const gaining = measured.filter((r) => r.diferencia_s! <= -0.05).sort((a, b) => a.diferencia_s! - b.diferencia_s!).slice(0, 2);
  const total = cmp.diferencia_s;
  return (
    <Panel title="Dónde está el tiempo">
      {total != null && (
        <div className="mb-4">
          {Math.abs(total) < 0.001 ? (
            <p className="text-[0.95rem]">Las dos vueltas dieron el mismo tiempo.</p>
          ) : (
            <>
              <span className={`display block text-[2.6rem] not-italic ${total > 0 ? "text-accent-ink" : "text-ok"}`}>{secondsText(total, false)}</span>
              <span className="text-[0.85rem] text-dim">tu vuelta, {total > 0 ? "más lenta" : "más rápida"} que la referencia</span>
            </>
          )}
        </div>
      )}
      {losing.length > 0 && (
        <>
          <h3 className="eyebrow mb-2">Dónde perdés</h3>
          <ul className="mb-4 flex flex-col gap-2">
            {losing.map((r) => (
              <AdviceItem key={r.curva} row={r} />
            ))}
          </ul>
        </>
      )}
      {gaining.length > 0 && (
        <>
          <h3 className="eyebrow mb-2">Dónde ganás</h3>
          <ul className="flex flex-col gap-2">
            {gaining.map((r) => (
              <AdviceItem key={r.curva} row={r} />
            ))}
          </ul>
        </>
      )}
      {losing.length === 0 && gaining.length === 0 && (
        <p className="text-sm text-muted">No hay diferencias de más de 5 centésimas en ninguna curva medida.</p>
      )}
    </Panel>
  );
}

function AdviceItem({ row }: { row: CornerRow }) {
  const advice = cornerAdvice(row);
  return (
    <li className="rounded-[10px] bg-bg px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="title text-[1.15rem]">
          Curva {row.curva} <span className="font-mono text-[0.65rem] font-normal text-dim">S{row.sector}</span>
        </span>
        <span className={`display text-[1.25rem] not-italic ${diffClass(row.diferencia_s)}`}>{secondsText(row.diferencia_s!)}</span>
      </div>
      {advice.length > 0 && <p className="mt-0.5 text-[0.88rem] text-muted">{capitalize(advice.join(", "))}.</p>}
    </li>
  );
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function SetupPanel({ overview, mine, other }: { overview: BoxOverview; mine: BoxLap | null; other: BoxLap | null }) {
  const setup = overview.reglajes.find((s) => s.id === mine?.reglaje);
  const compare = other && other.reglaje && other.reglaje !== mine?.reglaje
    ? overview.reglajes.find((s) => s.id === other.reglaje)
    : undefined;
  const rows = useMemo(() => (setup ? setupRows(setup.valores, compare?.valores) : []), [setup, compare]);
  if (!setup) {
    return (
      <Panel title="Reglaje">
        <p className="py-3 text-[0.9rem] text-dim">El juego no mandó el reglaje de esta vuelta.</p>
      </Panel>
    );
  }
  return (
    <Panel title="Reglaje de la vuelta" right={<span className="title text-[0.95rem] text-muted">Reglaje {setup.id}</span>}>
      {overview.reglajes.length > 1 && (
        <ul className="mb-3 space-y-0.5 text-xs text-muted">
          {overview.reglajes.map((s) => (
            <li key={s.id}>
              <span className="num font-semibold text-fg">{s.id}</span>: {lapsText(s.vueltas)}
            </li>
          ))}
        </ul>
      )}
      <table className="w-full text-[0.9rem]">
        {compare && (
          <thead>
            <tr className="eyebrow">
              <th className="pb-1 text-left font-normal" />
              <th className="pb-1 text-right font-normal">
                <span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: MINE_COLOR }} />
                {setup.id}
              </th>
              <th className="pb-1 text-right font-normal">
                <span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: REF_COLOR }} />
                {compare.id}
              </th>
            </tr>
          </thead>
        )}
        <tbody>
          {rows.map(([label, value, otherValue, changed]) => (
            <tr key={label} className="border-t border-panel-2">
              <td className={`py-1 pr-2 ${changed ? "text-fg" : "text-muted"}`}>{label}</td>
              <td className={`title num py-1.5 text-right text-[0.98rem] normal-case ${changed ? "text-accent-ink" : ""}`}>{value}</td>
              {compare && <td className={`title num py-1.5 text-right text-[0.98rem] normal-case ${changed ? "text-best" : "text-muted"}`}>{otherValue}</td>}
            </tr>
          ))}
        </tbody>
      </table>
      {compare && <p className="mt-2 text-[0.8rem] text-dim">En color, lo que cambia entre los dos reglajes.</p>}
    </Panel>
  );
}

function setupRows(v: SetupValues, other?: SetupValues): [string, string, string, boolean][] {
  const fmt = (x: unknown, unit = "") =>
    typeof x === "number" ? `${x.toLocaleString("es-AR", { maximumFractionDigits: 2 })}${unit}` : "—";
  const rows: [string, string, string, boolean][] = SETUP_ES.map(([key, label, unit]) => [
    label,
    fmt(v[key], unit),
    other ? fmt(other[key], unit) : "",
    !!other && v[key] !== other[key],
  ]);
  const p = v.presiones_psi as Record<string, number> | undefined;
  const q = other?.presiones_psi as Record<string, number> | undefined;
  for (const [key, label] of PRESSURE_ES) {
    rows.push([`${label}`, fmt(p?.[key], " psi"), q ? fmt(q[key], " psi") : "", !!q && p?.[key] !== q[key]]);
  }
  return rows;
}

function lapsText(laps: number[]): string {
  if (laps.length === 1) return `vuelta ${laps[0]}`;
  const contiguous = laps.every((n, i) => i === 0 || n === laps[i - 1] + 1);
  return contiguous ? `vueltas ${laps[0]} a ${laps[laps.length - 1]}` : `vueltas ${laps.join(", ")}`;
}

const ISSUE_SHORT: Record<string, string> = {
  subviraje: "subviraje",
  sobreviraje: "sobreviraje",
  patinaje_traccion: "patinaje",
  bloqueo_delantero: "bloqueo adelante",
  bloqueo_trasero: "bloqueo atrás",
  fuera_de_pista: "fuera de pista",
};

/** Every run of the session, newest first: what the car did, what to change and what the last change did. */
function RunsPanel({ runs, sessionId, onBestLap }: { runs: Run[]; sessionId: number; onBestLap: (lap: number) => void }) {
  const ordered = [...runs].reverse();
  return (
    <Panel title="Tandas y sugerencias de reglaje">
      {runs.length === 0 && <p className="py-3 text-[0.9rem] text-dim">Todavía no hay vueltas completas.</p>}
      <ol className="flex flex-col gap-3">
        {ordered.map((run, i) => (
          <RunCard key={run.tanda} run={run} sessionId={sessionId} open={i === 0} onBestLap={onBestLap} />
        ))}
      </ol>
      <p className="mt-3 text-[0.8rem] text-dim">
        Una tanda son las vueltas entre dos pasadas por boxes con el mismo reglaje. Cambiá uno o dos valores por vez y
        compará la tanda siguiente: así sabés qué cambio sirvió.
      </p>
    </Panel>
  );
}

function RunCard({ run, sessionId, open, onBestLap }: { run: Run; sessionId: number; open: boolean; onBestLap: (lap: number) => void }) {
  const prev = run.contra_tanda_anterior;
  const range = run.vueltas.length > 1 ? `vueltas ${run.vueltas[0]} a ${run.vueltas[run.vueltas.length - 1]}` : `vuelta ${run.vueltas[0]}`;
  const issues = Object.entries(run.problemas_pct).filter(([, v]) => v >= 0.15).sort((a, b) => b[1] - a[1]);
  return (
    <li className="rounded-[12px] bg-bg p-3.5">
      <details open={open}>
        <summary className="cursor-pointer list-none">
          <div className="flex items-baseline justify-between gap-2">
            <span className="title text-[1.2rem]">
              Tanda {run.tanda} <span className="font-sans text-[0.8rem] font-normal normal-case text-dim">{range}{run.reglaje ? ` · reglaje ${run.reglaje}` : ""}</span>
            </span>
            <span className="title num text-[1.1rem] normal-case">{run.mejor_vuelta_s ? lapTime(ms(run.mejor_vuelta_s)) : "—"}</span>
          </div>
          {prev?.mejor_vuelta_diferencia_s != null && (
            <div className={`num text-right text-xs ${prev.mejor_vuelta_diferencia_s < 0 ? "text-ok" : "text-danger"}`}>
              {secondsText(prev.mejor_vuelta_diferencia_s)} contra la tanda anterior
            </div>
          )}
        </summary>

        {prev && prev.cambios_de_reglaje.length > 0 && (
          <div className="mt-2 text-xs">
            <div className="label mb-1">Qué cambiaste</div>
            <ul className="space-y-0.5">
              {prev.cambios_de_reglaje.map((c) => (
                <li key={c.parametro} className="num">
                  <span className="font-sans text-muted">{paramName(c.parametro)}:</span> {paramValue(c.parametro, c.antes)} → {paramValue(c.parametro, c.despues)}
                </li>
              ))}
            </ul>
          </div>
        )}

        {issues.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {issues.map(([k, v]) => {
              const before = prev?.problemas_antes_pct?.[k];
              return (
                <span key={k} className="rounded-md border border-line px-1.5 py-0.5 text-xs text-muted">
                  {ISSUE_SHORT[k] ?? k} <span className="num text-fg">{Math.round(v * 100)}%</span>
                  {before != null && <span className="num"> (antes {Math.round(before * 100)}%)</span>}
                </span>
              );
            })}
          </div>
        )}

        {run.nota && <p className="mt-2 text-xs text-muted">{run.nota}</p>}

        {run.sugerencias_reglaje.length > 0 ? (
          <ul className="mt-3 space-y-2">
            {run.sugerencias_reglaje.map((sug) => (
              <li key={sug.parametro} className="rounded-[10px] border border-line p-3 text-[0.9rem]">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-semibold">{paramName(sug.parametro)}</span>
                  <span className="title num text-[1.05rem]">
                    {paramValue(sug.parametro, sug.valor_actual)} → <span className="text-accent-ink">{paramValue(sug.parametro, sug.valor_sugerido)}</span>
                  </span>
                </div>
                <p className="mt-1 text-muted">
                  <span className="text-fg">{sug.problema}</span> ({sug.evidencia}). {sug.efecto}
                </p>
                <p className="mt-1 text-xs text-muted">A cambio: {sug.compromiso}</p>
                <Link href={`/reglaje?s=${sessionId}&p=${sug.parametro}`} className="mt-1.5 inline-block text-[0.82rem] text-accent-ink">
                  Ver qué hace en el auto ›
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          run.vueltas_limpias.length > 0 && (
            <p className="mt-2 text-sm text-muted">No aparece ningún problema repetido que pida tocar el reglaje.</p>
          )
        )}

        {run.conduccion.length > 0 && (
          <div className="mt-3">
            <div className="label mb-1">Manejo</div>
            <ul className="space-y-1 text-sm text-muted">
              {run.conduccion.map((d) => (
                <li key={`${d.problema}-${d.curva}`}>{d.texto}</li>
              ))}
            </ul>
          </div>
        )}

        {run.mejor_vuelta != null && (
          <button
            onClick={() => onBestLap(run.mejor_vuelta!)}
            className="btn mt-3 px-2.5 py-1.5 text-[0.82rem] text-muted hover:text-fg"
          >
            Ver la mejor vuelta de la tanda en el gráfico
          </button>
        )}
      </details>
    </li>
  );
}
