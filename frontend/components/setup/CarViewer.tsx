"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

/**
 * A single-seater drawn as a technical draft: dark panels with cyan edges. The
 * setting being looked at lights up its part, the camera swings round to it and
 * the part acts out what the setting does (the wing flap tilts, the wheels show
 * camber and toe, the car rises and drops with ride height, the brakes glow by
 * the bias). Built from primitives in code: no model file to load.
 */

type Part =
  | "body"
  | "front_wing"
  | "front_flap"
  | "rear_wing"
  | "rear_flap"
  | "wheels_front"
  | "wheels_rear"
  | "tyres_front"
  | "tyres_rear"
  | "springs_front"
  | "springs_rear"
  | "arms_front"
  | "arms_rear"
  | "arb_front"
  | "arb_rear"
  | "brakes_front"
  | "brakes_rear"
  | "diff"
  | "floor";

type Anim =
  | "wing_front"
  | "wing_rear"
  | "diff"
  | "camber_front"
  | "camber_rear"
  | "toe_front"
  | "toe_rear"
  | "spring_front"
  | "spring_rear"
  | "roll"
  | "height_front"
  | "height_rear"
  | "brake_pressure"
  | "brake_bias"
  | "engine_brake"
  | "tyre_front"
  | "tyre_rear"
  | "none";

type Focus = { parts: Part[]; cam: [number, number, number]; target: [number, number, number]; anim: Anim; xray?: boolean };

const WB_F = 1.8; // front axle x
const WB_R = -1.8; // rear axle x
const TRACK = 0.8; // half track
const R = 0.36; // tyre radius

export const FOCUS: Record<string, Focus> = {
  overview: { parts: [], cam: [5.2, 2.6, 5.2], target: [0, 0.35, 0], anim: "none" },
  aleron_delantero: { parts: ["front_wing", "front_flap"], cam: [5.6, 1.1, 2.6], target: [2.9, 0.2, 0], anim: "wing_front" },
  aleron_trasero: { parts: ["rear_wing", "rear_flap"], cam: [-5.2, 2.2, 2.8], target: [-2.4, 0.85, 0], anim: "wing_rear" },
  diferencial_acelerando_pct: { parts: ["diff", "wheels_rear", "tyres_rear"], cam: [-3.6, 3.8, 2.4], target: [-1.8, 0.3, 0], anim: "diff", xray: true },
  diferencial_soltando_pct: { parts: ["diff", "wheels_rear", "tyres_rear"], cam: [-3.6, 3.8, -2.4], target: [-1.8, 0.3, 0], anim: "diff", xray: true },
  camber_del: { parts: ["wheels_front", "tyres_front"], cam: [6.4, 1.0, 0.01], target: [WB_F, 0.35, 0], anim: "camber_front" },
  camber_tras: { parts: ["wheels_rear", "tyres_rear"], cam: [-6.4, 1.1, 0.01], target: [WB_R, 0.35, 0], anim: "camber_rear" },
  convergencia_del: { parts: ["wheels_front", "tyres_front"], cam: [WB_F + 0.6, 5.2, 0.01], target: [WB_F, 0, 0], anim: "toe_front" },
  convergencia_tras: { parts: ["wheels_rear", "tyres_rear"], cam: [WB_R - 0.6, 5.2, 0.01], target: [WB_R, 0, 0], anim: "toe_rear" },
  suspension_del: { parts: ["springs_front", "arms_front"], cam: [3.4, 1.0, 3.0], target: [WB_F, 0.35, 0], anim: "spring_front", xray: true },
  suspension_tras: { parts: ["springs_rear", "arms_rear"], cam: [-3.4, 1.0, 3.0], target: [WB_R, 0.35, 0], anim: "spring_rear", xray: true },
  barra_antivuelco_del: { parts: ["arb_front"], cam: [4.6, 2.2, 0.9], target: [WB_F - 0.2, 0.45, 0], anim: "roll", xray: true },
  barra_antivuelco_tras: { parts: ["arb_rear"], cam: [-4.6, 2.2, 0.9], target: [WB_R + 0.2, 0.45, 0], anim: "roll", xray: true },
  altura_del: { parts: ["floor", "body"], cam: [0.8, 0.45, 6.4], target: [0.6, 0.3, 0], anim: "height_front" },
  altura_tras: { parts: ["floor", "body"], cam: [-0.8, 0.45, 6.4], target: [-0.6, 0.3, 0], anim: "height_rear" },
  presion_frenos_pct: { parts: ["brakes_front", "brakes_rear"], cam: [2.4, 1.0, 4.4], target: [0, 0.3, 0], anim: "brake_pressure", xray: true },
  reparto_frenada_pct: { parts: ["brakes_front", "brakes_rear"], cam: [0.01, 4.8, 4.2], target: [0, 0.3, 0], anim: "brake_bias", xray: true },
  freno_motor_pct: { parts: ["diff", "brakes_rear"], cam: [-3.4, 2.6, 3.2], target: [-1.6, 0.35, 0], anim: "engine_brake", xray: true },
  presion_del_izq: { parts: ["tyres_front"], cam: [4.2, 1.2, 3.2], target: [WB_F, 0.35, 0], anim: "tyre_front" },
  presion_tras_izq: { parts: ["tyres_rear"], cam: [-4.2, 1.2, 3.2], target: [WB_R, 0.35, 0], anim: "tyre_rear" },
};

const COLORS = {
  panel: 0x1a2330,
  tyre: 0x0e1218,
  edge: 0x3f5b72,
  hl: 0x0e7490,
  hlEmissive: 0x22d3ee,
  hlEdge: 0xa5f3fc,
  grid: 0x173040,
  grid2: 0x101d28,
};

type Wheel = { group: THREE.Group; camber: THREE.Group; spin: THREE.Group; tyre: THREE.Mesh; front: boolean; side: 1 | -1; hub: THREE.Vector3 };
type Link = { mesh: THREE.Mesh; inboard: THREE.Vector3; wheel: number; outboard: THREE.Vector3 };

export function CarViewer({ focus, bias }: { focus: string; bias?: number | null }) {
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<{ setFocus: (k: string) => void; setBias: (b: number | null) => void } | null>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    el.appendChild(renderer.domElement);
    renderer.domElement.style.display = "block";
    renderer.domElement.style.touchAction = "pan-y";

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(4, 8, 5);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x88ccff, 0.6);
    rim.position.set(-6, 3, -4);
    scene.add(rim);
    const grid = new THREE.GridHelper(16, 32, COLORS.grid, COLORS.grid2);
    scene.add(grid);

    // --- materials -------------------------------------------------------------
    const mats = {
      panel: new THREE.MeshStandardMaterial({ color: COLORS.panel, metalness: 0.35, roughness: 0.55, transparent: true }),
      tyre: new THREE.MeshStandardMaterial({ color: COLORS.tyre, metalness: 0.1, roughness: 0.9, transparent: true }),
      hl: new THREE.MeshStandardMaterial({ color: COLORS.hl, emissive: COLORS.hlEmissive, emissiveIntensity: 0.55, metalness: 0.3, roughness: 0.4 }),
      edge: new THREE.LineBasicMaterial({ color: COLORS.edge, transparent: true }),
      hlEdge: new THREE.LineBasicMaterial({ color: COLORS.hlEdge }),
    };
    const owned: { mesh: THREE.Mesh; edges: THREE.LineSegments; part: Part; base: THREE.Material; glow?: boolean }[] = [];
    const brakeMats: { front: boolean; mat: THREE.MeshStandardMaterial }[] = [];

    function add(parent: THREE.Object3D, geo: THREE.BufferGeometry, part: Part, opts: { tyre?: boolean; brake?: boolean; front?: boolean } = {}) {
      let base: THREE.Material = opts.tyre ? mats.tyre : mats.panel;
      if (opts.brake) {
        const m = new THREE.MeshStandardMaterial({ color: 0x2a1a14, emissive: 0xff5a1f, emissiveIntensity: 0, metalness: 0.6, roughness: 0.4 });
        brakeMats.push({ front: !!opts.front, mat: m });
        base = m;
      }
      const mesh = new THREE.Mesh(geo, base);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 28), mats.edge);
      mesh.add(edges);
      parent.add(mesh);
      owned.push({ mesh, edges, part, base, glow: opts.brake });
      return mesh;
    }

    const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);

    // --- car ---------------------------------------------------------------------
    const car = new THREE.Group();
    scene.add(car);
    const body = new THREE.Group(); // sprung mass: moves with ride height, pitch and roll
    body.position.y = 0;
    car.add(body);

    // Floor and plank.
    add(body, box(3.7, 0.04, 1.4), "floor").position.set(-0.2, 0.08, 0);
    // Monocoque, nose and cockpit.
    const tub = add(body, box(2.6, 0.42, 0.66), "body");
    tub.position.set(0.9, 0.4, 0);
    const nose = add(body, new THREE.CylinderGeometry(0.08, 0.26, 1.1, 12), "body");
    nose.rotation.z = Math.PI / 2; // narrow end forward
    nose.position.set(2.75, 0.3, 0);
    nose.scale.set(1, 1, 0.8);
    add(body, box(0.7, 0.12, 0.5), "body").position.set(0.95, 0.66, 0); // cockpit rim
    // Halo.
    const halo = add(body, new THREE.TorusGeometry(0.32, 0.03, 8, 24, Math.PI), "body");
    halo.rotation.set(-Math.PI / 2, 0, Math.PI / 2);
    halo.position.set(1.05, 0.82, 0);
    // Sidepods.
    for (const side of [1, -1]) {
      const pod = add(body, box(1.7, 0.36, 0.42), "body");
      pod.position.set(0.05, 0.36, side * 0.52);
    }
    // Engine cover and airbox.
    const cover = add(body, new THREE.CylinderGeometry(0.1, 0.34, 1.7, 12), "body");
    cover.rotation.z = -Math.PI / 2; // narrow end at the back
    cover.position.set(-1.25, 0.5, 0);
    cover.scale.set(1, 1, 0.75);
    add(body, box(0.5, 0.3, 0.26), "body").position.set(0.35, 0.82, 0);

    // Front wing: main plane, a flap that tilts, endplates.
    add(body, box(0.4, 0.03, 1.8), "front_wing").position.set(3.25, 0.1, 0);
    for (const side of [1, -1]) add(body, box(0.5, 0.2, 0.02), "front_wing").position.set(3.2, 0.17, side * 0.91);
    const frontFlap = new THREE.Group();
    frontFlap.position.set(3.08, 0.16, 0);
    body.add(frontFlap);
    add(frontFlap, box(0.26, 0.02, 1.72), "front_flap").position.set(-0.13, 0, 0);

    // Rear wing: main plane, a flap above it, endplates and pillar.
    add(body, box(0.32, 0.03, 1.0), "rear_wing").position.set(-2.42, 0.86, 0);
    for (const side of [1, -1]) add(body, box(0.62, 0.48, 0.02), "rear_wing").position.set(-2.4, 0.86, side * 0.51);
    add(body, box(0.08, 0.42, 0.06), "rear_wing").position.set(-2.3, 0.62, 0);
    const rearFlap = new THREE.Group();
    rearFlap.position.set(-2.28, 0.98, 0);
    body.add(rearFlap);
    add(rearFlap, box(0.24, 0.02, 0.98), "rear_flap").position.set(-0.12, 0, 0);

    // Differential and driveshafts.
    add(body, box(0.3, 0.22, 0.3), "diff").position.set(WB_R, 0.32, 0);

    // --- wheels ----------------------------------------------------------------
    const wheels: Wheel[] = [];
    for (const front of [true, false]) {
      for (const side of [1, -1] as const) {
        const x = front ? WB_F : WB_R;
        const width = front ? 0.3 : 0.4;
        const group = new THREE.Group(); // toe (steer) around y
        group.position.set(x, R, side * TRACK);
        car.add(group);
        const camber = new THREE.Group(); // camber around x
        group.add(camber);
        const spin = new THREE.Group(); // rolling around z
        camber.add(spin);
        const tyreGeo = new THREE.CylinderGeometry(R, R, width, 36, 1, true);
        tyreGeo.rotateX(Math.PI / 2);
        const tyre = add(spin, tyreGeo, front ? "tyres_front" : "tyres_rear", { tyre: true });
        // Sidewalls and rim with spokes, so rolling is visible.
        const wall = new THREE.RingGeometry(0.2, R, 36);
        for (const face of [1, -1]) {
          const w = add(spin, wall, front ? "tyres_front" : "tyres_rear", { tyre: true });
          w.position.z = (face * width) / 2;
          if (face < 0) w.rotation.y = Math.PI;
        }
        for (let k = 0; k < 5; k++) {
          const spoke = add(spin, box(0.36, 0.03, 0.02), front ? "wheels_front" : "wheels_rear");
          spoke.rotation.z = (k * Math.PI * 2) / 5;
          spoke.position.z = (side * width) / 2 + side * 0.005;
        }
        // Brake disc inboard of the wheel.
        const disc = new THREE.CylinderGeometry(0.17, 0.17, 0.03, 24);
        disc.rotateX(Math.PI / 2);
        add(camber, disc, front ? "brakes_front" : "brakes_rear", { brake: true, front }).position.z = -side * 0.08;
        wheels.push({ group, camber, spin, tyre, front, side, hub: new THREE.Vector3(x, R, side * TRACK) });
      }
    }
    // Wheel rims are part of the "wheels" highlight too.
    for (const w of wheels) {
      const hubGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.06, 12);
      hubGeo.rotateX(Math.PI / 2);
      add(w.spin, hubGeo, w.front ? "wheels_front" : "wheels_rear").position.z = (w.side * (w.front ? 0.3 : 0.4)) / 2;
    }

    // --- suspension: arms, springs and anti-roll bars, re-placed every frame ----------
    const links: Link[] = [];
    const rod = new THREE.CylinderGeometry(0.018, 0.018, 1, 6);
    const coilCurve = new THREE.CatmullRomCurve3(
      Array.from({ length: 120 }, (_, i) => {
        const a = (i / 119) * Math.PI * 2 * 7;
        return new THREE.Vector3(Math.cos(a) * 0.05, i / 119 - 0.5, Math.sin(a) * 0.05);
      }),
    );
    const coil = new THREE.TubeGeometry(coilCurve, 240, 0.008, 5, false);
    wheels.forEach((w, i) => {
      const fx = w.front ? 1 : -1;
      const armPart: Part = w.front ? "arms_front" : "arms_rear";
      // Upper and lower wishbones: two legs each, from the tub to the upright.
      for (const [y, dy] of [[0.48, 0.12], [0.22, -0.12]] as const) {
        for (const dx of [0.25, -0.25]) {
          const m = add(body, rod, armPart);
          links.push({ mesh: m, inboard: new THREE.Vector3(w.hub.x + dx * fx, y, w.side * 0.3), wheel: i, outboard: new THREE.Vector3(0, dy, -w.side * 0.12) });
        }
      }
      // Pushrod and spring.
      const push = add(body, rod, armPart);
      links.push({ mesh: push, inboard: new THREE.Vector3(w.hub.x - 0.15 * fx, 0.62, w.side * 0.22), wheel: i, outboard: new THREE.Vector3(0, -0.1, -w.side * 0.13) });
      const spring = add(body, coil, w.front ? "springs_front" : "springs_rear");
      links.push({ mesh: spring, inboard: new THREE.Vector3(w.hub.x - 0.15 * fx, 0.62, w.side * 0.06), wheel: i, outboard: new THREE.Vector3(-0.15 * fx, 0.22, -w.side * 0.2) });
    });
    for (const front of [true, false]) {
      const x = (front ? WB_F : WB_R) - (front ? 0.15 : -0.15);
      const bar = new THREE.CylinderGeometry(0.025, 0.025, 0.5, 8);
      bar.rotateX(Math.PI / 2);
      add(body, bar, front ? "arb_front" : "arb_rear").position.set(x, 0.6, 0);
      for (const side of [1, -1]) add(body, box(0.14, 0.03, 0.03), front ? "arb_front" : "arb_rear").position.set(x + (front ? 0.06 : -0.06), 0.6, side * 0.25);
    }
    // Driveshafts.
    for (const side of [1, -1]) {
      const m = add(body, rod, "diff");
      const wi = wheels.findIndex((w) => !w.front && w.side === side);
      links.push({ mesh: m, inboard: new THREE.Vector3(WB_R, 0.32, side * 0.15), wheel: wi, outboard: new THREE.Vector3(0, 0, -side * 0.12) });
    }

    const up = new THREE.Vector3(0, 1, 0);
    const tmpA = new THREE.Vector3();
    const tmpB = new THREE.Vector3();
    const inv = new THREE.Matrix4();
    function placeLinks() {
      body.updateMatrixWorld(true);
      for (const l of links) {
        const w = wheels[l.wheel];
        tmpA.copy(l.inboard).applyMatrix4(body.matrixWorld);
        // The spring runs from the tub to the top of the upright, so it shortens as the body drops.
        tmpB.copy(w.group.position).add(l.outboard);
        // Meshes live in body space: convert both ends back.
        inv.copy(body.matrixWorld).invert();
        const a = tmpA.clone().applyMatrix4(inv);
        const b = tmpB.clone().applyMatrix4(inv);
        const dir = b.clone().sub(a);
        const len = dir.length();
        l.mesh.position.copy(a).add(b).multiplyScalar(0.5);
        l.mesh.quaternion.setFromUnitVectors(up, dir.normalize());
        l.mesh.scale.set(1, Math.max(0.05, len), 1);
      }
    }

    // --- focus, highlight and camera --------------------------------------------
    let focus: Focus = FOCUS.overview;
    let focusStart = performance.now();
    let biasValue: number | null = null;
    const pivot = new THREE.Vector3(0, 0.35, 0);
    const camTarget = new THREE.Vector3(...focus.target);
    const sph = new THREE.Spherical().setFromVector3(new THREE.Vector3(...focus.cam).sub(pivot));
    let userYaw = 0;

    function applyHighlight() {
      const lit = new Set(focus.parts);
      for (const o of owned) {
        const on = lit.has(o.part);
        o.mesh.material = on && !o.glow ? mats.hl : o.base;
        o.edges.material = on ? mats.hlEdge : mats.edge;
      }
      // X-ray: the panels fade so the parts inside (springs, bars, diff, brakes) show.
      mats.panel.opacity = focus.xray ? 0.22 : 1;
      mats.panel.depthWrite = !focus.xray;
      mats.edge.opacity = focus.xray ? 0.45 : 1;
    }

    api.current = {
      setFocus(k: string) {
        focus = FOCUS[k] ?? FOCUS.overview;
        focusStart = performance.now();
        userYaw = 0;
        applyHighlight();
      },
      setBias(b) {
        biasValue = b;
      },
    };
    applyHighlight();

    // Drag to look around.
    let dragX: number | null = null;
    const onDown = (e: PointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      dragX = e.clientX;
      renderer.domElement.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (dragX == null) return;
      userYaw -= (e.clientX - dragX) * 0.008;
      dragX = e.clientX;
    };
    const onUp = () => (dragX = null);
    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("pointermove", onMove);
    renderer.domElement.addEventListener("pointerup", onUp);
    renderer.domElement.addEventListener("pointercancel", onUp);

    function resize() {
      const w = el!.clientWidth;
      const h = el!.clientHeight;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = `${w}px`;
      renderer.domElement.style.height = `${h}px`;
      camera.aspect = w / Math.max(1, h);
      // Narrow screens see the whole car: pull the camera back.
      camera.fov = camera.aspect < 1 ? 50 : 36;
      camera.updateProjectionMatrix();
    }
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    // --- animation loop ------------------------------------------------------------
    let last = performance.now();
    let raf = 0;
    const desired = new THREE.Spherical();
    const shortest = (a: number, b: number) => {
      let d = b - a;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      return d;
    };

    function frame(now: number) {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const t = (now - focusStart) / 1000;
      const s = (Math.sin(t * 2.4 - Math.PI / 2) + 1) / 2; // 0..1, starting at 0
      const k = 1 - Math.exp(-dt * 3.2);

      // Camera: swing round the car in spherical coordinates, like a turntable.
      desired.setFromVector3(new THREE.Vector3(...focus.cam).sub(pivot));
      desired.theta += userYaw + Math.sin(now / 4000) * 0.06;
      sph.radius += (desired.radius - sph.radius) * k;
      sph.phi += (desired.phi - sph.phi) * k;
      sph.theta += shortest(sph.theta, desired.theta) * k;
      camTarget.lerp(new THREE.Vector3(...focus.target), k);
      camera.position.setFromSpherical(sph).add(pivot);
      camera.lookAt(camTarget);

      // Reset the pose, then act out the focused setting.
      body.position.y = 0;
      body.rotation.set(0, 0, 0);
      frontFlap.rotation.z = 0.25;
      rearFlap.rotation.z = 0.35;
      for (const w of wheels) {
        w.group.rotation.y = 0;
        w.camber.rotation.x = w.side * 0.03;
        w.tyre.scale.set(1, 1, 1);
        w.spin.scale.set(1, 1, 1);
      }
      for (const b of brakeMats) b.mat.emissiveIntensity = 0;

      const a = focus.anim;
      if (a === "wing_front") frontFlap.rotation.z = 0.1 + s * 0.55;
      if (a === "wing_rear") rearFlap.rotation.z = 0.1 + s * 0.65;
      if (a === "camber_front" || a === "camber_rear") {
        for (const w of wheels) if (w.front === (a === "camber_front")) w.camber.rotation.x = w.side * (0.04 + s * 0.22);
      }
      if (a === "toe_front" || a === "toe_rear") {
        for (const w of wheels) {
          if (w.front !== (a === "toe_front")) continue;
          // Front: toe-out (fronts of the wheels open); rear: toe-in.
          const dir = w.front ? -w.side : w.side;
          w.group.rotation.y = dir * s * 0.28;
        }
      }
      if (a === "spring_front") {
        body.rotation.z = -s * 0.035;
        body.position.y = -s * 0.02;
      }
      if (a === "spring_rear") {
        body.rotation.z = s * 0.035;
        body.position.y = -s * 0.02;
      }
      if (a === "roll") body.rotation.x = Math.sin(t * 2.4) * 0.05;
      if (a === "height_front") {
        body.rotation.z = (s - 0.5) * 0.05;
        body.position.y = (s - 0.5) * 0.04;
      }
      if (a === "height_rear") {
        body.rotation.z = -(s - 0.5) * 0.05;
        body.position.y = (s - 0.5) * 0.04;
      }
      if (a === "brake_pressure") for (const b of brakeMats) b.mat.emissiveIntensity = s * 2.2;
      if (a === "brake_bias") {
        const front = (biasValue ?? 57) / 100;
        for (const b of brakeMats) b.mat.emissiveIntensity = (b.front ? front : 1 - front) * 2.8 * (0.55 + 0.45 * s);
      }
      if (a === "engine_brake") for (const b of brakeMats) if (!b.front) b.mat.emissiveIntensity = s * 1.6;
      if (a === "tyre_front" || a === "tyre_rear") {
        for (const w of wheels) if (w.front === (a === "tyre_front")) w.spin.scale.set(1 + s * 0.06, 1 + s * 0.06, 1);
      }
      // Rolling wheels where it helps to see them turn.
      const rolling = a === "diff" || a === "engine_brake" || a === "brake_pressure";
      for (const w of wheels) {
        if (!rolling) continue;
        // Diff: the outer rear wheel turns faster than the inner one in a corner.
        const rate = a === "diff" && !w.front ? (w.side > 0 ? 7 : 4.5) : 5;
        w.spin.rotation.z -= rate * dt;
      }

      placeLinks();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onDown);
      renderer.domElement.removeEventListener("pointermove", onMove);
      renderer.domElement.removeEventListener("pointerup", onUp);
      renderer.domElement.removeEventListener("pointercancel", onUp);
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose?.();
      });
      Object.values(mats).forEach((m) => m.dispose());
      brakeMats.forEach((b) => b.mat.dispose());
      renderer.dispose();
      el.removeChild(renderer.domElement);
      api.current = null;
    };
  }, []);

  useEffect(() => {
    api.current?.setFocus(focus);
  }, [focus]);

  useEffect(() => {
    api.current?.setBias(bias ?? null);
  }, [bias]);

  return <div ref={host} className="h-full w-full cursor-grab active:cursor-grabbing" aria-label="Monoplaza en 3D" role="img" />;
}
