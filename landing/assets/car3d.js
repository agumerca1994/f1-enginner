// The single-seater for the landing intro, built in code like the app's setup viewer
// (frontend/components/setup/carModel.ts): lofted bodywork, extruded airfoil wings,
// lathed tyres. Units are metres; x points forward, y up, z to the side.
import * as THREE from "three";

const WB_F = 1.8, WB_R = -1.75, TRACK = 0.8, R = 0.36, RIM = 0.235;

const cr = (p0, p1, p2, p3, t) =>
  0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);

function resample(st, steps) {
  const out = [];
  const keys = ["x", "w", "top", "bot", "zc", "n"];
  for (let i = 0; i < st.length - 1; i++) {
    const p0 = st[Math.max(0, i - 1)], p1 = st[i], p2 = st[i + 1], p3 = st[Math.min(st.length - 1, i + 2)];
    for (let k = 0; k < steps; k++) {
      const t = k / steps, s = {};
      for (const key of keys) {
        const v = (p) => p[key] ?? (key === "n" ? 2.6 : 0);
        s[key] = cr(v(p0), v(p1), v(p2), v(p3), t);
      }
      out.push(s);
    }
  }
  out.push({ zc: 0, n: 2.6, ...st[st.length - 1] });
  return out;
}

function loft(stations, seg = 28, steps = 5) {
  const st = resample(stations, steps);
  const pos = [], idx = [];
  const ring = (s, j) => {
    const th = (j / seg) * Math.PI * 2, c = Math.cos(th), sn = Math.sin(th), e = 2 / (s.n ?? 2.6);
    const yc = s.bot + (s.top - s.bot) * 0.4;
    const z = (s.zc ?? 0) + s.w * Math.sign(c) * Math.abs(c) ** e;
    const y = sn >= 0 ? yc + (s.top - yc) * Math.abs(sn) ** e : yc - (yc - s.bot) * Math.abs(sn) ** e;
    return [s.x, y, z];
  };
  st.forEach((s) => { for (let j = 0; j < seg; j++) pos.push(...ring(s, j)); });
  for (let i = 0; i < st.length - 1; i++)
    for (let j = 0; j < seg; j++) {
      const a = i * seg + j, b = i * seg + ((j + 1) % seg), c = (i + 1) * seg + j, d = (i + 1) * seg + ((j + 1) % seg);
      idx.push(a, c, b, b, c, d);
    }
  for (const [i, flip] of [[0, false], [st.length - 1, true]]) {
    const s = st[i], center = pos.length / 3;
    pos.push(s.x, s.bot + (s.top - s.bot) * 0.4, s.zc ?? 0);
    for (let j = 0; j < seg; j++) {
      const a = i * seg + j, b = i * seg + ((j + 1) % seg);
      flip ? idx.push(center, b, a) : idx.push(center, a, b);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

function airfoil(chord, thick = 0.12, camber = 0.05) {
  const n = 14, top = [], bot = [];
  for (let i = 0; i <= n; i++) {
    const x = (1 - Math.cos((i / n) * Math.PI)) / 2;
    const yt = 5 * thick * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
    const yc = -camber * Math.sin(Math.PI * x);
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

function wing(chord, span, thick = 0.12, camber = 0.05) {
  const g = new THREE.ExtrudeGeometry(airfoil(chord, thick, camber), { depth: span, bevelEnabled: false, curveSegments: 3 });
  g.translate(0, 0, -span / 2);
  return g;
}

function plate(points, t) {
  const s = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false });
  g.translate(0, 0, -t / 2);
  return g;
}

function planPlate(points, t, y) {
  const s = new THREE.Shape(points.map(([x, z]) => new THREE.Vector2(x, z)));
  const g = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false });
  g.rotateX(Math.PI / 2);
  g.translate(0, y + t, 0);
  return g;
}

function tyre(width) {
  const r = 0.06, h = width / 2, pts = [new THREE.Vector2(RIM, -h)];
  const arc = (cx, cy, a0, a1) => {
    for (let i = 0; i <= 5; i++) { const a = a0 + ((a1 - a0) * i) / 5; pts.push(new THREE.Vector2(cx + Math.cos(a) * r, cy + Math.sin(a) * r)); }
  };
  arc(R - r, -h + r, -Math.PI / 2, 0);
  arc(R - r, h - r, 0, Math.PI / 2);
  pts.push(new THREE.Vector2(RIM, h));
  const g = new THREE.LatheGeometry(pts, 36);
  g.rotateX(Math.PI / 2);
  return g;
}

function tube(points, radius) {
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p))), 24, radius, 8, false);
}

const BODY = [
  { x: 3.1, w: 0.05, top: 0.27, bot: 0.21, n: 2.2 }, { x: 2.8, w: 0.09, top: 0.31, bot: 0.18 }, { x: 2.4, w: 0.14, top: 0.37, bot: 0.15 },
  { x: 2.0, w: 0.19, top: 0.44, bot: 0.13 }, { x: 1.6, w: 0.26, top: 0.52, bot: 0.11 }, { x: 1.3, w: 0.32, top: 0.56, bot: 0.1 },
  { x: 0.95, w: 0.36, top: 0.57, bot: 0.1 }, { x: 0.55, w: 0.37, top: 0.6, bot: 0.1 }, { x: 0.3, w: 0.36, top: 0.79, bot: 0.1 },
  { x: 0.0, w: 0.33, top: 0.8, bot: 0.11 }, { x: -0.5, w: 0.27, top: 0.7, bot: 0.13 }, { x: -1.0, w: 0.2, top: 0.58, bot: 0.15 },
  { x: -1.5, w: 0.14, top: 0.49, bot: 0.17 }, { x: -1.95, w: 0.1, top: 0.43, bot: 0.2 }, { x: -2.25, w: 0.06, top: 0.38, bot: 0.23, n: 2.2 },
];
const sidepod = (side) => [
  { x: 1.08, zc: side * 0.5, w: 0.15, top: 0.5, bot: 0.15, n: 3.2 }, { x: 0.85, zc: side * 0.52, w: 0.2, top: 0.53, bot: 0.12, n: 3.2 },
  { x: 0.35, zc: side * 0.5, w: 0.21, top: 0.51, bot: 0.12, n: 3 }, { x: -0.3, zc: side * 0.43, w: 0.18, top: 0.45, bot: 0.13 },
  { x: -0.9, zc: side * 0.32, w: 0.13, top: 0.38, bot: 0.15 }, { x: -1.35, zc: side * 0.22, w: 0.07, top: 0.32, bot: 0.18, n: 2.2 },
];
const FLOOR = [[1.75, 0.22], [1.5, 0.52], [1.05, 0.7], [-1.25, 0.72], [-1.6, 0.56], [-2.05, 0.5], [-2.05, -0.5], [-1.6, -0.56], [-1.25, -0.72], [1.05, -0.7], [1.5, -0.52], [1.75, -0.22]];
const FRONT_ENDPLATE = [[3.5, 0.03], [2.78, 0.03], [2.72, 0.25], [2.95, 0.29], [3.42, 0.14]];
const REAR_ENDPLATE = [[-2.12, 0.5], [-2.78, 0.5], [-2.84, 1.06], [-2.25, 1.1], [-2.1, 0.92]];
const haloHalf = (side) => [[1.42, 0.58, 0], [1.36, 0.78, 0], [1.18, 0.84, side * 0.16], [0.9, 0.83, side * 0.26], [0.65, 0.76, side * 0.28], [0.55, 0.62, side * 0.28]];

/** A car in the given livery. Returns the group and its four wheel spinners. */
export function buildCar({ body = 0x23272e, accent = 0xff4b2b, helmet = 0xf2f3f5 } = {}) {
  const paint = new THREE.MeshPhysicalMaterial({ color: body, metalness: 0.4, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.15 });
  const carbon = new THREE.MeshPhysicalMaterial({ color: 0x111317, metalness: 0.2, roughness: 0.55, clearcoat: 0.5 });
  const livery = new THREE.MeshPhysicalMaterial({ color: accent, metalness: 0.15, roughness: 0.35, clearcoat: 0.8 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x0b0d10, roughness: 0.92 });
  const rim = new THREE.MeshStandardMaterial({ color: 0x1a1d22, metalness: 0.6, roughness: 0.3 });
  const band = new THREE.MeshStandardMaterial({ color: accent, roughness: 0.5 });
  const helm = new THREE.MeshPhysicalMaterial({ color: helmet, roughness: 0.25, clearcoat: 1 });
  const rain = new THREE.MeshBasicMaterial({ color: 0xff2a1a });

  const car = new THREE.Group();
  const add = (geo, mat, parent = car) => { const m = new THREE.Mesh(geo, mat); parent.add(m); return m; };
  add(loft(BODY), paint);
  for (const side of [1, -1]) add(loft(sidepod(side), 24, 4), paint);
  add(planPlate(FLOOR, 0.025, 0.05), carbon);
  const h = add(new THREE.SphereGeometry(0.125, 18, 12), helm);
  h.position.set(0.78, 0.72, 0);
  for (const side of [1, -1]) add(tube(haloHalf(side), 0.028), carbon);
  add(wing(0.44, 1.95, 0.1, 0.04), carbon).position.set(3.5, 0.075, 0);
  add(wing(0.24, 1.9, 0.1, 0.05), livery).position.set(3.08, 0.13, 0);
  add(wing(0.17, 1.9, 0.1, 0.05), carbon).position.set(2.91, 0.21, 0);
  for (const side of [1, -1]) add(plate(FRONT_ENDPLATE, 0.014), livery).position.z = side * 0.98;
  add(wing(0.38, 1.0, 0.11, 0.05), carbon).position.set(-2.22, 0.84, 0);
  add(wing(0.22, 0.98, 0.1, 0.05), livery).position.set(-2.46, 0.97, 0);
  for (const side of [1, -1]) add(plate(REAR_ENDPLATE, 0.014), livery).position.z = side * 0.505;
  add(plate([[-0.2, 0.74], [-1.5, 0.62], [-1.55, 0.68], [-0.1, 0.8]], 0.012), livery);
  // The rain light: a red dot at the back that streaks in the motion blur.
  add(new THREE.BoxGeometry(0.04, 0.05, 0.12), rain).position.set(-2.28, 0.33, 0);

  const spinners = [];
  for (const front of [true, false])
    for (const side of [1, -1]) {
      const width = front ? 0.3 : 0.4;
      const g = new THREE.Group();
      g.position.set(front ? WB_F : WB_R, R, side * TRACK);
      car.add(g);
      const spin = new THREE.Group();
      g.add(spin);
      add(tyre(width), rubber, spin);
      const cover = add(new THREE.CircleGeometry(RIM, 24), rim, spin);
      cover.position.z = side * (width / 2 - 0.02);
      if (side < 0) cover.rotation.y = Math.PI;
      const ring = add(new THREE.RingGeometry(0.295, 0.31, 36), band, spin);
      ring.position.z = side * (width / 2 + 0.001);
      if (side < 0) ring.rotation.y = Math.PI;
      for (let k = 0; k < 3; k++) {
        const mark = add(new THREE.BoxGeometry(0.08, 0.018, 0.004), band, spin);
        const a = (k * Math.PI * 2) / 3;
        mark.position.set(Math.cos(a) * 0.17, Math.sin(a) * 0.17, side * (width / 2 - 0.015));
        mark.rotation.z = a;
      }
      spinners.push(spin);
    }
  return { car, spinners };
}
