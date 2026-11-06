// Dungeon props: spike traps, breakable urns and the travelling merchant.
import * as THREE from 'three';
import { T } from './world.js';

const cache = {};
const once = (k, f) => cache[k] || (cache[k] = f());

export const TRAP_PERIOD = 3; // seconds per cycle
// Phase within a cycle: 0..1.6 hidden, 1.6..2.1 warning, 2.1..2.9 up, then retract.
export function trapState(t) {
  if (t < 1.6) return 'down';
  if (t < 2.1) return 'warn';
  if (t < 2.9) return 'up';
  return 'down';
}

export function makeTrap(x, z) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  const plate = new THREE.Mesh(
    once('plateGeo', () => new THREE.BoxGeometry(T * 0.92, 0.06, T * 0.92)),
    once('plateMat', () => new THREE.MeshStandardMaterial({ color: 0x3a3634, metalness: 0.5, roughness: 0.6 })),
  );
  plate.position.y = 0.03;
  const spikes = new THREE.Group();
  const spikeGeo = once('spikeGeo', () => new THREE.ConeGeometry(0.11, 0.7, 5));
  const spikeMat = once('spikeMat', () => new THREE.MeshStandardMaterial({ color: 0xc8ccd4, metalness: 0.9, roughness: 0.3 }));
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) {
      const s = new THREE.Mesh(spikeGeo, spikeMat);
      s.position.set((i - 1) * 0.55, 0.35, (j - 1) * 0.55);
      spikes.add(s);
    }
  spikes.position.y = -0.75;
  g.add(plate, spikes);
  return { mesh: g, spikes };
}

export function makeUrn(x, z, seed) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  const geo = once('urnGeo', () => {
    const pts = [
      [0.0, 0],
      [0.22, 0.02],
      [0.32, 0.2],
      [0.34, 0.42],
      [0.24, 0.66],
      [0.16, 0.76],
      [0.2, 0.84],
      [0.0, 0.84],
    ].map(([r, y]) => new THREE.Vector2(r, y));
    return new THREE.LatheGeometry(pts, 12);
  });
  const colors = [0xa8643a, 0x8a5a3a, 0x9a7a5a];
  const mat = once(`urnMat${seed % 3}`, () => new THREE.MeshStandardMaterial({ color: colors[seed % 3], roughness: 0.85 }));
  const m = new THREE.Mesh(geo, mat);
  m.rotation.y = seed;
  m.scale.setScalar(1 + (seed % 4) * 0.08);
  g.add(m);
  return g;
}

export function makeMerchant() {
  const g = new THREE.Group();
  const robe = new THREE.MeshStandardMaterial({ color: 0x4a2a5a, roughness: 0.8 });
  const trim = new THREE.MeshStandardMaterial({ color: 0xe8b84a, metalness: 0.8, roughness: 0.3 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x5a3a22, roughness: 0.9 });
  const body = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.6, 10), robe);
  body.position.set(0, 0.8, -0.6);
  const hood = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), robe);
  hood.position.set(0, 1.7, -0.6);
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffd84a });
  for (const s of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.045, 6, 6), eyeMat);
    e.position.set(s * 0.1, 1.72, -0.33);
    g.add(e);
  }
  const table = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.12, 0.8), wood);
  table.position.set(0, 0.75, 0.3);
  for (const [lx, lz] of [
    [-0.8, 0],
    [0.8, 0],
    [-0.8, 0.6],
    [0.8, 0.6],
  ]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.75, 0.08), wood);
    leg.position.set(lx, 0.37, lz);
    g.add(leg);
  }
  // wares: potions and a gilded box
  const potion = new THREE.MeshStandardMaterial({ color: 0xff3a5a, emissive: 0x5a0010, roughness: 0.2 });
  for (let i = 0; i < 3; i++) {
    const p = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), potion);
    p.position.set(-0.6 + i * 0.25, 0.93, 0.3);
    g.add(p);
  }
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.25, 0.3), trim);
  box.position.set(0.5, 0.94, 0.3);
  const lantern = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffd08a }));
  lantern.position.set(0.55, 1.6, -0.3);
  g.add(body, hood, table, box, lantern);
  return g;
}
