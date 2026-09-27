"use client";

import Link from "next/link";

import {
  CarCard,
  DamageCard,
  EventsCard,
  FuelErsCard,
  PositionCard,
  TimingCard,
  TyresCard,
  WeatherCard,
} from "@/components/dashboard/Cards";
import { WakeLockButton } from "@/components/WakeLockButton";
import { type LiveStatus, useLive } from "@/lib/live";
import type { Snapshot } from "@/lib/types";

const SESSION_ES: Record<string, string> = {
  Race: "Carrera",
  "Race 2": "Carrera 2",
  "Race 3": "Carrera 3",
  "Time Trial": "Contrarreloj",
  "Practice 1": "Práctica 1",
  "Practice 2": "Práctica 2",
  "Practice 3": "Práctica 3",
  "Short Practice": "Práctica corta",
  "Qualifying 1": "Clasificación 1",
  "Qualifying 2": "Clasificación 2",
  "Qualifying 3": "Clasificación 3",
  "Short Qualifying": "Clasificación corta",
  "One-Shot Qualifying": "Clasificación a una vuelta",
};

export function Dashboard() {
  const { status, snapshot } = useLive();

  return (
    <main className="mx-auto max-w-7xl px-3 pb-10 pt-3 sm:px-5">
      <TopBar status={status} s={snapshot} />
      {snapshot ? (
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <PositionCard s={snapshot} />
          <TimingCard s={snapshot} />
          <CarCard s={snapshot} />
          <TyresCard s={snapshot} />
          <FuelErsCard s={snapshot} />
          <DamageCard s={snapshot} />
          <WeatherCard s={snapshot} />
          <EventsCard s={snapshot} />
        </div>
      ) : (
        <Waiting status={status} />
      )}
    </main>
  );
}

function TopBar({ status, s }: { status: LiveStatus; s: Snapshot | null }) {
  const se = s?.session;
  return (
    <header className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-panel px-4 py-3">
      <div className="min-w-0">
        <div className="truncate text-lg font-semibold">{se ? se.track : "Ingeniero de carrera"}</div>
        <div className="text-sm text-muted">
          {se ? (
            <>
              {SESSION_ES[se.type] ?? se.type}
              {s?.driver && ` · ${s.driver.name} #${s.driver.race_number} · ${s.driver.team}`}
              {se.safety_car !== "None" && <span className="ml-2 font-semibold text-warn">{safetyCar(se.safety_car)}</span>}
              {se.paused && <span className="ml-2 text-warn">En pausa</span>}
            </>
          ) : (
            "Esperando la sesión"
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <LinkBadge reception={s?.link.reception ?? null} />
        <StatusPill status={status} />
        <WakeLockButton />
        <Link href="/settings" className="rounded-lg border border-line px-3 py-1.5 text-sm text-muted hover:text-fg">
          Ajustes
        </Link>
      </div>
    </header>
  );
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
    <span className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-sm">
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
      className="rounded-lg border border-line px-2.5 py-1.5 text-sm"
      title="Porcentaje de la telemetría del juego que llega al bridge. Con la consola por cable suele ser 100%."
    >
      Señal <span className={`num font-semibold ${cls}`}>{pct}%</span>
    </span>
  );
}

function Waiting({ status }: { status: LiveStatus }) {
  return (
    <div className="mt-10 rounded-2xl border border-dashed border-line p-8 text-center">
      <p className="text-lg font-semibold">
        {status === "offline" ? "Sin conexión con el servidor" : "Todavía no llegan datos de tu consola"}
      </p>
      <ol className="mx-auto mt-4 max-w-md space-y-1 text-left text-sm text-muted">
        <li>1. Abrí el juego y activá la telemetría UDP (formato 2024, puerto 20777).</li>
        <li>
          2. En la computadora, corré <code className="num text-fg">bridge run</code>.
        </li>
        <li>3. Salí a pista: los datos aparecen acá solos.</li>
      </ol>
      <p className="mt-4 text-sm text-muted">
        ¿Primera vez? Vinculá tu bridge en{" "}
        <Link className="text-accent underline" href="/pair">
          /pair
        </Link>
        .
      </p>
    </div>
  );
}
