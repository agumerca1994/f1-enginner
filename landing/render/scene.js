// The intro's scene, rendered offline into a video (render/intro.html + scripts/render-intro.js).
// Deterministic: every frame is a function of the time, so frames can be blended into motion blur.
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { buildCar } from "./car3d.js";

function asphalt() {
  const c = document.createElement("canvas");
  c.width = c.height = 512;
  const g = c.getContext("2d");
  g.fillStyle = "#141518";
  g.fillRect(0, 0, 512, 512);
  const img = g.getImageData(0, 0, 512, 512);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 34;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n + 2;
  }
  g.putImageData(img, 0, 0);
  // Rubber laid on the racing line.
  g.fillStyle = "rgba(0,0,0,0.25)";
  g.fillRect(180, 0, 150, 512);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function sky() {
  const c = document.createElement("canvas");
  c.width = 2; c.height = 256;
  const g = c.getContext("2d");
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, "#03040a");
  grad.addColorStop(0.5, "#0c1222");
  grad.addColorStop(0.78, "#26283a");
  grad.addColorStop(1, "#4a3536");
  g.fillStyle = grad;
  g.fillRect(0, 0, 2, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A ring segment on the ground, angles in the x-z plane (x = r cos θ, z = r sin θ). */
function band(r1, r2, a0, a1, y, segs = 48, uvScale = 0) {
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= segs; i++) {
    const a = a0 + ((a1 - a0) * i) / segs;
    for (const r of [r1, r2]) {
      const x = r * Math.cos(a), z = r * Math.sin(a);
      pos.push(x, y, z);
      uv.push(uvScale ? x / uvScale : i / segs, uvScale ? z / uvScale : r === r1 ? 0 : 1);
    }
  }
  for (let i = 0; i < segs; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // Face up: flip the winding if the normals came out pointing down.
  if (g.attributes.normal.getY(0) < 0) {
    for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
    g.setIndex(idx);
    g.computeVertexNormals();
  }
  return g;
}


export function buildScene(canvas, W, H) {
  const portrait = H > W;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;

  const scene = new THREE.Scene();
  scene.background = sky();
  scene.fog = new THREE.Fog(0x141722, 40, 140);
  const camera = new THREE.PerspectiveCamera(portrait ? 72 : 52, W / H, 0.05, 400);
  // Floodlit night: a cool sky fill, a high key light and warm light from the stands.
  scene.add(new THREE.HemisphereLight(0x8a96b8, 0x15161a, 0.9));
  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  key.position.set(14, 30, -10);
  scene.add(key);
  const warm = new THREE.DirectionalLight(0xffb48a, 1.6);
  warm.position.set(40, 6, -30);
  scene.add(warm);
  // Light from the camera's side, so the cars read as shapes, not silhouettes.
  const fill = new THREE.DirectionalLight(0xdde6ff, 2.2);
  fill.position.set(-6, 5, 8);
  scene.add(fill);

  // The corner: asphalt, the red and white kerb at the apex, white edge lines, dark run-off.
  const tex = asphalt();
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshStandardMaterial({ color: 0x050607, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.01;
  scene.add(ground);
  const road = new THREE.Mesh(band(20.4, 32, -Math.PI, Math.PI, 0, 160, 6), new THREE.MeshStandardMaterial({ map: tex, color: 0x777777, roughness: 0.95, metalness: 0 }));
  scene.add(road);
  scene.add(new THREE.Mesh(band(31.7, 31.95, -Math.PI, Math.PI, 0.004, 160), new THREE.MeshStandardMaterial({ color: 0x9c9c9c, roughness: 0.8 })));
  const red = new THREE.MeshStandardMaterial({ color: 0x8e1a12, roughness: 0.85 });
  const white = new THREE.MeshStandardMaterial({ color: 0x8f8f8f, roughness: 0.85 });
  const step = 1.1 / 20; // ~1.1 m per kerb block
  for (let i = 0, a = -Math.PI; a < Math.PI; i++, a += step) {
    const k = new THREE.Mesh(band(19.3, 20.4, a, a + step, 0.035, 2), i % 2 ? red : white);
    scene.add(k);
  }
  // Floodlight towers far away: glowing dots the bloom turns into lamps.
  const lamp = new THREE.MeshBasicMaterial({ color: 0xfff1dc });
  for (let i = 0; i < 14; i++) {
    const a = -1.0 + i * 0.13, r = 95;
    const m = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.5, 0.2), lamp);
    m.position.set(r * Math.cos(a), 18, r * Math.sin(a));
    m.lookAt(0, 18, 0);
    scene.add(m);
  }

  // Three cars, three liveries: the app's red, white and a cold teal.
  const liveries = [
    { body: 0xd8301c, accent: 0x15171b, helmet: 0xf2f3f5 },
    { body: 0xe9ecef, accent: 0xff4b2b, helmet: 0x15171b },
    { body: 0x13606e, accent: 0x3ddc97, helmet: 0xf2f3f5 },
  ];
  const cars = liveries.map((l, i) => {
    const c = buildCar(l);
    c.car.visible = false;
    scene.add(c.car);
    return { ...c, start: 0.45 + i * 0.42, r: [21.4, 22.3, 21.8][i], dur: 1.0 - i * 0.05 };
  });

  // The camera sits on the kerb at the apex, a hand off the ground, looking across the corner.
  const camR = 18.85, camA = 0;
  const camBase = new THREE.Vector3(camR * Math.cos(camA), 0.16, camR * Math.sin(camA));
  const look = new THREE.Vector3(27 * Math.cos(-0.42), 0.42, 27 * Math.sin(-0.42));

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(W, H), 0.55, 0.4, 0.93));
  composer.addPass(new OutputPass());

  return function renderAt(t) {
    let shake = 0;
    let aim = null, aimW = 0;
    for (const c of cars) {
      const p = (t - c.start) / c.dur;
      c.car.visible = p > -0.05 && p < 1.05;
      if (!c.car.visible) continue;
      const a = -1.15 + p * 2.3;
      const x = c.r * Math.cos(a), z = c.r * Math.sin(a);
      const tx = -Math.sin(a), tz = Math.cos(a);
      c.car.position.set(x, 0, z);
      c.car.rotation.y = Math.atan2(-tz, tx) - 0.06;
      for (const s of c.spinners) s.rotation.z = -t * 150;
      const d = c.car.position.distanceTo(camBase);
      shake = Math.max(shake, Math.max(0, 1 - d / 9));
      // The camera operator follows the car that is closest, then lets it go.
      const w = Math.max(0, 1 - d / 16) ** 1.5;
      if (w > aimW) { aimW = w; aim = c.car.position.clone().add(new THREE.Vector3(0, 0.45, 0)); }
    }
    const drift = Math.min(1, t / 2.4);
    camera.position.copy(camBase);
    camera.position.y += Math.sin(t * 40) * 0.012 * shake;
    camera.position.x += Math.sin(t * 53) * 0.03 * shake;
    const target = look.clone();
    target.applyAxisAngle(new THREE.Vector3(0, 1, 0), drift * 0.12 + (portrait ? -0.05 : 0));
    if (aim) target.lerp(aim, Math.min(0.55, aimW * 0.7));
    target.y += Math.cos(t * 47) * 0.05 * shake;
    camera.lookAt(target);
    camera.rotateZ(Math.sin(t * 31) * 0.01 * shake);
    composer.render();
  };
}
