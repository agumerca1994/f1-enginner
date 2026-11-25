"use client";

import { useEffect, useState } from "react";

import { useDictation } from "@/lib/listen";
import { useSharedLive } from "@/lib/liveContext";
import { playRadio, stopRadio } from "@/lib/voice";

/** Sits above the phone's tab bar and at the foot of the page on a computer. */
const DOCK = "sticky z-20 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] lg:bottom-4";

/**
 * The engineer at the foot of every screen. In a session you talk to them (hold to
 * talk, or type); elsewhere they read out what the screen already says, written
 * by code, so nothing is spent on a model outside a session.
 */
export function RadioDock({ text, label, compact = false, inline = false }: { text?: string | null; label?: string; compact?: boolean; inline?: boolean }) {
  const place = inline ? "" : DOCK;
  return text !== undefined ? <PresentDock text={text} label={label} compact={compact} place={place} /> : <TalkDock compact={compact} place={place} />;
}

function Dot() {
  return <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-accent" aria-hidden="true" />;
}

const SQUARE = "grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius-control)] border border-[#c4c8ce] disabled:opacity-40";

function PresentDock({ text, label, compact, place }: { text: string | null; label?: string; compact: boolean; place: string }) {
  const [playing, setPlaying] = useState(false);
  useEffect(() => () => stopRadio(), []);
  if (!text) return null;
  return (
    <div className={`${place} paper flex items-center gap-3 py-2 pl-4 pr-2 shadow-[0_10px_30px_rgb(0_0_0/0.45)]`}>
      <Dot />
      {!compact && <span className="title hidden text-[1.05rem] sm:inline">Ingeniero</span>}
      <span className="line-clamp-2 min-w-0 flex-1 text-[0.95rem] leading-snug">{label ?? text}</span>
      <button
        type="button"
        onClick={() => {
          if (playing) {
            stopRadio();
            setPlaying(false);
          } else {
            setPlaying(true);
            playRadio(text, null, true).finally(() => setPlaying(false));
          }
        }}
        className="btn-ink h-10 shrink-0 px-4 text-[0.95rem]"
      >
        {playing ? "■ Detener" : "▶ Escuchar"}
      </button>
    </div>
  );
}

function TalkDock({ compact, place }: { compact: boolean; place: string }) {
  const { status, snapshot, engineer, askEngineer, setEngineerActive, engineerBusy, voice } = useSharedLive();
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const ask = async (q: string) => {
    const t = q.trim();
    if (!t) return;
    setSending(true);
    try {
      await askEngineer(t);
      setDraft("");
      setTyping(false);
    } catch {
      /* the answer also arrives over the socket; a failed request leaves the draft */
    } finally {
      setSending(false);
    }
  };
  const mic = useDictation((q) => void ask(q));
  const last = [...engineer.messages].reverse().find((m) => m.radio);
  const live = status === "live" && snapshot;
  const paused = live && !engineer.active && engineer.provider != null;

  let line = last?.radio ?? (live ? "Preguntale qué tocar, o cómo salir." : "Cuando estés en pista, el ingeniero te habla acá.");
  if (mic.listening) line = mic.interim || "Te escucho…";
  if (sending) line = "Consultando…";

  return (
    <div className={`${place} paper flex items-center gap-3 py-2 pl-4 pr-2 shadow-[0_10px_30px_rgb(0_0_0/0.45)]`}>
      <Dot />
      {!compact && <span className="title hidden text-[1.05rem] lg:inline">Ingeniero</span>}
      {typing ? (
        <form
          className="flex min-w-0 flex-1 gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void ask(draft);
          }}
        >
          <label className="sr-only" htmlFor="pregunta">
            Preguntale al ingeniero
          </label>
          <input
            id="pregunta"
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="¿Qué le toco para que gire en la 3?"
            className="h-10 min-w-0 flex-1 rounded-[var(--radius-control)] border border-[#c4c8ce] bg-white px-3 text-[0.95rem] text-paper-fg"
          />
          <button type="submit" disabled={sending} className="btn-ink h-10 px-4 text-[0.95rem]">
            Enviar
          </button>
        </form>
      ) : (
        <span className="min-w-0 flex-1 truncate text-[0.95rem] font-medium" aria-live="polite">
          {paused ? (
            <>
              El ingeniero está en pausa.{" "}
              <button type="button" disabled={engineerBusy} onClick={() => void setEngineerActive(true)} className="underline">
                Activarlo
              </button>
            </>
          ) : (
            line
          )}
        </span>
      )}
      {!typing && voice.supported && (
        <button
          type="button"
          onClick={voice.toggle}
          aria-pressed={voice.enabled}
          aria-label={voice.enabled ? "Silenciar la voz del ingeniero" : "Escuchar la voz del ingeniero"}
          title={voice.enabled ? "Voz encendida" : "Voz apagada"}
          className={SQUARE}
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M4 9v6h4l5 4V5L8 9H4Z" />
            {voice.enabled ? <path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" /> : <path d="M17 9l5 6M22 9l-5 6" />}
          </svg>
        </button>
      )}
      {!typing && live && (
        <button
          type="button"
          disabled={engineerBusy}
          onClick={() => void setEngineerActive(!engineer.active)}
          aria-label={engineer.active ? "Pausar al ingeniero" : "Volver a activar al ingeniero"}
          title={engineer.active ? "Pausar al ingeniero en esta sesión" : "Activar al ingeniero"}
          className={SQUARE}
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
            {engineer.active ? <path d="M7 5h4v14H7zM13 5h4v14h-4z" /> : <path d="M7 4v16l13-8z" />}
          </svg>
        </button>
      )}
      <button
        type="button"
        aria-label={typing ? "Cerrar el teclado" : "Escribirle al ingeniero"}
        onClick={() => setTyping((t) => !t)}
        className="grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius-control)] border border-[#c4c8ce]"
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          {typing ? <path d="M6 6l12 12M18 6 6 18" /> : <path d="M4 20h4L19 9l-4-4L4 16v4Z" />}
        </svg>
      </button>
      {!typing && mic.supported && (
        <button
          type="button"
          onPointerDown={(e) => {
            e.preventDefault();
            mic.start();
          }}
          onPointerUp={mic.stop}
          onPointerLeave={() => mic.listening && mic.stop()}
          onContextMenu={(e) => e.preventDefault()}
          className={`btn-ink h-10 shrink-0 touch-none select-none px-4 text-[0.95rem] ${mic.listening ? "animate-pulse" : ""}`}
        >
          <span className="lg:hidden">Hablar</span>
          <span className="hidden lg:inline">Mantené para hablar</span>
        </button>
      )}
    </div>
  );
}
