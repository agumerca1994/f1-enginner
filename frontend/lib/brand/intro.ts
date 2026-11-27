// The start-up intro's clock and camera (ported from docs/marca/intro/intro3-template.html).
// Everything happens inside the logo's square: lights, then the track comes down with the leader already
// running, the camera pulls back and settles exactly on the logo tile, three cars go round the P.

import { GAP, blendedFactors, ease, lerp, type LogoLayers, type Row } from "./scene";

export type IntroData = {
  logo: LogoLayers;
  loopRibbon: string;
  loopKerbRed: string;
  loopKerbWhite: string;
  startLine: [number, number, number, number];
  path: Row[]; // x, y, heading, base speed, reveal, distance, zone
  iStart: number;
  pFrom: number;
  sExit: number;
  jP: number;
  pSec: (number | null)[];
};

export const LAMP0 = 1.2;
export const LAMP_DT = 1.0;
const HOLD = 1.3; // the wait after the fifth light
export const T_GO = LAMP0 + 4 * LAMP_DT + HOLD; // lights out

export function introModel(D: IntroData) {
  const P = D.path;
  const N = P.length;
  // the run-up on the lap-sim speeds times the agreed factors; the P on the logo animation's own clock
  const tl = (() => {
    const f = blendedFactors(P, 6);
    const v = P.map((p, i) => Math.max(p[3] * f[i], 0.03));
    const ts = new Array<number>(N).fill(0);
    for (let i = D.iStart + 1; i < N; i++) ts[i] = ts[i - 1] + (P[i][5] - P[i - 1][5]) / ((v[i] + v[i - 1]) / 2);
    for (let i = D.iStart - 1; i >= 0; i--) ts[i] = ts[i + 1] - (P[i + 1][5] - P[i][5]) / ((v[i] + v[i + 1]) / 2);
    const jP = D.jP;
    const ps = D.pSec;
    const vLogo = (P[jP + 1][5] - P[jP][5]) / ((ps[jP + 1] as number) - (ps[jP] as number));
    const vSim = (P[jP][5] - P[jP - 1][5]) / (ts[jP] - ts[jP - 1]);
    const k = vSim / vLogo;
    const out = ts.map((x) => x * k);
    let last = vLogo;
    for (let i = jP + 1; i < N; i++) {
      const s = ps[i];
      if (s != null) {
        out[i] = out[jP] + (s - (ps[jP] as number));
        last = (P[i][5] - P[i - 1][5]) / Math.max(out[i] - out[i - 1], 1e-6);
      } else out[i] = out[i - 1] + (P[i][5] - P[i - 1][5]) / last;
    }
    return out;
  })();
  const idxAtS = (s: number) => {
    let lo = 0;
    let hi = N - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (P[m][5] < s) lo = m;
      else hi = m;
    }
    return lo;
  };
  const tauAtS = (s: number) => {
    const i = idxAtS(s);
    const k = (s - P[i][5]) / (P[i + 1][5] - P[i][5] || 1);
    return tl[i] + (tl[i + 1] - tl[i]) * k;
  };
  const sAt = (tau: number) => {
    if (tau <= tl[0]) return P[0][5];
    if (tau >= tl[N - 1]) return P[N - 1][5];
    let lo = 0;
    let hi = N - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (tl[m] < tau) lo = m;
      else hi = m;
    }
    const k = (tau - tl[lo]) / (tl[hi] - tl[lo] || 1);
    return P[lo][5] + (P[hi][5] - P[lo][5]) * k;
  };
  const poseAt = (s: number) => {
    const lo = idxAtS(Math.max(P[0][5], Math.min(P[N - 1][5] - 0.01, s)));
    const a = P[lo];
    const b = P[lo + 1];
    const k = (s - a[5]) / (b[5] - a[5] || 1);
    let da = b[2] - a[2];
    if (da > 180) da -= 360;
    if (da < -180) da += 360;
    return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + da * k, a[4] + (b[4] - a[4]) * k];
  };
  const carS = (k: number, tau: number) => sAt(tau - k * GAP);

  const TAU_SETTLE = tauAtS(D.pFrom) + 0.15; // the camera has settled on the tile as the leader reaches the P
  const T_GONE = T_GO + tauAtS(D.sExit) + 2 * GAP + 0.05; // the last car has left the logo

  const H0 = 70;
  const CAM = { x: 128, y: 128, h: 256 };
  /** The camera: centre and size of the square view. It never turns: it pulls back and drifts up. */
  const camera = (t: number) => {
    const tau = t - T_GO;
    if (tau < 0) {
      const [x, y] = poseAt(carS(0, 0));
      return { x, y: y - H0 * 0.18, h: H0 };
    }
    const e = ease(Math.min(1, tau / TAU_SETTLE));
    const h = Math.exp(lerp(Math.log(H0), Math.log(CAM.h), e));
    const [x, y] = poseAt(carS(0, tau));
    const follow = y - h * lerp(0.18, 0.36, e);
    const k = 18;
    const cy = (follow + CAM.y + Math.sqrt((follow - CAM.y) ** 2 + k * k)) / 2; // never above the final centre
    return { x: lerp(x, CAM.x, e), y: cy, h };
  };
  /** How solid the track is: nearly transparent after the lights, solid as the camera settles. */
  const solid = (t: number) => {
    const tau = t - T_GO;
    return tau < 0 ? 0 : Math.pow(ease(tau / (TAU_SETTLE * 0.95)), 1.7);
  };
  /** Car k at time t: pose, opacity, and (for the last car) how much of the exit marks it has laid. */
  const car = (k: number, t: number) => {
    const tau = t - T_GO;
    const s = carS(k, Math.max(tau, -1));
    const [x, y, a, r] = poseAt(s);
    let op = tau < 0 ? 0 : k === 0 ? Math.min(1, 1.15 * Math.sqrt(solid(t))) : ease((tau - TAU_SETTLE * 0.3 - 0.3 * k) / 0.8);
    if (s > D.sExit + 40) op = 0;
    return { x, y, a, op, reveal: tau < 0 ? 0 : r };
  };
  const gantry = (t: number) => ease((t - 0.3) / 0.5) * (1 - ease((t - T_GO - 0.15) / 1.4));
  const lampOn = (i: number, t: number) => t >= LAMP0 + i * LAMP_DT && t < T_GO;

  return { T_GONE, camera, solid, car, gantry, lampOn };
}
