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


/** One radio message: the engineer's on the left, the driver's on the right. */
function Bubble({ who, tag, children, lit, dim }: { who: "ing" | "vos"; tag?: string; children: React.ReactNode; lit?: boolean; dim?: boolean }) {
  const mine = who === "vos";
  return (
    <div className={`flex flex-col gap-1 ${mine ? "items-end" : "items-start"}`}>
      {tag && <span className="text-[0.72rem] uppercase tracking-wider text-dim">{tag}</span>}
      <p
        className={`max-w-[92%] rounded-[var(--radius-control)] px-3 py-2 text-[0.98rem] leading-snug transition-colors ${
          mine ? "bg-accent text-accent-fg" : lit ? "bg-fg text-bg" : "bg-panel-2 text-fg"
        } ${dim ? "opacity-60" : ""}`}
      >
        {children}
      </p>
    </div>
  );
}

/** One of the two radios: same frame, so the difference is what they say. */
function Radio({ title, line, pro, children }: { title: string; line: string; pro?: boolean; children: React.ReactNode }) {
  return (
    <div className={`card flex min-w-0 flex-col gap-4 p-4 sm:p-5 ${pro ? "ring-1 ring-accent" : ""}`}>
      <div>
        <div className="flex items-center gap-2">
          <span className="title text-[1.15rem]">{title}</span>
          {pro && <span className="rounded-full bg-accent px-2 py-0.5 text-[0.68rem] font-semibold uppercase tracking-wider text-accent-fg">Pro</span>}
        </div>
        <p className="mt-0.5 text-[0.9rem] text-muted">{line}</p>
      </div>
      {children}
    </div>
  );
}

/** The engineer demo in Plans: the same moment of a race on both radios. */
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
    <div className="grid gap-3 md:grid-cols-2">
      <AlertsRadio />
      <ProRadio left={state?.restantes ?? null} />
    </div>
  );
}

/** The alert radio: a few fixed lines, read aloud. */
function AlertsRadio() {
  const [i, setI] = useState<number | null>(null);
  const playing = i != null;
  const listen = async () => {
    if (playing) {
      stopRadio();
      setI(null);
      return;
    }
    unlockVoice();
    setI(0);
    // started inside the tap: what phones require; the line being said lights up
    await speakNow(ALERTS.map((a) => a.text), setI);
    setI(null);
  };

  return (
    <Radio title="Radio de avisos" line="Te avisa lo importante. No le podés preguntar.">
      <div className="flex flex-1 flex-col gap-3" aria-live="polite">
        {ALERTS.map((a, n) => (
          <Bubble key={a.text} who="ing" tag={`Vuelta ${a.lap}`} lit={i === n}>
            {a.text}
          </Bubble>
        ))}
      </div>
      <button type="button" onClick={() => void listen()} className="btn h-11 w-full text-[0.95rem]">
        {playing ? "■ Detener" : "▶ Escuchar la radio"}
      </button>
    </Radio>
  );
}

/** The Pro engineer, live: pick a question, type one or hold to talk. */
function ProRadio({ left: initialLeft }: { left: number | null }) {
  const { credentials } = useAuth();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [left, setLeft] = useState<number | null>(initialLeft);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setLeft(initialLeft), [initialLeft]);

  const ask = async (question: string, acknowledged = false) => {
    const q = question.trim().slice(0, 300);
    if (!q || busy) return;
    if (!acknowledged) {
      // like a real radio, and the tap that lets the answer be heard on a phone
      unlockVoice();
      void speakNow(["Copiado."]);
    }
    setDraft("");
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
  const shown = turns.slice(-2);
  const asked = new Set(turns.map((t) => t.pregunta));
  const chips = SUGGESTED.filter((s) => !asked.has(s)).slice(0, 3);

  return (
    <Radio pro title="Ingeniero Pro" line="Le preguntás lo que quieras y te contesta con tu carrera.">
      <div className="flex flex-1 flex-col gap-3" aria-live="polite">
        {shown.length === 0 && !mic.listening && (
          <Bubble who="ing" tag="Ingeniero">Acá estoy. ¿Qué necesitás?</Bubble>
        )}
        {shown.map((t, n) => (
          <div key={turns.length - shown.length + n} className="flex flex-col gap-2">
            <Bubble who="vos" dim={n < shown.length - 1}>{t.pregunta}</Bubble>
            {t.respuesta ? (
              <Bubble who="ing" dim={n < shown.length - 1}>{t.respuesta}</Bubble>
            ) : (
              <Bubble who="ing"><span className="animate-pulse">Consultando…</span></Bubble>
            )}
          </div>
        ))}
        {mic.listening && <Bubble who="vos"><span className="animate-pulse">{mic.interim || "Te escucho…"}</span></Bubble>}
      </div>

      {chips.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {chips.map((s) => (
            <button
              key={s}
              type="button"
              disabled={busy}
              onClick={() => void ask(s)}
              className="rounded-full border border-line px-3 py-1.5 text-[0.88rem] text-soft-fg hover:border-accent disabled:opacity-50"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(draft);
        }}
      >
        <label className="sr-only" htmlFor="demo-pregunta">Preguntale al ingeniero</label>
        <input
          id="demo-pregunta"
          value={draft}
          maxLength={300}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Escribí tu pregunta"
          className="h-11 min-w-0 flex-1 rounded-[var(--radius-control)] border border-line bg-panel-2 px-3 text-[0.95rem] text-fg placeholder:text-dim"
        />
        {draft.trim() || !mic.supported ? (
          <button type="submit" disabled={busy || !draft.trim()} className="btn-primary h-11 shrink-0 px-4 text-[0.95rem] disabled:opacity-50">
            Enviar
          </button>
        ) : (
          <button
            type="button"
            disabled={busy}
            aria-label="Mantené apretado para hablar"
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
            className={`btn-primary h-11 shrink-0 touch-none select-none px-4 text-[0.95rem] disabled:opacity-50 ${mic.listening ? "animate-pulse" : ""}`}
          >
            Hablar
          </button>
        )}
      </form>
      {(error || mic.error) && <p className="text-[0.85rem] text-accent-ink">{error || mic.error}</p>}
      {left != null && (
        <p className="-mt-2 text-[0.78rem] text-dim">
          {left === 0 ? "Por hoy te contesto con respuestas de ejemplo." : `${left === 1 ? "1 pregunta" : `${left} preguntas`} en vivo por hoy · mantené Hablar apretado para preguntar con la voz`}
        </p>
      )}
    </Radio>
  );
}
