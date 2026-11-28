"use client";

import { useEffect, useState } from "react";

import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useDictation } from "@/lib/listen";
import { playRadio, speakNow, stopRadio, unlockVoice } from "@/lib/voice";

// Both engineers talk about the same moment: a real race (Texas capture) frozen at lap 4 of 6, in the rain.
// What the alert radio says there: only the important things, the same words every time.
const ALERTS = [
  { lap: 3, text: "Advertencia por toque con Norris." },
  { lap: 4, text: "Sigue la lluvia los próximos diez minutos." },
  { lap: 5, text: "Última vuelta." },
];

const SUGGESTED = ["¿Cuándo paro?", "¿Cómo viene Gasly?", "¿Dónde pierdo tiempo?", "¿Cómo están las gomas?"];

type Rival = { piloto: string | null; gap_s: number | null } | null;
type DemoState = {
  pista: string | null;
  vuelta: number | null;
  vueltas_restantes: number | null;
  posicion: number | null;
  clima: string | null;
  compuesto: string | null;
  desgaste_pct: number | null;
  adelante: Rival;
  atras: Rival;
  restantes: number;
  por_dia: number;
};
type Turn = { pregunta: string; respuesta: string | null; fuente?: "ia" | "guion" };
type DemoAnswer = { radio: string; audio: string | null; fuente: "ia" | "guion"; restantes: number };

const WEATHER: Record<string, string> = {
  Clear: "Despejado",
  "Light cloud": "Algo nublado",
  Overcast: "Nublado",
  "Light rain": "Llovizna",
  "Heavy rain": "Lluvia fuerte",
  Storm: "Tormenta",
};
const COMPOUND: Record<string, string> = { Soft: "Blandas", Medium: "Medias", Hard: "Duras", Intermediate: "Inter", Wet: "Lluvia" };
const name = (s: string | null | undefined) => (s ? s.charAt(0) + s.slice(1).toLowerCase() : "—");
const secs = (n: number | null | undefined) => (n == null ? "—" : `${n.toFixed(1).replace(".", ",")} s`);

/** The red dot of the engineer's radio, as in the app's dock. */
function Dot({ on = true }: { on?: boolean }) {
  return <span className={`h-2.5 w-2.5 shrink-0 rounded-full bg-accent ${on ? "animate-pulse" : ""}`} aria-hidden="true" />;
}

const SQUARE = "grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius-control)] border border-[#c4c8ce] disabled:opacity-40";

/** The engineer demo in Plans: the race at a glance, the alert radio and the Pro engineer, as in the app. */
export function EngineerDemo() {
  const { credentials } = useAuth();
  const [state, setState] = useState<DemoState | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const s = await api<DemoState>("/api/engineer/demo", await credentials());
        if (alive) setState(s);
      } catch {}
    })();
    return () => {
      alive = false;
      stopRadio();
    };
  }, [credentials]);

  return (
    <div className="flex flex-col gap-4">
      <RaceStrip s={state} />
      <div className="grid gap-4 md:grid-cols-2">
        <AlertsRadio />
        <ProRadio left={state?.restantes ?? null} lap={state?.vuelta ?? 4} />
      </div>
    </div>
  );
}

/** The race at a glance, like the cockpit's pieces. */
function RaceStrip({ s }: { s: DemoState | null }) {
  const total = s?.vuelta != null && s.vueltas_restantes != null ? s.vuelta + s.vueltas_restantes : null;
  const tiles: [string, string, string?][] = [
    ["Posición", s?.posicion ? `P${s.posicion}` : "—"],
    ["Vuelta", s?.vuelta ? `${s.vuelta}${total ? `/${total}` : ""}` : "—"],
    ["Gomas", s?.compuesto ? COMPOUND[s.compuesto] ?? s.compuesto : "—", s?.desgaste_pct != null ? `${Math.round(s.desgaste_pct)}% de desgaste` : undefined],
    ["Clima", s?.clima ? WEATHER[s.clima] ?? s.clima : "—"],
    ["Adelante", name(s?.adelante?.piloto), secs(s?.adelante?.gap_s)],
    ["Atrás", name(s?.atras?.piloto), secs(s?.atras?.gap_s)],
  ];
  return (
    <div className="card p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="h-2 w-2 rounded-full bg-[#3ddc97]" aria-hidden="true" />
        <span className="eyebrow">En pista · {s?.pista ?? "Austin"} · carrera de ejemplo</span>
      </div>
      <div className="grid grid-cols-3 gap-x-4 gap-y-3 sm:grid-cols-6">
        {tiles.map(([label, value, sub]) => (
          <div key={label} className="min-w-0">
            <span className="eyebrow block truncate">{label}</span>
            <span className="display block truncate text-[1.3rem] leading-none sm:text-[1.6rem]">{value}</span>
            {sub && <span className="block truncate text-[0.78rem] text-muted">{sub}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

/** The alert radio of the demo race: the cockpit's radio piece, read aloud. */
function AlertsRadio() {
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(false);
  const cur = ALERTS[i];
  const prev = i > 0 ? ALERTS[i - 1] : null;
  const listen = async () => {
    if (playing) {
      stopRadio();
      setPlaying(false);
      return;
    }
    unlockVoice();
    setPlaying(true);
    setI(0);
    // started inside the tap: what phones require; the card follows the line being said
    await speakNow(ALERTS.map((a) => a.text), setI);
    setPlaying(false);
  };

  return (
    <div className="card flex min-w-0 flex-col gap-3 p-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Dot on={playing} />
        <span className="title text-[1.15rem]">Radio de avisos</span>
        <span className="ml-auto text-[0.75rem] text-dim">Piloto rookie y profesional</span>
      </div>
      <span className="eyebrow">Radio · vuelta {cur.lap}</span>
      <p className="title min-h-[3.2rem] text-[1.5rem] leading-tight" style={{ textTransform: "none" }} aria-live="polite">{cur.text}</p>
      {prev && <p className="truncate text-[0.88rem] text-muted">Antes: {prev.text}</p>}
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => void listen()} className="btn-ink h-10 shrink-0 px-4 text-[0.95rem]">
          {playing ? "■ Detener" : "▶ Escuchar"}
        </button>
        <span className="text-[0.85rem] text-muted">No le podés preguntar.</span>
      </div>
      <p className="mt-auto border-t border-line pt-3 text-[0.88rem] text-muted">Te avisa lo importante: safety car, pinchazos, daños, lluvia y sanciones.</p>
    </div>
  );
}

/** The Pro engineer, live, in the app's radio: hold to talk, or type, or pick a question. */
function ProRadio({ left: initialLeft, lap }: { left: number | null; lap: number }) {
  const { credentials } = useAuth();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [left, setLeft] = useState<number | null>(initialLeft);
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setLeft(initialLeft), [initialLeft]);

  const ask = async (question: string, acknowledged = false) => {
    const q = question.trim().slice(0, 300);
    if (!q || busy) return;
    if (!acknowledged) {
      // like a real radio, and the tap that lets the answer be heard on a phone
      // (a spoken question already said it when the talk button was released)
      unlockVoice();
      void speakNow(["Copiado."]);
    }
    setDraft("");
    setTyping(false);
    setError(null);
    setBusy(true);
    const history = turns.filter((t) => t.respuesta).slice(-4).map(({ pregunta, respuesta }) => ({ pregunta, respuesta }));
    setTurns((t) => [...t, { pregunta: q, respuesta: null }]);
    try {
      const r = await api<DemoAnswer>("/api/engineer/demo", await credentials(), { method: "POST", body: { texto: q, historial: history } });
      setTurns((t) => t.map((x, n) => (n === t.length - 1 ? { ...x, respuesta: r.radio, fuente: r.fuente } : x)));
      setLeft(r.restantes);
      void playRadio(r.radio, r.audio, true);
    } catch (e) {
      setTurns((t) => t.slice(0, -1));
      setError(e instanceof ApiError && e.status === 422 ? "Preguntá algo más corto." : "No te pude responder. Probá de nuevo.");
    } finally {
      setBusy(false);
    }
  };
  const mic = useDictation((heard) => void ask(heard, true));

  const last = turns[turns.length - 1];
  const prev = turns.length > 1 ? turns[turns.length - 2] : null;
  let line = last?.respuesta ?? "Preguntale qué tocar, cuándo parar o cómo viene el de atrás.";
  if (busy) line = "Consultando…";
  if (mic.listening) line = mic.interim || "Te escucho…";

  return (
    <div className="paper flex min-w-0 flex-col gap-3 p-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Dot on={busy || mic.listening} />
        <span className="title text-[1.15rem]">Ingeniero Pro</span>
        <span className="ml-auto text-[0.75rem] text-paper-muted">Con carreras Pro</span>
      </div>
      <span className="eyebrow !text-paper-muted">
        Radio · vuelta {lap}
        {last && !busy && !mic.listening ? ` · Vos: ${last.pregunta}` : ""}
      </span>
      <p className={`title min-h-[3.2rem] text-[1.5rem] leading-tight ${busy ? "animate-pulse" : ""}`} style={{ textTransform: "none" }} aria-live="polite">
        {line}
      </p>
      {last?.respuesta && !busy && (
        <div className="flex flex-col gap-1 text-[0.85rem] text-paper-muted">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <button type="button" onClick={() => void speakNow([last.respuesta as string])} className="whitespace-nowrap font-semibold underline">
              Repetir
            </button>
            {last.fuente === "guion" && <span className="whitespace-nowrap">Respuesta de ejemplo</span>}
          </div>
          {prev?.respuesta && <span className="truncate">Antes: {prev.respuesta}</span>}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {SUGGESTED.map((s) => (
          <button
            key={s}
            type="button"
            disabled={busy}
            onClick={() => void ask(s)}
            className="rounded-full bg-black/[0.06] px-3 py-1.5 text-[0.85rem] text-paper-fg hover:bg-black/[0.1] disabled:opacity-50"
          >
            {s}
          </button>
        ))}
      </div>

      {/* the app's radio bar */}
      <div className="flex items-center gap-2 border-t border-[#d5d8dc] pt-3">
        {typing ? (
          <form
            className="flex min-w-0 flex-1 gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void ask(draft);
            }}
          >
            <label className="sr-only" htmlFor="demo-pregunta">
              Preguntale al ingeniero
            </label>
            <input
              id="demo-pregunta"
              autoFocus
              value={draft}
              maxLength={300}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="¿Qué le toco para que gire en la 3?"
              className="h-10 min-w-0 flex-1 rounded-[var(--radius-control)] border border-[#c4c8ce] bg-white px-3 text-[0.95rem] text-paper-fg"
            />
            <button type="submit" disabled={busy || !draft.trim()} className="btn-ink h-10 px-4 text-[0.95rem] disabled:opacity-50">
              Enviar
            </button>
          </form>
        ) : (
          <span className="min-w-0 flex-1 text-[0.85rem] text-paper-muted">
            {left == null
              ? " "
              : left === 0
                ? "Por hoy, respuestas de ejemplo. Mañana tenés más en vivo."
                : `Te ${left === 1 ? "queda 1 pregunta" : `quedan ${left} preguntas`} en vivo hoy`}
          </span>
        )}
        <button
          type="button"
          aria-label={typing ? "Cerrar el teclado" : "Escribirle al ingeniero"}
          onClick={() => setTyping((t) => !t)}
          className={SQUARE}
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            {typing ? <path d="M6 6l12 12M18 6 6 18" /> : <path d="M4 20h4L19 9l-4-4L4 16v4Z" />}
          </svg>
        </button>
        {!typing && mic.supported && (
          <button
            type="button"
            disabled={busy}
            onPointerDown={(e) => {
              e.preventDefault();
              unlockVoice();
              mic.start();
            }}
            onPointerUp={() => {
              unlockVoice();
              void speakNow(["Copiado."]);
              mic.stop();
            }}
            onPointerLeave={() => mic.listening && mic.stop()}
            onContextMenu={(e) => e.preventDefault()}
            className={`btn-ink h-10 shrink-0 touch-none select-none px-4 text-[0.95rem] disabled:opacity-50 ${mic.listening ? "animate-pulse" : ""}`}
          >
            <span className="lg:hidden">Hablar</span>
            <span className="hidden lg:inline">Mantené para hablar</span>
          </button>
        )}
      </div>
      {(error || mic.error) && <p className="text-[0.85rem] text-[#b3261e]">{error || mic.error}</p>}
      <p className="text-[0.88rem] text-paper-muted">Le hablás y te contesta con la telemetría de tu carrera. Arma la estrategia, la cambia sobre la marcha y se acuerda de todo el fin de semana.</p>
    </div>
  );
}
