"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { CockpitGrid } from "@/components/cockpit/CockpitGrid";
import { ConnectGuide } from "@/components/live/ConnectGuide";
import { Boxes } from "@/components/session/Boxes";
import { RadioDock } from "@/components/ui/RadioDock";
import { chooseCockpit, chosenCockpit, useCockpits, type Cockpit } from "@/lib/cockpit";
import { useSharedLive } from "@/lib/liveContext";
import { sessionEs, useApi, useLiveSessionId, type GameSession } from "@/lib/sessions";
import { isRace } from "@/components/live/LiveBlocks";
import type { Snapshot } from "@/lib/types";

type View = "boxes" | "pista";

function clock(s: number) {
  return `${Math.floor(s / 60)} min`;
}

/**
 * The session: the box while the car is in the garage, the cockpit while it runs.
 * It switches by itself when the game says the car left or came back; the player
 * can still pick one, until the car moves again.
 */
export function Session() {
  const { status, snapshot: s, engineer } = useSharedLive();
  const sid = useLiveSessionId(s?.session_uid);
  const auto: View = s?.car_state === "garage" ? "boxes" : "pista";
  const [forced, setForced] = useState<{ view: View; state: string | undefined } | null>(null);
  // A manual choice holds until the car changes state.
  const view = forced && forced.state === s?.car_state ? forced.view : auto;
  const { cockpits } = useCockpits();
  const [cockpit, setCockpit] = useState<Cockpit | null>(null);
  useEffect(() => {
    if (cockpits) setCockpit(chosenCockpit(cockpits));
  }, [cockpits]);

  if (!s) return <NoSession status={status} />;

  const race = isRace(s);
  // The game sends "SEND" when the session ends (and "CHQF" at the chequered flag).
  const ended = s.events.some((e) => e.code === "SEND" || e.code === "CHQF");
  const left = s.session?.time_left_s;
  return (
    <main className="mx-auto flex max-w-[1600px] flex-col gap-4 px-[max(1rem,env(safe-area-inset-left))] pt-4 lg:px-7 lg:pt-5">
      <header className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <div className="min-w-0">
          <span className="eyebrow block">
            {s.session?.track ?? "Pista"} · {sessionEs(s.session?.type)}
            {race ? ` · vuelta ${s.lap?.lap ?? "—"} de ${s.session?.total_laps ?? "—"}` : left ? ` · quedan ${clock(left)}` : ""}
          </span>
          <h1 className="display mt-1 text-[2.4rem] uppercase lg:text-[2.9rem]">{view === "boxes" ? "En boxes" : "En pista"}</h1>
        </div>
        <div className="mb-1 flex rounded-[var(--radius-control)] bg-panel p-1" role="group" aria-label="Vista">
          {(["boxes", "pista"] as View[]).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => setForced({ view: v, state: s.car_state })}
              className={`title h-9 rounded-[8px] px-4 text-[1rem] ${view === v ? "bg-fg text-bg" : "text-muted"}`}
            >
              {v === "boxes" ? "Boxes" : "Pista"}
            </button>
          ))}
        </div>
        <span className="mb-3 hidden text-[0.85rem] text-dim xl:inline">
          {forced && forced.state === s.car_state ? "Elegido a mano hasta que el auto se mueva" : "Automático: cambia cuando salís y cuando volvés"}
        </span>
        <div className="mb-1 ml-auto flex items-center gap-2">
          {view === "pista" && cockpits && cockpit && (
            <CockpitControls
              cockpits={cockpits}
              current={cockpit}
              onPick={(c) => {
                chooseCockpit(c.id);
                setCockpit(c);
              }}
            />
          )}
          {view === "boxes" && sid != null && (
            <Link href={`/resumen/${sid}`} className="btn flex h-10 items-center gap-2 px-3.5 text-[0.9rem]">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M5 4h14v16H5zM9 9h6M9 13h6M9 17h3" /></svg>
              Resumen de la sesión
            </Link>
          )}
        </div>
      </header>

      {ended && sid != null && (
        <Link href={`/resumen/${sid}`} className="paper flex items-center justify-between gap-3 px-5 py-4">
          <span>
            <span className="title block text-[1.3rem]">Terminó la sesión</span>
            <span className="text-[0.9rem] text-paper-muted">Mirá cómo te fue, dónde perdiste tiempo y qué cambiar para la próxima.</span>
          </span>
          <span className="btn-ink shrink-0 px-4 py-2.5 text-[0.95rem]">Ver el resumen</span>
        </Link>
      )}

      {view === "boxes" ? <Boxes s={s} sid={sid} messages={engineer.messages} /> : cockpit ? <Pista s={s} cockpit={cockpit} /> : <div className="h-[60dvh]" />}
      <RadioDock />
      <div className="h-2" />
    </main>
  );
}

const ICON = "grid h-10 w-10 place-items-center rounded-[var(--radius-control)] border border-line text-muted hover:text-fg";

/** Which cockpit this screen shows, full screen, and the way to build them: icons on the right of the title. */
function CockpitControls({ cockpits, current, onPick }: { cockpits: Cockpit[]; current: Cockpit; onPick: (c: Cockpit) => void }) {
  return (
    <>
      <label className="relative flex h-10 items-center rounded-[var(--radius-control)] border border-line pl-9 pr-2 text-muted hover:text-fg" title="Qué cockpit ves en esta pantalla">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" className="pointer-events-none absolute left-2.5" aria-hidden="true">
          <rect x="3" y="4" width="18" height="12" rx="2" />
          <path d="M8 20h8M12 16v4" />
        </svg>
        <span className="sr-only">Cockpit</span>
        <select value={current.id} onChange={(e) => onPick(cockpits.find((k) => k.id === e.target.value)!)} className="h-full max-w-[11rem] bg-transparent pr-1 text-[0.88rem] text-fg outline-none">
          {cockpits.map((c) => (
            <option key={c.id} value={c.id} className="bg-panel">
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <Link href="/cockpit" className={ICON} aria-label="Ver a pantalla completa" title="Pantalla completa">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
        </svg>
      </Link>
      <Link href="/settings#pantallas" className={ICON} aria-label="Tus pantallas y cockpits" title="Tus pantallas y cockpits">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12" />
          <circle cx="16" cy="6" r="2" />
          <circle cx="10" cy="12" r="2" />
          <circle cx="18" cy="18" r="2" />
        </svg>
      </Link>
    </>
  );
}

function Pista({ s, cockpit }: { s: Snapshot; cockpit: Cockpit }) {
  const { engineer } = useSharedLive();
  return (
    <section className="h-[max(360px,calc(100dvh-20rem))] lg:h-[max(460px,calc(100dvh-16.5rem))]" aria-label="Tu cockpit">
      <CockpitGrid cockpit={cockpit} ctx={{ s, messages: engineer.messages }} />
    </section>
  );
}

function NoSession({ status }: { status: ReturnType<typeof useSharedLive>["status"] }) {
  const { data: sessions } = useApi<GameSession[]>("/api/sessions");
  const last = sessions?.find((g) => g.has_recording);
  return (
    <main className="mx-auto flex max-w-[1100px] flex-col gap-5 px-[max(1rem,env(safe-area-inset-left))] pt-5 lg:px-7">
      <div>
        <span className="eyebrow">Sin sesión en curso</span>
        <h1 className="display mt-1 text-[2.4rem] uppercase">Salí a pista</h1>
        <p className="mt-2 max-w-[60ch] text-[1rem] text-soft-fg">
          Cuando el juego arranque una sesión, esta pantalla pasa sola a Boxes o a Pista. Mientras tanto, preparate en{" "}
          <Link href="/circuitos" className="text-accent-ink">
            Circuitos
          </Link>
          .
        </p>
      </div>
      {last && (
        <Link href={`/resumen/${last.id}`} className="card flex items-center justify-between gap-4 px-5 py-4 hover:bg-panel-2">
          <span>
            <span className="eyebrow block">Tu última sesión</span>
            <span className="title text-[1.4rem]">
              {last.track} · {sessionEs(last.session_type)}
            </span>
          </span>
          <span className="text-accent-ink">Ver el resumen ›</span>
        </Link>
      )}
      <ConnectGuide status={status} />
    </main>
  );
}
