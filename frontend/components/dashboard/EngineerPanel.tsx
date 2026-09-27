"use client";

import { Panel } from "@/components/dashboard/Panel";
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
  busy = false,
}: {
  engineer: EngineerState;
  onToggle: (active: boolean) => void;
  busy?: boolean;
}) {
  const voice = useEngineerVoice(engineer.messages);
  const latest = engineer.messages.at(-1);
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
      {!engineer.active ? (
        <p className="py-3 text-sm text-muted">
          Activalo para que el ingeniero siga la sesión: te habla por radio cuando hay algo importante, ajusta la
          estrategia y analiza tu ritmo contra los rivales.
        </p>
      ) : !latest ? (
        <p className="py-3 text-sm text-muted">
          Escuchando la sesión. El ingeniero habla al completar cada vuelta o cuando pasa algo importante: safety car,
          daños, lluvia, boxes.
        </p>
      ) : (
        <div className="space-y-3">
          {lastRadio && (
            <div className={`rounded-xl border-l-4 bg-panel-2 px-4 py-3 ${PRIORITY[lastRadio.prioridad]?.border ?? "border-accent"}`}>
              <div className="flex items-center justify-between text-[0.65rem] tracking-wider">
                <span className={PRIORITY[lastRadio.prioridad]?.text ?? "text-accent"}>
                  {PRIORITY[lastRadio.prioridad]?.label ?? "RADIO"}
                </span>
                {lastRadio.lap != null && <span className="num text-muted">V{lastRadio.lap}</span>}
              </div>
              <p className="mt-1 text-lg font-medium leading-snug">“{lastRadio.radio}”</p>
            </div>
          )}

          <Strategy s={latest.estrategia} />

          {latest.manejo.length > 0 && (
            <ul className="space-y-1 text-sm">
              {latest.manejo.map((tip) => (
                <li key={tip} className="flex gap-2">
                  <span className="text-accent">›</span>
                  {tip}
                </li>
              ))}
            </ul>
          )}

          {latest.reglaje.length > 0 && (
            <div>
              <div className="label mb-1">Reglaje sugerido</div>
              <ul className="space-y-1 text-sm">
                {latest.reglaje.map((r) => (
                  <li key={r.parametro}>
                    <span className="font-medium">{r.parametro}</span> <span className="text-accent">{r.cambio}</span>
                    <span className="text-muted"> · {r.motivo}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {latest.analisis && <p className="text-sm leading-relaxed text-muted">{latest.analisis}</p>}

          {history.length > 0 && (
            <div>
              <div className="label mb-1">Radio anterior</div>
              <ul className="space-y-1 text-xs text-muted">
                {history.map((m) => (
                  <li key={m.id} className="flex gap-2">
                    <span className="num shrink-0">V{m.lap ?? "–"}</span>
                    <span>{m.radio}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {cost > 0 && <p className="num text-right text-[0.65rem] text-muted">Costo de IA en esta sesión: US$ {cost.toFixed(3)}</p>}
        </div>
      )}
    </Panel>
  );
}

function Strategy({ s }: { s: EngineerState["messages"][number]["estrategia"] }) {
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
            Ventana: <span className="num">{window.length > 1 ? `v${window[0]}–${window.at(-1)}` : `v${window[0]}`}</span>
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
