"use client";

import { useEffect, useId, useRef } from "react";

import {
  CARS,
  DARK,
  FG,
  GAP,
  RED,
  blendedFactors,
  carSvg,
  loadBrand,
  marksGradient,
  prefersReducedMotion,
  type LogoLayers,
  type Row,
} from "@/lib/brand/scene";

type LogoAnim = LogoLayers & { car: Row[] };

const HOLD = 0.5; // the finished logo stays a moment before the next lap
const FADE = 0.35; // the marks fade before the cars come round again

/** The logo animation's clock: the agreed speeds per stretch, lap time scaled like the logo page. */
function makeLap(rows: Row[]) {
  const times = (factors?: number[]) => {
    const f = blendedFactors(rows, 6, factors);
    const t = [0];
    for (let i = 1; i < rows.length; i++) {
      const v0 = rows[i - 1][3] * f[i - 1];
      const v1 = rows[i][3] * f[i];
      t.push(t[i - 1] + rows[i - 1][4] / Math.max((v0 + v1) / 2, 0.03));
    }
    return t;
  };
  const chosen = times();
  const plain = times([1, 1, 1, 1]);
  const total = chosen[chosen.length - 1];
  const run = (1.6 * total) / plain[plain.length - 1];
  const u = chosen.map((x) => x / total);
  const pose = (q: number) => {
    let lo = 0;
    let hi = rows.length - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (u[m] < q) lo = m;
      else hi = m;
    }
    const a = rows[lo];
    const b = rows[hi];
    const k = (q - u[lo]) / (u[hi] - u[lo] || 1);
    let da = b[2] - a[2];
    if (da > 180) da -= 360;
    if (da < -180) da += 360;
    return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + da * k, a[5] + (b[5] - a[5]) * k];
  };
  return { run, pose };
}

/**
 * The logo with three cars going round the P and laying the exit marks: the app's loading mark.
 * With reduced motion it is the still logo.
 */
export function LogoLoader({ size = 72, className = "" }: { size?: number; className?: string }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");

  useEffect(() => {
    let raf = 0;
    let alive = true;
    loadBrand<LogoAnim>("/brand/logo-anim.json")
      .then((d) => {
        const svg = svgRef.current;
        if (!alive || !svg) return;
        svg.innerHTML = `
          <defs>
            <clipPath id="t${uid}"><rect width="256" height="256" rx="56"/></clipPath>
            ${marksGradient(`m${uid}`, d.markEnds)}
          </defs>
          <g clip-path="url(#t${uid})">
            <rect width="256" height="256" fill="${DARK}"/>
            <path fill="${RED}" fill-rule="evenodd" d="M-100 -100H400V400H-100Z ${d.inside}"/>
            <path fill="${FG}" d="${d.ribbon}"/>
            <path fill="${RED}" d="${d.kerbRed}"/><path fill="${FG}" d="${d.kerbWhite}"/>
            <g class="marks">${d.marks
              .map((m) => `<path d="${m}" pathLength="1" fill="none" stroke="url(#m${uid})" stroke-width="3.2" stroke-linecap="round" stroke-dasharray="1 1" stroke-dashoffset="1"/>`)
              .join("")}</g>
            ${[2, 1, 0].map((k) => `<g class="car" data-k="${k}" opacity="0">${carSvg(k)}</g>`).join("")}
          </g>`;
        const marks = Array.from(svg.querySelectorAll<SVGPathElement>(".marks path"));
        const markGroup = svg.querySelector<SVGGElement>(".marks")!;
        const cars: SVGGElement[] = [];
        svg.querySelectorAll<SVGGElement>(".car").forEach((g) => (cars[Number(g.dataset.k)] = g));
        if (prefersReducedMotion()) {
          marks.forEach((p) => p.setAttribute("stroke-dashoffset", "0"));
          return;
        }
        const { run, pose } = makeLap(d.car);
        const span = run + (CARS - 1) * GAP;
        const cycle = span + HOLD + FADE;
        const last = CARS - 1; // the marks are the last car's
        const t0 = performance.now();
        const tick = (now: number) => {
          const t = ((now - t0) / 1000) % cycle;
          let rev = 0;
          cars.forEach((el, k) => {
            const tk = t - k * GAP;
            if (tk < 0 || tk >= run) {
              el.setAttribute("opacity", "0");
              if (k === last && tk >= run) rev = 1;
              return;
            }
            const [x, y, a, r] = pose(tk / run);
            if (k === last) rev = r;
            el.setAttribute("transform", `translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${a.toFixed(1)})`);
            el.setAttribute("opacity", "1");
          });
          marks.forEach((p) => p.setAttribute("stroke-dashoffset", (1 - rev).toFixed(3)));
          const fade = t > span + HOLD ? Math.max(0, 1 - (t - span - HOLD) / FADE) : 1;
          markGroup.setAttribute("opacity", fade.toFixed(3));
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      })
      .catch(() => {});
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
    };
  }, [uid]);

  return (
    <svg
      ref={svgRef}
      viewBox="0 0 256 256"
      width={size}
      height={size}
      role="img"
      aria-label="Cargando"
      className={`block rounded-[21.875%] bg-[#14161a] ${className}`}
    />
  );
}

/** A loading state: the animated logo with a line of text under it. */
export function LoadingScreen({ label = "Cargando…", size = 72, compact = false }: { label?: string; size?: number; compact?: boolean }) {
  return (
    <div className={`flex flex-col items-center justify-center gap-3 text-center text-muted ${compact ? "py-4" : "min-h-[40vh] p-8"}`} role="status">
      <LogoLoader size={size} />
      {label && <p className="text-[0.95rem]">{label}</p>}
    </div>
  );
}
