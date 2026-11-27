"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { sessionName } from "@/components/dashboard/Cards";
import { RequireAuth } from "@/components/RequireAuth";
import { CarViewer } from "@/components/setup/CarViewer";
import { ACADEMY, ACADEMY_ALIAS, type AcademyEntry, academyEntry, GROUPS, SYMPTOMS } from "@/lib/academy";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { COMPOUND_ES, type BoxOverview, type Run, type SetupSuggestion, type SetupValues } from "@/lib/box";

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
    if (p && academyEntry(keyOf(p))) {
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

  // An unknown or old setting name in the link falls back to the first setting instead of breaking the page.
  const entry = academyEntry(selected) ?? academyEntry(order[0])!;
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
    <main className="mx-auto max-w-[1600px] px-[max(1rem,env(safe-area-inset-left))] pb-8 pt-4 lg:px-7 lg:pt-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <span className="eyebrow block">
            {pista ? `${pista} · ${wet ? "lluvia" : "seco"}${active ? ` · ${SOURCE_LABEL[active].toLowerCase()}` : ""}` : "Elegí la pista para empezar"}
          </span>
          <h1 className="display mt-1 text-[2.4rem] uppercase lg:text-[2.9rem]">Reglaje</h1>
        </div>
        {sid != null && (
          <Link href={`/box?s=${sid}`} className="btn mb-1 px-3.5 py-2 text-[0.88rem] text-muted hover:text-fg">
            Ver la telemetría de la tanda ›
          </Link>
        )}
      </header>

      <div className="mt-4 lg:grid lg:grid-cols-[minmax(0,440px)_minmax(0,1fr)] lg:items-start lg:gap-5">
        <div className="flex flex-col gap-4">
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
        {wide && <div className="sticky top-[76px] max-h-[calc(100dvh-90px)] overflow-y-auto overscroll-contain pr-1">{detail}</div>}
      </div>

      {!wide && open && (
        <div className="fixed inset-0 z-40 overflow-y-auto bg-bg pb-[max(1rem,env(safe-area-inset-bottom))] pt-[env(safe-area-inset-top)]" role="dialog" aria-label={entry.title}>
          {detail}
        </div>
      )}
    </main>
  );
}

/** A segmented choice, the same control as Boxes and Pista. */
function Segmented<T extends string | boolean>({ options, value, onChange, label, disabled }: { options: { v: T; label: string; hint?: string }[]; value: T | null; onChange: (v: T) => void; label: string; disabled?: (v: T) => boolean }) {
  return (
    <div className="flex rounded-[var(--radius-control)] bg-bg p-1" role="radiogroup" aria-label={label}>
      {options.map((o) => {
        const off = disabled?.(o.v) ?? false;
        return (
          <button
            key={String(o.v)}
            type="button"
            role="radio"
            aria-checked={value === o.v}
            disabled={off}
            title={off ? o.hint : undefined}
            onClick={() => onChange(o.v)}
            className={`title min-w-0 flex-1 truncate rounded-[8px] px-2.5 py-2 text-[0.92rem] ${value === o.v ? "bg-fg text-bg" : "text-muted"} disabled:opacity-35`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
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
      ? `El reglaje de tu mejor vuelta limpia en esta pista (${lapS(base.tu_mejor.vuelta_s)}${base.tu_mejor.compuesto ? `, con ${(COMPOUND_ES[base.tu_mejor.compuesto] ?? base.tu_mejor.compuesto).toLowerCase()}` : ""}). Buen punto de partida para hoy.`
      : "",
    base: base ? `${base.caracteristicas.nota} ${base.nota}` : "",
  };
  const select = "h-11 w-full rounded-[var(--radius-control)] border border-line bg-bg px-3 text-[0.92rem] text-fg";
  return (
    <section className="card flex flex-col gap-3 px-4 py-4">
      <h2 className="eyebrow">Partís de</h2>
      <Segmented
        label="De dónde salen los valores"
        value={active}
        onChange={onSource}
        disabled={(s) => !available.includes(s)}
        options={[
          { v: "tanda" as Source, label: "Tu tanda", hint: "Todavía no diste vueltas en esta sesión" },
          { v: "mejor" as Source, label: "Tu mejor", hint: "Todavía no corriste en esta pista" },
          { v: "base" as Source, label: "Base", hint: "Elegí una pista" },
        ]}
      />
      <p className="text-[0.92rem] leading-snug text-soft-fg">{active ? explain[active] : "Elegí la pista para ver un reglaje base."}</p>
      <div className="grid grid-cols-[minmax(0,1fr)_150px] gap-2">
        <select value={trackId ?? ""} onChange={(e) => onTrack(Number(e.target.value))} className={select} aria-label="Pista">
          {trackId == null && <option value="">Elegí la pista…</option>}
          {tracks.map((t) => (
            <option key={t.id} value={t.id}>
              {t.pista}
            </option>
          ))}
        </select>
        <Segmented label="Clima" value={wet} onChange={onWet} options={[{ v: false, label: "Seco" }, { v: true, label: "Lluvia" }]} />
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

function Tag({ children, tone }: { children: React.ReactNode; tone: "warn" | "accent" | "ok" | "muted" }) {
  const c = { warn: "border-warn/40 text-warn", accent: "border-accent/50 text-accent-ink", ok: "border-ok/40 text-ok", muted: "border-line text-dim" }[tone];
  return <span className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[0.65rem] tracking-wider ${c}`}>{children}</span>;
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
  const first = suggestions[0];
  const e0 = first ? academyEntry(first.parametro) : undefined;
  return (
    <section className="flex flex-col gap-3" aria-label="Qué cambiar">
      <h2 className="eyebrow">Qué cambiar</h2>

      {agreed.map((a) => {
        const e = academyEntry(a.parametro);
        return (
          <button key={a.parametro} type="button" onClick={() => onPick(a.parametro)} className="card flex flex-col gap-1.5 px-4 py-3.5 text-left ring-1 ring-warn/40 hover:bg-panel-2">
            <span className="flex items-center justify-between gap-3">
              <Tag tone="warn">ACORDADO POR RADIO</Tag>
              <span className="title num text-[1.15rem]">{fmt(e, valueOf(setup, keyOf(a.parametro)))} → {fmt(e, a.valor)}</span>
            </span>
            <span className="title text-[1.2rem]">{e?.title ?? a.parametro}</span>
            {a.motivo && <span className="text-[0.88rem] text-muted">{a.motivo}</span>}
          </button>
        );
      })}

      {lastChange && (
        <div className="card flex items-center gap-4 px-4 py-3.5">
          <div className="min-w-0 flex-1">
            <span className="eyebrow block">Tu último cambio</span>
            <span className="mt-1 block text-[0.92rem] text-soft-fg">
              {lastChange.cambios_de_reglaje.map((c) => `${academyEntry(c.parametro)?.title ?? c.parametro} ${c.antes} → ${c.despues}`).join(", ")}
            </span>
          </div>
          {lastChange.mejor_vuelta_diferencia_s != null && (
            <div className="text-right">
              <span className={`display block text-[1.7rem] not-italic ${lastChange.mejor_vuelta_diferencia_s < 0 ? "text-ok" : "text-warn"}`}>
                {lastChange.mejor_vuelta_diferencia_s < 0 ? "−" : "+"}
                {Math.abs(lastChange.mejor_vuelta_diferencia_s).toFixed(2).replace(".", ",")}
              </span>
              <span className="text-[0.78rem] text-dim">{lastChange.mejor_vuelta_diferencia_s < 0 ? "sirvió" : "no mejoró"}</span>
            </div>
          )}
        </div>
      )}

      {first ? (
        <button type="button" onClick={() => onPick(first.parametro)} className="paper flex flex-col gap-2.5 px-5 py-5 text-left">
          <span className="text-[0.85rem] text-paper-muted">Para tu próxima tanda · un cambio por vez</span>
          <span className="title text-[1.6rem]">{e0?.title ?? first.parametro}</span>
          <span className="display flex items-baseline gap-3 not-italic">
            <span className="text-[2.6rem] text-[#6b717c]">{fmt(e0, first.valor_actual)}</span>
            <span className="text-[1.5rem] text-[#6b717c]">→</span>
            <span className="text-[2.6rem] text-[#d92b14]">{fmt(e0, first.valor_sugerido)}</span>
          </span>
          <span className="text-[0.92rem] leading-snug text-[#2a2e35]">
            {first.problema} ({first.evidencia}).
          </span>
          <span className="text-[0.85rem] font-semibold">Verlo en el auto ›</span>
        </button>
      ) : run ? (
        <div className="card px-4 py-4 text-[0.92rem] text-soft-fg">El ingeniero no ve nada para cambiar en tu última tanda. Si el auto anda, no lo toques.</div>
      ) : null}

      {suggestions.length > 1 && (
        <div className="card flex flex-col gap-1 px-2 py-2">
          <span className="px-2 pt-1 text-[0.82rem] text-dim">Después, si hace falta</span>
          {suggestions.slice(1).map((x) => {
            const e = academyEntry(x.parametro);
            return (
              <button key={x.parametro} type="button" onClick={() => onPick(x.parametro)} className="flex items-baseline justify-between gap-3 rounded-[8px] px-2 py-2 text-left hover:bg-panel-2">
                <span className="min-w-0">
                  <span className="block text-[0.95rem]">{e?.title ?? x.parametro}</span>
                  <span className="block text-[0.8rem] text-dim">{x.problema}</span>
                </span>
                <span className="title num shrink-0 text-[1.1rem] text-accent-ink">{fmt(e, x.valor_actual)} → {fmt(e, x.valor_sugerido)}</span>
              </button>
            );
          })}
        </div>
      )}

      {run?.conduccion.slice(0, 3).map((c) => (
        <div key={`${c.curva}-${c.problema}`} className="card flex items-start gap-3 px-4 py-3.5">
          <Tag tone="warn">MANEJO</Tag>
          <span className="text-[0.9rem] leading-snug text-soft-fg">{c.texto}</span>
        </div>
      ))}

      <div className="card flex flex-col gap-3 px-4 py-4">
        <h3 className="eyebrow">¿Qué sentís en el auto?</h3>
        <div className="flex flex-wrap gap-1.5">
          {SYMPTOMS.map((x, i) => (
            <button
              key={x.label}
              type="button"
              onClick={() => onSymptom(symptom === i ? null : i)}
              aria-pressed={symptom === i}
              className={`rounded-full px-3 py-1.5 text-[0.85rem] ${symptom === i ? "bg-accent/15 text-fg ring-1 ring-accent" : "bg-panel-2 text-muted hover:text-fg"}`}
            >
              {x.label}
            </button>
          ))}
        </div>
        {recommended.length > 0 && (
          <div className="flex flex-col gap-1">
            <span className="text-[0.82rem] text-dim">Probá tocar, en este orden</span>
            {recommended.map((k, i) => {
              const e = academyEntry(k);
              return (
                <button key={k} type="button" onClick={() => onPick(k)} className="flex items-center gap-3 rounded-[8px] px-1 py-2 text-left hover:bg-panel-2">
                  <span className="display w-6 text-[1.3rem] not-italic text-dim">{i + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[0.95rem]">{e?.title ?? k}</span>
                    <span className="block text-[0.8rem] text-dim">{e?.when[0] ?? ""}</span>
                  </span>
                  <span className="title num text-[1.05rem]">{fmt(e, valueOf(setup, k))}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </section>
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
    <section className="flex flex-col gap-2" aria-label="Tu reglaje completo">
      <h2 className="eyebrow">Tu reglaje completo</h2>
      <div className="card px-2 py-2">
        {GROUPS.map((g) => (
          <div key={g} className="mb-1">
            <div className="title px-2 pb-1 pt-3 text-[0.95rem] text-dim">{g}</div>
            <ul>
              {ACADEMY.filter((e) => e.group === g).map((e) => {
                const on = e.key === selected;
                const v = valueOf(setup, e.key);
                const sug = suggestions[e.key];
                return (
                  <li key={e.key}>
                    <button
                      type="button"
                      onClick={() => onPick(e.key)}
                      aria-current={on || undefined}
                      className={`flex w-full items-center justify-between gap-2 rounded-[10px] px-2.5 py-2.5 text-left ${on ? "bg-panel-2 shadow-[inset_3px_0_0_var(--color-accent)]" : "hover:bg-panel-2"}`}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-[0.95rem]">{e.title}</span>
                        {recommended.includes(e.key) && <Tag tone="warn">PROBÁ</Tag>}
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        {sug ? (
                          <span className="title num text-[1.05rem] text-accent-ink">
                            {fmt(e, v)} → {fmt(e, sug.valor_sugerido)}
                          </span>
                        ) : (
                          <span className="title num text-[1.05rem]">{fmt(e, v)}</span>
                        )}
                        <span className="text-dim" aria-hidden>
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
      </div>
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
  const arrow = "grid h-10 w-10 place-items-center rounded-[var(--radius-control)] border border-line text-muted hover:text-fg";
  return (
    <div className="flex flex-col gap-4 p-4 lg:p-0">
      <header className="flex items-center gap-3">
        {onClose && (
          <button type="button" onClick={onClose} className="btn px-3 py-2 text-[0.9rem]" aria-label="Volver a la lista">
            ‹ Volver
          </button>
        )}
        <div className="min-w-0 flex-1">
          <span className="eyebrow block">{entry.group}</span>
          <h2 className="title truncate text-[1.8rem] lg:text-[2.1rem]">{entry.title}</h2>
        </div>
        <button type="button" onClick={() => onMove(-1)} className={arrow} aria-label="Ajuste anterior">
          ↑
        </button>
        <button type="button" onClick={() => onMove(1)} className={arrow} aria-label="Ajuste siguiente">
          ↓
        </button>
      </header>

      <div className="card relative h-[270px] overflow-hidden bg-[radial-gradient(ellipse_at_center,#1c1f24_0%,#0b0c0e_78%)] sm:h-[380px] xl:h-[460px]">
        <CarViewer focus={entry.key} bias={bias} setting={{ value: current ?? null, suggested: suggestion?.valor_sugerido ?? null, range: entry.range }} />
        <p className="pointer-events-none absolute right-4 bottom-3 left-4 flex flex-wrap justify-between gap-x-3 text-[0.78rem] text-dim">
          <span>Arrastrá para girar el auto</span>
          {current != null && entry.range && (
            <span className="text-soft-fg">
              {suggestion ? `Se mueve entre tu valor (${fmt(entry, current)}) y el sugerido (${fmt(entry, suggestion.valor_sugerido)})` : `Así está con tu valor: ${fmt(entry, current)}`}
            </span>
          )}
        </p>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="card flex flex-col gap-3 px-5 py-4">
          <div className="flex items-baseline justify-between gap-2">
            <span className="eyebrow">Tu valor</span>
            <span className="display text-[2.6rem] not-italic">{current != null ? fmt(entry, current) : "—"}</span>
          </div>
          {entry.range && <RangeBar entry={entry} current={current} suggested={suggestion?.valor_sugerido ?? null} />}
          <p className="text-[0.95rem] leading-snug text-soft-fg">{entry.what}</p>
        </section>

        {suggestion ? (
          <section className="paper flex flex-col gap-2 px-5 py-4">
            <span className="text-[0.85rem] text-paper-muted">El ingeniero sugiere</span>
            <span className="display flex items-baseline gap-3 not-italic">
              <span className="text-[2.2rem] text-[#6b717c]">{fmt(entry, suggestion.valor_actual)}</span>
              <span className="text-[1.3rem] text-[#6b717c]">→</span>
              <span className="text-[2.2rem] text-[#d92b14]">{fmt(entry, suggestion.valor_sugerido)}</span>
            </span>
            <p className="text-[0.92rem] leading-snug">
              <b>{suggestion.problema}</b> ({suggestion.evidencia}). {suggestion.efecto}
            </p>
            <p className="text-[0.82rem] text-paper-muted">A cambio: {suggestion.compromiso}</p>
          </section>
        ) : (
          <section className="card flex flex-col gap-2 px-5 py-4">
            <span className="eyebrow">Cuándo tocarlo</span>
            <ul className="flex flex-col gap-2 text-[0.92rem] text-soft-fg">
              {entry.when.map((w) => (
                <li key={w} className="flex gap-2.5">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
                  <span>{w}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="card px-4 py-4">
          <span className="eyebrow">Si lo subís ▲</span>
          <p className="mt-1.5 text-[0.92rem] leading-snug text-soft-fg">{entry.up}</p>
        </div>
        <div className="card px-4 py-4">
          <span className="eyebrow">Si lo bajás ▼</span>
          <p className="mt-1.5 text-[0.92rem] leading-snug text-soft-fg">{entry.down}</p>
        </div>
      </div>

      {suggestion && (
        <section className="card flex flex-col gap-2 px-5 py-4">
          <span className="eyebrow">Cuándo tocarlo</span>
          <ul className="flex flex-col gap-2 text-[0.92rem] text-soft-fg">
            {entry.when.map((w) => (
              <li key={w} className="flex gap-2.5">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
                <span>{w}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {entry.related.length > 0 && (
        <section className="flex flex-col gap-2">
          <span className="eyebrow">Va de la mano con</span>
          {entry.related.map((r) => {
            const other = academyEntry(r.key);
            return (
              <button key={r.key} type="button" onClick={() => onPick(other?.key ?? r.key)} className="card px-4 py-3.5 text-left hover:bg-panel-2">
                <span className="title text-[1.1rem] text-accent-ink">{other?.title ?? r.key} ›</span>
                <span className="mt-1 block text-[0.88rem] text-muted">{r.text}</span>
              </button>
            );
          })}
        </section>
      )}
      <p className="text-[0.82rem] text-dim">Tocá un valor por vez y dá dos o tres vueltas: así sabés qué cambio sirvió.</p>
    </div>
  );
}

function RangeBar({ entry, current, suggested }: { entry: AcademyEntry; current: number | null; suggested: number | null }) {
  const [lo, hi] = entry.range!;
  const pos = (v: number) => `${Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100))}%`;
  return (
    <div>
      <div className="relative h-2.5 rounded-full bg-panel-2">
        {current != null && suggested != null && (
          <span className="absolute top-0 h-2.5 rounded-full bg-accent/30" style={{ left: `min(${pos(current)}, ${pos(suggested)})`, width: `calc(max(${pos(current)}, ${pos(suggested)}) - min(${pos(current)}, ${pos(suggested)}))` }} />
        )}
        {current != null && <span className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-panel bg-fg" style={{ left: pos(current) }} title="Tu valor" />}
        {suggested != null && <span className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-panel bg-accent" style={{ left: pos(suggested) }} title="Sugerido" />}
      </div>
      <div className="mt-1.5 flex justify-between font-mono text-[0.7rem] text-dim">
        <span>{fmt(entry, lo)}</span>
        <span className="font-sans">
          <span className="text-fg">● vos</span>
          {suggested != null && <span className="ml-2 text-accent-ink">● sugerido</span>}
        </span>
        <span>{fmt(entry, hi)}</span>
      </div>
    </div>
  );
}
