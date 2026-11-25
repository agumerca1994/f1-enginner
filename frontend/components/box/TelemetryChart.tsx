"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { type BoxCorner, deltaTrace, type Trace } from "@/lib/box";

// You in near-white, the reference in the timing screens' purple: they differ in lightness, not hue alone.
export const MINE_COLOR = "#f2f3f5";
export const REF_COLOR = "#b77cff";

const MARGIN = { left: 44, right: 12, top: 50 };
const PANEL_GAP = 26;
const MAX_GAP_BINS = 8; // a line bridges up to 40 m without data; longer holes stay open
const MIN_ZOOM_M = 80;

type Channel = "speed" | "throttle" | "brake" | "gear";
type PanelSpec = { key: Channel | "delta"; label: string; height: number; unit: string };

const PANELS: PanelSpec[] = [
  { key: "speed", label: "Velocidad", height: 190, unit: "km/h" },
  { key: "delta", label: "Delta", height: 70, unit: "s" },
  { key: "throttle", label: "Acelerador", height: 70, unit: "%" },
  { key: "brake", label: "Freno", height: 52, unit: "%" },
  { key: "gear", label: "Marcha", height: 60, unit: "" },
];

export function TelemetryChart({
  mine,
  reference,
  corners,
  sectors,
  trackLength,
  mineLabel,
  refLabel,
}: {
  mine: Trace;
  reference: Trace;
  corners: BoxCorner[];
  sectors: number[] | null;
  trackLength: number;
  mineLabel: string;
  refLabel: string;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [view, setView] = useState<[number, number]>([0, trackLength]);
  const [hover, setHover] = useState<number | null>(null); // distance under the pointer
  const [drag, setDrag] = useState<[number, number] | null>(null);

  useEffect(() => setView([0, trackLength]), [trackLength, mine.lap, reference.lap, reference.car]);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(320, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fullDelta = useMemo(() => deltaTrace(mine, reference), [mine, reference]);
  const bin = mine.bin_m;
  const [x0, x1] = view;
  const zoomed = x0 > 0 || x1 < trackLength;
  // Zoomed in, the delta starts at zero where the stretch starts: what is won or lost in it alone.
  const delta = useMemo(() => {
    if (!zoomed) return fullDelta;
    const base = fullDelta.slice(Math.floor(x0 / bin)).find((v) => v != null);
    return base == null ? fullDelta : fullDelta.map((v) => (v == null ? null : v - base));
  }, [fullDelta, zoomed, x0, bin]);
  const plotW = width - MARGIN.left - MARGIN.right;
  const sx = (d: number) => MARGIN.left + ((d - x0) / (x1 - x0)) * plotW;
  const dAt = (px: number) => x0 + ((px - MARGIN.left) / plotW) * (x1 - x0);
  const i0 = Math.max(0, Math.floor(x0 / bin) - 1);
  const i1 = Math.min(mine.speed.length - 1, Math.ceil(x1 / bin) + 1);

  // Panel layout.
  let y = MARGIN.top;
  const layout = PANELS.map((p) => {
    const top = y;
    y += p.height + PANEL_GAP;
    return { ...p, top };
  });
  const height = y - PANEL_GAP + 22;

  const speedMax = useMemo(() => {
    let m = 0;
    for (const t of [mine, reference]) for (const v of t.speed) if (v != null && v > m) m = v;
    return Math.ceil((m + 10) / 50) * 50 || 350;
  }, [mine, reference]);
  const gearMax = 8;
  const deltaMax = useMemo(() => {
    let m = 0;
    for (let i = i0; i <= i1; i++) {
      const v = delta[i];
      if (v != null && Math.abs(v) > m) m = Math.abs(v);
    }
    return Math.max(0.2, Math.ceil(m * 10) / 10);
  }, [delta, i0, i1]);

  function domain(key: PanelSpec["key"]): [number, number] {
    if (key === "speed") return [0, speedMax];
    if (key === "delta") return [-deltaMax, deltaMax];
    if (key === "gear") return [0, gearMax];
    return [0, 100];
  }

  function path(values: (number | null)[], top: number, h: number, [lo, hi]: [number, number], step = false): string {
    const sy = (v: number) => top + h - ((v - lo) / (hi - lo)) * h;
    let d = "";
    let last = -Infinity;
    for (let i = i0; i <= i1; i++) {
      const v = values[i];
      if (v == null) continue;
      const x = sx(i * bin + bin / 2);
      const yy = sy(Math.max(lo, Math.min(hi, v)));
      if (i - last > MAX_GAP_BINS) d += `M${x.toFixed(1)},${yy.toFixed(1)}`;
      else if (step) d += `H${x.toFixed(1)}V${yy.toFixed(1)}`;
      else d += `L${x.toFixed(1)},${yy.toFixed(1)}`;
      last = i;
    }
    return d;
  }

  function ticks(key: PanelSpec["key"]): number[] {
    if (key === "speed") return Array.from({ length: speedMax / 50 + 1 }, (_, k) => k * 50).filter((v) => v % 100 === 0);
    if (key === "delta") return [-deltaMax, 0, deltaMax];
    if (key === "gear") return [2, 4, 6, 8];
    return [0, 100];
  }

  function xTicks(): number[] {
    const span = x1 - x0;
    const step = span > 3000 ? 1000 : span > 1200 ? 500 : span > 500 ? 100 : 50;
    const out = [];
    for (let v = Math.ceil(x0 / step) * step; v <= x1; v += step) {
      if (sx(v) > MARGIN.left + 20 && sx(v) < width - 30) out.push(v); // keep labels off the edges
    }
    return out;
  }

  const clampView = (a: number, b: number): [number, number] => {
    let lo = Math.max(0, Math.min(a, b));
    let hi = Math.min(trackLength, Math.max(a, b));
    if (hi - lo < MIN_ZOOM_M) {
      const mid = (lo + hi) / 2;
      lo = Math.max(0, mid - MIN_ZOOM_M / 2);
      hi = Math.min(trackLength, lo + MIN_ZOOM_M);
    }
    return [lo, hi];
  };

  function localX(e: React.PointerEvent): number {
    const r = (e.currentTarget as SVGElement).getBoundingClientRect();
    return ((e.clientX - r.left) / r.width) * width;
  }

  function onMove(e: React.PointerEvent) {
    const px = localX(e);
    if (px < MARGIN.left || px > width - MARGIN.right) {
      setHover(null);
      return;
    }
    const d = dAt(px);
    setHover(d);
    if (drag) setDrag([drag[0], d]);
  }

  function onDown(e: React.PointerEvent) {
    if (e.pointerType !== "mouse" || e.button !== 0) return; // touch scrolls; zoom with the corner chips
    const d = dAt(localX(e));
    setDrag([d, d]);
    (e.currentTarget as SVGElement).setPointerCapture(e.pointerId);
  }

  function onUp() {
    if (drag && Math.abs(sx(drag[1]) - sx(drag[0])) > 12) setView(clampView(drag[0], drag[1]));
    setDrag(null);
  }

  const hi = hover == null ? null : Math.min(mine.speed.length - 1, Math.max(0, Math.floor(hover / bin)));
  const visibleCorners = corners.filter((k) => k.apex_m >= x0 && k.apex_m <= x1);

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <Swatch color={MINE_COLOR} label={mineLabel} />
          <Swatch color={REF_COLOR} label={refLabel} />
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden text-xs text-muted sm:inline">Arrastrá sobre el gráfico para acercar</span>
          {zoomed && (
            <button
              onClick={() => setView([0, trackLength])}
              className="rounded-lg border border-line px-3 py-1 text-xs text-muted hover:text-fg"
            >
              Ver toda la vuelta
            </button>
          )}
        </div>
      </div>

      {corners.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1" aria-label="Acercar a una curva">
          {corners.map((k) => (
            <button
              key={k.curva}
              onClick={() => setView(clampView(k.entrada_m - 150, k.salida_m + 150))}
              className="num min-w-8 rounded-md border border-line px-2 py-1 text-xs text-muted hover:border-accent hover:text-fg"
              title={`Acercar a la curva ${k.curva}`}
            >
              C{k.curva}
            </button>
          ))}
        </div>
      )}

      <div ref={wrap} className="relative w-full select-none">
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          className="block touch-pan-y"
          onPointerMove={onMove}
          onPointerDown={onDown}
          onPointerUp={onUp}
          onPointerLeave={() => {
            setHover(null);
            setDrag(null);
          }}
          role="img"
          aria-label={`Telemetría por distancia: ${mineLabel} contra ${refLabel}`}
        >
          {/* Sector boundaries and corner apexes run through every panel. */}
          {(sectors ?? []).slice(1).map(
            (s, k) =>
              s >= x0 &&
              s <= x1 && (
                <g key={`s${k}`}>
                  <line x1={sx(s)} x2={sx(s)} y1={MARGIN.top} y2={height - 22} stroke="var(--color-muted)" strokeOpacity={0.5} strokeDasharray="4 4" />
                  <text x={sx(s) + 4} y={MARGIN.top + 12} className="fill-muted text-[10px]">S{k + 2}</text>
                </g>
              ),
          )}
          {visibleCorners.map((k) => (
            <g key={k.curva}>
              <line x1={sx(k.apex_m)} x2={sx(k.apex_m)} y1={21} y2={height - 22} stroke="var(--color-line)" />
              <circle cx={sx(k.apex_m)} cy={12} r={9} fill="var(--color-panel-2)" stroke="var(--color-line)" />
              <text x={sx(k.apex_m)} y={15.5} textAnchor="middle" className="num fill-fg text-[10px]">
                {k.curva}
              </text>
            </g>
          ))}

          {layout.map((p) => {
            const dom = domain(p.key);
            const sy = (v: number) => p.top + p.height - ((v - dom[0]) / (dom[1] - dom[0])) * p.height;
            return (
              <g key={p.key}>
                <text x={MARGIN.left} y={p.top - 8} className="fill-muted text-[10px] uppercase tracking-wider">
                  {p.label}
                  {p.unit ? ` (${p.unit})` : ""}
                  {p.key === "delta" ? (zoomed ? " desde el inicio del tramo · arriba: perdés" : " · arriba: perdés contra la referencia") : ""}
                </text>
                {ticks(p.key).map((t) => (
                  <g key={t}>
                    <line x1={MARGIN.left} x2={width - MARGIN.right} y1={sy(t)} y2={sy(t)} stroke="var(--color-line)" strokeWidth={p.key === "delta" && t === 0 ? 1.5 : 1} />
                    <text x={MARGIN.left - 6} y={sy(t) + 3} textAnchor="end" className="num fill-muted text-[10px]">
                      {p.key === "delta" ? (t > 0 ? "+" : t < 0 ? "−" : "") + Math.abs(t).toFixed(1) : t}
                    </text>
                  </g>
                ))}
                {p.key === "delta" ? (
                  <path d={path(delta, p.top, p.height, dom)} fill="none" stroke="var(--color-warn)" strokeWidth={1.75} />
                ) : (
                  <>
                    <path d={path(reference[p.key], p.top, p.height, dom, p.key === "gear")} fill="none" stroke={REF_COLOR} strokeWidth={2} />
                    <path d={path(mine[p.key], p.top, p.height, dom, p.key === "gear")} fill="none" stroke={MINE_COLOR} strokeWidth={2} />
                  </>
                )}
              </g>
            );
          })}

          {xTicks().map((t) => (
            <text key={t} x={sx(t)} y={height - 6} textAnchor="middle" className="num fill-muted text-[10px]">
              {t.toLocaleString("es-AR")} m
            </text>
          ))}

          {drag && (
            <rect
              x={Math.min(sx(drag[0]), sx(drag[1]))}
              y={MARGIN.top}
              width={Math.abs(sx(drag[1]) - sx(drag[0]))}
              height={height - 22 - MARGIN.top}
              fill="var(--color-accent)"
              fillOpacity={0.08}
              stroke="var(--color-accent)"
              strokeOpacity={0.4}
            />
          )}
          {hover != null && (
            <line x1={sx(hover)} x2={sx(hover)} y1={MARGIN.top} y2={height - 22} stroke="var(--color-fg)" strokeOpacity={0.5} pointerEvents="none" />
          )}
        </svg>

        {hover != null && hi != null && (
          <Tooltip
            left={sx(hover)}
            width={width}
            distance={hover}
            rows={[
              ["Velocidad", mine.speed[hi], reference.speed[hi], "km/h"],
              ["Acelerador", mine.throttle[hi], reference.throttle[hi], "%"],
              ["Freno", mine.brake[hi], reference.brake[hi], "%"],
              ["Marcha", mine.gear[hi], reference.gear[hi], ""],
            ]}
            delta={delta[hi]}
          />
        )}
      </div>
    </div>
  );
}

function Swatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-2">
      <svg width="18" height="8" aria-hidden>
        <line x1="1" x2="17" y1="4" y2="4" stroke={color} strokeWidth="3" strokeLinecap="round" />
      </svg>
      <span className="text-fg">{label}</span>
    </span>
  );
}

function Tooltip({
  left,
  width,
  distance,
  rows,
  delta,
}: {
  left: number;
  width: number;
  distance: number;
  rows: [string, number | null, number | null, string][];
  delta: number | null;
}) {
  const flip = left > width - 200;
  const fmt = (v: number | null, unit: string) => (v == null ? "—" : `${Math.round(v)}${unit ? ` ${unit}` : ""}`);
  return (
    <div
      className="pointer-events-none absolute top-8 z-10 w-44 rounded-lg border border-line bg-panel-2/95 p-2 text-xs shadow-lg"
      style={flip ? { right: width - left + 10 } : { left: left + 10 }}
    >
      <div className="num mb-1 text-muted">{Math.round(distance).toLocaleString("es-AR")} m</div>
      <table className="w-full">
        <thead>
          <tr className="text-muted">
            <th />
            <th className="text-right font-normal">
              <span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: MINE_COLOR }} />
              Vos
            </th>
            <th className="text-right font-normal">
              <span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: REF_COLOR }} />
              Ref.
            </th>
          </tr>
        </thead>
        <tbody className="num">
          {rows.map(([label, a, b, unit]) => (
            <tr key={label}>
              <td className="font-sans text-muted">{label}</td>
              <td className="text-right text-fg">{fmt(a, unit === "km/h" ? "" : unit)}</td>
              <td className="text-right text-fg">{fmt(b, unit === "km/h" ? "" : unit)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="num mt-1 border-t border-line pt-1 text-fg">
        Delta {delta == null ? "—" : `${delta > 0 ? "+" : delta < 0 ? "−" : ""}${Math.abs(delta).toFixed(3)} s`}
      </div>
    </div>
  );
}
