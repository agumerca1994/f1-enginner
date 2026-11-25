// The downloaded single-seater (assets-src/monoplaza, kept out of git by its license),
// loaded for the offline intro render. The model's forward is -z, so it is turned to face +x.
import * as THREE from "three";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";

const URL_OBJ = "./model/custom_f122.obj";
let source = null;

export async function loadCar({ body = 0xd8301c, accent = 0x15171b } = {}) {
  source ??= await new OBJLoader().loadAsync(URL_OBJ);
  const mats = {
    chassis: new THREE.MeshPhysicalMaterial({ color: body, metalness: 0.35, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.1 }),
    coler: new THREE.MeshPhysicalMaterial({ color: accent, metalness: 0.35, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.12 }),
    carbon_fiber: new THREE.MeshPhysicalMaterial({ color: 0x131417, metalness: 0.3, roughness: 0.45, clearcoat: 0.6 }),
    tier: new THREE.MeshStandardMaterial({ color: 0x101113, roughness: 0.9 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xb0b0b0, metalness: 1, roughness: 0.2 }),
    mirror: new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 1, roughness: 0.05 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x0c0c0c, roughness: 0.05 }),
  };
  const model = source.clone(true);
  const wheels = {}; // corner -> meshes that roll (tyre, rim, hub)
  model.traverse((m) => {
    if (!m.isMesh) return;
    const pick = (mm) => mats[mm.name] ?? mats.carbon_fiber;
    m.material = Array.isArray(m.material) ? m.material.map(pick) : pick(m.material);
    const corner = /^(?:Rim_|Cylinder_)?(FL|FR|RL|RR)$/.exec(m.name)?.[1];
    if (corner) (wheels[corner] ??= []).push(m);
  });
  // Re-pivot each wheel on its own centre so it can roll about its axle (x in model space).
  const spinners = [];
  for (const meshes of Object.values(wheels)) {
    const box = new THREE.Box3();
    meshes.forEach((m) => box.expandByObject(m));
    const c = box.getCenter(new THREE.Vector3());
    const spin = new THREE.Group();
    spin.position.copy(c);
    model.add(spin);
    for (const m of meshes) {
      m.geometry = m.geometry.clone();
      m.geometry.translate(-c.x, -c.y, -c.z);
      spin.add(m);
    }
    spinners.push(spin);
  }
  const box = new THREE.Box3().setFromObject(model);
  const car = new THREE.Group();
  model.rotation.y = Math.PI / 2; // nose (-z) towards +x, the direction of travel
  model.position.set(0, -box.min.y, 0);
  car.add(model);
  // The intro spins `rotation.z`; these wheels roll about the model's x axis.
  return { car, spinners: spinners.map((g) => ({ rotation: { set z(v) { g.rotation.x = v; } } })) };
}
