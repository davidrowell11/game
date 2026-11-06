// Particles, projectiles, pickups and floating damage numbers.
import * as THREE from 'three';
import { glowTexture } from './textures.js';

const MAX_PARTICLES = 600;

export class Effects {
  constructor(scene) {
    this.scene = scene;
    const geo = new THREE.BoxGeometry(0.12, 0.12, 0.12);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX_PARTICLES);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.p = Array.from({ length: MAX_PARTICLES }, () => ({ life: 0, max: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, s: 1 }));
    this.next = 0;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._v = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._c = new THREE.Color();
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.mesh.setMatrixAt(i, zero);
      this.mesh.setColorAt(i, this._c.set(0xffffff));
    }
    scene.add(this.mesh);
    this.rings = [];
  }

  burst(x, y, z, color, count = 12, speed = 4, life = 0.6) {
    this._c.set(color);
    for (let i = 0; i < count; i++) {
      const k = this.next;
      this.next = (this.next + 1) % MAX_PARTICLES;
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
  }

  ring(x, z, radius, color) {
    const geo = new THREE.RingGeometry(radius * 0.85, radius, 40);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending });
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, 0.05, z);
    this.scene.add(m);
    this.rings.push({ m, t: 0 });
  }

  update(dt) {
    for (let i = 0; i < MAX_PARTICLES; i++) {
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
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.t += dt;
      r.m.material.opacity = 0.8 * (1 - r.t / 0.4);
      r.m.scale.setScalar(0.6 + r.t);
      if (r.t >= 0.4) {
        this.scene.remove(r.m);
        r.m.geometry.dispose();
        r.m.material.dispose();
        this.rings.splice(i, 1);
      }
    }
  }

  clear() {
    for (const p of this.p) p.life = 0;
    for (const r of this.rings) this.scene.remove(r.m);
    this.rings.length = 0;
  }
}

// ---------------------------------------------------------------------------
const glow = () => glowTexture();
let projAssets = null;
function assets() {
  if (projAssets) return projAssets;
  const tex = glow();
  const mk = (color) => new THREE.SpriteMaterial({ map: tex, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  projAssets = {
    core: new THREE.SphereGeometry(0.14, 8, 8),
    player: { core: new THREE.MeshBasicMaterial({ color: 0xc8f4ff }), glow: mk(0x5ac8ff) },
    enemy: { core: new THREE.MeshBasicMaterial({ color: 0xffd0f0 }), glow: mk(0xff3aa0) },
  };
  return projAssets;
}

export class Projectiles {
  constructor(scene) {
    this.scene = scene;
    this.list = [];
  }

  spawn({ x, z, angle, speed, dmg, owner, pierce = 0, radius = 0.25, life = 1.6, crit = false }) {
    const a = assets()[owner];
    const g = new THREE.Group();
    const core = new THREE.Mesh(assets().core, a.core);
    const halo = new THREE.Sprite(a.glow);
    halo.scale.setScalar(owner === 'enemy' ? 1.0 : 1.1);
    g.add(core, halo);
    g.position.set(x, 1.0, z);
    this.scene.add(g);
    this.list.push({ x, z, vx: Math.sin(angle) * speed, vz: Math.cos(angle) * speed, dmg, owner, pierce, radius, life, mesh: g, hit: new Set(), crit });
  }

  remove(i) {
    this.scene.remove(this.list[i].mesh);
    this.list.splice(i, 1);
  }

  clear() {
    for (const p of this.list) this.scene.remove(p.mesh);
    this.list.length = 0;
  }
}

// ---------------------------------------------------------------------------
export class Pickups {
  constructor(scene) {
    this.scene = scene;
    this.list = [];
    this.geo = {
      xp: new THREE.OctahedronGeometry(0.16, 0),
      gold: new THREE.CylinderGeometry(0.18, 0.18, 0.06, 12),
      potion: new THREE.SphereGeometry(0.22, 10, 8),
    };
    this.mat = {
      xp: new THREE.MeshBasicMaterial({ color: 0x6aff9a }),
      gold: new THREE.MeshStandardMaterial({ color: 0xffd04a, metalness: 0.9, roughness: 0.3, emissive: 0x3a2800 }),
      potion: new THREE.MeshStandardMaterial({ color: 0xff3a5a, emissive: 0x6a0010, roughness: 0.2 }),
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
  }

  spawn(x, y, z, text, cls = '') {
    const el = this.pool.pop() || document.createElement('div');
    el.className = `dmg ${cls}`;
    el.textContent = text;
    this.container.appendChild(el);
    this.active.push({ el, x: x + (Math.random() - 0.5) * 0.5, y, z, t: 0 });
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
      if (n.t > 0.8) {
        this._kill(i);
        continue;
      }
      this._v.set(n.x, n.y + n.t * 1.6, n.z).project(camera);
      n.el.style.transform = `translate(${(this._v.x * 0.5 + 0.5) * w}px, ${(-this._v.y * 0.5 + 0.5) * h}px) translate(-50%,-50%) scale(${1 + Math.max(0, 0.25 - n.t) * 2})`;
      n.el.style.opacity = String(Math.min(1, (0.8 - n.t) * 4));
    }
  }

  clear() {
    while (this.active.length) this._kill(0);
  }
}
