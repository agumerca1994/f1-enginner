"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { Panel } from "@/components/dashboard/Panel";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { teamColor } from "@/lib/teams";
import type { Snapshot, TrackLayout } from "@/lib/types";
import { WEATHER_ES } from "@/lib/format";

type Bounds = { minX: number; maxX: number; minZ: number; maxZ: number };
const PAD = 60; // metres around the outline

/**
 * Top-down circuit map. The outline is built by the server from every car's
 * position, so on a new track it appears progressively during the first lap.
 */
export function TrackMap({ s }: { s: Snapshot }) {
  const { credentials } = useAuth();
  const track = s.track;
  const [layout, setLayout] = useState<TrackLayout | null>(null);
  const bounds = useRef<Bounds | null>(null);
  const trackKey = track ? `${track.id}:${track.layout_coverage}:${track.layout_ready}` : null;

  useEffect(() => {
    if (!track) return;
    let cancelled = false;
    (async () => {
      try {
        const l = await api<TrackLayout>(`/api/tracks/${track.id}/layout`, await credentials());
        if (!cancelled) setLayout(l);
      } catch {
        /* no outline yet: the map shows only the cars */
      }
    })();
    return () => {
      cancelled = true;
    };
    // trackKey changes when the outline grew enough to be worth refetching.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackKey, credentials]);

  // A new track resets the view.
  useEffect(() => {
    bounds.current = null;
    setLayout(null);
  }, [track?.id]);

  const cars = (s.cars ?? []).filter((c) => c.x != null && c.z != null && c.result === "active");

  // Bounds only grow, so the map never jumps around while cars move.
  const view = useMemo(() => {
    const xs: number[] = [];
    const zs: number[] = [];
    layout?.segments.forEach((seg) => seg.forEach(([x, z]) => (xs.push(x), zs.push(z))));
    cars.forEach((c) => (xs.push(c.x!), zs.push(c.z!)));
    if (xs.length === 0) return null;
    const b = bounds.current;
    const next = {
      minX: Math.min(b?.minX ?? Infinity, ...xs),
      maxX: Math.max(b?.maxX ?? -Infinity, ...xs),
      minZ: Math.min(b?.minZ ?? Infinity, ...zs),
      maxZ: Math.max(b?.maxZ ?? -Infinity, ...zs),
    };
    bounds.current = next;
    return next;
  }, [layout, cars]);

  const se = s.session;
  const loop = layout?.ready && layout.segments.length === 1 ? layout.segments[0] : null;
  const pointAt = (m: number) => (loop ? loop[Math.min(loop.length - 1, Math.floor(m / 10))] : null);
  const s2 = track ? pointAt(track.sector2_m) : null;
  const s3 = track ? pointAt(track.sector3_m) : null;

  return (
    <Panel
      title={se ? se.track : "Circuito"}
      className="relative"
      right={
        track && !track.layout_ready ? (
          <span className="text-xs text-muted">Armando el mapa… {Math.round((layout?.coverage ?? track.layout_coverage) * 100)}%</span>
        ) : null
      }
    >
      <div className="relative aspect-[4/3] w-full lg:aspect-[16/10]">
        {view ? (
          <svg
            viewBox={`${view.minX - PAD} ${view.minZ - PAD} ${view.maxX - view.minX + 2 * PAD} ${view.maxZ - view.minZ + 2 * PAD}`}
            className="h-full w-full"
            preserveAspectRatio="xMidYMid meet"
          >
            {layout?.segments.map((seg, i) => (
              <g key={i}>
                <polyline points={seg.map((p) => p.join(",")).join(" ")} fill="none" stroke="#1d2530" strokeWidth={26} strokeLinejoin="round" strokeLinecap="round" />
                <polyline points={seg.map((p) => p.join(",")).join(" ")} fill="none" stroke="#3a4655" strokeWidth={7} strokeLinejoin="round" strokeLinecap="round" />
              </g>
            ))}
            {loop && <Marker p={loop[0]} label="META" color="#e9eef3" />}
            {s2 && <Marker p={s2} label="S2" color="#22d3ee" />}
            {s3 && <Marker p={s3} label="S3" color="#22d3ee" />}
            {[...cars]
              .sort((a, b) => Number(a.is_player) - Number(b.is_player))
              .map((c) => (
                <g
                  key={c.index}
                  style={{ transform: `translate(${c.x}px, ${c.z}px)`, transition: "transform 250ms linear" }}
                >
                  {c.is_player && <circle r={34} fill="none" stroke="#e9eef3" strokeWidth={5} />}
                  <circle r={c.is_player ? 24 : 18} fill={teamColor(c.team_id)} stroke="#07090c" strokeWidth={4} />
                  <text
                    y={c.is_player ? 8 : 6}
                    textAnchor="middle"
                    fontSize={c.is_player ? 22 : 17}
                    fontWeight={700}
                    fill="#07090c"
                    className="num"
                  >
                    {c.position}
                  </text>
                </g>
              ))}
          </svg>
        ) : (
          <p className="absolute inset-0 flex items-center justify-center text-sm text-muted">Esperando posiciones…</p>
        )}
        {se && (
          <div className="absolute left-2 top-2 rounded-lg bg-bg/80 px-2.5 py-1.5 text-xs backdrop-blur">
            <div className="font-semibold">{WEATHER_ES[se.weather] ?? se.weather}</div>
            <div className="num text-muted">
              Pista {se.track_temperature_c}° · Aire {se.air_temperature_c}°
            </div>
            {se.forecast.some((f) => f.rain_percent >= 40) && (
              <div className="num text-wet">
                Lluvia {Math.max(...se.forecast.map((f) => f.rain_percent))}% próximos {se.forecast.at(-1)?.in_minutes}′
              </div>
            )}
          </div>
        )}
        {se && se.safety_car !== "None" && (
          <div className="absolute right-2 top-2 rounded-lg bg-warn px-2.5 py-1 text-xs font-bold text-bg">
            {se.safety_car === "Virtual safety car" ? "VSC" : "SAFETY CAR"}
          </div>
        )}
      </div>
    </Panel>
  );
}

function Marker({ p, label, color }: { p: [number, number]; label: string; color: string }) {
  return (
    <g transform={`translate(${p[0]}, ${p[1]})`}>
      <circle r={9} fill={color} />
      <text x={16} y={6} fontSize={24} fill={color} fontWeight={600}>
        {label}
      </text>
    </g>
  );
}
