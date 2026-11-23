"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { sessionName } from "@/components/dashboard/Cards";
import { RequireAuth } from "@/components/RequireAuth";
import { CarViewer } from "@/components/setup/CarViewer";
import { ACADEMY, ACADEMY_ALIAS, type AcademyEntry, academyEntry, GROUPS, SYMPTOMS } from "@/lib/academy";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { BoxOverview, SetupSuggestion, SetupValues } from "@/lib/box";

type GameSession = {
  id: number;
  session_uid: string;
  track: string | null;
  track_id: number | null;
  session_type: string | null;
  started_at: string;
  has_recording: boolean;
};

type BaseSetup = {
  pista: string | null;
  lluvia: boolean;
  caracteristicas: { carga: number; pianos: number; traccion: number; frenada: number; nota: string };
  valores: SetupValues;
  nota: string;
  tu_mejor: { valores: SetupValues; vuelta_s: number; compuesto: string | null; temp_pista: number | null } | null;
};

type Source = "tanda" | "mejor" | "base";
const SOURCE_LABEL: Record<Source, string> = { tanda: "Tu última tanda", mejor: "Tu mejor reglaje acá", base: "Reglaje base" };

export default function SetupPage() {
  return (
    <RequireAuth>
      <Setup />
    </RequireAuth>
  );
}

const when = (iso: string) => new Date(iso).toLocaleString("es-AR", { dateStyle: "medium", timeStyle: "short", hour12: false });

/** The value of a setting in a setup; tyre pressures are shown per axle. */
function valueOf(v: SetupValues | null, key: string): number | null {
  if (!v) return null;
  const p = v.presiones_psi as Record<string, number> | undefined;
  if (key === "presion_del_izq") return p ? round1((p.del_izq + p.del_der) / 2) : null;
  if (key === "presion_tras_izq") return p ? round1((p.tras_izq + p.tras_der) / 2) : null;
  const x = v[key];
  return typeof x === "number" ? x : null;
}
const round1 = (x: number) => Math.round(x * 10) / 10;
const fmt = (e: AcademyEntry, v: number | null) =>
  v == null ? "—" : `${v.toLocaleString("es-AR", { maximumFractionDigits: 2 })}${e.unit ?? ""}`;

function Setup() {
  const { credentials } = useAuth();
  const [sessions, setSessions] = useState<GameSession[] | null>(null);
  const [sid, setSid] = useState<number | null>(null);
  const [overview, setOverview] = useState<BoxOverview | null>(null);
  const [selected, setSelected] = useState<string>("aleron_delantero");
  const [symptom, setSymptom] = useState<number | null>(null);
  const [tracks, setTracks] = useState<{ id: number; pista: string }[]>([]);
  const [pickedTrack, setPickedTrack] = useState<number | null>(null);
  // A session that just started is not in the list yet (it hides the very short ones): its track comes from the live state.
  const [liveTrack, setLiveTrack] = useState<number | null>(null);
  const [wet, setWet] = useState(false);
  const [base, setBase] = useState<BaseSetup | null>(null);
  const [source, setSource] = useState<Source | null>(null); // null = the best available
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const p = q.get("p");
    if (p) setSelected(ACADEMY_ALIAS[p] ?? p);
    (async () => {
      try {
        const all = await api<GameSession[]>("/api/sessions", await credentials());
        const recorded = all.filter((s) => s.has_recording);
        setSessions(recorded);
        setTracks(await api<{ id: number; pista: string }[]>("/api/setup/tracks", await credentials()));
        try {
          const live = await api<{ session_uid: string; track?: { id: number } | null }>("/api/live", await credentials());
          if (live.track && !recorded.some((s) => s.session_uid === live.session_uid)) setLiveTrack(live.track.id);
        } catch {
          /* no live session */
        }
        const wanted = Number(q.get("s"));
        setSid(recorded.find((s) => s.id === wanted)?.id ?? recorded[0]?.id ?? null);
      } catch {
        setSessions([]);
      }
    })();
  }, [credentials]);

  useEffect(() => {
    if (sid == null) return;
    let cancelled = false;
    setOverview(null);
    (async () => {
      try {
        const ov = await api<BoxOverview>(`/api/sessions/${sid}/box`, await credentials());
        if (!cancelled) setOverview(ov);
      } catch {
        /* the academy works without a session */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sid, credentials]);

  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("p", selected);
    if (sid != null) url.searchParams.set("s", String(sid));
    window.history.replaceState(null, "", url);
  }, [selected, sid]);

  // The track whose base setup to offer: the session's, or one picked by hand.
  const trackId = pickedTrack ?? liveTrack ?? overview?.sesion.track_id ?? sessions?.find((s) => s.id === sid)?.track_id ?? null;
  useEffect(() => {
    if (trackId == null) {
      setBase(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const b = await api<BaseSetup>(`/api/setup/base?track_id=${trackId}&lluvia=${wet}`, await credentials());
        if (!cancelled) setBase(b);
      } catch {
        if (!cancelled) setBase(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [trackId, wet, credentials]);

  // The setup and advice of the session's last run with data.
  const lastRun = useMemo(() => {
    const runs = overview?.tandas ?? [];
    return [...runs].reverse().find((r) => r.vueltas_limpias.length > 0) ?? runs[runs.length - 1] ?? null;
  }, [overview]);
  const runSetup = useMemo(() => {
    if (!overview || pickedTrack != null || liveTrack != null) return null;
    const id = lastRun?.reglaje ?? overview.reglajes[overview.reglajes.length - 1]?.id;
    return overview.reglajes.find((s) => s.id === id)?.valores ?? null;
  }, [overview, lastRun, pickedTrack, liveTrack]);
  // Where the values come from: the last run once there is one, else the best own setup here, else the base.
  const available: Source[] = [
    ...(runSetup ? (["tanda"] as Source[]) : []),
    ...(base?.tu_mejor ? (["mejor"] as Source[]) : []),
    ...(base ? (["base"] as Source[]) : []),
  ];
  const active: Source | null = source && available.includes(source) ? source : (available[0] ?? null);
  const setup = active === "tanda" ? runSetup : active === "mejor" ? (base?.tu_mejor?.valores ?? null) : active === "base" ? (base?.valores ?? null) : null;
  const suggestions = useMemo(() => {
    const out: Record<string, SetupSuggestion> = {};
    if (active !== "tanda") return out;
    for (const s of lastRun?.sugerencias_reglaje ?? []) out[ACADEMY_ALIAS[s.parametro] ?? s.parametro] = s;
    return out;
  }, [lastRun, active]);

  const order = useMemo(() => GROUPS.flatMap((g) => ACADEMY.filter((e) => e.group === g).map((e) => e.key)), []);
  const recommended = symptom != null ? SYMPTOMS[symptom].keys : [];

  const move = useCallback(
    (step: number) => {
      const i = order.indexOf(selected);
      setSelected(order[(i + step + order.length) % order.length]);
    },
    [order, selected],
  );

  // Up/down walk the list, like a setup menu in a game.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLSelectElement || e.target instanceof HTMLInputElement) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        move(1);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        move(-1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [move]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-key="${selected}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const entry = academyEntry(selected)!;
  const current = valueOf(setup, entry.key);
  const suggestion = suggestions[entry.key];

  return (
    <main className="mx-auto max-w-[1800px] px-3 pb-10 pt-3 sm:px-5">
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-panel px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="rounded bg-accent/20 px-2 py-0.5 text-xs font-semibold text-accent">REGLAJE</span>
            <span className="truncate text-lg font-semibold">Qué hace cada ajuste</span>
          </div>
          <div className="text-sm text-muted">
            {active && (base?.pista ?? overview?.sesion.pista)
              ? `${SOURCE_LABEL[active]} · ${base?.pista ?? overview?.sesion.pista}${active === "tanda" && overview?.sesion.tipo ? ` · ${sessionName(overview.sesion.tipo)}` : ""}`
              : "Elegí un ajuste para ver qué pasa en el auto"}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {sessions && sessions.length > 0 && (
            <select
              value={sid ?? ""}
              onChange={(e) => {
                setSid(Number(e.target.value));
                setLiveTrack(null);
                setPickedTrack(null);
              }}
              className="max-w-64 rounded-lg border border-line bg-panel-2 px-2 py-1.5 text-sm"
              aria-label="Sesión"
            >
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.track ?? "Pista desconocida"} · {s.session_type ? sessionName(s.session_type) : "Sesión"} · {when(s.started_at)}
                </option>
              ))}
            </select>
          )}
          <Link href={sid != null ? `/box?s=${sid}` : "/box"} className="rounded-lg border border-line px-3 py-1.5 text-sm text-muted hover:text-fg">
            Box
          </Link>
          <Link href="/" className="rounded-lg border border-line px-3 py-1.5 text-sm text-muted hover:text-fg">
            Dashboard
          </Link>
        </div>
      </header>

      <SourceBar
        available={available}
        active={active}
        onSource={setSource}
        wet={wet}
        onWet={setWet}
        base={base}
        tracks={tracks}
        trackId={trackId}
        onTrack={(id) => {
          setPickedTrack(id);
          setSource(null);
        }}
        lastRunNumber={lastRun?.tanda ?? null}
      />

      <section className="mt-3 rounded-2xl border border-line bg-panel p-3">
        <div className="label mb-2">¿Qué sentís en el auto?</div>
        <div className="-mx-3 flex gap-1.5 overflow-x-auto px-3 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0">
          {SYMPTOMS.map((s, i) => (
            <button
              key={s.label}
              onClick={() => {
                setSymptom(symptom === i ? null : i);
                if (symptom !== i) setSelected(s.keys[0]);
              }}
              className={`shrink-0 rounded-full border px-3 py-1 text-sm ${symptom === i ? "border-accent bg-accent/15 text-fg" : "border-line text-muted hover:text-fg"}`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </section>

      <div className="mt-3 grid gap-3 lg:grid-cols-[280px_minmax(0,1fr)] xl:grid-cols-[280px_minmax(0,1fr)_400px]">
        <div ref={listRef} className="order-2 max-h-[70vh] overflow-y-auto rounded-2xl border border-line bg-panel p-2 lg:order-1">
          {GROUPS.map((g) => (
            <div key={g} className="mb-2">
              <div className="label px-2 py-1.5">{g}</div>
              <ul>
                {ACADEMY.filter((e) => e.group === g).map((e) => {
                  const on = e.key === selected;
                  const v = valueOf(setup, e.key);
                  const sug = suggestions[e.key];
                  const rec = recommended.includes(e.key);
                  return (
                    <li key={e.key}>
                      <button
                        data-key={e.key}
                        onClick={() => setSelected(e.key)}
                        className={`flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-sm ${on ? "bg-accent/15 text-fg" : "text-muted hover:bg-panel-2 hover:text-fg"}`}
                        aria-current={on}
                      >
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span className={`h-4 w-1 shrink-0 rounded-full ${on ? "bg-accent" : "bg-transparent"}`} aria-hidden />
                          <span className="truncate">{e.title}</span>
                          {rec && <span className="shrink-0 rounded bg-warn/15 px-1 text-[0.65rem] font-semibold text-warn">PROBÁ</span>}
                        </span>
                        <span className="num shrink-0 text-xs">
                          {sug ? (
                            <span className="text-accent">
                              {fmt(e, v)} → {fmt(e, sug.valor_sugerido)}
                            </span>
                          ) : (
                            fmt(e, v)
                          )}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          <p className="px-2 pt-1 text-xs text-muted">Usá ↑ y ↓ para recorrer la lista.</p>
        </div>

        <div className="order-1 flex min-w-0 flex-col gap-3 lg:order-2">
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="rounded-lg border border-line bg-panel-2 px-2 py-2 text-sm lg:hidden"
            aria-label="Ajuste"
          >
            {GROUPS.map((g) => (
              <optgroup key={g} label={g}>
                {ACADEMY.filter((e) => e.group === g).map((e) => (
                  <option key={e.key} value={e.key}>
                    {e.title}
                    {suggestions[e.key] ? " · sugerencia" : ""}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <div className="relative h-[300px] overflow-hidden rounded-2xl border border-line bg-[radial-gradient(ellipse_at_center,#0f1a24_0%,#07090c_75%)] sm:h-[420px] xl:h-[560px]">
            <CarViewer focus={entry.key} bias={valueOf(setup, "reparto_frenada_pct")} />
            <div className="pointer-events-none absolute left-3 top-3 rounded-lg bg-bg/70 px-3 py-1.5 backdrop-blur">
              <div className="text-xs text-muted">{entry.group}</div>
              <div className="font-semibold">{entry.title}</div>
            </div>
            <div className="absolute bottom-3 right-3 flex gap-1">
              <button onClick={() => move(-1)} className="rounded-lg border border-line bg-bg/70 px-3 py-1.5 text-sm text-muted hover:text-fg" aria-label="Ajuste anterior">
                ↑
              </button>
              <button onClick={() => move(1)} className="rounded-lg border border-line bg-bg/70 px-3 py-1.5 text-sm text-muted hover:text-fg" aria-label="Ajuste siguiente">
                ↓
              </button>
            </div>
            <p className="pointer-events-none absolute bottom-3 left-3 text-xs text-muted">Arrastrá para girar el auto</p>
          </div>
          <div className="xl:hidden">
            <AcademyCard entry={entry} current={current} suggestion={suggestion} onPick={setSelected} />
          </div>
        </div>

        <div className="order-3 hidden xl:block">
          <AcademyCard entry={entry} current={current} suggestion={suggestion} onPick={setSelected} />
        </div>
      </div>
    </main>
  );
}

function AcademyCard({
  entry,
  current,
  suggestion,
  onPick,
}: {
  entry: AcademyEntry;
  current: number | null;
  suggestion?: SetupSuggestion;
  onPick: (k: string) => void;
}) {
  return (
    <section className="rounded-2xl border border-line bg-panel p-4">
      <header className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">{entry.title}</h2>
        <span className="num text-sm text-muted">{current != null ? fmt(entry, current) : ""}</span>
      </header>
      {entry.range && <RangeBar entry={entry} current={current} suggested={suggestion?.valor_sugerido ?? null} />}

      {suggestion && (
        <div className="mt-3 rounded-xl border border-accent/40 bg-accent/10 p-3 text-sm">
          <div className="label mb-1 text-accent">Sugerencia para tu última tanda</div>
          <div className="num font-semibold">
            {fmt(entry, suggestion.valor_actual)} → {fmt(entry, suggestion.valor_sugerido)}
          </div>
          <p className="mt-1 text-muted">
            <span className="text-fg">{suggestion.problema}</span> ({suggestion.evidencia}). {suggestion.efecto}
          </p>
          <p className="mt-1 text-xs text-muted">A cambio: {suggestion.compromiso}</p>
        </div>
      )}

      <p className="mt-3 text-sm">{entry.what}</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <div className="rounded-lg bg-panel-2 p-2.5 text-sm">
          <div className="label mb-1">Si lo subís</div>
          <p className="text-muted">{entry.up}</p>
        </div>
        <div className="rounded-lg bg-panel-2 p-2.5 text-sm">
          <div className="label mb-1">Si lo bajás</div>
          <p className="text-muted">{entry.down}</p>
        </div>
      </div>

      <h3 className="label mb-1.5 mt-4">Cuándo tocarlo</h3>
      <ul className="space-y-1.5 text-sm text-muted">
        {entry.when.map((w) => (
          <li key={w} className="flex gap-2">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
            <span>{w}</span>
          </li>
        ))}
      </ul>

      {entry.related.length > 0 && (
        <>
          <h3 className="label mb-1.5 mt-4">Se relaciona con</h3>
          <ul className="space-y-2 text-sm">
            {entry.related.map((r) => {
              const other = academyEntry(r.key);
              return (
                <li key={r.key} className="rounded-lg bg-panel-2 p-2.5">
                  <button onClick={() => onPick(other?.key ?? r.key)} className="font-semibold text-accent hover:underline">
                    {other?.title ?? r.key}
                  </button>
                  <p className="mt-0.5 text-muted">{r.text}</p>
                </li>
              );
            })}
          </ul>
        </>
      )}
      <p className="mt-4 text-xs text-muted">Tocá un valor por vez y dá dos o tres vueltas: así sabés qué cambio sirvió.</p>
    </section>
  );
}

function RangeBar({ entry, current, suggested }: { entry: AcademyEntry; current: number | null; suggested: number | null }) {
  const [lo, hi] = entry.range!;
  const pos = (v: number) => `${Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100))}%`;
  return (
    <div>
      <div className="relative h-2 rounded-full bg-panel-2">
        {current != null && <span className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-bg bg-fg" style={{ left: pos(current) }} title="Tu valor" />}
        {suggested != null && (
          <span className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-bg bg-accent" style={{ left: pos(suggested) }} title="Sugerido" />
        )}
      </div>
      <div className="num mt-1 flex justify-between text-[0.7rem] text-muted">
        <span>{fmt(entry, lo)}</span>
        {suggested != null && <span className="font-sans text-accent">● sugerido</span>}
        <span>{fmt(entry, hi)}</span>
      </div>
    </div>
  );
}

function SourceBar({
  available,
  active,
  onSource,
  wet,
  onWet,
  base,
  tracks,
  trackId,
  onTrack,
  lastRunNumber,
}: {
  available: Source[];
  active: Source | null;
  onSource: (s: Source) => void;
  wet: boolean;
  onWet: (w: boolean) => void;
  base: BaseSetup | null;
  tracks: { id: number; pista: string }[];
  trackId: number | null;
  onTrack: (id: number) => void;
  lastRunNumber: number | null;
}) {
  const explain: Record<Source, string> = {
    tanda: `Lo que usaste en la tanda ${lastRunNumber ?? ""} y lo que te sugiere el ingeniero para la próxima.`,
    mejor: base?.tu_mejor
      ? `El reglaje de tu mejor vuelta limpia en esta pista (${base.tu_mejor.vuelta_s.toLocaleString("es-AR", { minimumFractionDigits: 3 })} s${base.tu_mejor.compuesto ? `, ${base.tu_mejor.compuesto}` : ""}). Buen punto de partida para hoy.`
      : "",
    base: base ? `${base.caracteristicas.nota} ${base.nota}` : "",
  };
  return (
    <section className="mt-3 rounded-2xl border border-line bg-panel p-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="label mr-1">Valores</div>
        {(["tanda", "mejor", "base"] as Source[]).map((s) => {
          const on = active === s;
          const can = available.includes(s);
          return (
            <button
              key={s}
              disabled={!can}
              onClick={() => onSource(s)}
              className={`rounded-full border px-3 py-1 text-sm ${on ? "border-accent bg-accent/15 text-fg" : "border-line text-muted hover:text-fg"} disabled:cursor-not-allowed disabled:opacity-40`}
              title={can ? undefined : s === "tanda" ? "Todavía no diste vueltas en esta sesión" : s === "mejor" ? "Todavía no corriste en esta pista" : "Elegí una pista"}
            >
              {SOURCE_LABEL[s]}
            </button>
          );
        })}
        <label className="ml-auto flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" checked={wet} onChange={(e) => onWet(e.target.checked)} />
          Lluvia
        </label>
        <select
          value={trackId ?? ""}
          onChange={(e) => onTrack(Number(e.target.value))}
          className="max-w-48 rounded-lg border border-line bg-panel-2 px-2 py-1 text-sm"
          aria-label="Pista"
        >
          {trackId == null && <option value="">Elegí la pista…</option>}
          {tracks.map((t) => (
            <option key={t.id} value={t.id}>
              {t.pista}
            </option>
          ))}
        </select>
      </div>
      {active && <p className="mt-2 text-sm text-muted">{explain[active]}</p>}
      {!active && <p className="mt-2 text-sm text-muted">Elegí la pista para ver un reglaje base.</p>}
    </section>
  );
}
