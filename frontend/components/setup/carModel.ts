import * as THREE from "three";

/**
 * Geometry for the single-seater, built in code: the bodywork is lofted from
 * rounded cross-sections, the wings are extruded airfoils and the tyres are
 * lathed from a rounded profile, so the car reads as a car from every angle.
 * Units are metres; x points forward, y up, z to the side.
 */

export const WB_F = 1.8; // front axle x
export const WB_R = -1.75; // rear axle x
export const TRACK = 0.8; // half track
export const R = 0.36; // tyre radius
export const RIM = 0.235;

type Station = { x: number; w: number; top: number; bot: number; zc?: number; n?: number };

const cr = (p0: number, p1: number, p2: number, p3: number, t: number) =>
  0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);

/** Smooth the stations with Catmull-Rom so the surface has no kinks between them. */
function resample(st: Station[], steps: number): Station[] {
  const out: Station[] = [];
  const keys: (keyof Station)[] = ["x", "w", "top", "bot", "zc", "n"];
  for (let i = 0; i < st.length - 1; i++) {
    const p0 = st[Math.max(0, i - 1)];
    const p1 = st[i];
    const p2 = st[i + 1];
    const p3 = st[Math.min(st.length - 1, i + 2)];
    for (let k = 0; k < steps; k++) {
      const t = k / steps;
      const s = {} as Station;
      for (const key of keys) {
        const v = (p: Station) => (p[key] as number | undefined) ?? (key === "n" ? 2.6 : 0);
        (s as Record<string, number>)[key] = cr(v(p0), v(p1), v(p2), v(p3), t);
      }
      out.push(s);
    }
  }
  out.push({ zc: 0, n: 2.6, ...st[st.length - 1] });
  return out;
}

/**
 * A closed surface through rounded (superellipse) sections, capped at both ends.
 */
export function loft(stations: Station[], seg = 36, steps = 6): THREE.BufferGeometry {
  const st = resample(stations, steps);
  const pos: number[] = [];
  const idx: number[] = [];
  const ring = (s: Station, j: number): [number, number, number] => {
    const th = (j / seg) * Math.PI * 2;
    const c = Math.cos(th);
    const sn = Math.sin(th);
    const e = 2 / (s.n ?? 2.6);
    const yc = s.bot + (s.top - s.bot) * 0.4;
    const z = (s.zc ?? 0) + s.w * Math.sign(c) * Math.abs(c) ** e;
    const y = sn >= 0 ? yc + (s.top - yc) * Math.abs(sn) ** e : yc - (yc - s.bot) * Math.abs(sn) ** e;
    return [s.x, y, z];
  };
  st.forEach((s) => {
    for (let j = 0; j < seg; j++) pos.push(...ring(s, j));
  });
  for (let i = 0; i < st.length - 1; i++) {
    for (let j = 0; j < seg; j++) {
      const a = i * seg + j;
      const b = i * seg + ((j + 1) % seg);
      const c = (i + 1) * seg + j;
      const d = (i + 1) * seg + ((j + 1) % seg);
      idx.push(a, c, b, b, c, d);
    }
  }
  // End caps.
  for (const [i, flip] of [[0, false], [st.length - 1, true]] as const) {
    const s = st[i];
    const center = pos.length / 3;
    pos.push(s.x, s.bot + (s.top - s.bot) * 0.4, s.zc ?? 0);
    for (let j = 0; j < seg; j++) {
      const a = i * seg + j;
      const b = i * seg + ((j + 1) % seg);
      if (flip) idx.push(center, b, a);
      else idx.push(center, a, b);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();

  return geo;
}

/** An airfoil section (cambered, NACA-like thickness), leading edge at x=0, chord running to -chord. */
export function airfoil(chord: number, thick = 0.12, camber = 0.05): THREE.Shape {
  const n = 18;
  const top: [number, number][] = [];
  const bot: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const x = (1 - Math.cos((i / n) * Math.PI)) / 2;
    const yt = 5 * thick * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
    const yc = -camber * Math.sin(Math.PI * x); // inverted: an F1 wing pushes down
    top.push([-x * chord, (yc + yt) * chord]);
    bot.push([-x * chord, (yc - yt) * chord]);
  }
  const shape = new THREE.Shape();
  shape.moveTo(top[0][0], top[0][1]);
  for (const p of top.slice(1)) shape.lineTo(p[0], p[1]);
  for (const p of bot.reverse()) shape.lineTo(p[0], p[1]);
  shape.closePath();
  return shape;
}

/** A wing element spanning `span` across z, centred. */
export function wing(chord: number, span: number, thick = 0.12, camber = 0.05): THREE.BufferGeometry {
  const g = new THREE.ExtrudeGeometry(airfoil(chord, thick, camber), { depth: span, bevelEnabled: false, curveSegments: 4 });
  g.translate(0, 0, -span / 2);
  return g;
}

/** A flat plate from a side profile (x, y), `t` thick, centred on z. */
export function plate(points: [number, number][], t: number): THREE.BufferGeometry {
  const s = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: true, bevelSize: 0.004, bevelThickness: 0.004, bevelSegments: 1 });
  g.translate(0, 0, -t / 2);
  return g;
}

/** A floor or other flat part from a plan outline (x, z), `t` thick, at height y. */
export function planPlate(points: [number, number][], t: number, y: number): THREE.BufferGeometry {
  const s = new THREE.Shape(points.map(([x, z]) => new THREE.Vector2(x, z)));
  const g = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false });
  g.rotateX(Math.PI / 2);
  g.translate(0, y + t, 0);
  return g;
}

/** A tyre lathed from a rounded profile, axis along z. */
export function tyre(width: number): THREE.BufferGeometry {
  const r = 0.06;
  const h = width / 2;
  const pts: THREE.Vector2[] = [new THREE.Vector2(RIM, -h)];
  const arc = (cx: number, cy: number, a0: number, a1: number) => {
    for (let i = 0; i <= 6; i++) {
      const a = a0 + ((a1 - a0) * i) / 6;
      pts.push(new THREE.Vector2(cx + Math.cos(a) * r, cy + Math.sin(a) * r));
    }
  };
  arc(R - r, -h + r, -Math.PI / 2, 0);
  arc(R - r, h - r, 0, Math.PI / 2);
  pts.push(new THREE.Vector2(RIM, h));
  const g = new THREE.LatheGeometry(pts, 56);
  g.rotateX(Math.PI / 2);
  return g;
}

/** A tube along points (halo, wishbones). */
export function tube(points: [number, number, number][], radius: number): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
  return new THREE.TubeGeometry(curve, 40, radius, 10, false);
}

// --- the car's shapes ------------------------------------------------------------
// Modern proportions (2022 onwards): a long low nose, a tall airbox, sidepods with a high
// inlet, an undercut and a steep downwash ramp, a wide floor and rounded rear wing tips.

export const BODY: Station[] = [
  { x: 3.32, w: 0.1, top: 0.21, bot: 0.15, n: 3 },
  { x: 3.0, w: 0.13, top: 0.25, bot: 0.13, n: 3 },
  { x: 2.6, w: 0.17, top: 0.31, bot: 0.12 },
  { x: 2.2, w: 0.2, top: 0.39, bot: 0.11 },
  { x: 1.8, w: 0.24, top: 0.47, bot: 0.1 },
  { x: 1.4, w: 0.3, top: 0.54, bot: 0.1 },
  { x: 1.05, w: 0.34, top: 0.57, bot: 0.1 },
  { x: 0.7, w: 0.36, top: 0.59, bot: 0.1 },
  { x: 0.42, w: 0.33, top: 0.66, bot: 0.1 },
  { x: 0.22, w: 0.28, top: 0.93, bot: 0.11, n: 3 },
  { x: -0.1, w: 0.26, top: 0.9, bot: 0.12 },
  { x: -0.6, w: 0.21, top: 0.74, bot: 0.13 },
  { x: -1.1, w: 0.16, top: 0.6, bot: 0.15 },
  { x: -1.6, w: 0.12, top: 0.5, bot: 0.17 },
  { x: -2.0, w: 0.08, top: 0.42, bot: 0.2 },
  { x: -2.3, w: 0.05, top: 0.36, bot: 0.24, n: 2.2 },
];

export function sidepod(side: 1 | -1): Station[] {
  return [
    { x: 1.15, zc: side * 0.5, w: 0.22, top: 0.6, bot: 0.38, n: 4 },
    { x: 0.98, zc: side * 0.5, w: 0.28, top: 0.62, bot: 0.3, n: 3.8 },
    { x: 0.6, zc: side * 0.49, w: 0.29, top: 0.6, bot: 0.24, n: 3.4 },
    { x: 0.1, zc: side * 0.44, w: 0.26, top: 0.5, bot: 0.18, n: 3 },
    { x: -0.5, zc: side * 0.36, w: 0.19, top: 0.38, bot: 0.14 },
    { x: -1.0, zc: side * 0.26, w: 0.12, top: 0.28, bot: 0.13 },
    { x: -1.4, zc: side * 0.18, w: 0.07, top: 0.22, bot: 0.14, n: 2.2 },
  ];
}

export const FLOOR: [number, number][] = [
  [1.6, 0.25], [1.3, 0.6], [1.0, 0.78], [-0.9, 0.8], [-1.3, 0.7], [-2.1, 0.55],
  [-2.1, -0.55], [-1.3, -0.7], [-0.9, -0.8], [1.0, -0.78], [1.3, -0.6], [1.6, -0.25],
];

export const FRONT_ENDPLATE: [number, number][] = [[3.58, 0.03], [2.75, 0.03], [2.7, 0.2], [2.9, 0.31], [3.25, 0.3], [3.5, 0.16]];
export const REAR_ENDPLATE: [number, number][] = [[-2.08, 0.46], [-2.8, 0.46], [-2.86, 0.95], [-2.76, 1.08], [-2.42, 1.13], [-2.14, 1.02]];

export function haloHalf(side: 1 | -1): [number, number, number][] {
  return [
    [1.42, 0.58, 0],
    [1.36, 0.8, 0],
    [1.18, 0.86, side * 0.16],
    [0.9, 0.85, side * 0.26],
    [0.65, 0.78, side * 0.28],
    [0.55, 0.64, side * 0.28],
  ];
}

export function roundedTexture(): THREE.Texture {
  // A soft shadow under the car.
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  grad.addColorStop(0, "rgba(0,0,0,0.75)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  return t;
}
