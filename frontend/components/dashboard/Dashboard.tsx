"use client";

import Link from "next/link";
import { useState } from "react";

import { CarTopView } from "@/components/dashboard/CarTopView";
import {
  EventsCard,
  RelativesCard,
  sessionName,
  SessionCard,
  StandingsCard,
  TelemetryCard,
  TimingCard,
} from "@/components/dashboard/Cards";
import { TrackMap } from "@/components/dashboard/TrackMap";
import { ConnectGuide } from "@/components/live/ConnectGuide";
import { LiveHero, PitWall, RadioFeed, Rivals, TalkControls, useEngineerAlwaysOn } from "@/components/live/LiveBlocks";
import { WakeLockButton } from "@/components/WakeLockButton";
import { useEngineerVoice } from "@/lib/voice";
import { type LiveStatus, useLive } from "@/lib/live";
import type { EngineerState, Snapshot } from "@/lib/types";

export function Dashboard() {
  const { status, snapshot, engineer, engineerBusy, toggleEngineer, askEngineer } = useLive();
  const toggle = useEngineerAlwaysOn(snapshot, engineer, toggleEngineer, engineerBusy);
  const voice = useEngineerVoice(engineer.messages);

  return (
    <main className="mx-auto max-w-[1800px] px-3 pb-6 pt-3 sm:px-5">
      <TopBar status={status} s={snapshot} />
      {!snapshot ? (
        <ConnectGuide status={status} />
      ) : (
        <LiveLayout
          s={snapshot}
          engineer={engineer}
          voice={voice}
          onToggle={toggle}
          busy={engineerBusy}
          onAsk={askEngineer}
        />
      )}
    </main>
  );
}

/** The live screen's blocks, shared with session replays (which cannot talk to the engineer). */
export function LiveLayout({
  s,
  engineer,
  voice,
  onToggle,
  busy,
  onAsk,
}: {
  s: Snapshot;
  engineer: EngineerState;
  voice: { supported: boolean; enabled: boolean; toggle: () => void };
  onToggle: (active: boolean) => void;
  busy: boolean;
  onAsk?: (text: string) => Promise<unknown>;
}) {
  const [more, setMore] = useState(false);
  return (
    // One tree for every screen: on a phone the columns dissolve (display: contents) and the
    // blocks stack by importance; on a tablet or computer they are the three columns of a pit wall.
    <div className="mt-3 flex flex-col gap-3 lg:grid lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.4fr)_minmax(0,1fr)] lg:items-start">
      <div className="contents lg:flex lg:flex-col lg:gap-3">
        <div className={`order-10 lg:order-none ${more ? "" : "hidden lg:block"}`}>
          <SessionCard s={s} />
        </div>
        <div className={`order-11 lg:order-none ${more ? "" : "hidden lg:block"}`}>
          <RelativesCard s={s} />
        </div>
        <div className={`order-12 lg:order-none ${more ? "" : "hidden lg:block"}`}>
          <StandingsCard s={s} />
        </div>
      </div>
      <div className="contents lg:flex lg:flex-col lg:gap-3">
        <div className="order-1 lg:order-none">
          <LiveHero s={s} />
        </div>
        <div className="order-2 lg:order-none">
          <Rivals s={s} />
        </div>
        <div className={`order-7 lg:order-none ${more ? "" : "hidden lg:block"}`}>
          <TrackMap s={s} />
        </div>
        <div className={`order-8 lg:order-none ${more ? "" : "hidden lg:block"}`}>
          <TimingCard s={s} />
        </div>
      </div>
      <div className="contents lg:flex lg:flex-col lg:gap-3">
        <div className="order-3 lg:order-none">
          <RadioFeed engineer={engineer} voice={voice} onToggle={onToggle} busy={busy} replay={!onAsk} />
        </div>
        <div className="order-4 lg:order-none">
          {onAsk ? <TalkControls onAsk={onAsk} /> : null}
        </div>
        <button onClick={() => setMore((v) => !v)} className="chip order-5 py-3 text-sm text-muted lg:hidden">
          {more ? "Ocultar el resto" : "Todo lo demás: tiempos, mapa, posiciones, auto"}
        </button>
        <div className={`order-6 lg:order-none ${more ? "" : "hidden lg:block"}`}>
          <PitWall engineer={engineer} />
        </div>
        <div className={`order-9 lg:order-none ${more ? "" : "hidden lg:block"}`}>
          <TelemetryCard s={s} />
        </div>
        <div className={`order-13 lg:order-none ${more ? "" : "hidden lg:block"}`}>
          <CarTopView s={s} />
        </div>
      </div>
    </div>
  );
}

/** The cards, shared by the live dashboard and session replays. */
export function DashboardGrid({ s: snapshot, engineer }: { s: Snapshot; engineer?: React.ReactNode }) {
  return (
    // Landscape first (tablet, computer, TV): session and standings | map and
    // timing | car. On a phone the columns stack with the car on top.
    <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.5fr)_minmax(0,1fr)]">
      <div className="order-3 flex flex-col gap-3 lg:order-1">
        <SessionCard s={snapshot} />
        <RelativesCard s={snapshot} />
        <StandingsCard s={snapshot} />
      </div>
      <div className="order-2 flex flex-col gap-3">
        {engineer}
        <TrackMap s={snapshot} />
        <TimingCard s={snapshot} />
        <EventsCard s={snapshot} />
      </div>
      <div className="order-1 flex flex-col gap-3 lg:order-3">
        <TelemetryCard s={snapshot} />
        <CarTopView s={snapshot} />
      </div>
    </div>
  );
}

function TopBar({ status, s }: { status: LiveStatus; s: Snapshot | null }) {
  const se = s?.session;
  return (
    <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
      <div className="label flex min-w-0 flex-wrap items-center gap-x-2 !text-sm">
        {se && <span className="truncate !text-fg">{`${se.track} · ${sessionName(se.type)}`}</span>}
        {se && se.safety_car !== "None" && <span className="font-semibold text-warn">{safetyCar(se.safety_car)}</span>}
        {se && <FlagBadge flag={s?.status?.fia_flag} zones={se.marshal_zones} />}
        {se?.paused && <span className="text-warn">En pausa</span>}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 whitespace-nowrap text-xs [&>*]:!py-1 [&>*]:!text-xs">
        <LinkBadge reception={s?.link.reception ?? null} />
        <StatusPill status={status} />
        <WakeLockButton />
        <Link href="/volante" className="chip px-3 py-1.5 text-sm text-muted hover:text-fg lg:hidden">
          Modo volante
        </Link>
      </div>
    </header>
  );
}

const FLAGS: Record<string, [string, string]> = {
  blue: ["Bandera azul", "text-[#3b82f6]"],
  yellow: ["Amarilla", "text-warn"],
  red: ["Roja", "text-danger"],
};

/** The FIA flag shown to the player, or a yellow/red marshal zone on track. */
function FlagBadge({ flag, zones }: { flag?: string | null; zones?: { bandera: string | null }[] }) {
  const onTrack = zones?.some((z) => z.bandera === "yellow" || z.bandera === "red");
  const key = flag && FLAGS[flag] ? flag : onTrack ? "yellow" : null;
  if (!key) return null;
  const [label, cls] = FLAGS[key];
  const suffix = !flag && onTrack ? " en pista" : "";
  return <span className={`font-semibold ${cls}`}>⚑ {label}{suffix}</span>;
}

function safetyCar(kind: string): string {
  return kind === "Virtual safety car" ? "VSC" : kind === "Formation lap" ? "Vuelta de formación" : "SAFETY CAR";
}

function StatusPill({ status }: { status: LiveStatus }) {
  const map: Record<LiveStatus, [string, string]> = {
    live: ["En vivo", "bg-ok"],
    waiting: ["Sin datos del juego", "bg-warn"],
    connecting: ["Conectando…", "bg-muted"],
    offline: ["Sin conexión", "bg-danger"],
  };
  const [label, dot] = map[status];
  return (
    <span className="chip flex items-center gap-1.5 px-2.5 py-1.5 text-sm">
      <span className={`h-2 w-2 rounded-full ${dot} ${status === "live" ? "animate-pulse" : ""}`} />
      {label}
    </span>
  );
}

/** How much of the game's telemetry reaches the bridge: the console's network, not ours. */
function LinkBadge({ reception }: { reception: number | null }) {
  if (reception == null) return null;
  const pct = Math.round(reception * 100);
  const cls = pct >= 75 ? "text-ok" : pct >= 40 ? "text-warn" : "text-danger";
  return (
    <span
      className="chip px-2.5 py-1.5 text-sm"
      title="Porcentaje de la telemetría del juego que llega al bridge. Con la consola por cable suele ser 100%."
    >
      Señal <span className={`num font-semibold ${cls}`}>{pct}%</span>
    </span>
  );
}
