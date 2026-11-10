// Dungeon props: spike traps, breakable urns and the travelling merchant.
import * as THREE from 'three';
import { T } from './world.js';

const cache = {};
const once = (k, f) => {
  if (!cache[k]) {
    cache[k] = f();
    cache[k].userData.shared = true;
  }
  return cache[k];
};

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
  const lantern = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffd08a).multiplyScalar(3) }));
  lantern.position.set(0.55, 1.6, -0.3);
  g.add(body, hood, table, box, lantern);
  return g;
}

// ---------------------------------------------------------------------------
// The way down: a swirling vortex (custom shader) ringed by runes.
const PortalShader = {
  uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(0x5ad8ff) } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform float uTime;
    uniform vec3 uColor;
    varying vec2 vUv;
    void main() {
      vec2 p = vUv * 2.0 - 1.0;
      float r = length(p);
      if (r > 1.0) discard;
      float a = atan(p.y, p.x);
      // logarithmic spiral arms drifting inward
      float arms = sin(a * 3.0 + log(r + 0.02) * 6.0 + uTime * 2.5);
      float swirl = smoothstep(0.1, 1.0, arms) * smoothstep(1.0, 0.3, r);
      float core = smoothstep(0.55, 0.0, r);
      float rim = smoothstep(0.75, 0.98, r) * smoothstep(1.0, 0.95, r);
      vec3 col = uColor * (swirl * 1.4 + rim * 2.5) + vec3(0.0) * core;
      float alpha = clamp(swirl * 0.9 + rim + (1.0 - core) * 0.15, 0.0, 1.0);
      gl_FragColor = vec4(col * (1.0 - core * 0.85), alpha);
    }`,
};

export function makePortal() {
  const g = new THREE.Group();
  const pit = new THREE.Mesh(once('pitGeo', () => new THREE.CircleGeometry(1.35, 40).rotateX(-Math.PI / 2)), once('pitMat', () => new THREE.MeshBasicMaterial({ color: 0x000000 })));
  pit.position.y = 0.015;
  const mat = new THREE.ShaderMaterial({ ...PortalShader, uniforms: THREE.UniformsUtils.clone(PortalShader.uniforms), transparent: true, depthWrite: false });
  const vortex = new THREE.Mesh(once('vortexGeo', () => new THREE.PlaneGeometry(2.8, 2.8).rotateX(-Math.PI / 2)), mat);
  vortex.position.y = 0.03;
  const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x5ad8ff).multiplyScalar(2) });
  const stone = once('rimStone', () => new THREE.MeshStandardMaterial({ color: 0x5a5a62, roughness: 0.85 }));
  const rim = new THREE.Mesh(once('rimGeo', () => new THREE.TorusGeometry(1.45, 0.16, 8, 40).rotateX(-Math.PI / 2)), stone);
  rim.position.y = 0.08;
  const ring = new THREE.Mesh(once('ringGeo', () => new THREE.TorusGeometry(1.0, 0.035, 6, 40).rotateX(-Math.PI / 2)), ringMat);
  ring.position.y = 0.55;
  // rune stones standing around the rim
  const runeGeo = once('runeStone', () => new THREE.BoxGeometry(0.22, 0.6, 0.14));
  const glyphGeo = once('glyph', () => new THREE.PlaneGeometry(0.12, 0.3));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const st = new THREE.Mesh(runeGeo, stone);
    st.position.set(Math.cos(a) * 1.75, 0.3, Math.sin(a) * 1.75);
    st.rotation.y = -a + Math.PI / 2;
    const glyph = new THREE.Mesh(glyphGeo, ringMat);
    glyph.position.set(0, 0.05, 0.075);
    st.add(glyph);
    st.castShadow = true;
    g.add(st);
  }
  g.add(pit, vortex, rim, ring);
  return { mesh: g, ring, ringMat, shader: mat };
}

export function setPortalColor(portal, hex) {
  portal.ringMat.color.set(hex).multiplyScalar(2);
  portal.shader.uniforms.uColor.value.set(hex);
}

export function makeChest() {
  const g = new THREE.Group();
  const wood = once('chestWood', () => new THREE.MeshStandardMaterial({ color: 0x7a4a24, roughness: 0.75 }));
  const trim = once('chestTrim', () => new THREE.MeshStandardMaterial({ color: 0xe8b84a, metalness: 1, roughness: 0.28, emissive: 0x3a2400 }));
  const base = new THREE.Mesh(once('chestBase', () => new THREE.BoxGeometry(1.1, 0.6, 0.75)), wood);
  base.position.y = 0.3;
  const band = new THREE.Mesh(once('chestBand', () => new THREE.BoxGeometry(1.14, 0.1, 0.79)), trim);
  band.position.y = 0.55;
  const bandV = new THREE.Mesh(once('chestBandV', () => new THREE.BoxGeometry(0.1, 0.62, 0.79)), trim);
  bandV.position.set(-0.38, 0.31, 0);
  const bandV2 = bandV.clone();
  bandV2.position.x = 0.38;
  const lid = new THREE.Group();
  lid.position.set(0, 0.6, -0.375);
  const lidMesh = new THREE.Mesh(once('chestLid', () => new THREE.CylinderGeometry(0.375, 0.375, 1.1, 14, 1, false, 0, Math.PI).rotateZ(Math.PI / 2)), wood);
  lidMesh.position.set(0, 0, 0.375);
  const lock = new THREE.Mesh(once('chestLock', () => new THREE.BoxGeometry(0.16, 0.2, 0.06)), trim);
  lock.position.set(0, 0, 0.77);
  lid.add(lidMesh, lock);
  // treasure glow revealed when opened
  const glow = new THREE.Mesh(once('chestGlow', () => new THREE.PlaneGeometry(0.95, 0.6).rotateX(-Math.PI / 2)), once('chestGlowMat', () => new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffd06a).multiplyScalar(2.5) })));
  glow.position.y = 0.58;
  g.add(base, band, bandV, bandV2, lid, glow);
  g.traverse((o) => o.isMesh && (o.castShadow = true));
  return { mesh: g, lid };
}

export function makeShrine() {
  const g = new THREE.Group();
  const stone = once('shrineStone', () => new THREE.MeshStandardMaterial({ color: 0x8a8a92, roughness: 0.9 }));
  const base = new THREE.Mesh(once('shrineBase', () => new THREE.CylinderGeometry(0.95, 1.15, 0.45, 12)), stone);
  base.position.y = 0.22;
  const step = new THREE.Mesh(once('shrineStep', () => new THREE.CylinderGeometry(0.7, 0.8, 0.2, 12)), stone);
  step.position.y = 0.55;
  const pillar = new THREE.Mesh(once('shrinePillar', () => new THREE.CylinderGeometry(0.2, 0.28, 1.0, 8)), stone);
  pillar.position.y = 1.1;
  const cup = new THREE.Mesh(once('shrineCup', () => new THREE.CylinderGeometry(0.42, 0.18, 0.22, 12, 1, true)), stone);
  cup.position.y = 1.65;
  const orbMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x6aff9a).multiplyScalar(2) });
  const orb = new THREE.Mesh(once('shrineOrb', () => new THREE.IcosahedronGeometry(0.3, 2)), orbMat);
  orb.position.y = 2.05;
  g.add(base, step, pillar, cup, orb);
  g.traverse((o) => o.isMesh && o !== orb && (o.castShadow = true));
  return { mesh: g, orb, orbMat };
}
