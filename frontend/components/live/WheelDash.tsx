"use client";

import Link from "next/link";
import { useEffect } from "react";

import { shortName } from "@/components/dashboard/Cards";
import { isRace, signedSecs, useEngineerAlwaysOn } from "@/components/live/LiveBlocks";
import { lapTime, tyreTempColor } from "@/lib/format";
import { useDictation } from "@/lib/listen";
import { useLive } from "@/lib/live";
import { useEngineerVoice } from "@/lib/voice";
import type { Snapshot } from "@/lib/types";

const LED_COLORS = [...Array(5).fill("#22c55e"), ...Array(5).fill("#ef4444"), ...Array(5).fill("#3b82f6")];

/**
 * The wheel dashboard: a phone in landscape on a mount above the wheel. Gear and
 * speed big, shift lights, the delta and the times; the engineer's last line and a
 * talk button at the bottom. Data comes through the server about five times a
 * second, so the shift lights are a guide, not a cue to change gear on.
 */
export function WheelDash() {
  const { status, snapshot: s, engineer, engineerBusy, toggleEngineer, askEngineer } = useLive();
  useEngineerAlwaysOn(s, engineer, toggleEngineer, engineerBusy);
  useEngineerVoice(engineer.messages);
  useScreenOn();

  const last = [...engineer.messages].reverse().find((m) => m.radio);
  const car = s?.car;
  const lap = s?.lap;
  const lit = Math.round(((car?.rev_lights_percent ?? 0) / 100) * LED_COLORS.length);
  const gear = car == null ? "–" : car.gear === 0 ? "N" : car.gear < 0 ? "R" : String(car.gear);
  const delta = lap?.delta_best_ms ?? null;

  return (
    <main className="flex h-dvh flex-col gap-2 overflow-hidden p-[max(0.6rem,env(safe-area-inset-top))_max(0.8rem,env(safe-area-inset-right))_max(0.6rem,env(safe-area-inset-bottom))_max(0.8rem,env(safe-area-inset-left))]">
      <header className="flex items-center gap-3">
        <Link href="/" className="chip px-3 py-1 text-xs text-muted" aria-label="Salir del modo volante">
          Salir
        </Link>
        <div className="flex flex-1 justify-center gap-[1.2vw]" role="img" aria-label={`Luces de cambio: ${lit} de ${LED_COLORS.length}`}>
          {LED_COLORS.map((c, i) => (
            <span
              key={i}
              className="h-[min(3.4vh,1.1rem)] w-[min(3.4vh,1.1rem)] rounded-full border border-line"
              style={i < lit ? { background: c, borderColor: c, boxShadow: `0 0 10px ${c}` } : undefined}
            />
          ))}
        </div>
        <span className={`label ${status === "live" ? "!text-ok" : "!text-warn"}`}>{status === "live" ? "En vivo" : "Sin datos"}</span>
      </header>

      {!s ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
          <p className="display text-3xl">Esperando tu consola</p>
          <p className="text-sm text-muted">Abrí el Bridge en la compu y salí a pista.</p>
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(0,2.3fr)_minmax(0,1fr)] gap-2">
          <div className="flex min-h-0 flex-col gap-2">
            <Tile label="Posición" value={lap ? `P${lap.position}` : "—"} big accent />
            <Tile
              label={isRace(s) ? "Vuelta" : "Vuelta"}
              value={lap ? `${lap.lap}${isRace(s) && s.session ? `/${s.session.total_laps}` : ""}` : "—"}
            />
            <Rival s={s} />
          </div>

          <div className="card grid min-h-0 grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)_minmax(0,1fr)] items-center gap-2 px-3 py-2">
            <div className="text-center">
              <div className="display text-[clamp(2rem,9vh,4.5rem)]">{car ? Math.round(car.speed_kmh) : "—"}</div>
              <div className="label">km/h</div>
              <div className="num mt-2 text-[clamp(0.9rem,4vh,1.4rem)] text-muted">{car ? car.rpm.toLocaleString("es-AR") : "—"}</div>
              <div className="label">rpm</div>
            </div>
            <div className="flex h-full items-center justify-center rounded-[var(--radius-card)] border-2 border-accent bg-bg">
              <span className="display text-[clamp(5rem,40vh,13rem)] text-accent">{gear}</span>
            </div>
            <div className="text-center">
              <div className="label">vs tu mejor</div>
              <div className={`display text-[clamp(1.8rem,8vh,3.8rem)] ${delta == null ? "text-muted" : delta > 50 ? "text-warn" : delta < -50 ? "text-ok" : ""}`}>
                {delta == null ? "—" : signedSecs(delta)}
              </div>
              <div className="num mt-2 text-[clamp(0.9rem,4.5vh,1.6rem)]">{lapTime(lap?.current_lap_ms)}</div>
              <div className="label">vuelta actual</div>
            </div>
          </div>

          <div className="flex min-h-0 flex-col gap-2">
            <Tyres s={s} />
            <Tile
              label="Batería"
              value={s.status ? `${Math.round(s.status.ers_percent)}%` : "—"}
              tone={s.status && s.status.ers_percent < 15 ? "text-warn" : undefined}
            />
            <Tile
              label="Combustible"
              value={s.status ? `${s.status.fuel_remaining_laps >= 0 ? "+" : ""}${s.status.fuel_remaining_laps.toFixed(1).replace(".", ",")} v` : "—"}
              tone={s.status && s.status.fuel_remaining_laps < 0 ? "text-danger" : "text-ok"}
            />
          </div>
        </div>
      )}

      <RadioStrip text={last?.radio ?? null} onAsk={askEngineer} />
    </main>
  );
}

function Tile({ label, value, big = false, accent = false, tone }: { label: string; value: string; big?: boolean; accent?: boolean; tone?: string }) {
  return (
    <div className={`flex min-h-0 flex-1 flex-col justify-center px-3 py-1.5 ${accent ? "slant rounded-[var(--radius-card)] bg-accent text-accent-fg" : "card"}`}>
      <div className={`label ${accent ? "!text-current opacity-80" : ""}`}>{label}</div>
      <div className={`display ${big ? "text-[clamp(1.8rem,10vh,3.6rem)]" : "text-[clamp(1.3rem,7vh,2.6rem)]"} ${tone ?? ""}`}>{value}</div>
    </div>
  );
}

function Rival({ s }: { s: Snapshot }) {
  const behind = s.relatives?.behind[0];
  const ahead = s.relatives?.ahead[0];
  const row = behind && behind.gap_s != null && behind.gap_s < 1 ? { r: behind, ahead: false } : ahead ? { r: ahead, ahead: true } : behind ? { r: behind, ahead: false } : null;
  if (!row) return <Tile label="Rivales" value="—" />;
  const car = s.cars?.find((c) => c.index === row.r.index);
  const danger = !row.ahead && (row.r.gap_s ?? 9) < 0.6;
  return (
    <div className={`flex min-h-0 flex-1 flex-col justify-center px-3 py-1.5 ${danger ? "rounded-[var(--radius-card)] border border-danger/70 bg-danger/10" : "card"}`}>
      <div className={`label truncate ${danger ? "!text-danger" : ""}`}>
        {row.ahead ? "Adelante" : "Atrás"} · {car ? shortName(car) : "—"}
      </div>
      <div className={`display text-[clamp(1.3rem,7vh,2.6rem)] ${danger ? "text-danger" : ""}`}>
        {row.r.gap_s == null ? "—" : `${row.ahead ? "−" : "+"}${row.r.gap_s.toFixed(1).replace(".", ",")}`}
      </div>
    </div>
  );
}

function Tyres({ s }: { s: Snapshot }) {
  const t = s.car?.tyres_surface_temperature_c;
  const wear = s.damage?.tyres_wear_percent;
  const cells: [string, number | undefined, number | undefined][] = [
    ["DI", t?.front_left, wear?.front_left],
    ["DD", t?.front_right, wear?.front_right],
    ["TI", t?.rear_left, wear?.rear_left],
    ["TD", t?.rear_right, wear?.rear_right],
  ];
  const worst = wear ? Math.max(wear.front_left, wear.front_right, wear.rear_left, wear.rear_right) : null;
  return (
    <div className="card flex min-h-0 flex-1 items-center justify-between gap-2 px-3 py-1.5">
      <div className="min-w-0">
        <div className="label">Gomas</div>
        <div className="num text-sm text-muted">{worst != null ? `más gastada ${Math.round(worst)}%` : "—"}</div>
      </div>
      <div className="grid grid-cols-2 gap-1" role="img" aria-label="Temperatura de cada goma">
        {cells.map(([k, temp]) => (
          <span
            key={k}
            className="num rounded px-1.5 py-0.5 text-center text-xs font-semibold text-black"
            style={{ background: temp != null ? tyreTempColor(temp) : "var(--color-panel-2)" }}
            title={k}
          >
            {temp != null ? Math.round(temp) : "–"}
          </span>
        ))}
      </div>
    </div>
  );
}

function RadioStrip({ text, onAsk }: { text: string | null; onAsk: (q: string) => Promise<unknown> }) {
  const mic = useDictation((q) => {
    onAsk(q).catch(() => {});
  });
  return (
    <div className="card flex h-[clamp(2.6rem,12vh,3.4rem)] shrink-0 items-center gap-3 pl-3 pr-1.5">
      <span className="label !text-warn">Radio</span>
      <span className="min-w-0 flex-1 truncate text-[clamp(0.85rem,4vh,1.05rem)] font-medium">
        {mic.listening ? mic.interim || "Te escucho…" : text ?? "Sin mensajes todavía"}
      </span>
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
          className={`btn-primary h-[85%] touch-none select-none px-5 text-sm ${mic.listening ? "animate-pulse" : ""}`}
        >
          Hablar
        </button>
      )}
    </div>
  );
}

/** Keeps the screen on while the dashboard is open, re-taking the lock when the tab comes back. */
function useScreenOn() {
  useEffect(() => {
    if (!("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    const take = async () => {
      try {
        lock = await navigator.wakeLock.request("screen");
      } catch {}
    };
    const onVisible = () => document.visibilityState === "visible" && take();
    take();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      lock?.release().catch(() => {});
    };
  }, []);
}
