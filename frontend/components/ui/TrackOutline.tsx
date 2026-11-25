"use client";

import { useEffect, useMemo, useState } from "react";

import { api, screenToken } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { teamColor } from "@/lib/teams";
import type { CarRow, TrackCorner, TrackLayout } from "@/lib/types";

const cache = new Map<number, Promise<TrackLayout | null>>();

/** The track outline (built from every player's telemetry), fetched once per track and kept. */
export function useTrackLayout(trackId: number | null | undefined, refreshKey?: string): TrackLayout | null {
  const { credentials } = useAuth();
  const [layout, setLayout] = useState<TrackLayout | null>(null);
  useEffect(() => {
    if (trackId == null) return;
    let cancelled = false;
    if (refreshKey) cache.delete(trackId);
    if (!cache.has(trackId)) {
      cache.set(trackId, (async () => {
        try {
          const screen = screenToken();
          return screen
            ? await api<TrackLayout>(`/api/screens/tracks/${trackId}/layout`, null)
            : await api<TrackLayout>(`/api/tracks/${trackId}/layout`, await credentials());
        } catch {
          cache.delete(trackId);
          return null;
        }
      })());
    }
    cache.get(trackId)!.then((l) => !cancelled && setLayout(l));
    return () => {
      cancelled = true;
    };
  }, [trackId, refreshKey, credentials]);
  return layout;
}

type View = { paths: string[]; toXY: (x: number, z: number) => [number, number]; at: (m: number) => [number, number] | null };

const W = 1000;
const H = 640;

function project(layout: TrackLayout, pad: number): View | null {
  const pts = layout.segments.flat();
  if (pts.length < 2) return null;
  const xs = pts.map((p) => p[0]);
  const zs = pts.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
  const s = Math.min((W - 2 * pad) / (maxX - minX || 1), (H - 2 * pad) / (maxZ - minZ || 1));
  const ox = (W - (maxX - minX) * s) / 2, oz = (H - (maxZ - minZ) * s) / 2;
  const toXY = (x: number, z: number): [number, number] => [(x - minX) * s + ox, (z - minZ) * s + oz];
  const paths = layout.segments.map((seg) => seg.map(([x, z], i) => `${i ? "L" : "M"}${toXY(x, z).map((v) => v.toFixed(1)).join(",")}`).join(" "));
  // Lap distance to a point: walk the outline, assuming it starts at the line.
  const flat = layout.segments.flat();
  const cum: number[] = [0];
  for (let i = 1; i < flat.length; i++) cum.push(cum[i - 1] + Math.hypot(flat[i][0] - flat[i - 1][0], flat[i][1] - flat[i - 1][1]));
  const total = cum[cum.length - 1] || 1;
  const at = (m: number) => {
    const target = (m / (layout.length_m || total)) * total;
    const i = cum.findIndex((d) => d >= target);
    const p = flat[i < 0 ? flat.length - 1 : i];
    return p ? toXY(p[0], p[1]) : null;
  };
  return { paths, toXY, at };
}

/**
 * The circuit as a drawing: the outline, the numbered corners (red where
 * `highlight` says time was lost) and, live, every car. The same corner numbers
 * as everywhere else in the app, since they come from the track's stored map.
 */
export function TrackOutline({
  trackId,
  corners,
  highlight = [],
  cars,
  showCorners = true,
  thick = false,
  thumb = false,
  className,
  label,
}: {
  trackId: number | null | undefined;
  corners?: TrackCorner[] | null;
  highlight?: number[];
  cars?: CarRow[] | null;
  showCorners?: boolean;
  thick?: boolean;
  /** A small thumbnail: a heavier line and a big dot on the corner, no numbers. */
  thumb?: boolean;
  className?: string;
  label?: string;
}) {
  const layout = useTrackLayout(trackId);
  const view = useMemo(() => (layout ? project(layout, showCorners ? 46 : 24) : null), [layout, showCorners]);
  const map = corners ?? layout?.corners ?? [];
  if (!view) return <div className={className} aria-hidden="true" />;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={className} role="img" aria-label={label ?? "Mapa del circuito"}>
      {view.paths.map((d, i) => (
        <g key={i}>
          <path d={d} fill="none" stroke={thumb ? "var(--color-line)" : "var(--color-panel-2)"} strokeWidth={thumb ? 38 : thick ? 34 : 24} strokeLinejoin="round" strokeLinecap="round" />
          {!thumb && <path d={d} fill="none" stroke={thick ? "var(--color-fg)" : "var(--color-line)"} strokeWidth={thick ? 5 : 4} strokeLinejoin="round" strokeLinecap="round" />}
        </g>
      ))}
      {showCorners &&
        map.map((c) => {
          const p = view.at(c.apex_m);
          if (!p) return null;
          const hot = highlight.includes(c.curva);
          if (thumb) return hot ? <circle key={c.curva} cx={p[0]} cy={p[1]} r={70} fill="var(--color-accent)" /> : null;
          return (
            <g key={c.curva}>
              <circle cx={p[0]} cy={p[1]} r={20} fill={hot ? "var(--color-accent)" : "var(--color-bg)"} stroke={hot ? "var(--color-bg)" : "var(--color-dim)"} strokeWidth={3} />
              <text x={p[0]} y={p[1] + 7} textAnchor="middle" fontFamily="var(--font-display)" fontWeight={800} fontSize={21} fill={hot ? "var(--color-bg)" : "var(--color-muted)"}>
                {c.curva}
              </text>
            </g>
          );
        })}
      {cars
        ?.filter((c) => c.x != null && c.z != null && c.result === "active")
        .sort((a, b) => Number(a.is_player) - Number(b.is_player))
        .map((c) => {
          const [x, y] = view.toXY(c.x!, c.z!);
          return (
            <g key={c.index}>
              <circle cx={x} cy={y} r={c.is_player ? 14 : 10} fill={c.color ?? teamColor(c.team_id)} stroke="var(--color-bg)" strokeWidth={3} />
              {c.is_player && <circle cx={x} cy={y} r={21} fill="none" stroke="var(--color-fg)" strokeWidth={3} />}
            </g>
          );
        })}
    </svg>
  );
}

/** Where a corner sits on the outline, for the small "this corner" thumbnails. */
export function CornerThumb({ trackId, corner, corners, className }: { trackId: number | null | undefined; corner: number; corners?: TrackCorner[] | null; className?: string }) {
  return <TrackOutline trackId={trackId} corners={corners ? corners.filter((c) => c.curva === corner) : undefined} highlight={[corner]} thumb className={className} label={`Curva ${corner} en el mapa`} />;
}
