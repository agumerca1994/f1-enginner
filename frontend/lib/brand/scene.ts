// Shared pieces of the logo animations (the loading mark and the start-up intro).
// Geometry and data come from public/brand/*.json, generated from the brand work in docs/marca/.

export const FG = "#f2f3f5";
export const RED = "#ff4b2b";
export const DARK = "#14161a";

/** The agreed settings of the logo animation (docs/marca/animacion/ajustes-elegidos.md). */
export const FACTORS = [0.5, 0.55, 1.0, 1.45]; // straight from below, right-hand kink, the P, exit
export const GAP = 0.3; // seconds between cars
export const CARS = 3;

/** A path sample: x, y, heading (deg), base speed, step to next, marks reveal, zone. */
export type Row = number[];

export type LogoLayers = {
  inside: string;
  ribbon: string;
  kerbRed: string;
  kerbWhite: string;
  marks: string[];
  markEnds: [[number, number], [number, number]];
};

const LIVERIES = [
  { body: "#ff4b2b", stripe: "#f2f3f5", helmet: "#f2f3f5", trim: "#ff4b2b" },
  { body: "#1e5fd8", stripe: "#ff6fb5", helmet: "#ff6fb5", trim: "#ff6fb5" }, // blue with pink
  { body: "#3ddc97", stripe: "#15171b", helmet: "#f2f3f5", trim: "#3ddc97" },
];

/** Top-down open-wheel car as SVG markup, pointing +x, centred, about 30 units long (the track is 46 wide). */
export function carSvg(k: number): string {
  const L = LIVERIES[k % LIVERIES.length];
  const W = "#15171b";
  const TY = "#0d0e10";
  return `
  <ellipse cx="0.8" cy="1.1" rx="13.5" ry="5.6" fill="#000" opacity=".13"/>
  <g stroke="#2b2e34" stroke-width=".7" stroke-linecap="round">
    <path d="M-6 -3.6 L-9 -6.2 M-6 3.6 L-9 6.2 M4 -2.2 L7.6 -5.8 M4 2.2 L7.6 5.8 M1.5 -2.4 L7 -6.3 M1.5 2.4 L7 6.3"/>
  </g>
  <rect x="-12.4" y="-8.9" width="6.6" height="3.9" rx="1.5" fill="${TY}"/>
  <rect x="-12.4" y="5" width="6.6" height="3.9" rx="1.5" fill="${TY}"/>
  <rect x="5.2" y="-8" width="5" height="3.2" rx="1.3" fill="${TY}"/>
  <rect x="5.2" y="4.8" width="5" height="3.2" rx="1.3" fill="${TY}"/>
  <path d="M-11.6 -7.2 h5.2 M-11.6 7.2 h5.2 M5.8 -6.4 h3.8 M5.8 6.4 h3.8" stroke="#3a3e45" stroke-width=".5"/>
  <path d="M-9.5 -4.6 L4 -3.1 L4 3.1 L-9.5 4.6 Z" fill="#202329"/>
  <path d="M14.2 -.85 C11 -1.15 8 -1.75 5 -2.15 L2.2 -2.55 C.2 -4.7 -4 -4.9 -7 -4.25 C-9 -3.45 -10.6 -2.1 -11.8 -1.25 L-11.8 1.25 C-10.6 2.1 -9 3.45 -7 4.25 C-4 4.9 .2 4.7 2.2 2.55 L5 2.15 C8 1.75 11 1.15 14.2 .85 Z" fill="${L.body}"/>
  <path d="M13.6 0 L-11.2 0" stroke="${L.stripe}" stroke-width="1" opacity=".9"/>
  <ellipse cx="-.6" cy="0" rx="2.4" ry="1.45" fill="#0b0c0e"/>
  <circle cx="-.9" cy="0" r="1.15" fill="${L.helmet}"/>
  <path d="M1.7 -1.7 Q3.4 0 1.7 1.7" fill="none" stroke="${W}" stroke-width=".8" stroke-linecap="round"/>
  <rect x="13.4" y="-7.4" width="2.2" height="14.8" rx=".7" fill="${W}"/>
  <rect x="13.4" y="-7.4" width="2.2" height="1.6" rx=".5" fill="${L.trim}"/>
  <rect x="13.4" y="5.8" width="2.2" height="1.6" rx=".5" fill="${L.trim}"/>
  <rect x="-14.8" y="-6.4" width="2.8" height="12.8" rx=".7" fill="${W}"/>
  <rect x="-14.8" y="-.7" width="2.8" height="1.4" fill="${L.trim}"/>
  <rect x="-14.8" y="-6.4" width="2.8" height="1.4" rx=".5" fill="${L.trim}"/>
  <rect x="-14.8" y="5" width="2.8" height="1.4" rx=".5" fill="${L.trim}"/>`;
}

/** The marks' fade-in/out gradient, as SVG markup with the given id. */
export function marksGradient(id: string, ends: LogoLayers["markEnds"]): string {
  const [[x1, y1], [x2, y2]] = ends;
  return `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">
    <stop offset="0" stop-color="#3b3e44" stop-opacity="0"/><stop offset=".3" stop-color="#3b3e44" stop-opacity=".8"/>
    <stop offset=".65" stop-color="#3b3e44" stop-opacity=".8"/><stop offset="1" stop-color="#3b3e44" stop-opacity="0"/>
  </linearGradient>`;
}

export const ease = (u: number) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
export const lerp = (a: number, b: number, u: number) => a + (b - a) * u;

/** Speed factors blended across stretches (a moving average of 19 samples), like the logo animation. */
export function blendedFactors(rows: Row[], zoneCol: number, factors: number[] = FACTORS): number[] {
  const n = rows.length;
  const W = 9;
  const raw = rows.map((p) => factors[p[zoneCol]]);
  return raw.map((_, i) => {
    let a = 0;
    for (let j = -W; j <= W; j++) a += raw[Math.min(n - 1, Math.max(0, i + j))];
    return a / (2 * W + 1);
  });
}

/** Fetches a brand data file once and caches the promise. */
const cache = new Map<string, Promise<unknown>>();
export function loadBrand<T>(path: string): Promise<T> {
  if (!cache.has(path)) {
    cache.set(
      path,
      fetch(path).then((r) => {
        if (!r.ok) throw new Error(`brand data ${path}: ${r.status}`);
        return r.json();
      }),
    );
  }
  return cache.get(path) as Promise<T>;
}

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}
