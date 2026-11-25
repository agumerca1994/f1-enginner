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

  if (!s) return <NoSession status={status} />;

  const race = isRace(s);
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
        <span className="mb-3 hidden text-[0.85rem] text-dim sm:inline">
          {forced && forced.state === s.car_state ? "Elegido a mano hasta que el auto se mueva" : "Automático: cambia cuando salís y cuando volvés"}
        </span>
      </header>

      {view === "boxes" ? <Boxes s={s} sid={sid} messages={engineer.messages} /> : <Pista s={s} />}
      <RadioDock />
      <div className="h-2" />
    </main>
  );
}

function Pista({ s }: { s: Snapshot }) {
  const { cockpits } = useCockpits();
  const { engineer } = useSharedLive();
  const [current, setCurrent] = useState<Cockpit | null>(null);
  useEffect(() => {
    if (cockpits) setCurrent(chosenCockpit(cockpits));
  }, [cockpits]);
  if (!cockpits || !current) return <div className="h-[60dvh]" />;
  return (
    <section className="flex flex-col gap-3" aria-label="Tu cockpit">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-[0.85rem] text-muted">
          Cockpit
          <select
            value={current.id}
            onChange={(e) => {
              const c = cockpits.find((k) => k.id === e.target.value)!;
              chooseCockpit(c.id);
              setCurrent(c);
            }}
            className="h-9 rounded-[8px] border border-line bg-panel px-2 text-[0.92rem] text-fg"
          >
            {cockpits.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <Link href={`/cockpit/editar?id=${current.id}`} className="btn px-3 py-1.5 text-[0.85rem]">
          Armar
        </Link>
        <Link href="/cockpit" className="btn px-3 py-1.5 text-[0.85rem]">
          Pantalla completa
        </Link>
      </div>
      <div className="h-[max(360px,calc(100dvh-23rem))] lg:h-[max(460px,calc(100dvh-19.5rem))]">
        <CockpitGrid cockpit={current} ctx={{ s, messages: engineer.messages }} />
      </div>
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
