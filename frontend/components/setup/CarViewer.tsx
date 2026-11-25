"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

import { API_URL } from "@/lib/api";
import { useAuth, type Credentials } from "@/lib/auth";

import {
  BODY,
  FLOOR,
  FRONT_ENDPLATE,
  haloHalf,
  loft,
  planPlate,
  plate,
  R,
  REAR_ENDPLATE,
  RIM,
  roundedTexture,
  sidepod,
  TRACK,
  tube,
  tyre,
  WB_F,
  WB_R,
  wing,
} from "@/components/setup/carModel";

/**
 * The single-seater in the Reglaje tab. The setting being looked at lights up
 * its part, the camera swings round to it like a turntable and the part acts
 * out what the setting does: the wing flap tilts, the wheels show camber and
 * toe, the car rises, drops and rolls, the brakes glow by the bias. Parts that
 * live inside the car (springs, anti-roll bars, differential) only show when
 * the bodywork turns see-through.
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

const INTERNAL: Part[] = ["springs_front", "springs_rear", "arb_front", "arb_rear", "diff"];

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

export const FOCUS: Record<string, Focus> = {
  overview: { parts: [], cam: [5.4, 2.4, 5.4], target: [0, 0.35, 0], anim: "none" },
  aleron_delantero: { parts: ["front_wing", "front_flap"], cam: [6.2, 1.5, 3.4], target: [2.6, 0.25, 0], anim: "wing_front" },
  aleron_trasero: { parts: ["rear_wing", "rear_flap"], cam: [-6.0, 2.4, 3.4], target: [-2.3, 0.75, 0], anim: "wing_rear" },
  diferencial_acelerando_pct: { parts: ["diff", "wheels_rear", "tyres_rear"], cam: [-4.4, 4.2, 2.8], target: [WB_R, 0.3, 0], anim: "diff", xray: true },
  diferencial_soltando_pct: { parts: ["diff", "wheels_rear", "tyres_rear"], cam: [-4.4, 4.2, -2.8], target: [WB_R, 0.3, 0], anim: "diff", xray: true },
  camber_del: { parts: ["wheels_front", "tyres_front"], cam: [6.6, 1.1, 0.01], target: [WB_F, 0.35, 0], anim: "camber_front" },
  camber_tras: { parts: ["wheels_rear", "tyres_rear"], cam: [-6.6, 1.2, 0.01], target: [WB_R, 0.35, 0], anim: "camber_rear" },
  convergencia_del: { parts: ["wheels_front", "tyres_front"], cam: [WB_F + 0.4, 5.6, 0.01], target: [WB_F, 0, 0], anim: "toe_front" },
  convergencia_tras: { parts: ["wheels_rear", "tyres_rear"], cam: [WB_R - 0.4, 5.6, 0.01], target: [WB_R, 0, 0], anim: "toe_rear" },
  suspension_del: { parts: ["springs_front", "arms_front"], cam: [3.8, 1.4, 3.4], target: [WB_F, 0.4, 0], anim: "spring_front", xray: true },
  suspension_tras: { parts: ["springs_rear", "arms_rear"], cam: [-3.8, 1.4, 3.4], target: [WB_R, 0.4, 0], anim: "spring_rear", xray: true },
  barra_antivuelco_del: { parts: ["arb_front"], cam: [5.0, 2.4, 1.2], target: [WB_F - 0.2, 0.45, 0], anim: "roll", xray: true },
  barra_antivuelco_tras: { parts: ["arb_rear"], cam: [-5.0, 2.4, 1.2], target: [WB_R + 0.2, 0.45, 0], anim: "roll", xray: true },
  altura_del: { parts: ["floor"], cam: [1.0, 0.55, 6.8], target: [0.5, 0.3, 0], anim: "height_front" },
  altura_tras: { parts: ["floor"], cam: [-1.0, 0.55, 6.8], target: [-0.5, 0.3, 0], anim: "height_rear" },
  presion_frenos_pct: { parts: ["brakes_front", "brakes_rear"], cam: [2.8, 1.4, 4.8], target: [0, 0.3, 0], anim: "brake_pressure", xray: true },
  reparto_frenada_pct: { parts: ["brakes_front", "brakes_rear"], cam: [0.01, 5.4, 4.4], target: [0, 0.3, 0], anim: "brake_bias", xray: true },
  freno_motor_pct: { parts: ["diff", "brakes_rear"], cam: [-3.8, 2.8, 3.6], target: [-1.5, 0.35, 0], anim: "engine_brake", xray: true },
  presion_del_izq: { parts: ["tyres_front"], cam: [4.4, 1.3, 3.4], target: [WB_F, 0.35, 0], anim: "tyre_front" },
  presion_tras_izq: { parts: ["tyres_rear"], cam: [-4.4, 1.3, 3.4], target: [WB_R, 0.35, 0], anim: "tyre_rear" },
};

type Wheel = { group: THREE.Group; camber: THREE.Group; spin: THREE.Group; front: boolean; side: 1 | -1 };
type Link = { mesh: THREE.Mesh; inboard: THREE.Vector3; wheel: number; outboard: THREE.Vector3 };
type Owned = { mesh: THREE.Mesh; lines: THREE.LineSegments; part: Part; base: THREE.Material; glow?: boolean; retired?: boolean };

/**
 * The licensed car model (served only to signed-in players, see backend/app/routers/assets.py),
 * fetched once per page load. Null when it is not there: the viewer keeps the car built in code.
 */
let realCar: Promise<THREE.Group | null> | null = null;
function loadRealCar(creds: Credentials | null): Promise<THREE.Group | null> {
  realCar ??= (async () => {
    try {
      const headers: Record<string, string> = {};
      if (creds?.token) headers.Authorization = `Bearer ${creds.token}`;
      if (creds?.devUser) headers["X-Dev-User"] = creds.devUser;
      const res = await fetch(`${API_URL}/api/assets/car.glb`, { headers });
      if (!res.ok) {
        realCar = null; // try again next time the viewer opens (signed in later, uploaded later)
        return null;
      }
      const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
      const gltf = await loader.parseAsync(await res.arrayBuffer(), "");
      return gltf.scene;
    } catch {
      return null;
    }
  })();
  return realCar;
}

/** The setting being shown: the player's value, the engineer's suggestion and the game's range. */
export type ViewerSetting = { value: number | null; suggested: number | null; range?: [number, number] };

// Settings whose effect grows as the number goes down (more negative camber, softer springs mean more movement).
const INVERTED = new Set(["camber_del", "camber_tras", "suspension_del", "suspension_tras", "barra_antivuelco_del", "barra_antivuelco_tras", "diferencial_acelerando_pct", "diferencial_soltando_pct"]);

/** The studio floor: a pool of light fading to nothing, with a faint grid. */
function studioFloor(): THREE.Texture {
  const size = 1024;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, "rgba(58,63,71,0.55)");
  grad.addColorStop(0.45, "rgba(36,39,45,0.35)");
  grad.addColorStop(1, "rgba(11,12,14,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  g.globalCompositeOperation = "source-atop";
  g.strokeStyle = "rgba(255,255,255,0.05)";
  g.lineWidth = 1;
  for (let i = 0; i <= size; i += size / 36) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i, size);
    g.moveTo(0, i);
    g.lineTo(size, i);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function CarViewer({ focus, bias, setting }: { focus: string; bias?: number | null; setting?: ViewerSetting }) {
  const host = useRef<HTMLDivElement>(null);
  const { credentials } = useAuth();
  const credentialsRef = useRef(credentials);
  credentialsRef.current = credentials;
  const api = useRef<{ setFocus: (k: string) => void; setBias: (b: number | null) => void; setSetting: (v: ViewerSetting | null) => void } | null>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    el.appendChild(renderer.domElement);
    renderer.domElement.style.display = "block";
    renderer.domElement.style.touchAction = "pan-y";

    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
    // Studio light: a soft key from above, a cool fill and a warm rim in the app's red.
    const key = new THREE.DirectionalLight(0xffffff, 1.35);
    key.position.set(3, 9, 4);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xc9d2dc, 0.35);
    fill.position.set(5, 2, -6);
    scene.add(fill);
    const rim = new THREE.DirectionalLight(0xff6a4d, 0.9);
    rim.position.set(-7, 2.5, -3);
    scene.add(rim);
    scene.add(new THREE.HemisphereLight(0x2a2e35, 0x0b0c0e, 0.6));
    // A studio floor: a soft pool of light that fades out, with a faint grid.
    const floorTex = studioFloor();
    const floor = new THREE.Mesh(new THREE.CircleGeometry(9, 64), new THREE.MeshBasicMaterial({ map: floorTex, transparent: true, depthWrite: false }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.001;
    scene.add(floor);
    const shadowTex = roundedTexture();
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(6.2, 2.4), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.002;
    scene.add(shadow);

    // --- materials -------------------------------------------------------------
    const mats = {
      paint: new THREE.MeshPhysicalMaterial({ color: 0x23272e, metalness: 0.35, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.18, sheen: 0.4, sheenColor: new THREE.Color(0x3a3f47), envMapIntensity: 0.7, transparent: true }),
      carbon: new THREE.MeshPhysicalMaterial({ color: 0x111317, metalness: 0.2, roughness: 0.55, clearcoat: 0.5, clearcoatRoughness: 0.4, envMapIntensity: 0.45, transparent: true }),
      livery: new THREE.MeshPhysicalMaterial({ color: 0xff4b2b, metalness: 0.15, roughness: 0.35, clearcoat: 0.8, clearcoatRoughness: 0.2, envMapIntensity: 0.6, transparent: true }),
      cover: new THREE.MeshPhysicalMaterial({ color: 0x1a1d22, metalness: 0.5, roughness: 0.3, clearcoat: 0.6, envMapIntensity: 0.6 }),
      rubber: new THREE.MeshStandardMaterial({ color: 0x0b0e12, metalness: 0, roughness: 0.92 }),
      rim: new THREE.MeshStandardMaterial({ color: 0x2b3542, metalness: 0.85, roughness: 0.3 }),
      stripe: new THREE.MeshStandardMaterial({ color: 0xff4b2b, roughness: 0.5 }),
      helmet: new THREE.MeshPhysicalMaterial({ color: 0xff4b2b, metalness: 0.1, roughness: 0.25, clearcoat: 1 }),
      visor: new THREE.MeshPhysicalMaterial({ color: 0x0a0d12, metalness: 0.9, roughness: 0.1 }),
      metal: new THREE.MeshStandardMaterial({ color: 0x55667a, metalness: 0.9, roughness: 0.35 }),
      black: new THREE.MeshBasicMaterial({ color: 0x030405 }),
      hl: new THREE.MeshStandardMaterial({ color: 0xe9edf2, emissive: 0xffffff, emissiveIntensity: 0.45, metalness: 0.2, roughness: 0.3 }),
      line: new THREE.LineBasicMaterial({ color: 0x6b717c, transparent: true, opacity: 0.55 }),
      hlLine: new THREE.LineBasicMaterial({ color: 0xffffff }),
    };
    const owned: Owned[] = [];
    const brakeMats: { front: boolean; mat: THREE.MeshStandardMaterial }[] = [];

    function add(
      parent: THREE.Object3D,
      geo: THREE.BufferGeometry,
      part: Part,
      base: THREE.Material,
      opts: { lines?: THREE.BufferGeometry | false; brake?: boolean; front?: boolean } = {},
    ) {
      let material = base;
      if (opts.brake) {
        const m = new THREE.MeshStandardMaterial({ color: 0x2a1a14, emissive: 0xff5a1f, emissiveIntensity: 0, metalness: 0.6, roughness: 0.4 });
        brakeMats.push({ front: !!opts.front, mat: m });
        material = m;
      }
      const mesh = new THREE.Mesh(geo, material);
      const lines = new THREE.LineSegments(opts.lines === false ? new THREE.BufferGeometry() : (opts.lines ?? new THREE.EdgesGeometry(geo, 35)), mats.line);
      mesh.add(lines);
      parent.add(mesh);
      owned.push({ mesh, lines, part, base: material, glow: opts.brake });
      return mesh;
    }

    // --- car ---------------------------------------------------------------------
    const car = new THREE.Group();
    scene.add(car);
    const body = new THREE.Group(); // sprung mass: moves with ride height, pitch and roll
    car.add(body);

    add(body, loft(BODY), "body", mats.paint, { lines: false });
    for (const side of [1, -1] as const) {
      add(body, loft(sidepod(side), 32, 6), "body", mats.paint, { lines: false });
      // Mirrors on stalks.
      add(body, tube([[1.2, 0.5, side * 0.33], [1.21, 0.57, side * 0.4], [1.22, 0.62, side * 0.45]], 0.012), "body", mats.carbon, { lines: false });
      const mirror = new THREE.SphereGeometry(0.06, 16, 10);
      mirror.scale(0.6, 0.55, 1.2);
      add(body, mirror, "body", mats.carbon, { lines: false }).position.set(1.22, 0.64, side * 0.47);
    }
    add(body, planPlate(FLOOR, 0.025, 0.05), "floor", mats.carbon);

    // Cockpit: rim, opening and the driver's helmet.
    const rimCurve = new THREE.EllipseCurve(0, 0, 0.36, 0.25, 0, Math.PI * 2, false, 0);
    const rimPts = rimCurve.getPoints(48).slice(0, -1).map((p) => new THREE.Vector3(0.88 + p.x, 0.6, p.y));
    add(body, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(rimPts, true), 64, 0.025, 8, true), "body", mats.carbon, { lines: false });
    const opening = new THREE.CircleGeometry(1, 40);
    opening.scale(0.35, 0.24, 1);
    opening.rotateX(-Math.PI / 2);
    add(body, opening, "body", mats.black, { lines: false }).position.set(0.88, 0.605, 0);
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.125, 24, 18), mats.helmet);
    helmet.position.set(0.78, 0.71, 0);
    body.add(helmet);
    const visor = new THREE.Mesh(new THREE.SphereGeometry(0.127, 24, 12, -Math.PI / 2.6, Math.PI / 1.3, Math.PI / 2.9, Math.PI / 5), mats.visor);
    visor.rotation.y = Math.PI / 2;
    visor.position.copy(helmet.position);
    body.add(visor);
    // Halo.
    for (const side of [1, -1] as const) add(body, tube(haloHalf(side), 0.028), "body", mats.carbon, { lines: false });
    // Airbox intake above the driver.
    const intake = new THREE.CircleGeometry(1, 24);
    intake.scale(0.09, 0.07, 1);
    intake.rotateY(Math.PI / 2);
    add(body, intake, "body", mats.black, { lines: false }).position.set(0.3, 0.86, 0);

    // Front wing: four elements whose outer thirds sweep up (the flaps tilt together), endplates,
    // the nose pylons and the wake deflectors over the front wheels.
    const element = (parent: THREE.Object3D, part: Part, chord: number, span: number, mat: THREE.Material, x: number, y: number) => {
      const mid = span * 0.36;
      const out = (span - mid) / 2;
      add(parent, wing(chord, mid + 0.02, 0.09, 0.045), part, mat).position.set(x, y, 0);
      for (const side of [1, -1]) {
        // The tip hinges on the edge of the middle piece, so the element stays one surface.
        const hinge = new THREE.Group();
        hinge.position.set(x, y, side * (mid / 2));
        hinge.rotation.x = side * 0.16;
        parent.add(hinge);
        add(hinge, wing(chord, out, 0.09, 0.045), part, mat).position.z = side * (out / 2);
      }
    };
    element(body, "front_wing", 0.42, 2.0, mats.carbon, 3.55, 0.06);
    for (const side of [1, -1]) add(body, plate(FRONT_ENDPLATE, 0.014), "front_wing", mats.livery).position.z = side * 1.0;
    const frontFlap = new THREE.Group();
    frontFlap.position.set(3.14, 0.12, 0);
    body.add(frontFlap);
    element(frontFlap, "front_flap", 0.22, 1.96, mats.carbon, 0, 0);
    element(frontFlap, "front_flap", 0.17, 1.94, mats.carbon, -0.18, 0.07);
    element(frontFlap, "front_flap", 0.13, 1.92, mats.carbon, -0.31, 0.13);
    for (const side of [1, -1]) add(body, tube([[3.0, 0.22, side * 0.05], [3.08, 0.15, side * 0.08], [3.16, 0.09, side * 0.1]], 0.012), "front_wing", mats.carbon, { lines: false });
    for (const side of [1, -1]) {
      const d = add(body, wing(0.36, 0.26, 0.12, 0.08), "body", mats.carbon, { lines: false });
      d.position.set(WB_F + 0.2, 0.71, side * (TRACK - 0.12));
      d.rotation.set(side * 0.45, 0, -0.1);
    }
    // Floor edges.
    for (const side of [1, -1]) add(body, plate([[1.0, 0.075], [-0.9, 0.075], [-0.9, 0.12], [1.0, 0.1]], 0.01), "floor", mats.carbon, { lines: false }).position.z = side * 0.79;

    // Rear wing: main plane, a flap above it, endplates, beam wing and pylon.
    add(body, wing(0.4, 1.0, 0.12, 0.06), "rear_wing", mats.carbon).position.set(-2.22, 0.84, 0);
    for (const side of [1, -1]) add(body, plate(REAR_ENDPLATE, 0.014), "rear_wing", mats.livery).position.z = side * 0.505;
    // A red fin on the engine cover, like a livery.
    add(body, plate([[-0.1, 0.88], [-1.45, 0.64], [-1.5, 0.7], [0.05, 0.95]], 0.012), "body", mats.livery, { lines: false });
    // Beam wing: two small elements low between the endplates.
    add(body, wing(0.18, 0.9, 0.12, 0.05), "rear_wing", mats.carbon).position.set(-2.12, 0.42, 0);
    add(body, wing(0.14, 0.9, 0.12, 0.05), "rear_wing", mats.carbon).position.set(-2.3, 0.5, 0);
    add(body, tube([[-2.15, 0.36, 0], [-2.3, 0.62, 0], [-2.36, 0.83, 0]], 0.022), "rear_wing", mats.carbon, { lines: false });
    const rearFlap = new THREE.Group();
    rearFlap.position.set(-2.48, 0.98, 0);
    body.add(rearFlap);
    add(rearFlap, wing(0.22, 0.98, 0.1, 0.05), "rear_flap", mats.carbon);

    // Differential (inside the gearbox).
    const diff = new THREE.CylinderGeometry(0.11, 0.11, 0.2, 20);
    diff.rotateX(Math.PI / 2);
    add(body, diff, "diff", mats.metal).position.set(WB_R, 0.3, 0);

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
        add(spin, tyre(width), front ? "tyres_front" : "tyres_rear", mats.rubber, { lines: false });
        // Compound band on the outer sidewall.
        const band = new THREE.Mesh(new THREE.RingGeometry(0.295, 0.31, 56), mats.stripe);
        band.position.z = side * (width / 2 + 0.001);
        if (side < 0) band.rotation.y = Math.PI;
        spin.add(band);
        // Rim and wheel cover, with marks so rolling shows.
        const barrel = new THREE.CylinderGeometry(RIM, RIM, width - 0.02, 40, 1, true);
        barrel.rotateX(Math.PI / 2);
        add(spin, barrel, front ? "wheels_front" : "wheels_rear", mats.rim, { lines: false });
        const c = add(spin, new THREE.CircleGeometry(RIM, 40), front ? "wheels_front" : "wheels_rear", mats.cover, { lines: false });
        c.position.z = side * (width / 2 - 0.02);
        if (side < 0) c.rotation.y = Math.PI;
        for (let k = 0; k < 3; k++) {
          const mark = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.018, 0.004), mats.stripe);
          const ang = (k * Math.PI * 2) / 3;
          mark.position.set(Math.cos(ang) * 0.17, Math.sin(ang) * 0.17, side * (width / 2 - 0.015));
          mark.rotation.z = ang;
          spin.add(mark);
        }
        const nut = new THREE.CylinderGeometry(0.035, 0.035, 0.03, 12);
        nut.rotateX(Math.PI / 2);
        add(spin, nut, front ? "wheels_front" : "wheels_rear", mats.metal, { lines: false }).position.z = side * (width / 2 - 0.01);
        // Brake disc inside the rim.
        const disc = new THREE.CylinderGeometry(0.17, 0.17, 0.03, 28);
        disc.rotateX(Math.PI / 2);
        add(camber, disc, front ? "brakes_front" : "brakes_rear", mats.metal, { brake: true, front, lines: false }).position.z = -side * 0.06;
        wheels.push({ group, camber, spin, front, side });
      }
    }

    // --- suspension, re-placed every frame so it follows the body and the wheels ---
    const links: Link[] = [];
    const rod = new THREE.CylinderGeometry(0.014, 0.014, 1, 8);
    const coilCurve = new THREE.CatmullRomCurve3(
      Array.from({ length: 140 }, (_, i) => {
        const ang = (i / 139) * Math.PI * 2 * 8;
        return new THREE.Vector3(Math.cos(ang) * 0.045, i / 139 - 0.5, Math.sin(ang) * 0.045);
      }),
    );
    const coil = new THREE.TubeGeometry(coilCurve, 280, 0.007, 6, false);
    wheels.forEach((w, i) => {
      const fx = w.front ? 1 : -1;
      const x = w.front ? WB_F : WB_R;
      const armPart: Part = w.front ? "arms_front" : "arms_rear";
      // Upper and lower wishbones from the tub to the upright.
      for (const [y, dy] of [[0.46, 0.12], [0.2, -0.12]] as const) {
        for (const dx of [0.28, -0.22]) {
          links.push({ mesh: add(body, rod, armPart, mats.carbon, { lines: false }), inboard: new THREE.Vector3(x + dx * fx, y, w.side * 0.24), wheel: i, outboard: new THREE.Vector3(0, dy, -w.side * 0.13) });
        }
      }
      // Pushrod to the rocker, and the spring inside the body.
      links.push({ mesh: add(body, rod, armPart, mats.carbon, { lines: false }), inboard: new THREE.Vector3(x - 0.12 * fx, 0.5, w.side * 0.16), wheel: i, outboard: new THREE.Vector3(0, -0.11, -w.side * 0.14) });
      links.push({ mesh: add(body, coil, w.front ? "springs_front" : "springs_rear", mats.metal, { lines: false }), inboard: new THREE.Vector3(x - 0.12 * fx, 0.5, w.side * 0.05), wheel: i, outboard: new THREE.Vector3(-0.12 * fx, 0.16, -w.side * 0.62) });
    });
    for (const front of [true, false]) {
      const x = (front ? WB_F : WB_R) + (front ? -0.12 : 0.12);
      const bar = new THREE.CylinderGeometry(0.022, 0.022, 0.36, 10);
      bar.rotateX(Math.PI / 2);
      add(body, bar, front ? "arb_front" : "arb_rear", mats.metal, { lines: false }).position.set(x, 0.5, 0);
      for (const side of [1, -1]) {
        add(body, new THREE.BoxGeometry(0.13, 0.025, 0.025), front ? "arb_front" : "arb_rear", mats.metal, { lines: false }).position.set(x + (front ? 0.05 : -0.05), 0.5, side * 0.18);
      }
    }
    for (const side of [1, -1]) {
      const wi = wheels.findIndex((w) => !w.front && w.side === side);
      links.push({ mesh: add(body, rod, "diff", mats.metal, { lines: false }), inboard: new THREE.Vector3(WB_R, 0.3, side * 0.1), wheel: wi, outboard: new THREE.Vector3(0, 0, -side * 0.1) });
    }

    const up = new THREE.Vector3(0, 1, 0);
    const pa = new THREE.Vector3();
    const pb = new THREE.Vector3();
    const dir = new THREE.Vector3();
    const inv = new THREE.Matrix4();
    function placeLinks() {
      body.updateMatrixWorld(true);
      inv.copy(body.matrixWorld).invert();
      for (const l of links) {
        pa.copy(l.inboard); // already in body space
        pb.copy(wheels[l.wheel].group.position).add(l.outboard).applyMatrix4(inv);
        dir.copy(pb).sub(pa);
        const len = dir.length();
        l.mesh.position.copy(pa).add(pb).multiplyScalar(0.5);
        l.mesh.quaternion.setFromUnitVectors(up, dir.normalize());
        l.mesh.scale.set(1, Math.max(0.05, len), 1);
      }
    }

    // --- focus, highlight and camera --------------------------------------------
    let focus: Focus = FOCUS.overview;
    let focusStart = performance.now();
    let biasValue: number | null = null;
    let focusKey = "overview";
    let shown: ViewerSetting | null = null;
    // Where a value sits in its range, 0..1, flipped for settings that act the other way round.
    const norm = (v: number | null | undefined): number | null => {
      const r = shown?.range;
      if (v == null || !r || r[1] === r[0]) return null;
      const n = Math.min(1, Math.max(0, (v - r[0]) / (r[1] - r[0])));
      return INVERTED.has(focusKey) ? 1 - n : n;
    };
    const pivot = new THREE.Vector3(0, 0.35, 0);
    const camTarget = new THREE.Vector3(...focus.target);
    const sph = new THREE.Spherical().setFromVector3(new THREE.Vector3(...focus.cam).sub(pivot));
    let userYaw = 0;

    function applyHighlight() {
      const lit = new Set(focus.parts);
      for (const o of owned) {
        if (o.retired) {
          o.mesh.visible = false;
          continue;
        }
        const on = lit.has(o.part);
        o.mesh.material = on && !o.glow ? mats.hl : o.base;
        o.lines.material = on ? mats.hlLine : mats.line;
        o.mesh.visible = !INTERNAL.includes(o.part) || !!focus.xray || on;
      }
      // See-through bodywork, so the parts inside show.
      for (const m of [mats.paint, mats.carbon, mats.livery]) {
        m.opacity = focus.xray ? 0.16 : 1;
        m.depthWrite = !focus.xray;
      }
      helmet.visible = visor.visible = !focus.xray && !realLoaded;
      mats.line.opacity = focus.xray ? 0.35 : 0.55;
    }

    // --- the licensed model, when the server has it: it replaces the car built in code ---
    let realLoaded = false;
    let disposed = false;
    const realFrontWing = new THREE.Group();
    const realRearFlap = new THREE.Group();
    const REPLACED: Part[] = ["body", "front_wing", "front_flap", "rear_wing", "rear_flap", "floor", "tyres_front", "tyres_rear", "wheels_front", "wheels_rear", "arms_front", "arms_rear"];
    const realMat: Record<string, THREE.Material> = {
      chassis: mats.paint, coler: mats.livery, carbon_fiber: mats.carbon, tier: mats.rubber, chrome: mats.metal, mirror: mats.metal, glass: mats.black,
    };
    const own = (mesh: THREE.Mesh, part: Part) => {
      const lines = new THREE.LineSegments(new THREE.BufferGeometry(), mats.line);
      mesh.add(lines);
      owned.push({ mesh, lines, part, base: mesh.material as THREE.Material });
    };
    function attachReal(model: THREE.Group) {
      if (disposed) return;
      const parts = new Map<string, THREE.Mesh[]>();
      const real = new Set<THREE.Object3D>();
      model.updateMatrixWorld(true);
      model.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        // Node names are "<part>:<material>", but three.js drops the ":" from names.
        const hit = /^(.*?):?(chassis|coler|carbon_fiber|tier|chrome|mirror|glass)$/.exec(m.name);
        if (!hit) return;
        const [, part, matName] = hit;
        // Meshopt stores positions and normals as quantised integers: back to floats before moving them.
        const geo = new THREE.BufferGeometry();
        for (const key of ["position", "normal"] as const) {
          const a = m.geometry.getAttribute(key);
          if (!a) continue;
          const f = new Float32Array(a.count * 3);
          for (let i = 0; i < a.count; i++) {
            f[i * 3] = a.getX(i);
            f[i * 3 + 1] = a.getY(i);
            f[i * 3 + 2] = a.getZ(i);
          }
          geo.setAttribute(key, new THREE.BufferAttribute(f, 3));
        }
        if (m.geometry.index) geo.setIndex(Array.from(m.geometry.index.array as ArrayLike<number>));
        geo.applyMatrix4(m.matrixWorld);
        if (!geo.getAttribute("normal")) geo.computeVertexNormals();
        const mesh = new THREE.Mesh(geo, realMat[matName] ?? mats.carbon);
        real.add(mesh);
        (parts.get(part) ?? parts.set(part, []).get(part)!).push(mesh);
      });
      if (!parts.size) return;
      for (const o of owned) if (REPLACED.includes(o.part)) o.retired = true;
      const into = (group: THREE.Object3D, name: string, part: Part, at?: THREE.Vector3) => {
        for (const mesh of parts.get(name) ?? []) {
          if (at) mesh.geometry.translate(-at.x, -at.y, -at.z);
          group.add(mesh);
          own(mesh, part);
        }
      };
      ["body", "floor", "rear_wing", "arms_front", "arms_rear"].forEach((n) => into(body, n, (n === "body" ? "body" : n) as Part));
      // The front wing and the rear flap tilt about their leading edges.
      realFrontWing.position.set(3.05, 0.1, 0);
      body.add(realFrontWing);
      into(realFrontWing, "front_wing", "front_wing", realFrontWing.position);
      const flapBox = new THREE.Box3();
      (parts.get("rear_flap") ?? []).forEach((m) => flapBox.expandByObject(m));
      const flapAt = flapBox.isEmpty() ? new THREE.Vector3(-2.4, 0.95, 0) : flapBox.getCenter(new THREE.Vector3());
      realRearFlap.position.copy(flapAt);
      body.add(realRearFlap);
      into(realRearFlap, "rear_flap", "rear_flap", flapAt);
      // Each wheel goes on its corner's spinner, at the model's own axle positions.
      for (const w of wheels) {
        const corner = `${w.front ? "F" : "R"}${w.side < 0 ? "L" : "R"}`;
        const box = new THREE.Box3();
        for (const k of ["tyre", "rim"]) (parts.get(`wheel_${corner}_${k}`) ?? []).forEach((m) => box.expandByObject(m));
        if (box.isEmpty()) continue;
        const c = box.getCenter(new THREE.Vector3());
        w.group.position.set(c.x, c.y, c.z);
        into(w.spin, `wheel_${corner}_tyre`, w.front ? "tyres_front" : "tyres_rear", c);
        into(w.spin, `wheel_${corner}_rim`, w.front ? "wheels_front" : "wheels_rear", c);
        into(w.camber, `wheel_${corner}_brake`, w.front ? "wheels_front" : "wheels_rear", c);
      }
      // The code-built wheels' marks, bands and nuts go too; the brake discs stay for the x-ray views.
      for (const w of wheels) for (const c of [...w.spin.children]) if (!real.has(c)) c.visible = false;
      realLoaded = true;
      applyHighlight();
    }
    credentialsRef.current().then((creds) => loadRealCar(creds)).then((m) => m && attachReal(m));

    api.current = {
      setFocus(k: string) {
        focus = FOCUS[k] ?? FOCUS.overview;
        focusKey = k;
        focusStart = performance.now();
        userYaw = 0;
        applyHighlight();
      },
      setBias(v) {
        biasValue = v;
      },
      setSetting(v) {
        shown = v;
        focusStart = performance.now();
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
      camera.fov = camera.aspect < 1 ? 52 : 34; // narrow screens: see the whole part
      camera.updateProjectionMatrix();
    }
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    // --- animation loop ------------------------------------------------------------
    let last = performance.now();
    let raf = 0;
    const desired = new THREE.Spherical();
    const want = new THREE.Vector3();
    const shortest = (x: number, y: number) => {
      let d = y - x;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      return d;
    };

    function frame(now: number) {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const t = (now - focusStart) / 1000;
      const wave = (Math.sin(t * 1.6 - Math.PI / 2) + 1) / 2; // 0..1, starting at 0
      // With the player's value the part sits where their setup puts it; with a suggestion
      // it moves between the two, so the change can be seen. Without either, the generic swing.
      const mine = norm(shown?.value);
      const sug = norm(shown?.suggested);
      const s = mine == null ? (Math.sin(t * 2.4 - Math.PI / 2) + 1) / 2 : sug == null || Math.abs(sug - mine) < 0.005 ? mine + Math.sin(t * 2) * 0.02 : mine + (sug - mine) * wave;
      const k = 1 - Math.exp(-dt * 3.2);

      // Camera: swing round the car in spherical coordinates, like a turntable.
      desired.setFromVector3(want.set(...focus.cam).sub(pivot));
      desired.theta += userYaw + Math.sin(now / 4000) * 0.06;
      sph.radius += (desired.radius - sph.radius) * k;
      sph.phi += (desired.phi - sph.phi) * k;
      sph.theta += shortest(sph.theta, desired.theta) * k;
      camTarget.lerp(want.set(...focus.target), k);
      camera.position.setFromSpherical(sph).add(pivot);
      camera.lookAt(camTarget);

      // Reset the pose, then act out the focused setting.
      body.position.y = 0;
      body.rotation.set(0, 0, 0);
      frontFlap.rotation.z = -0.32;
      rearFlap.rotation.z = -0.45;
      for (const w of wheels) {
        w.group.rotation.y = 0;
        w.camber.rotation.x = w.side * 0.03;
        w.spin.scale.set(1, 1, 1);
      }
      for (const bm of brakeMats) bm.mat.emissiveIntensity = 0;

      // The chosen part breathes, so it reads as selected from any angle.
      mats.hl.emissiveIntensity = 0.32 + 0.22 * (Math.sin(now / 420) + 1) / 2;
      const anim = focus.anim;
      if (anim === "wing_front") frontFlap.rotation.z = -0.12 - s * 0.5;
      if (anim === "wing_rear") rearFlap.rotation.z = -0.15 - s * 0.65;
      if (anim === "camber_front" || anim === "camber_rear") {
        for (const w of wheels) if (w.front === (anim === "camber_front")) w.camber.rotation.x = w.side * (0.04 + s * 0.2);
      }
      if (anim === "toe_front" || anim === "toe_rear") {
        for (const w of wheels) {
          if (w.front !== (anim === "toe_front")) continue;
          // Front: toe-out (the fronts of the wheels open); rear: toe-in.
          w.group.rotation.y = (w.front ? -w.side : w.side) * s * 0.26;
        }
      }
      if (anim === "spring_front") {
        body.rotation.z = -s * 0.03;
        body.position.y = -s * 0.02;
      }
      if (anim === "spring_rear") {
        body.rotation.z = s * 0.03;
        body.position.y = -s * 0.02;
      }
      if (anim === "roll") body.rotation.x = Math.sin(t * 2.4) * (mine == null ? 0.05 : 0.012 + s * 0.06);
      if (anim === "height_front") {
        body.rotation.z = (s - 0.5) * 0.045;
        body.position.y = (s - 0.5) * 0.04;
      }
      if (anim === "height_rear") {
        body.rotation.z = -(s - 0.5) * 0.045;
        body.position.y = (s - 0.5) * 0.04;
      }
      if (anim === "brake_pressure") for (const bm of brakeMats) bm.mat.emissiveIntensity = s * 2.2;
      if (anim === "brake_bias") {
        const front = (biasValue ?? 57) / 100;
        for (const bm of brakeMats) bm.mat.emissiveIntensity = (bm.front ? front : 1 - front) * 2.8 * (0.55 + 0.45 * s);
      }
      if (anim === "engine_brake") for (const bm of brakeMats) if (!bm.front) bm.mat.emissiveIntensity = s * 1.6;
      if (anim === "tyre_front" || anim === "tyre_rear") {
        for (const w of wheels) if (w.front === (anim === "tyre_front")) w.spin.scale.set(1 + s * 0.05, 1 + s * 0.05, 1);
      }
      if (anim === "diff" || anim === "engine_brake" || anim === "brake_pressure") {
        for (const w of wheels) {
          // Diff: in a corner the outer rear wheel turns faster than the inner one.
          // A more open diff (lower %) lets them differ more.
          const split = mine == null ? 1 : 0.15 + s * 1.2;
          const rate = anim === "diff" && !w.front ? 5.75 + (w.side > 0 ? 1 : -1) * 1.25 * split : 5;
          w.spin.rotation.z -= rate * dt;
        }
      }

      realFrontWing.rotation.z = (frontFlap.rotation.z + 0.32) * 0.35;
      realRearFlap.rotation.z = (rearFlap.rotation.z + 0.45) * 0.8;
      placeLinks();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onDown);
      renderer.domElement.removeEventListener("pointermove", onMove);
      renderer.domElement.removeEventListener("pointerup", onUp);
      renderer.domElement.removeEventListener("pointercancel", onUp);
      scene.traverse((o) => {
        (o as THREE.Mesh).geometry?.dispose?.();
      });
      Object.values(mats).forEach((m) => m.dispose());
      brakeMats.forEach((bm) => bm.mat.dispose());
      shadowTex.dispose();
      floorTex.dispose();
      env.dispose();
      pmrem.dispose();
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

  const value = setting?.value ?? null;
  const suggested = setting?.suggested ?? null;
  const lo = setting?.range?.[0];
  const hi = setting?.range?.[1];
  useEffect(() => {
    api.current?.setSetting(value == null && suggested == null ? null : { value, suggested, range: lo != null && hi != null ? [lo, hi] : undefined });
  }, [value, suggested, lo, hi, focus]);

  return <div ref={host} className="h-full w-full cursor-grab active:cursor-grabbing" aria-label="Monoplaza en 3D" role="img" />;
}
