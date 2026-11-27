"use client";

import { useEffect, useState } from "react";

import { shortName } from "@/components/dashboard/Cards";
import { Strategy } from "@/components/dashboard/EngineerPanel";
import { useDictation } from "@/lib/listen";
import { teamColor } from "@/lib/teams";
import type { CarRow, EngineerMessage, EngineerState, Snapshot } from "@/lib/types";
import { isRulesProvider } from "@/lib/format";

/** Seconds as said on the radio: "+0,21", "−1,4". */
export function signedSecs(ms: number | null | undefined, digits = 2): string {
  if (ms == null) return "—";
  const s = Math.abs(ms) / 1000;
  return `${ms < 0 ? "−" : "+"}${s.toFixed(digits).replace(".", ",")}`;
}

export function isRace(s: Snapshot): boolean {
  return (s.session?.type ?? "").startsWith("Race");
}

function clock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  return `${m}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

/** Position, lap and the delta to the best lap: the three numbers a driver glances at. */
export function LiveHero({ s }: { s: Snapshot }) {
  const lap = s.lap;
  const race = isRace(s);
  const gained = race && lap && lap.grid_position > 0 ? lap.grid_position - lap.position : 0;
  const delta = lap?.delta_best_ms ?? null;
  const deltaTone = delta == null ? "text-muted" : delta > 50 ? "text-warn" : delta < -50 ? "text-ok" : "text-fg";
  const window = s.session?.pit_window_ideal_lap;
  return (
    <section className="grid grid-cols-3 gap-2">
      <div className="slant rounded-[var(--radius-card)] bg-accent px-3 py-2.5 text-accent-fg">
        <div className="label !text-current opacity-80">Posición</div>
        <div className="display text-5xl">{lap ? `P${lap.position}` : "—"}</div>
        <div className="mt-0.5 text-xs font-semibold opacity-80">
          {gained > 0 ? `subiste ${gained}` : gained < 0 ? `perdiste ${-gained}` : race ? "igual que en la largada" : " "}
        </div>
      </div>
      <div className="card px-3 py-2.5">
        <div className="label">{race ? "Vuelta" : "Queda"}</div>
        <div className="display text-4xl">
          {race ? (
            <>
              {lap?.lap ?? "—"}
              <span className="text-lg text-muted">/{s.session?.total_laps ?? "—"}</span>
            </>
          ) : (
            clock(s.session?.time_left_s ?? 0)
          )}
        </div>
        <div className="mt-0.5 text-xs text-muted">
          {race && window ? `box desde la ${window}` : race ? " " : `vuelta ${lap?.lap ?? "—"}`}
        </div>
      </div>
      <div className="card px-3 py-2.5">
        <div className="label">vs tu mejor</div>
        <div className={`display text-3xl leading-[1.25] ${deltaTone}`}>{delta == null ? "—" : signedSecs(delta)}</div>
        <div className="mt-0.5 text-xs text-muted">{delta == null ? "sin vuelta de referencia" : `sector ${(lap?.sector ?? 0) + 1}`}</div>
      </div>
    </section>
  );
}

function carName(s: Snapshot, index: number | undefined): { name: string; car?: CarRow } {
  const car = s.cars?.find((c) => c.index === index);
  return { name: car ? shortName(car) : "—", car };
}

/** The car ahead and the car behind, and whether the gap is closing. */
export function Rivals({ s }: { s: Snapshot }) {
  const race = isRace(s);
  const ahead = s.relatives?.ahead[0];
  const behind = s.relatives?.behind[0];
  if (!ahead && !behind) return null;
  const pace = s.pace;
  const side = (row: typeof ahead, isAhead: boolean) => {
    if (!row) return <div />;
    const { name, car } = carName(s, row.index);
    const p = race ? (isAhead ? pace?.ahead : pace?.behind) : null;
    const close = row.gap_s != null && row.gap_s < (isAhead ? 1 : 0.6);
    const danger = !isAhead && close;
    const laps = p?.laps_to_catch != null ? Math.ceil(p.laps_to_catch) : null;
    const note = p?.state === "catching"
      ? isAhead ? `lo alcanzás en ${laps}` : `te alcanza en ${laps}`
      : p?.state === "opening"
        ? isAhead ? "se escapa" : "se aleja"
        : danger ? "muy cerca" : row.relation === "lapped" ? "doblado" : row.relation === "lapping" ? "te dobla" : row.pit ? "en boxes" : " ";
    return (
      <div className={`flex items-center justify-between gap-2 rounded-[var(--radius-card)] border px-3 py-2 ${danger ? "border-danger/60 bg-danger/10" : "border-line"}`}>
        <div className="min-w-0">
          <div className={`label ${danger ? "!text-danger" : ""}`}>{isAhead ? "Adelante" : "Atrás"}</div>
          <div className="flex items-center gap-1.5 truncate font-semibold">
            <span className="h-3.5 w-1 shrink-0 rounded-full" style={{ background: car?.color ?? teamColor(car?.team_id ?? null) }} />
            {name}
          </div>
        </div>
        <div className="text-right">
          <div className="display text-xl">{row.gap_s == null ? "—" : `${row.estimated ? "~" : ""}${row.gap_s.toFixed(1).replace(".", ",")} s`}</div>
          <div className={`text-[0.7rem] ${danger ? "text-danger" : p?.state === "catching" && isAhead ? "text-ok" : "text-muted"}`}>{note}</div>
        </div>
      </div>
    );
  };
  return (
    <section className="grid grid-cols-2 gap-2">
      {side(ahead, true)}
      {side(behind, false)}
    </section>
  );
}

const PRIORITY_LABEL: Record<string, string> = { urgente: "URGENTE", importante: "IMPORTANTE", info: "RADIO" };

/** The conversation with the engineer: older calls small, the last one big. */
export function RadioFeed({
  engineer,
  voice,
  onToggle,
  busy,
  replay = false,
}: {
  engineer: EngineerState;
  voice: { supported: boolean; enabled: boolean; toggle: () => void };
  onToggle: (active: boolean) => void;
  busy: boolean;
  /** A recorded session: the engineer starts off and listens to the playback when switched on. */
  replay?: boolean;
}) {
  const said = engineer.messages.filter((m) => m.radio);
  const last = said.slice(-1)[0];
  const before = said.slice(-4, -1);
  const rules = isRulesProvider(engineer.provider);
  return (
    <section className="card flex flex-col gap-2.5 p-4">
      <header className="flex items-center justify-between gap-2">
        <div className="label">{rules ? "Radio de avisos" : "Radio"}</div>
        <div className="flex items-center gap-2">
          {voice.supported && engineer.active && (
            <button onClick={voice.toggle} className={`chip px-2.5 py-1 text-xs ${voice.enabled ? "!border-accent text-accent" : "text-muted"}`}>
              {voice.enabled ? "Voz activada" : "Voz apagada"}
            </button>
          )}
          <button onClick={() => onToggle(!engineer.active)} disabled={busy} className="chip px-2.5 py-1 text-xs text-muted disabled:opacity-50">
            {engineer.active ? "Pausar" : replay ? "Activar" : "Reanudar"}
          </button>
        </div>
      </header>
      {!engineer.active ? (
        <p className="text-sm text-muted">
          {replay
            ? "Activá el ingeniero para escuchar qué te habría dicho en esta sesión."
            : "El ingeniero está en pausa. Tocá Reanudar para que siga la sesión y te hable."}
        </p>
      ) : !last ? (
        <p className="text-sm text-muted">
          Te escucho. Te hablo en las rectas cuando haya algo que sirva: ritmo, rivales, en qué curva perdés tiempo, gomas, y al instante si pasa algo urgente.
        </p>
      ) : (
        <>
          {before.map((m) => <Bubble key={m.id} m={m} />)}
          <Bubble m={last} latest />
        </>
      )}
    </section>
  );
}

function Bubble({ m, latest = false }: { m: EngineerMessage; latest?: boolean }) {
  return (
    <>
      {m.pregunta && (
        <div className="max-w-[85%] self-end rounded-[var(--radius-card)] bg-accent/15 px-3 py-2 text-sm">
          {m.pregunta}
          <div className="mt-0.5 text-[0.7rem] text-muted">vos{m.lap != null ? ` · vuelta ${m.lap}` : ""}</div>
        </div>
      )}
      {latest ? (
        <div className={`rounded-[var(--radius-card)] border bg-panel-2 px-4 py-3 ${m.prioridad === "urgente" ? "border-danger" : m.prioridad === "importante" ? "border-warn" : "border-accent"}`}>
          <div className={`label ${m.prioridad === "urgente" ? "!text-danger" : m.prioridad === "importante" ? "!text-warn" : "!text-accent"}`}>
            {PRIORITY_LABEL[m.prioridad] ?? "RADIO"}
            {m.lap != null ? ` · vuelta ${m.lap}` : ""}
          </div>
          <p className="mt-1 text-lg font-medium leading-snug">{m.radio}</p>
        </div>
      ) : (
        <div className="max-w-[90%] text-sm leading-snug text-muted">
          {m.lap != null && <span className="num mr-1.5 text-fg/80">V{m.lap}</span>}
          {m.radio}
        </div>
      )}
    </>
  );
}

const QUICK = ["Estatus", "¿Cómo están las gomas?", "¿Cuándo paro?"];

/** Talking to the engineer: quick questions, a big push-to-talk button and a keyboard fallback. */
export function TalkControls({ onAsk, compact = false }: { onAsk: (text: string) => Promise<unknown>; compact?: boolean }) {
  const [text, setText] = useState("");
  const [typing, setTyping] = useState(false);
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const send = async (q: string) => {
    q = q.trim();
    if (!q || sending) return;
    setSending(true);
    setFailed(null);
    try {
      await onAsk(q);
      setText("");
      setTyping(false);
    } catch {
      setFailed("No llegó la pregunta. Probá de nuevo.");
    } finally {
      setSending(false);
    }
  };
  const mic = useDictation(send);
  // Without speech recognition (some browsers) the keyboard is the only way in.
  const showInput = typing || !mic.supported;

  return (
    <section className="flex flex-col gap-2">
      {!compact && (
        <div className="flex gap-2 overflow-x-auto pb-0.5">
          {QUICK.map((q) => (
            <button key={q} onClick={() => send(q)} disabled={sending} className="chip shrink-0 px-3.5 py-2 text-sm disabled:opacity-50">
              {q}
            </button>
          ))}
          <button
            onClick={() => {
              setTyping(true);
              setText("Anotalo: ");
            }}
            className="chip shrink-0 px-3.5 py-2 text-sm"
          >
            Anotá algo
          </button>
        </div>
      )}
      {showInput && (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            send(text);
          }}
        >
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            autoFocus={typing}
            maxLength={500}
            placeholder="Escribí: estatus, ¿cómo me fue en la 3?, anotalo: …"
            className="min-w-0 flex-1 rounded-[var(--radius-control)] border border-line bg-panel-2 px-3 py-2.5 text-sm placeholder:text-muted focus:border-accent focus:outline-none"
          />
          <button disabled={sending || !text.trim()} className="chip px-4 text-sm disabled:opacity-40">
            {sending ? "…" : "Enviar"}
          </button>
        </form>
      )}
      <div className="flex gap-2">
        {mic.supported && (
          <button
            type="button"
            onPointerDown={(e) => {
              e.preventDefault();
              mic.start();
            }}
            onPointerUp={mic.stop}
            onPointerLeave={() => mic.listening && mic.stop()}
            onContextMenu={(e) => e.preventDefault()}
            className={`btn-primary flex h-16 flex-1 touch-none select-none items-center justify-center gap-3 text-lg ${mic.listening ? "animate-pulse" : ""}`}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
              <rect x="9" y="3" width="6" height="11" rx="3" />
              <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
            </svg>
            {mic.listening ? mic.interim || "Te escucho…" : sending ? "Preguntando…" : "Mantené para hablar"}
          </button>
        )}
        {mic.supported && !typing && (
          <button onClick={() => setTyping(true)} className="chip w-16 text-xs text-muted" aria-label="Escribir la pregunta">
            Escribir
          </button>
        )}
      </div>
      {(mic.error || failed) && <p className="text-xs text-danger">{mic.error || failed}</p>}
      {!compact && !mic.listening && (
        <p className="text-[0.7rem] text-muted">“Anotalo: …” guarda lo que sentís · “Alto” lo calla · “Hablame” lo vuelve a activar</p>
      )}
    </section>
  );
}

/** The pit wall's last full analysis: strategy, driving and setup advice. */
export function PitWall({ engineer }: { engineer: EngineerState }) {
  const wall = [...engineer.messages].reverse().find((m) => m.estrategia);
  if (!wall) return null;
  return (
    <section className="card space-y-3 p-4">
      <div className="label">Muro de boxes</div>
      {wall.estrategia && <Strategy s={wall.estrategia} />}
      {wall.manejo && wall.manejo.length > 0 && (
        <ul className="space-y-1 text-sm">
          {wall.manejo.map((tip) => (
            <li key={tip} className="flex gap-2">
              <span className="text-accent">›</span>
              {tip}
            </li>
          ))}
        </ul>
      )}
      {wall.reglaje && wall.reglaje.length > 0 && (
        <ul className="space-y-1 text-sm">
          {wall.reglaje.map((r) => (
            <li key={r.parametro}>
              <span className="font-medium">{r.parametro}</span> <span className="text-accent">{r.cambio}</span>
              <span className="text-muted"> · {r.motivo}</span>
            </li>
          ))}
        </ul>
      )}
      {wall.analisis && <p className="text-sm leading-relaxed text-muted">{wall.analisis}</p>}
    </section>
  );
}

const PAUSED_KEY = "ingeniero-pausado";

/**
 * The engineer is on by default: it switches itself on when a session is live,
 * unless the driver paused it in this same session.
 */
export function useEngineerAlwaysOn(
  snapshot: Snapshot | null,
  engineer: EngineerState,
  toggle: (active: boolean) => Promise<void>,
  busy: boolean,
) {
  const uid = snapshot?.session_uid;
  useEffect(() => {
    if (!uid || engineer.active || busy || engineer.provider == null) return;
    let paused: string | null = null;
    try {
      paused = localStorage.getItem(PAUSED_KEY);
    } catch {}
    if (paused === uid) return;
    toggle(true).catch(() => {});
  }, [uid, engineer.active, engineer.provider, busy, toggle]);

  return async (active: boolean) => {
    try {
      if (active) localStorage.removeItem(PAUSED_KEY);
      else if (uid) localStorage.setItem(PAUSED_KEY, uid);
    } catch {}
    await toggle(active);
  };
}
