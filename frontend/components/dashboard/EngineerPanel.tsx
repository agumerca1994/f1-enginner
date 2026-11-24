"use client";

import Link from "next/link";
import { useState } from "react";

import { Panel } from "@/components/dashboard/Panel";
import { useDictation } from "@/lib/listen";
import { useEngineerVoice } from "@/lib/voice";
import { COMPOUND_COLORS } from "@/lib/teams";
import type { EngineerState } from "@/lib/types";

const COMPOUND_ES: Record<string, string> = {
  Soft: "Blando",
  Medium: "Medio",
  Hard: "Duro",
  Intermediate: "Intermedio",
  Wet: "Lluvia",
};
const PRIORITY: Record<string, { label: string; border: string; text: string }> = {
  urgente: { label: "URGENTE", border: "border-danger", text: "text-danger" },
  importante: { label: "IMPORTANTE", border: "border-warn", text: "text-warn" },
  info: { label: "RADIO", border: "border-accent", text: "text-accent" },
};

/** The race engineer: radio calls, strategy, driving and setup advice, and its analysis. */
export function EngineerPanel({
  engineer,
  onToggle,
  onAsk,
  busy = false,
}: {
  engineer: EngineerState;
  onToggle: (active: boolean) => void;
  /** Live only: the driver talks to the engineer. */
  onAsk?: (text: string) => Promise<unknown>;
  busy?: boolean;
}) {
  const voice = useEngineerVoice(engineer.messages);
  const latest = engineer.messages.slice(-1)[0];
  // Radio-only calls (the quick lane) carry no strategy: the pit wall shows the last full analysis.
  const wall = [...engineer.messages].reverse().find((m) => m.estrategia);
  const lastRadio = [...engineer.messages].reverse().find((m) => m.radio);
  const history = engineer.messages.filter((m) => m.radio && m.id !== lastRadio?.id).slice(-5).reverse();
  const cost = engineer.messages.reduce((sum, m) => sum + (m.cost_usd || 0), 0);
  const ai = engineer.provider && engineer.provider !== "reglas";

  return (
    <Panel
      title="Ingeniero de pista"
      className={engineer.active ? "border-accent/40" : ""}
      right={
        <div className="flex items-center gap-2">
          {engineer.provider && (
            <span className="rounded bg-panel-2 px-2 py-0.5 text-[0.65rem] text-muted" title="Quién responde">
              {ai ? engineer.provider : "Reglas (sin IA)"}
            </span>
          )}
          {voice.supported && engineer.active && (
            <button
              onClick={voice.toggle}
              className={`rounded-lg border px-2 py-1 text-xs ${voice.enabled ? "border-accent text-accent" : "border-line text-muted"}`}
              title="Leer la radio en voz alta"
            >
              {voice.enabled ? "🔊 Voz" : "🔈 Voz"}
            </button>
          )}
          <button
            onClick={() => onToggle(!engineer.active)}
            disabled={busy}
            className={`rounded-lg px-3 py-1 text-xs font-semibold disabled:opacity-50 ${
              engineer.active ? "bg-accent text-bg" : "border border-line text-fg"
            }`}
          >
            {engineer.active ? "Activo" : "Activar"}
          </button>
        </div>
      }
    >
      {engineer.active && onAsk && <TalkBar onAsk={onAsk} />}

      {!engineer.active ? (
        <p className="py-3 text-sm text-muted">
          Activalo para que el ingeniero siga la sesión: te habla por radio cuando hay algo importante, ajusta la
          estrategia y analiza tu ritmo contra los rivales.
        </p>
      ) : !latest ? (
        <p className="py-3 text-sm text-muted">
          Escuchando la sesión. El ingeniero te habla en las rectas: ritmo, rivales, en qué curva perdés tiempo, qué goma
          estás castigando, y al instante si pasa algo urgente (safety car, daños, lluvia, boxes).
        </p>
      ) : (
        <div className="space-y-3">
          {lastRadio && (
            <div className={`rounded-xl border-l-4 bg-panel-2 px-4 py-3 ${PRIORITY[lastRadio.prioridad]?.border ?? "border-accent"}`}>
              <div className="flex items-center justify-between text-[0.65rem] tracking-wider">
                <span className={PRIORITY[lastRadio.prioridad]?.text ?? "text-accent"}>
                  {PRIORITY[lastRadio.prioridad]?.label ?? "RADIO"}
                  {lastRadio.provider === "aviso inmediato" && ai && (
                    <span className="ml-2 text-muted">· aviso inmediato, la IA está analizando…</span>
                  )}
                </span>
                {lastRadio.lap != null && <span className="num text-muted">V{lastRadio.lap}</span>}
              </div>
              {lastRadio.pregunta && <p className="mt-1 text-xs text-muted">Vos: “{lastRadio.pregunta}”</p>}
              <p className="mt-1 text-lg font-medium leading-snug">“{lastRadio.radio}”</p>
            </div>
          )}

          {wall?.estrategia && <Strategy s={wall.estrategia} />}

          {wall?.manejo && wall.manejo.length > 0 && (
            <ul className="space-y-1 text-sm">
              {wall.manejo.map((tip) => (
                <li key={tip} className="flex gap-2">
                  <span className="text-accent">›</span>
                  {tip}
                </li>
              ))}
            </ul>
          )}

          {wall?.reglaje && wall.reglaje.length > 0 && (
            <div>
              <div className="label mb-1">Reglaje sugerido</div>
              <ul className="space-y-1 text-sm">
                {wall.reglaje.map((r) => (
                  <li key={r.parametro}>
                    <span className="font-medium">{r.parametro}</span> <span className="text-accent">{r.cambio}</span>
                    <span className="text-muted"> · {r.motivo}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {wall?.analisis && <p className="text-sm leading-relaxed text-muted">{wall.analisis}</p>}

          {history.length > 0 && (
            <div>
              <div className="label mb-1">Radio anterior</div>
              <ul className="space-y-1 text-xs text-muted">
                {history.map((m) => (
                  <li key={m.id} className="flex gap-2">
                    <span className="num shrink-0">V{m.lap ?? "–"}</span>
                    <span>
                      {m.pregunta && <span className="text-fg/70">Vos: “{m.pregunta}” · </span>}
                      {m.radio}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {cost > 0 && (
            <p className="num text-right text-[0.65rem] text-muted">
              Costo de IA en esta sesión: US$ {cost.toFixed(3)} ·{" "}
              <Link href="/usage" className="text-accent underline">
                ver consumo
              </Link>
            </p>
          )}
        </div>
      )}
    </Panel>
  );
}

function Strategy({ s }: { s: NonNullable<EngineerState["messages"][number]["estrategia"]> }) {
  const window = s.ventana_box?.filter(Boolean) ?? [];
  return (
    <div className="rounded-xl border border-line p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="label">Estrategia</div>
          <div className="font-medium">{s.plan}</div>
        </div>
        <span
          className={`shrink-0 rounded px-2 py-0.5 text-[0.65rem] ${
            s.certeza === "alta" ? "bg-ok/20 text-ok" : s.certeza === "media" ? "bg-warn/20 text-warn" : "bg-panel-2 text-muted"
          }`}
        >
          certeza {s.certeza}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {s.vuelta_box != null && (
          <span>
            Box: <span className="num font-semibold">vuelta {s.vuelta_box}</span>
          </span>
        )}
        {window.length > 0 && (
          <span>
            Ventana: <span className="num">{window.length > 1 ? `v${window[0]}–${window.slice(-1)[0]}` : `v${window[0]}`}</span>
          </span>
        )}
        {s.proximo_compuesto && (
          <span className="flex items-center gap-1.5">
            Próximo:
            <span className="h-3 w-3 rounded-full" style={{ background: COMPOUND_COLORS[s.proximo_compuesto] ?? "#7d8996" }} />
            {COMPOUND_ES[s.proximo_compuesto] ?? s.proximo_compuesto}
          </span>
        )}
      </div>
      {s.alternativa && <p className="mt-1 text-xs text-muted">Alternativa: {s.alternativa}</p>}
    </div>
  );
}

/** Push to talk (or type): the driver asks, the engineer answers on the radio at once. */
function TalkBar({ onAsk }: { onAsk: (text: string) => Promise<unknown> }) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const send = async (question: string) => {
    const q = question.trim();
    if (!q || sending) return;
    setSending(true);
    setFailed(null);
    try {
      await onAsk(q);
      setText("");
    } catch {
      setFailed("No llegó la pregunta. Probá de nuevo.");
    } finally {
      setSending(false);
    }
  };
  const mic = useDictation(send);

  return (
    <div className="mb-3">
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          send(text);
        }}
      >
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
            className={`shrink-0 touch-none select-none rounded-full border px-3 py-2 text-sm font-semibold ${
              mic.listening ? "border-danger bg-danger/15 text-danger" : "border-accent text-accent"
            }`}
            title="Mantené apretado y hablá"
          >
            {mic.listening ? "● Te escucho" : "🎙 Hablar"}
          </button>
        )}
        <input
          value={mic.listening ? mic.interim : text}
          onChange={(e) => setText(e.target.value)}
          placeholder={mic.supported ? "Mantené Hablar o escribí: estatus, ¿cómo me fue en la 3?" : "Escribí: estatus, ¿cuándo paro?, anotalo…"}
          className="min-w-0 flex-1 rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm placeholder:text-muted focus:border-accent focus:outline-none"
          disabled={sending || mic.listening}
          maxLength={500}
        />
        <button
          type="submit"
          disabled={sending || !text.trim()}
          className="shrink-0 rounded-lg border border-line px-3 py-2 text-sm disabled:opacity-40"
        >
          {sending ? "…" : "Enviar"}
        </button>
      </form>
      {(mic.error || failed) && <p className="mt-1 text-xs text-danger">{mic.error || failed}</p>}
      {!mic.listening && !sending && (
        <p className="mt-1 text-[0.65rem] text-muted">
          “Anotalo: …” guarda lo que sentís para el box · “Alto” lo calla · “Hablame” lo vuelve a activar
        </p>
      )}
    </div>
  );
}
