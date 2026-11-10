// Particles, projectiles, pickups and floating damage numbers.
import * as THREE from 'three';
import { glowTexture } from './textures.js';

const shared = (o) => ((o.userData.shared = true), o);

// ---------------------------------------------------------------------------
// Two particle systems:
//   debris : lit-independent instanced cubes affected by gravity (blood, shards)
//   sparks : additive glowing points (magic, trails, embers) that bloom
const MAX_DEBRIS = 600;
const MAX_SPARKS = 900;

export class Effects {
  constructor(scene) {
    this.scene = scene;
    const geo = shared(new THREE.BoxGeometry(0.12, 0.12, 0.12));
    const mat = shared(new THREE.MeshBasicMaterial({ color: 0xffffff }));
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX_DEBRIS);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.p = Array.from({ length: MAX_DEBRIS }, () => ({ life: 0, max: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, s: 1 }));
    this.next = 0;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._v = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._c = new THREE.Color();
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < MAX_DEBRIS; i++) {
      this.mesh.setMatrixAt(i, zero);
      this.mesh.setColorAt(i, this._c.set(0xffffff));
    }
    scene.add(this.mesh);

    // sparks
    const sg = new THREE.BufferGeometry();
    this.sPos = new Float32Array(MAX_SPARKS * 3).fill(-100);
    this.sCol = new Float32Array(MAX_SPARKS * 3);
    sg.setAttribute('position', new THREE.BufferAttribute(this.sPos, 3).setUsage(THREE.DynamicDrawUsage));
    sg.setAttribute('color', new THREE.BufferAttribute(this.sCol, 3).setUsage(THREE.DynamicDrawUsage));
    const sm = new THREE.PointsMaterial({ map: glowTexture(), size: 0.42, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true });
    this.sparkPts = new THREE.Points(sg, shared(sm));
    this.sparkPts.frustumCulled = false;
    scene.add(this.sparkPts);
    this.sp = Array.from({ length: MAX_SPARKS }, () => ({ life: 0, max: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, r: 0, g: 0, b: 0, grav: 0 }));
    this.sNext = 0;

    this.rings = [];
    this.ringGeo = shared(new THREE.RingGeometry(0.86, 1, 48).rotateX(-Math.PI / 2));
  }

  burst(x, y, z, color, count = 12, speed = 4, life = 0.6) {
    this._c.set(color);
    for (let i = 0; i < count; i++) {
      const k = this.next;
      this.next = (this.next + 1) % MAX_DEBRIS;
      const p = this.p[k];
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.4 + Math.random() * 0.6);
      p.x = x;
      p.y = y;
      p.z = z;
      p.vx = Math.cos(a) * v;
      p.vz = Math.sin(a) * v;
      p.vy = 1.5 + Math.random() * speed * 0.8;
      p.life = p.max = life * (0.6 + Math.random() * 0.6);
      p.s = 0.6 + Math.random() * 1.2;
      this.mesh.setColorAt(k, this._c);
    }
    this.mesh.instanceColor.needsUpdate = true;
    // every burst also throws a few glowing sparks
    this.sparks(x, y, z, color, Math.ceil(count / 2), speed * 0.8, life * 0.8);
  }

  sparks(x, y, z, color, count = 10, speed = 3, life = 0.5, gravity = 4) {
    this._c.set(color);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const e = Math.random() * 2 - 1;
      const v = speed * (0.3 + Math.random() * 0.7);
      this.emit(x, y, z, Math.cos(a) * v, e * v * 0.8 + speed * 0.3, Math.sin(a) * v, life * (0.6 + Math.random() * 0.6), gravity);
    }
  }

  // Single spark using the colour set in this._c (call setColor first).
  emit(x, y, z, vx, vy, vz, life, gravity = 0) {
    const s = this.sp[this.sNext];
    this.sNext = (this.sNext + 1) % MAX_SPARKS;
    s.x = x;
    s.y = y;
    s.z = z;
    s.vx = vx;
    s.vy = vy;
    s.vz = vz;
    s.life = s.max = life;
    s.r = this._c.r;
    s.g = this._c.g;
    s.b = this._c.b;
    s.grav = gravity;
  }

  trail(x, y, z, color, life = 0.25) {
    this._c.set(color);
    this.emit(x + (Math.random() - 0.5) * 0.1, y + (Math.random() - 0.5) * 0.1, z + (Math.random() - 0.5) * 0.1, 0, 0.2, 0, life, 0);
  }

  ring(x, z, radius, color) {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending });
    const m = new THREE.Mesh(this.ringGeo, mat);
    m.position.set(x, 0.06, z);
    m.scale.setScalar(radius * 0.6);
    this.scene.add(m);
    this.rings.push({ m, t: 0, radius });
  }

  update(dt) {
    for (let i = 0; i < MAX_DEBRIS; i++) {
      const p = this.p[i];
      if (p.life <= 0) continue;
      p.life -= dt;
      p.vy -= 14 * dt;
      p.x += p.vx * dt;
      p.y = Math.max(0.05, p.y + p.vy * dt);
      p.z += p.vz * dt;
      if (p.y <= 0.05) {
        p.vx *= 0.8;
        p.vz *= 0.8;
      }
      const s = p.life > 0 ? p.s * (p.life / p.max) : 0;
      this._m.compose(this._v.set(p.x, p.y, p.z), this._q, this._s.set(s, s, s));
      this.mesh.setMatrixAt(i, this._m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;

    for (let i = 0; i < MAX_SPARKS; i++) {
      const s = this.sp[i];
      const o = i * 3;
      if (s.life <= 0) {
        if (this.sPos[o + 1] !== -100) this.sPos[o + 1] = -100;
        continue;
      }
      s.life -= dt;
      s.vy -= s.grav * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.z += s.vz * dt;
      const k = Math.max(0, s.life / s.max); // fade by darkening (additive blend)
      this.sPos[o] = s.x;
      this.sPos[o + 1] = s.y;
      this.sPos[o + 2] = s.z;
      this.sCol[o] = s.r * k * 1.6;
      this.sCol[o + 1] = s.g * k * 1.6;
      this.sCol[o + 2] = s.b * k * 1.6;
    }
    this.sparkPts.geometry.attributes.position.needsUpdate = true;
    this.sparkPts.geometry.attributes.color.needsUpdate = true;

    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.t += dt;
      const k = r.t / 0.45;
      r.m.material.opacity = 0.9 * (1 - k);
      r.m.scale.setScalar(r.radius * (0.6 + 0.4 * Math.sqrt(k)));
      if (k >= 1) {
        this.scene.remove(r.m);
        r.m.material.dispose();
        this.rings.splice(i, 1);
      }
    }
  }

  clear() {
    for (const p of this.p) p.life = 0;
    for (const s of this.sp) s.life = 0;
    for (const r of this.rings) {
      this.scene.remove(r.m);
      r.m.material.dispose();
    }
    this.rings.length = 0;
  }
}

// ---------------------------------------------------------------------------
// Projectiles are pooled: the boss's spiral alone fires ~30 per second.
let projAssets = null;
function assets() {
  if (projAssets) return projAssets;
  const tex = glowTexture();
  const mk = (color) => shared(new THREE.SpriteMaterial({ map: tex, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  projAssets = {
    core: shared(new THREE.SphereGeometry(0.13, 10, 8)),
    player: { core: shared(new THREE.MeshBasicMaterial({ color: new THREE.Color(0xc8f4ff).multiplyScalar(2) })), glow: mk(0x5ac8ff), trail: 0x5ac8ff },
    enemy: { core: shared(new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffd0f0).multiplyScalar(2) })), glow: mk(0xff3aa0), trail: 0xff3aa0 },
  };
  return projAssets;
}

export class Projectiles {
  constructor(scene) {
    this.scene = scene;
    this.list = [];
    this.pool = { player: [], enemy: [] };
  }

  spawn({ x, z, angle, speed, dmg, owner, pierce = 0, radius = 0.25, life = 1.6, crit = false }) {
    const a = assets()[owner];
    let g = this.pool[owner].pop();
    if (!g) {
      g = new THREE.Group();
      const halo = new THREE.Sprite(a.glow);
      halo.scale.setScalar(owner === 'enemy' ? 1.1 : 1.3);
      g.add(new THREE.Mesh(assets().core, a.core), halo);
    }
    g.position.set(x, 1.0, z);
    g.scale.setScalar(crit ? 1.4 : 1);
    this.scene.add(g);
    this.list.push({ x, z, vx: Math.sin(angle) * speed, vz: Math.cos(angle) * speed, dmg, owner, pierce, radius, life, mesh: g, hit: new Set(), crit, trail: a.trail });
  }

  remove(i) {
    const p = this.list[i];
    this.scene.remove(p.mesh);
    this.pool[p.owner].push(p.mesh);
    this.list.splice(i, 1);
  }

  clear() {
    while (this.list.length) this.remove(this.list.length - 1);
  }
}

// ---------------------------------------------------------------------------
export class Pickups {
  constructor(scene) {
    this.scene = scene;
    this.list = [];
    this.geo = {
      xp: shared(new THREE.OctahedronGeometry(0.17, 0)),
      gold: shared(new THREE.CylinderGeometry(0.18, 0.18, 0.06, 14)),
      potion: shared(new THREE.SphereGeometry(0.22, 12, 10)),
    };
    this.mat = {
      xp: shared(new THREE.MeshBasicMaterial({ color: new THREE.Color(0x6aff9a).multiplyScalar(1.8) })),
      gold: shared(new THREE.MeshStandardMaterial({ color: 0xffd04a, metalness: 1, roughness: 0.25, emissive: 0x7a5000 })),
      potion: shared(new THREE.MeshStandardMaterial({ color: 0xff3a5a, emissive: 0xa0001a, roughness: 0.15 })),
    };
  }

  spawn(kind, x, z, value = 1) {
    const m = new THREE.Mesh(this.geo[kind], this.mat[kind]);
    if (kind === 'gold') m.rotation.x = Math.PI / 2;
    const a = Math.random() * Math.PI * 2;
    const sp = 1 + Math.random() * 2;
    m.position.set(x, 0.5, z);
    this.scene.add(m);
    this.list.push({ kind, value, x, z, vx: Math.cos(a) * sp, vz: Math.sin(a) * sp, mesh: m, t: Math.random() * 6, magnet: false, age: 0 });
  }

  clear() {
    for (const p of this.list) this.scene.remove(p.mesh);
    this.list.length = 0;
  }
}

// ---------------------------------------------------------------------------
export class DamageNumbers {
  constructor(container) {
    this.container = container;
    this.pool = [];
    this.active = [];
    this._v = new THREE.Vector3();
    this.enabled = true;
  }

  spawn(x, y, z, text, cls = '') {
    if (!this.enabled) return;
    const el = this.pool.pop() || document.createElement('div');
    el.className = `dmg ${cls}`;
    el.textContent = text;
    this.container.appendChild(el);
    this.active.push({ el, x: x + (Math.random() - 0.5) * 0.6, y, z, t: 0, drift: (Math.random() - 0.5) * 0.8 });
    if (this.active.length > 40) this._kill(0);
  }

  _kill(i) {
    const n = this.active[i];
    n.el.remove();
    this.pool.push(n.el);
    this.active.splice(i, 1);
  }

  update(dt, camera, w, h) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const n = this.active[i];
      n.t += dt;
      if (n.t > 0.9) {
        this._kill(i);
        continue;
      }
      // pop up, then float and fade
      const rise = n.t < 0.15 ? n.t * 6 : 0.9 + (n.t - 0.15) * 1.1;
      this._v.set(n.x + n.drift * n.t, n.y + rise, n.z).project(camera);
      const pop = n.t < 0.12 ? 1 + (0.12 - n.t) * 6 : 1;
      n.el.style.transform = `translate(${(this._v.x * 0.5 + 0.5) * w}px, ${(-this._v.y * 0.5 + 0.5) * h}px) translate(-50%,-50%) scale(${pop})`;
      n.el.style.opacity = String(Math.min(1, (0.9 - n.t) * 4));
    }
  }

  clear() {
    while (this.active.length) this._kill(0);
  }
}
