"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { sessionName } from "@/components/dashboard/Cards";
import { RequireAuth } from "@/components/RequireAuth";
import { CarViewer } from "@/components/setup/CarViewer";
import { ACADEMY, ACADEMY_ALIAS, type AcademyEntry, academyEntry, GROUPS, SYMPTOMS } from "@/lib/academy";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { BoxOverview, Run, SetupSuggestion, SetupValues } from "@/lib/box";

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

/** A change agreed with the engineer on the radio, waiting to be applied in the game. */
type Agreed = { parametro: string; valor: number | string; motivo: string; estado: string };

type Source = "tanda" | "mejor" | "base";
const SOURCE_LABEL: Record<Source, string> = { tanda: "Tu última tanda", mejor: "Tu mejor acá", base: "Base de la pista" };

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
const fmt = (e: AcademyEntry | undefined, v: number | string | null) =>
  v == null ? "—" : typeof v === "string" ? v : `${v.toLocaleString("es-AR", { maximumFractionDigits: 2 })}${e?.unit ?? ""}`;
const keyOf = (param: string) => ACADEMY_ALIAS[param] ?? param;
/** 116.883 → "1:56,883", as a lap time is read. */
const lapS = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(3).padStart(6, "0").replace(".", ",")}`;

/** True on a tablet in landscape or a computer: the detail sits beside the list instead of over it. */
function useWide(): boolean {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const m = window.matchMedia("(min-width: 1024px)");
    const on = () => setWide(m.matches);
    on();
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return wide;
}

/**
 * Setup, in the order a driver thinks about it: where the values come from, what to
 * change (the engineer's advice, what was agreed on the radio, or a symptom), then the
 * whole setup. Each setting opens its explanation with the 3D car.
 */
function Setup() {
  const { credentials } = useAuth();
  const wide = useWide();
  const [sessions, setSessions] = useState<GameSession[] | null>(null);
  const [sid, setSid] = useState<number | null>(null);
  const [overview, setOverview] = useState<BoxOverview | null>(null);
  const [selected, setSelected] = useState<string>("aleron_delantero");
  const [open, setOpen] = useState(false); // the detail sheet, on a phone
  const [symptom, setSymptom] = useState<number | null>(null);
  const [tracks, setTracks] = useState<{ id: number; pista: string }[]>([]);
  const [pickedTrack, setPickedTrack] = useState<number | null>(null);
  // A session that just started is not in the list yet (it hides the very short ones): its track comes from the live state.
  const [liveTrack, setLiveTrack] = useState<number | null>(null);
  const [wet, setWet] = useState(false);
  const [base, setBase] = useState<BaseSetup | null>(null);
  const [source, setSource] = useState<Source | null>(null); // null = the best available
  const [agreed, setAgreed] = useState<{ track: number | null; items: Agreed[] }>({ track: null, items: [] });

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const p = q.get("p");
    if (p) {
      setSelected(keyOf(p));
      setOpen(true);
    }
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
        try {
          const mem = await api<{ pista_id: number | null; reglaje_acordado?: Agreed[] }>("/api/engineer/memory", await credentials());
          setAgreed({ track: mem.pista_id, items: (mem.reglaje_acordado ?? []).filter((a) => a.estado === "pendiente") });
        } catch {
          /* no memory yet */
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
    if (open || wide) url.searchParams.set("p", selected);
    else url.searchParams.delete("p");
    if (sid != null) url.searchParams.set("s", String(sid));
    window.history.replaceState(null, "", url);
  }, [selected, sid, open, wide]);

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
    for (const s of lastRun?.sugerencias_reglaje ?? []) out[keyOf(s.parametro)] = s;
    return out;
  }, [lastRun, active]);
  const agreedHere = agreed.track != null && agreed.track === trackId ? agreed.items : [];

  const order = useMemo(() => GROUPS.flatMap((g) => ACADEMY.filter((e) => e.group === g).map((e) => e.key)), []);
  const recommended = symptom != null ? SYMPTOMS[symptom].keys : [];

  const pick = useCallback((key: string) => {
    setSelected(keyOf(key));
    setOpen(true);
  }, []);
  const move = useCallback(
    (step: number) => {
      const i = order.indexOf(selected);
      setSelected(order[(i + step + order.length) % order.length]);
    },
    [order, selected],
  );

  // Up/down walk the settings, like a setup menu in a game; Escape closes the sheet.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLSelectElement || e.target instanceof HTMLInputElement) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        move(1);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        move(-1);
      } else if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [move]);

  const entry = academyEntry(selected)!;
  const detail = (
    <Detail
      entry={entry}
      current={valueOf(setup, entry.key)}
      suggestion={suggestions[entry.key]}
      bias={valueOf(setup, "reparto_frenada_pct")}
      onPick={(k) => setSelected(keyOf(k))}
      onMove={move}
      onClose={wide ? undefined : () => setOpen(false)}
    />
  );
  const pista = base?.pista ?? overview?.sesion.pista;

  return (
    <main className="mx-auto max-w-[1500px] px-3 pb-8 pt-3 sm:px-5">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="display text-3xl">Reglaje</h1>
          <p className="text-sm text-muted">
            {pista ? `${pista} · ${wet ? "lluvia" : "seco"}${active ? ` · ${SOURCE_LABEL[active].toLowerCase()}` : ""}` : "Elegí la pista para empezar"}
          </p>
        </div>
        {sid != null && (
          <Link href={`/box?s=${sid}`} className="chip px-3 py-1.5 text-sm text-muted hover:text-fg">
            Ver la tanda en el análisis
          </Link>
        )}
      </header>

      <div className="mt-3 lg:grid lg:grid-cols-[minmax(0,460px)_minmax(0,1fr)] lg:items-start lg:gap-4">
        <div className="flex flex-col gap-3">
          <StartCard
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
            sessions={sessions}
            sid={sid}
            onSession={(id) => {
              setSid(id);
              setLiveTrack(null);
              setPickedTrack(null);
            }}
            lastRun={lastRun}
          />
          <ChangeCard
            run={active === "tanda" ? lastRun : null}
            setup={setup}
            agreed={agreedHere}
            symptom={symptom}
            onSymptom={setSymptom}
            recommended={recommended}
            onPick={pick}
          />
          <SetupList setup={setup} suggestions={suggestions} recommended={recommended} selected={wide ? selected : null} onPick={pick} />
        </div>
        {wide && <div className="sticky top-16 max-h-[calc(100dvh-5rem)] overflow-y-auto overscroll-contain pr-1">{detail}</div>}
      </div>

      {!wide && open && (
        <div className="fixed inset-0 z-40 overflow-y-auto bg-bg pb-[max(1rem,env(safe-area-inset-bottom))] pt-[env(safe-area-inset-top)]" role="dialog" aria-label={entry.title}>
          {detail}
        </div>
      )}
    </main>
  );
}

/** Where the values on screen come from: track, dry or wet, and which setup. */
function StartCard({
  available,
  active,
  onSource,
  wet,
  onWet,
  base,
  tracks,
  trackId,
  onTrack,
  sessions,
  sid,
  onSession,
  lastRun,
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
  sessions: GameSession[] | null;
  sid: number | null;
  onSession: (id: number) => void;
  lastRun: Run | null;
}) {
  const explain: Record<Source, string> = {
    tanda: `Lo que usaste en la tanda ${lastRun?.tanda ?? ""}${lastRun?.mejor_vuelta_s ? ` (mejor vuelta ${lapS(lastRun.mejor_vuelta_s)})` : ""}, con lo que te sugiere el ingeniero para la próxima.`,
    mejor: base?.tu_mejor
      ? `El reglaje de tu mejor vuelta limpia en esta pista (${lapS(base.tu_mejor.vuelta_s)}${base.tu_mejor.compuesto ? `, ${base.tu_mejor.compuesto}` : ""}). Buen punto de partida para hoy.`
      : "",
    base: base ? `${base.caracteristicas.nota} ${base.nota}` : "",
  };
  const select = "w-full rounded-[var(--radius-control)] border border-line bg-panel-2 px-3 py-2 text-sm";
  return (
    <section className="card space-y-3 p-4">
      <div className="label">Partís de</div>
      <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="De dónde salen los valores">
        {(["tanda", "mejor", "base"] as Source[]).map((s) => {
          const can = available.includes(s);
          return (
            <button
              key={s}
              role="radio"
              aria-checked={active === s}
              disabled={!can}
              onClick={() => onSource(s)}
              className={`chip px-2 py-2 text-center text-xs sm:text-sm ${active === s ? "!border-accent bg-accent/15 text-fg" : "text-muted"} disabled:opacity-35`}
              title={can ? undefined : s === "tanda" ? "Todavía no diste vueltas en esta sesión" : s === "mejor" ? "Todavía no corriste en esta pista" : "Elegí una pista"}
            >
              {SOURCE_LABEL[s]}
            </button>
          );
        })}
      </div>
      {active ? <p className="text-sm text-muted">{explain[active]}</p> : <p className="text-sm text-muted">Elegí la pista para ver un reglaje base.</p>}

      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
        <select value={trackId ?? ""} onChange={(e) => onTrack(Number(e.target.value))} className={select} aria-label="Pista">
          {trackId == null && <option value="">Elegí la pista…</option>}
          {tracks.map((t) => (
            <option key={t.id} value={t.id}>
              {t.pista}
            </option>
          ))}
        </select>
        <div className="flex overflow-hidden rounded-[var(--radius-control)] border border-line" role="radiogroup" aria-label="Clima">
          {[false, true].map((w) => (
            <button
              key={String(w)}
              role="radio"
              aria-checked={wet === w}
              onClick={() => onWet(w)}
              className={`px-3 text-sm ${wet === w ? "bg-accent text-accent-fg" : "text-muted"}`}
            >
              {w ? "Lluvia" : "Seco"}
            </button>
          ))}
        </div>
      </div>
      {active === "tanda" && sessions && sessions.length > 1 && (
        <select value={sid ?? ""} onChange={(e) => onSession(Number(e.target.value))} className={select} aria-label="Sesión">
          {sessions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.track ?? "Pista desconocida"} · {s.session_type ? sessionName(s.session_type) : "Sesión"} · {when(s.started_at)}
            </option>
          ))}
        </select>
      )}
    </section>
  );
}

/** What to change next: the engineer's advice for the last run, what was agreed on the radio,
 *  whether the last change helped, or the settings to look at for a feeling. */
function ChangeCard({
  run,
  setup,
  agreed,
  symptom,
  onSymptom,
  recommended,
  onPick,
}: {
  run: Run | null;
  setup: SetupValues | null;
  agreed: Agreed[];
  symptom: number | null;
  onSymptom: (i: number | null) => void;
  recommended: string[];
  onPick: (key: string) => void;
}) {
  const suggestions = run?.sugerencias_reglaje ?? [];
  const last = run?.contra_tanda_anterior;
  const lastChange = last && last.cambios_de_reglaje.length > 0 ? last : null;
  return (
    <section className="card space-y-3 p-4">
      <div className="label">Qué cambiar</div>

      {agreed.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-xs font-semibold text-warn">Acordado con el ingeniero, todavía sin aplicar</div>
          {agreed.map((a) => {
            const e = academyEntry(a.parametro);
            return (
              <Row
                key={a.parametro}
                title={e?.title ?? a.parametro}
                value={`${fmt(e, valueOf(setup, keyOf(a.parametro)))} → ${fmt(e, a.valor)}`}
                text={a.motivo}
                tone="warn"
                onClick={() => onPick(a.parametro)}
              />
            );
          })}
        </div>
      )}

      {lastChange && (
        <div className="rounded-[var(--radius-card)] bg-panel-2 p-3 text-sm">
          <div className="text-xs font-semibold text-muted">Tu último cambio</div>
          <p className="mt-0.5">
            {lastChange.cambios_de_reglaje.map((c) => `${academyEntry(c.parametro)?.title ?? c.parametro} ${c.antes} → ${c.despues}`).join(", ")}
          </p>
          {lastChange.mejor_vuelta_diferencia_s != null && (
            <p className={`mt-0.5 font-semibold ${lastChange.mejor_vuelta_diferencia_s < 0 ? "text-ok" : "text-warn"}`}>
              {lastChange.mejor_vuelta_diferencia_s < 0
                ? `Sirvió: tu mejor vuelta bajó ${Math.abs(lastChange.mejor_vuelta_diferencia_s).toFixed(2).replace(".", ",")} s`
                : `No mejoró: tu mejor vuelta subió ${lastChange.mejor_vuelta_diferencia_s.toFixed(2).replace(".", ",")} s`}
            </p>
          )}
        </div>
      )}

      {suggestions.length > 0 ? (
        <div className="space-y-1.5">
          <div className="text-xs font-semibold text-accent">Para tu próxima tanda, de a uno por vez</div>
          {suggestions.map((s) => {
            const e = academyEntry(s.parametro);
            return (
              <Row
                key={s.parametro}
                title={e?.title ?? s.parametro}
                value={`${fmt(e, s.valor_actual)} → ${fmt(e, s.valor_sugerido)}`}
                text={`${s.problema} (${s.evidencia}).`}
                tone="accent"
                onClick={() => onPick(s.parametro)}
              />
            );
          })}
        </div>
      ) : run ? (
        <p className="text-sm text-muted">El ingeniero no ve nada para cambiar en tu última tanda. Si el auto anda, no lo toques.</p>
      ) : null}

      {run && run.conduccion.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-muted">No es reglaje: es manejo</div>
          <ul className="mt-1 space-y-1 text-sm">
            {run.conduccion.slice(0, 3).map((c) => (
              <li key={`${c.curva}-${c.problema}`} className="flex gap-2">
                <span className="text-accent">›</span>
                {c.texto}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <div className="text-xs font-semibold text-muted">¿Qué sentís en el auto?</div>
        <div className="-mx-4 mt-1.5 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
          {SYMPTOMS.map((s, i) => (
            <button
              key={s.label}
              onClick={() => onSymptom(symptom === i ? null : i)}
              aria-pressed={symptom === i}
              className={`chip shrink-0 px-3 py-1.5 text-sm ${symptom === i ? "!border-accent bg-accent/15 text-fg" : "text-muted"}`}
            >
              {s.label}
            </button>
          ))}
        </div>
        {recommended.length > 0 && (
          <div className="mt-2 space-y-1.5">
            <div className="text-xs text-muted">Probá tocar, en este orden:</div>
            {recommended.map((k) => {
              const e = academyEntry(k);
              return <Row key={k} title={e?.title ?? k} value={fmt(e, valueOf(setup, k))} text={e?.when[0] ?? ""} onClick={() => onPick(k)} />;
            })}
          </div>
        )}
      </div>
    </section>
  );
}

function Row({ title, value, text, tone, onClick }: { title: string; value: string; text: string; tone?: "accent" | "warn"; onClick: () => void }) {
  const border = tone === "accent" ? "border-accent/50" : tone === "warn" ? "border-warn/50" : "border-line";
  return (
    <button onClick={onClick} className={`flex w-full items-start justify-between gap-3 rounded-[var(--radius-card)] border ${border} px-3 py-2.5 text-left hover:bg-panel-2`}>
      <span className="min-w-0">
        <span className="block font-semibold">{title}</span>
        {text && <span className="mt-0.5 block text-xs text-muted">{text}</span>}
      </span>
      <span className={`num shrink-0 text-sm font-semibold ${tone === "accent" ? "text-accent" : tone === "warn" ? "text-warn" : ""}`}>{value}</span>
    </button>
  );
}

/** The whole setup by group, with what the engineer would change marked. */
function SetupList({
  setup,
  suggestions,
  recommended,
  selected,
  onPick,
}: {
  setup: SetupValues | null;
  suggestions: Record<string, SetupSuggestion>;
  recommended: string[];
  selected: string | null;
  onPick: (key: string) => void;
}) {
  return (
    <section className="card p-2">
      <div className="label px-2 pb-1 pt-2">Tu reglaje completo</div>
      {GROUPS.map((g) => (
        <div key={g} className="mb-1">
          <div className="px-2 pb-0.5 pt-2 text-xs font-semibold text-muted">{g}</div>
          <ul>
            {ACADEMY.filter((e) => e.group === g).map((e) => {
              const on = e.key === selected;
              const v = valueOf(setup, e.key);
              const sug = suggestions[e.key];
              return (
                <li key={e.key}>
                  <button
                    onClick={() => onPick(e.key)}
                    aria-current={on || undefined}
                    className={`flex w-full items-center justify-between gap-2 rounded-[var(--radius-control)] px-2 py-2 text-left text-sm ${on ? "bg-accent/15 text-fg" : "hover:bg-panel-2"}`}
                  >
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate">{e.title}</span>
                      {recommended.includes(e.key) && <span className="shrink-0 rounded bg-warn/15 px-1 text-[0.65rem] font-semibold text-warn">PROBÁ</span>}
                    </span>
                    <span className="num flex shrink-0 items-center gap-2 text-xs">
                      {sug ? (
                        <span className="text-accent">
                          {fmt(e, v)} → {fmt(e, sug.valor_sugerido)}
                        </span>
                      ) : (
                        <span className="text-muted">{fmt(e, v)}</span>
                      )}
                      <span className="text-muted" aria-hidden>
                        ›
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </section>
  );
}

/** One setting: the car turning to it, the engineer's advice and what it does. */
function Detail({
  entry,
  current,
  suggestion,
  bias,
  onPick,
  onMove,
  onClose,
}: {
  entry: AcademyEntry;
  current: number | null;
  suggestion?: SetupSuggestion;
  bias: number | null;
  onPick: (k: string) => void;
  onMove: (step: number) => void;
  onClose?: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 p-3 lg:p-0">
      <header className="flex items-center gap-2">
        {onClose && (
          <button onClick={onClose} className="chip px-3 py-1.5 text-sm" aria-label="Volver a la lista">
            ‹ Volver
          </button>
        )}
        <div className="min-w-0 flex-1">
          <div className="text-xs text-muted">{entry.group}</div>
          <h2 className="display truncate text-2xl">{entry.title}</h2>
        </div>
        <div className="flex gap-1">
          <button onClick={() => onMove(-1)} className="chip px-3 py-1.5 text-sm text-muted" aria-label="Ajuste anterior">
            ↑
          </button>
          <button onClick={() => onMove(1)} className="chip px-3 py-1.5 text-sm text-muted" aria-label="Ajuste siguiente">
            ↓
          </button>
        </div>
      </header>

      <div className="relative h-[260px] overflow-hidden rounded-[var(--radius-card)] border border-line bg-[radial-gradient(ellipse_at_center,#0f1a24_0%,#07090c_75%)] sm:h-[360px] xl:h-[440px]">
        <CarViewer focus={entry.key} bias={bias} />
        <p className="pointer-events-none absolute bottom-2 left-3 text-xs text-muted">Arrastrá para girar el auto</p>
      </div>

      <section className="card p-4">
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <span className="label">Tu valor</span>
          <span className="display text-2xl">{current != null ? fmt(entry, current) : "—"}</span>
        </div>
        {entry.range && <RangeBar entry={entry} current={current} suggested={suggestion?.valor_sugerido ?? null} />}

        {suggestion && (
          <div className="mt-3 rounded-[var(--radius-card)] border border-accent/40 bg-accent/10 p-3 text-sm">
            <div className="label mb-1 !text-accent">El ingeniero sugiere</div>
            <div className="num text-lg font-semibold">
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
          <div className="rounded-[var(--radius-card)] bg-panel-2 p-3 text-sm">
            <div className="label mb-1">Si lo subís</div>
            <p className="text-muted">{entry.up}</p>
          </div>
          <div className="rounded-[var(--radius-card)] bg-panel-2 p-3 text-sm">
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
            <h3 className="label mb-1.5 mt-4">Va de la mano con</h3>
            <ul className="space-y-2 text-sm">
              {entry.related.map((r) => {
                const other = academyEntry(r.key);
                return (
                  <li key={r.key}>
                    <button onClick={() => onPick(other?.key ?? r.key)} className="w-full rounded-[var(--radius-card)] bg-panel-2 p-3 text-left hover:ring-1 hover:ring-accent/50">
                      <span className="font-semibold text-accent">{other?.title ?? r.key} ›</span>
                      <span className="mt-0.5 block text-muted">{r.text}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
        <p className="mt-4 text-xs text-muted">Tocá un valor por vez y dá dos o tres vueltas: así sabés qué cambio sirvió.</p>
      </section>
    </div>
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
        <span className="font-sans">
          <span className="text-fg">● vos</span>
          {suggested != null && <span className="ml-2 text-accent">● sugerido</span>}
        </span>
        <span>{fmt(entry, hi)}</span>
      </div>
    </div>
  );
}
