"use client";

import { useEffect, useState } from "react";

import { LiveDelta, RelativesList, SectorReview, shortName } from "@/components/dashboard/Cards";
import { gap, lapTime } from "@/lib/format";
import { useLive } from "@/lib/live";
import { teamColor } from "@/lib/teams";
import type { EngineerMessage, Snapshot } from "@/lib/types";
import { useEngineerVoice } from "@/lib/voice";

export const OVERLAY_PANELS = {
  delta: { label: "Delta", size: "320×110" },
  relativos: { label: "Relativos", size: "360×300" },
  tiempos: { label: "Tiempos y sectores", size: "380×220" },
  posiciones: { label: "Posiciones", size: "300×480" },
  pedales: { label: "Pedales", size: "140×160" },
  radio: { label: "Radio del ingeniero", size: "520×120" },
} as const;

export type OverlayPanel = keyof typeof OVERLAY_PANELS;

const RADIO_SHOWN_MS = 20_000;
// Right after opening, an empty panel looks broken: say it is connected, then get out of the way.
const WAITING_HINT_MS = 15_000;

type Props = { panel: string; token: string; scale: number; opacity: number; rows: number; voice: boolean; dark: boolean };

/** One panel over a transparent page. Without data it stays empty, so nothing covers the game. */
export function Overlay({ panel, token, scale, opacity, rows, voice, dark }: Props) {
  const { status, snapshot: s, engineer } = useLive({ overlayToken: token || undefined });
  const [justOpened, setJustOpened] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setJustOpened(false), WAITING_HINT_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    // The app's dark background would paint over the game; a tab on a second screen keeps it.
    if (dark) return;
    for (const el of [document.documentElement, document.body]) el.style.background = "transparent";
  }, [dark]);

  let body: React.ReactNode = null;
  if (!token) body = <Notice>Falta el link del panel. Crealo en Ajustes → Paneles flotantes.</Notice>;
  else if (!(panel in OVERLAY_PANELS)) body = <Notice>Panel desconocido: {panel}</Notice>;
  else if (!s && justOpened && status === "waiting")
    body = <Notice>Conectado. Esperando la sesión: el panel se llena solo cuando corras.</Notice>;
  else if (panel === "radio") body = <RadioPanel messages={engineer.messages} voice={voice} />;
  else if (s) body = <SnapshotPanel panel={panel as OverlayPanel} s={s} rows={rows} />;
  else if (status === "offline") body = <Notice>Sin conexión. Si el link fue revocado, creá uno nuevo.</Notice>;

  if (!body) return null;
  return (
    <div className="p-1" style={{ zoom: scale }}>
      <div
        className="rounded-xl p-3 text-fg empty:hidden"
        style={{ background: `rgba(7, 9, 12, ${opacity})` }}
      >
        {body}
      </div>
    </div>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return <p className="max-w-xs text-xs text-muted">{children}</p>;
}

function SnapshotPanel({ panel, s, rows }: { panel: OverlayPanel; s: Snapshot; rows: number }) {
  const lap = s.lap;
  switch (panel) {
    case "delta":
      return lap ? (
        <div className="flex items-end justify-between gap-6">
          <div>
            <div className="label">Vuelta {lap.lap}</div>
            <div className="num text-3xl font-semibold">{lapTime(lap.current_lap_ms)}</div>
          </div>
          <LiveDelta ms={lap.delta_best_ms} refLap={lap.delta_reference_lap} />
        </div>
      ) : null;
    case "relativos":
      return s.relatives ? <RelativesList s={s} rows={rows || 3} /> : null;
    case "tiempos":
      return lap ? <TimesPanel s={s} /> : null;
    case "posiciones":
      return <StandingsPanel s={s} rows={rows || 10} />;
    case "pedales":
      return s.car ? <PedalsPanel throttle={s.car.throttle} brake={s.car.brake} /> : null;
    default:
      return null;
  }
}

function TimesPanel({ s }: { s: Snapshot }) {
  const lap = s.lap!;
  const s3 = lap.sector === 3 && lap.sector1_ms && lap.sector2_ms ? lap.current_lap_ms - lap.sector1_ms - lap.sector2_ms : null;
  const me = s.cars?.find((c) => c.is_player);
  return (
    <div>
      <div className="flex items-end justify-between gap-4">
        <div className="num text-3xl font-semibold">{lapTime(lap.current_lap_ms)}</div>
        <div className="text-right text-xs text-muted">
          <div>
            Última <span className="num text-fg">{lapTime(lap.last_lap_ms)}</span>
          </div>
          <div>
            Mejor <span className="num text-fg">{lapTime(me?.best_lap_ms)}</span>
          </div>
        </div>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-1.5">
        {[lap.sector1_ms, lap.sector2_ms, s3].map((ms, i) => (
          <div key={i} className={`rounded-md border px-2 py-1 text-center ${lap.sector === i + 1 ? "border-accent/60" : "border-line"}`}>
            <div className="label">S{i + 1}</div>
            <div className="num text-sm">{ms && lap.sector > i + 1 ? (ms / 1000).toFixed(3) : "—"}</div>
          </div>
        ))}
      </div>
      <SectorReview rows={s.sector_review} />
    </div>
  );
}

/** A window of the standings centred on the player, so it fits on screen in a full grid. */
function StandingsPanel({ s, rows }: { s: Snapshot; rows: number }) {
  const cars = s.cars ?? [];
  const at = Math.max(0, cars.findIndex((c) => c.is_player));
  const start = Math.max(0, Math.min(at - Math.floor(rows / 2), cars.length - rows));
  return (
    <ol className="space-y-0.5">
      {cars.slice(start, start + rows).map((c) => (
        <li
          key={c.index}
          className={`grid grid-cols-[1.6rem_0.25rem_minmax(0,1fr)_4rem] items-center gap-2 rounded px-1 text-sm ${
            c.is_player ? "bg-accent/20" : ""
          }`}
        >
          <span className="num text-right text-muted">{c.position}</span>
          <span className="h-4 rounded-full" style={{ background: c.color ?? teamColor(c.team_id) }} />
          <span className={`truncate ${c.is_player ? "font-semibold" : ""}`}>
            {shortName(c)}
            {c.pit !== "On track" && <span className="ml-1 rounded bg-warn px-1 text-[0.6rem] font-bold text-bg">BOX</span>}
          </span>
          <span className="num text-right text-xs text-muted">{c.position === 1 ? `V${c.lap}` : gap(c.gap_ahead_ms)}</span>
        </li>
      ))}
    </ol>
  );
}

/** Bars without numbers, like a steering-wheel display. */
function PedalsPanel({ throttle, brake }: { throttle: number; brake: number }) {
  const bar = (value: number, color: string) => (
    <div className="relative h-28 w-6 overflow-hidden rounded bg-panel-2">
      <div className="absolute bottom-0 w-full transition-all duration-150" style={{ height: `${value * 100}%`, background: color }} />
    </div>
  );
  return (
    <div className="flex gap-3">
      {bar(brake, "#f43f5e")}
      {bar(throttle, "#34d399")}
    </div>
  );
}

function RadioPanel({ messages, voice }: { messages: EngineerMessage[]; voice: boolean }) {
  useEngineerVoice(messages, { alwaysOn: voice });
  const last = [...messages].reverse().find((m) => m.radio);
  const [shownId, setShownId] = useState<number | null>(null);

  // Show each new call for a while, then clear the panel so it does not cover the game.
  useEffect(() => {
    if (!last) return;
    setShownId(last.id);
    const timer = setTimeout(() => setShownId(null), RADIO_SHOWN_MS);
    return () => clearTimeout(timer);
  }, [last?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!last || shownId !== last.id) return null;
  const urgent = last.prioridad === "urgente";
  return (
    <div className={`max-w-[32rem] border-l-4 pl-3 ${urgent ? "border-danger" : "border-accent"}`}>
      <div className={`label ${urgent ? "text-danger" : ""}`}>Radio{last.lap ? ` · vuelta ${last.lap}` : ""}</div>
      <p className="mt-1 text-lg font-medium leading-snug">“{last.radio}”</p>
    </div>
  );
}
