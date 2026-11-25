// The intro's scene, rendered offline into a video (render/intro.html + scripts/render-intro.js).
// Deterministic: every frame is a function of the time, so frames can be blended into motion blur.
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { loadCar } from "./realcar.js";

function asphalt() {
  const c = document.createElement("canvas");
  c.width = c.height = 512;
  const g = c.getContext("2d");
  g.fillStyle = "#3a3c41";
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


// A telephoto shot from the outside of a long, fast corner: a train of cars comes from far away
// towards the lens, the long lens compressing them into a column, until the leader fills the frame.
export async function buildScene(canvas, W, H) {
  const portrait = H > W;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.35;

  const scene = new THREE.Scene();
  scene.background = sky();
  scene.fog = new THREE.Fog(0x1a1e2a, 60, 320); // floodlit haze: the far cars fade in
  const camera = new THREE.PerspectiveCamera(portrait ? 22 : 13, W / H, 0.5, 2000);

  scene.add(new THREE.HemisphereLight(0xb4bfd8, 0x2a2c33, 2.4));
  const key = new THREE.DirectionalLight(0xffffff, 3.6);
  key.position.set(200, 120, 260);
  scene.add(key);
  const warm = new THREE.DirectionalLight(0xffd8c0, 0.6);
  warm.position.set(-300, 60, -100);
  scene.add(warm);

  // The corner: centre of curvature at the origin, radius 300 m, 15 m wide.
  const RC = 300, IN = RC - 7.5, OUT = RC + 7.5;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), new THREE.MeshStandardMaterial({ color: 0x1a3a2a, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.02;
  scene.add(ground);
  const tex = asphalt();
  scene.add(new THREE.Mesh(band(IN, OUT, -1.6, 0.4, 0, 900, 6), new THREE.MeshStandardMaterial({ map: tex, color: 0xb4b4b4, roughness: 0.6, metalness: 0.05 })));
  const lineMat = new THREE.MeshStandardMaterial({ color: 0xd8d8d8, roughness: 0.7 });
  scene.add(new THREE.Mesh(band(OUT - 0.35, OUT - 0.1, -1.6, 0.4, 0.01, 900), lineMat));
  scene.add(new THREE.Mesh(band(IN + 0.1, IN + 0.35, -1.6, 0.4, 0.01, 900), lineMat));
  // Red and white kerb on the inside, and a dark green run-off outside.
  const red = new THREE.MeshStandardMaterial({ color: 0x9a1c13, roughness: 0.8 });
  const white = new THREE.MeshStandardMaterial({ color: 0x9a9a9a, roughness: 0.8 });
  const step = 1.6 / IN;
  for (let i = 0, a = -1.4; a < 0.3; i++, a += step) scene.add(new THREE.Mesh(band(IN - 1.3, IN, a, a + step, 0.03, 1), i % 2 ? red : white));
  scene.add(new THREE.Mesh(band(OUT, OUT + 12, -1.6, 0.4, 0.005, 400), new THREE.MeshStandardMaterial({ color: 0x24523b, roughness: 1 })));
  // A wall with floodlights along the outside.
  scene.add(new THREE.Mesh(band(OUT + 12, OUT + 12.4, -1.6, 0.4, 0.6, 400), new THREE.MeshStandardMaterial({ color: 0x1d2a44, roughness: 0.8 })));
  // A grandstand and catch fence across the back, so the skyline is the circuit, not the night.
  const stand = (r, h, color) => {
    const g = new THREE.CylinderGeometry(r, r, h, 300, 1, true, Math.PI / 2 - 0.4, 2.0);
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color, roughness: 0.9, side: THREE.DoubleSide }));
    m.position.y = h / 2;
    scene.add(m);
  };
  stand(OUT + 16, 3.2, 0x2a3b5c);
  stand(OUT + 45, 16, 0x1b2233);
  const crowd = new THREE.MeshStandardMaterial({ color: 0x2a3147, roughness: 1 });
  for (let a = -1.5; a < 0.35; a += 0.0105) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(3.4, 5, 0.4), crowd);
    m.position.set((OUT + 44) * Math.cos(a), 9 + (Math.sin(a * 97) > 0 ? 0.6 : 0), (OUT + 44) * Math.sin(a));
    m.lookAt(0, m.position.y, 0);
    scene.add(m);
  }
  const lamp = new THREE.MeshBasicMaterial({ color: 0xfff1dc });
  for (let a = -1.4; a < 0.3; a += 0.05) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.7, 0.3), lamp);
    m.position.set((OUT + 46) * Math.cos(a), 22, (OUT + 46) * Math.sin(a));
    m.lookAt(0, 22, 0);
    scene.add(m);
  }

  const liveries = [
    { body: 0xd8301c, accent: 0x15171b },
    { body: 0xe9ecef, accent: 0xff4b2b },
    { body: 0x13606e, accent: 0x3ddc97 },
    { body: 0x23272e, accent: 0xff4b2b },
  ];
  const built = await Promise.all(liveries.map((l) => loadCar(l)));
  const SPEED = 62 / RC; // rad/s, about 220 km/h
  const cars = built.map((c, i) => {
    scene.add(c.car);
    return { ...c, a0: -0.85 - i * 0.075, last: i === built.length - 1, r: [RC + 1.2, RC - 1.4, RC + 2.4, RC - 0.4][i], weave: i * 1.7 };
  });

  // The camera stands just inside the kerb, a long lens looking up the corner at the oncoming cars.
  const camA = 0.0, camR = IN - 2.5;
  const camBase = new THREE.Vector3(camR * Math.cos(camA), 1.1, camR * Math.sin(camA));
  const look = new THREE.Vector3(RC * Math.cos(-0.2), -0.55, RC * Math.sin(-0.2));

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(W, H), 0.45, 0.4, 0.93));
  composer.addPass(new OutputPass());

  return function renderAt(t) {
    // A locked-off camera. Each car that goes by shakes it a little; the last one the most.
    let shake = 0;
    for (const c of cars) {
      const a = c.a0 + SPEED * t;
      const r = c.r + Math.sin(t * 1.3 + c.weave) * 0.4; // drivers moving on the line
      c.car.visible = a < camA + 0.03;
      c.car.position.set(r * Math.cos(a), 0, r * Math.sin(a));
      c.car.rotation.y = Math.atan2(-Math.cos(a), -Math.sin(a)) - 0.02;
      for (const s of c.spinners) s.rotation.z = -t * 172; // 62 m/s on a 0.36 m tyre
      const d = Math.abs(a - camA) * RC; // metres along the track from the camera
      shake = Math.max(shake, Math.exp(-d / 7) * (c.last ? 1 : 0.55));
    }
    camera.position.copy(camBase);
    camera.position.y += (Math.sin(t * 53) * 0.6 + Math.sin(t * 91) * 0.4) * 0.03 * shake;
    camera.position.x += Math.sin(t * 67) * 0.03 * shake;
    camera.lookAt(look);
    camera.rotateZ((Math.sin(t * 71) * 0.6 + Math.sin(t * 43) * 0.4) * 0.012 * shake);
    composer.render();
  };
}
