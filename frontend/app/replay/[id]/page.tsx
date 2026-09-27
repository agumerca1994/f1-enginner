"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";

import { DashboardGrid } from "@/components/dashboard/Dashboard";
import { EngineerPanel } from "@/components/dashboard/EngineerPanel";
import { sessionName } from "@/components/dashboard/Cards";
import { RequireAuth } from "@/components/RequireAuth";
import { REPLAY_SPEEDS, useReplay } from "@/lib/replay";

export default function ReplayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <RequireAuth>
      <Replay sessionId={Number(id)} />
    </RequireAuth>
  );
}

function Replay({ sessionId }: { sessionId: number }) {
  const r = useReplay(sessionId);
  const se = r.snapshot?.session;

  return (
    <main className="mx-auto max-w-[1800px] px-3 pb-28 pt-3 sm:px-5">
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-panel px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="rounded bg-accent/20 px-2 py-0.5 text-xs font-semibold text-accent">REPETICIÓN</span>
            <span className="truncate text-lg font-semibold">{se ? se.track : "Cargando sesión…"}</span>
          </div>
          <div className="text-sm text-muted">
            {se && sessionName(se.type)}
            {r.snapshot?.driver && ` · ${r.snapshot.driver.name} #${r.snapshot.driver.race_number} · ${r.snapshot.driver.team}`}
          </div>
        </div>
        <div className="flex gap-2">
          <Link href="/sessions" className="rounded-lg border border-line px-3 py-1.5 text-sm text-muted hover:text-fg">
            Sesiones
          </Link>
          <Link href="/" className="rounded-lg border border-line px-3 py-1.5 text-sm text-muted hover:text-fg">
            En vivo
          </Link>
        </div>
      </header>

      {r.status === "error" ? (
        <p className="mt-10 text-center text-danger">{r.error}</p>
      ) : r.snapshot ? (
        <DashboardGrid s={r.snapshot} engineer={<EngineerPanel engineer={r.engineer} onToggle={r.toggleEngineer} />} />
      ) : (
        <>
          {r.status === "ready" && (
            <div className="mx-auto mt-3 max-w-2xl">
              <EngineerPanel engineer={r.engineer} onToggle={r.toggleEngineer} />
            </div>
          )}
          <p className="mt-10 text-center text-muted">
            {r.status === "loading" ? "Preparando la repetición…" : "Tocá ▶ o mové la línea de tiempo para empezar."}
          </p>
        </>
      )}

      {r.status !== "error" && <Transport r={r} />}
    </main>
  );
}

function Transport({ r }: { r: ReturnType<typeof useReplay> }) {
  // While dragging, show the thumb where the finger is instead of the server's time.
  const [dragging, setDragging] = useState<number | null>(null);
  const shown = dragging ?? r.t;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.code === "Space") {
        e.preventDefault();
        if (r.playing) r.pause();
        else r.play();
      } else if (e.code === "ArrowRight") r.seek(Math.min(r.duration, r.t + 10));
      else if (e.code === "ArrowLeft") r.seek(Math.max(0, r.t - 10));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [r]);

  return (
    <div className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-bg/90 px-3 py-3 backdrop-blur sm:px-5">
      <div className="mx-auto flex max-w-[1800px] items-center gap-3">
        <button
          onClick={r.playing ? r.pause : r.play}
          disabled={r.status !== "ready"}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-fg text-lg text-bg disabled:opacity-40"
          aria-label={r.playing ? "Pausa" : "Reproducir"}
        >
          {r.playing ? "❚❚" : "▶"}
        </button>
        <button
          onClick={() => r.seek(Math.max(0, r.t - 10))}
          className="hidden rounded-lg border border-line px-2 py-1 text-sm text-muted hover:text-fg sm:block"
          aria-label="Atrás 10 segundos"
        >
          −10s
        </button>
        <span className="num w-14 shrink-0 text-right text-sm">{clock(shown)}</span>
        <input
          type="range"
          min={0}
          max={Math.max(r.duration, 0.1)}
          step={0.5}
          value={shown}
          disabled={r.status !== "ready"}
          onChange={(e) => setDragging(Number(e.target.value))}
          onPointerUp={() => {
            if (dragging != null) r.seek(dragging);
            setDragging(null);
          }}
          onKeyUp={() => {
            if (dragging != null) r.seek(dragging);
            setDragging(null);
          }}
          className="h-2 min-w-0 flex-1 cursor-pointer accent-[#22d3ee]"
          aria-label="Línea de tiempo"
        />
        <span className="num w-14 shrink-0 text-sm text-muted">{clock(r.duration)}</span>
        <button
          onClick={() => r.seek(Math.min(r.duration, r.t + 10))}
          className="hidden rounded-lg border border-line px-2 py-1 text-sm text-muted hover:text-fg sm:block"
          aria-label="Adelante 10 segundos"
        >
          +10s
        </button>
        <select
          value={r.speed}
          onChange={(e) => r.setSpeed(Number(e.target.value))}
          className="rounded-lg border border-line bg-panel px-2 py-1.5 text-sm"
          aria-label="Velocidad"
        >
          {REPLAY_SPEEDS.map((s) => (
            <option key={s} value={s}>
              {s}×
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

function clock(t: number): string {
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}
