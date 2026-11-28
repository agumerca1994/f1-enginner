"use client";

import { useEffect, useRef, useState } from "react";

import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useDictation } from "@/lib/listen";
import { playRadio, speakNow, stopRadio, unlockVoice } from "@/lib/voice";

// Both engineers talk about the same moment: a real race frozen at Austin, lap 4 of 6, in the rain.
export const DEMO_MOMENT = "Austin, vuelta 4 de 6. Llueve, vas octavo con intermedios, Verstappen medio segundo adelante y Gasly encima.";

// What the alert radio says in that race: only the important things, the same words every time.
const ALERTS = [
  { lap: 3, text: "Advertencia por toque con Norris." },
  { lap: 4, text: "Sigue la lluvia los próximos diez minutos." },
  { lap: 5, text: "Última vuelta." },
];

const SUGGESTED = ["¿Cuándo paro?", "¿Cómo viene Gasly?", "¿Dónde pierdo tiempo?", "¿Cómo están las gomas?"];

type Turn = { pregunta: string; respuesta: string | null; fuente?: "ia" | "guion" };
type DemoState = { restantes: number; por_dia: number };
type DemoAnswer = { radio: string; audio: string | null; fuente: "ia" | "guion"; restantes: number };

function Bubble({ who, children, light }: { who: "ing" | "vos"; children: React.ReactNode; light?: boolean }) {
  return (
    <div
      className={`max-w-[92%] rounded-2xl px-3.5 py-2 text-[0.95rem] ${
        who === "vos" ? "self-end bg-accent text-white" : light ? "bg-black/[0.06]" : "bg-panel-2"
      }`}
    >
      <span className={`mr-1.5 text-[0.7rem] font-semibold uppercase tracking-wider ${who === "vos" ? "text-white/80" : "opacity-60"}`}>
        {who === "vos" ? "Vos" : "Ingeniero"}
      </span>
      {children}
    </div>
  );
}

/** The alert radio of the demo race, read aloud with the engineer's voice. */
export function AlertsDemo() {
  const [playing, setPlaying] = useState(false);
  const listen = async () => {
    if (playing) {
      stopRadio();
      setPlaying(false);
      return;
    }
    unlockVoice();
    setPlaying(true);
    await speakNow(ALERTS.map((a) => a.text)); // started inside the tap: what phones require
    setPlaying(false);
  };
  useEffect(() => () => stopRadio(), []);

  return (
    <div className="card flex min-w-0 flex-col gap-3 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="title text-[1.3rem]">Radio de avisos</span>
        <span className="text-[0.75rem] text-dim">Piloto rookie y Piloto profesional</span>
      </div>
      <div className="flex flex-col gap-2">
        {ALERTS.map((a) => (
          <Bubble key={a.lap} who="ing">
            <span className="mr-1.5 font-mono text-[0.75rem] opacity-60">V{a.lap}</span>
            {a.text}
          </Bubble>
        ))}
      </div>
      <button type="button" onClick={() => void listen()} className="btn self-start px-4 py-2 text-[0.9rem]">
        {playing ? "Parar" : "Escuchar"}
      </button>
      <p className="mt-auto text-[0.88rem] text-muted">Te avisa lo importante: safety car, pinchazos, daños, lluvia y sanciones. No responde preguntas.</p>
    </div>
  );
}

/** The Pro engineer, live: the player asks (typed, a suggestion, or by voice) about the demo race. */
export function ProDemo() {
  const { credentials } = useAuth();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [left, setLeft] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const turnsRef = useRef<Turn[]>([]);
  turnsRef.current = turns;

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const s = await api<DemoState>("/api/engineer/demo", await credentials());
        if (alive) setLeft(s.restantes);
      } catch {}
    })();
    return () => {
      alive = false;
      stopRadio();
    };
  }, [credentials]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, busy]);

  const ask = async (question: string, acknowledged = false) => {
    const q = question.trim().slice(0, 300);
    if (!q || busy) return;
    if (!acknowledged) {
      unlockVoice();
      // like a real radio, and the tap that lets the answer be heard on a phone
      // (a spoken question already said it when the talk button was released)
      void speakNow(["Copiado."]);
    }
    setText("");
    setError(null);
    setBusy(true);
    const history = turnsRef.current.filter((t) => t.respuesta).slice(-4).map(({ pregunta, respuesta }) => ({ pregunta, respuesta }));
    setTurns((t) => [...t, { pregunta: q, respuesta: null }]);
    try {
      const r = await api<DemoAnswer>("/api/engineer/demo", await credentials(), { method: "POST", body: { texto: q, historial: history } });
      setTurns((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, respuesta: r.radio, fuente: r.fuente } : x)));
      setLeft(r.restantes);
      void playRadio(r.radio, r.audio, true);
    } catch (e) {
      setTurns((t) => t.slice(0, -1));
      setError(e instanceof ApiError && e.status === 422 ? "Preguntá algo más corto." : "No te pude responder. Probá de nuevo.");
    } finally {
      setBusy(false);
    }
  };

  // the spoken question ends on the release of the button: that release is the tap the voice needs
  const dictation = useDictation((heard) => void ask(heard, true));
  const scripted = left === 0;

  return (
    <div className="paper flex min-w-0 flex-col gap-3 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="title text-[1.3rem]">Ingeniero Pro</span>
        <span className="text-[0.75rem] text-[#5b616b]">Con carreras Pro</span>
      </div>

      <div ref={listRef} className="flex max-h-[22rem] min-h-[7rem] flex-col gap-2 overflow-y-auto">
        {turns.length === 0 && <p className="text-[0.95rem] text-[#3d434c]">Preguntale lo que quieras de esta carrera, escribiendo o con la voz.</p>}
        {turns.map((t, i) => (
          <div key={i} className="flex flex-col gap-2">
            <Bubble who="vos">{t.pregunta}</Bubble>
            {t.respuesta ? (
              <Bubble who="ing" light>
                {t.respuesta}
                <span className="mt-1 flex items-center gap-3 text-[0.72rem] text-[#5b616b]">
                  <button type="button" onClick={() => void speakNow([t.respuesta as string])} className="font-semibold underline">
                    Escuchar
                  </button>
                  {t.fuente === "guion" && <span>Respuesta de ejemplo</span>}
                </span>
              </Bubble>
            ) : (
              <Bubble who="ing" light>
                <span className="animate-pulse">…</span>
              </Bubble>
            )}
          </div>
        ))}
        {dictation.listening && <Bubble who="vos">{dictation.interim || "Escuchando…"}</Bubble>}
      </div>

      <div className="flex flex-wrap gap-2">
        {SUGGESTED.map((s) => (
          <button
            key={s}
            type="button"
            disabled={busy}
            onClick={() => void ask(s)}
            className="rounded-full border border-black/15 px-3 py-1.5 text-[0.85rem] text-[#24282e] hover:bg-black/[0.05] disabled:opacity-50"
          >
            {s}
          </button>
        ))}
      </div>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(text);
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={300}
          placeholder="Preguntale algo…"
          aria-label="Tu pregunta para el ingeniero"
          className="min-w-0 flex-1 rounded-[var(--radius-control)] border border-black/15 bg-white px-3 py-2 text-[0.95rem] text-[#15171b] placeholder:text-[#7a808a]"
        />
        {dictation.supported && (
          <button
            type="button"
            disabled={busy}
            onPointerDown={(e) => {
              e.preventDefault();
              unlockVoice();
              dictation.start();
            }}
            onPointerUp={() => {
              unlockVoice();
              void speakNow(["Copiado."]);
              dictation.stop();
            }}
            onPointerLeave={() => dictation.listening && dictation.stop()}
            onContextMenu={(e) => e.preventDefault()}
            aria-label="Mantené apretado para hablar"
            title="Mantené apretado para hablar"
            className={`select-none rounded-[var(--radius-control)] px-3 py-2 text-[0.9rem] ${dictation.listening ? "bg-accent text-white" : "btn-ink"} disabled:opacity-50`}
          >
            {dictation.listening ? "Soltá" : "Hablar"}
          </button>
        )}
        <button type="submit" disabled={busy || !text.trim()} className="btn-ink px-4 py-2 text-[0.9rem] disabled:opacity-50">
          Enviar
        </button>
      </form>

      {(error || dictation.error) && <p className="text-[0.85rem] text-[#b3261e]">{error || dictation.error}</p>}
      <p className="text-[0.8rem] text-[#5b616b]">
        {left == null
          ? " "
          : scripted
            ? "Por hoy ya usaste las preguntas en vivo: ahora contesta con respuestas de ejemplo. Mañana tenés más."
            : `Responde la IA del ingeniero Pro sobre telemetría real. Te quedan ${left} ${left === 1 ? "pregunta" : "preguntas"} hoy.`}
      </p>
      <p className="mt-auto text-[0.88rem] text-[#3d434c]">Le hablás y te contesta. Arma la estrategia, la cambia sobre la marcha y se acuerda de todo el fin de semana.</p>
    </div>
  );
}
