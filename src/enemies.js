// Enemy archetypes, models and AI.
import * as THREE from 'three';
import { sfx } from './audio.js';
import { glowTexture } from './textures.js';

export const ENEMY_DEFS = {
  husk: { name: 'Husk', hp: 32, speed: 3.3, dmg: 9, radius: 0.48, xp: 3, gold: 0.35, ai: 'melee', reach: 1.25, windup: 0.42, cd: 1.0, color: 0x7f9c5e },
  spitter: { name: 'Spitter', hp: 24, speed: 2.7, dmg: 8, radius: 0.45, xp: 4, gold: 0.45, ai: 'ranged', range: 10, windup: 0.4, cd: 1.9, projSpeed: 9, color: 0xb36ad8 },
  brute: { name: 'Brute', hp: 95, speed: 2.1, dmg: 18, radius: 0.85, xp: 9, gold: 0.8, ai: 'charger', reach: 1.7, windup: 0.75, cd: 2.4, color: 0xa65632 },
  bloater: { name: 'Bloater', hp: 40, speed: 2.7, dmg: 26, radius: 0.6, xp: 5, gold: 0.5, ai: 'bomber', reach: 1.6, windup: 0.85, cd: 0, blast: 3.2, color: 0x9ab83a },
  wisp: { name: 'Wisp', hp: 13, speed: 5.6, dmg: 6, radius: 0.34, xp: 2, gold: 0.25, ai: 'melee', reach: 0.95, windup: 0.22, cd: 0.7, color: 0x6ae4ff, float: true },
  shaman: { name: 'Bone Shaman', hp: 45, speed: 2.4, dmg: 7, radius: 0.5, xp: 8, gold: 0.9, ai: 'summoner', range: 11, windup: 0.6, cd: 4.5, projSpeed: 8, color: 0xe0d7a8 },
  boss: { name: 'The Hollow Warden', hp: 750, speed: 2.5, dmg: 16, radius: 1.5, xp: 60, gold: 1, ai: 'boss', reach: 2.4, windup: 0.6, cd: 2.4, projSpeed: 8.5, color: 0x5a3c78 },
};

const geoCache = {};
function geo(key, make) {
  return geoCache[key] || (geoCache[key] = make());
}

let shadowMat = null;
export function blobShadow(radius) {
  if (!shadowMat) shadowMat = new THREE.MeshBasicMaterial({ map: glowTexture(), color: 0x000000, transparent: true, opacity: 0.55, depthWrite: false });
  const m = new THREE.Mesh(geo('shadow', () => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)), shadowMat);
  m.position.y = 0.03;
  m.scale.setScalar(radius * 3);
  m.renderOrder = -1;
  return m;
}

function buildModel(type, def, elite) {
  const g = new THREE.Group();
  g.add(blobShadow(def.radius));
  const mat = new THREE.MeshStandardMaterial({ color: def.color, roughness: 0.6, metalness: 0.1, emissive: 0x000000 });
  const eyeMat = new THREE.MeshBasicMaterial({ color: type === 'wisp' ? 0xffffff : 0xff3a2a });
  const eye = geo('eye', () => new THREE.SphereGeometry(0.06, 6, 6));
  const addEyes = (y, z, spread = 0.12, scale = 1) => {
    for (const s of [-1, 1]) {
      const e = new THREE.Mesh(eye, eyeMat);
      e.position.set(s * spread, y, z);
      e.scale.setScalar(scale);
      g.add(e);
    }
  };
  let body;
  switch (type) {
    case 'husk': {
      body = new THREE.Mesh(geo('husk', () => new THREE.CapsuleGeometry(0.36, 0.5, 4, 8)), mat);
      body.position.y = 0.72;
      body.rotation.x = 0.35;
      const armGeo = geo('huskArm', () => new THREE.BoxGeometry(0.12, 0.12, 0.7));
      for (const s of [-1, 1]) {
        const arm = new THREE.Mesh(armGeo, mat);
        arm.position.set(s * 0.38, 0.8, 0.35);
        g.add(arm);
      }
      addEyes(1.1, 0.33);
      break;
    }
    case 'spitter': {
      body = new THREE.Mesh(geo('spitter', () => new THREE.OctahedronGeometry(0.5, 0)), mat);
      body.position.y = 1.1;
      body.scale.set(1, 1.3, 1);
      addEyes(1.25, 0.36, 0.14);
      const sac = new THREE.Mesh(geo('sac', () => new THREE.SphereGeometry(0.22, 8, 8)), new THREE.MeshBasicMaterial({ color: 0xd88cff }));
      sac.position.set(0, 0.95, 0.38);
      g.add(sac);
      break;
    }
    case 'brute': {
      body = new THREE.Mesh(geo('brute', () => new THREE.BoxGeometry(1.3, 1.3, 1.0)), mat);
      body.position.y = 0.85;
      const hornGeo = geo('horn', () => new THREE.ConeGeometry(0.12, 0.5, 6));
      const hornMat = new THREE.MeshStandardMaterial({ color: 0xe8dcc0 });
      for (const s of [-1, 1]) {
        const h = new THREE.Mesh(hornGeo, hornMat);
        h.position.set(s * 0.45, 1.65, 0.3);
        h.rotation.z = -s * 0.5;
        g.add(h);
      }
      addEyes(1.15, 0.51, 0.25, 1.5);
      break;
    }
    case 'bloater': {
      body = new THREE.Mesh(geo('bloater', () => new THREE.SphereGeometry(0.62, 14, 10)), mat);
      body.position.y = 0.75;
      const pusMat = new THREE.MeshStandardMaterial({ color: 0xe8e060, emissive: 0x4a4400 });
      const pus = geo('pus', () => new THREE.SphereGeometry(0.14, 8, 6));
      for (let i = 0; i < 6; i++) {
        const a = i * 2.4;
        const p = new THREE.Mesh(pus, pusMat);
        p.position.set(Math.cos(a) * 0.5, 0.75 + Math.sin(i * 1.7) * 0.3, Math.sin(a) * 0.5);
        body.add(p);
        p.position.y -= 0.75;
      }
      addEyes(0.95, 0.55, 0.16, 1.2);
      break;
    }
    case 'wisp': {
      mat.emissive.set(def.color);
      mat.emissiveIntensity = 0.8;
      body = new THREE.Mesh(geo('wisp', () => new THREE.IcosahedronGeometry(0.32, 0)), mat);
      body.position.y = 1.0;
      addEyes(1.02, 0.26, 0.1, 0.8);
      break;
    }
    case 'shaman': {
      body = new THREE.Mesh(geo('shaman', () => new THREE.ConeGeometry(0.45, 1.4, 8)), mat);
      body.position.y = 0.7;
      const skull = new THREE.Mesh(geo('skull', () => new THREE.SphereGeometry(0.26, 10, 8)), new THREE.MeshStandardMaterial({ color: 0xf2ecd8 }));
      skull.position.y = 1.55;
      g.add(skull);
      const staff = new THREE.Mesh(geo('staff', () => new THREE.CylinderGeometry(0.04, 0.04, 1.8, 6)), new THREE.MeshStandardMaterial({ color: 0x4a3626 }));
      staff.position.set(0.5, 0.9, 0.1);
      const orb = new THREE.Mesh(geo('orb', () => new THREE.SphereGeometry(0.12, 8, 8)), new THREE.MeshBasicMaterial({ color: 0x7affb0 }));
      orb.position.set(0.5, 1.85, 0.1);
      g.add(staff, orb);
      addEyes(1.58, 0.22, 0.09);
      break;
    }
    case 'boss': {
      body = new THREE.Mesh(geo('boss', () => new THREE.DodecahedronGeometry(1.3, 0)), mat);
      body.position.y = 1.8;
      const crownMat = new THREE.MeshStandardMaterial({ color: 0xd8b04a, metalness: 0.9, roughness: 0.3, emissive: 0x3a2400 });
      const spike = geo('spike', () => new THREE.ConeGeometry(0.16, 0.8, 6));
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        const s = new THREE.Mesh(spike, crownMat);
        s.position.set(Math.cos(a) * 0.8, 3.1, Math.sin(a) * 0.8);
        g.add(s);
      }
      const coreMat = new THREE.MeshBasicMaterial({ color: 0xff3a6a });
      const core = new THREE.Mesh(geo('core', () => new THREE.SphereGeometry(0.35, 12, 10)), coreMat);
      core.position.set(0, 1.9, 1.05);
      g.add(core);
      const l = new THREE.PointLight(0xff3a6a, 8, 10, 1.5);
      l.position.set(0, 2.2, 1.6);
      g.add(l);
      break;
    }
  }
  g.add(body);
  if (elite) g.scale.setScalar(1.3);
  g.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });
  return { group: g, body, mat };
}

export class Enemy {
  constructor(type, x, z, depth, elite = false) {
    const def = ENEMY_DEFS[type];
    this.type = type;
    this.def = def;
    this.elite = elite;
    const scale = 1 + (depth - 1) * 0.22;
    const eliteMul = elite ? 2.2 : 1;
    this.maxHp = Math.round(def.hp * (type === 'boss' ? 1 + (depth / 4 - 1) * 0.6 : scale) * eliteMul);
    this.hp = this.maxHp;
    this.dmg = def.dmg * (1 + (depth - 1) * 0.12) * (elite ? 1.4 : 1);
    this.speed = def.speed * (1 + Math.min(0.3, (depth - 1) * 0.02));
    this.radius = def.radius * (elite ? 1.3 : 1);
    this.xp = Math.round(def.xp * (1 + depth * 0.1) * (elite ? 3 : 1));
    this.pos = new THREE.Vector3(x, 0, z);
    this.knock = new THREE.Vector2();
    this.facing = Math.random() * Math.PI * 2;
    this.awake = false;
    this.state = 'idle';
    this.stateT = 0;
    this.cd = 0.5 + Math.random();
    this.flash = 0;
    this.dead = false;
    this.wander = Math.random() * 10;
    this.phase = 1;
    this.patternIdx = 0;
    const m = buildModel(type, def, elite);
    this.mesh = m.group;
    this.body = m.body;
    this.mat = m.mat;
    if (elite) this.mat.emissive.set(0x442200);
    this.baseEmissive = this.mat.emissive.clone();
    this.mesh.position.copy(this.pos);
  }

  get dist() {
    return this._dist;
  }

  update(dt, g) {
    const p = g.player;
    const w = g.world;
    const dx = p.pos.x - this.pos.x;
    const dz = p.pos.z - this.pos.z;
    const dist = Math.hypot(dx, dz);
    this._dist = dist;
    this.stateT += dt;
    this.cd -= dt;
    this.flash -= dt;

    // Wake up on sight
    if (!this.awake && dist < 15 && w.lineOfSight(this.pos.x, this.pos.z, p.pos.x, p.pos.z)) this.wake(g);

    let mx = 0;
    let mz = 0;
    if (this.awake && !g.player.dead) {
      const los = dist < 22 && w.lineOfSight(this.pos.x, this.pos.z, p.pos.x, p.pos.z);
      const toward = () => {
        if (los) return [dx / dist, dz / dist];
        const t = w.flowTarget(this.pos.x, this.pos.z);
        if (!t) return [0, 0];
        const tx = t.x - this.pos.x;
        const tz = t.z - this.pos.z;
        const l = Math.hypot(tx, tz) || 1;
        return [tx / l, tz / l];
      };
      const face = () => (this.facing = Math.atan2(dx, dz));

      switch (this.def.ai) {
        case 'melee': {
          if (this.state === 'windup') {
            face();
            if (this.stateT >= this.def.windup) {
              if (dist <= this.def.reach + p.radius + this.radius + 0.35) g.damagePlayer(this.dmg, this);
              this.state = 'recover';
              this.stateT = 0;
              this.cd = this.def.cd;
            }
          } else if (this.state === 'recover') {
            if (this.stateT > 0.3) this.state = 'chase';
          } else {
            this.state = 'chase';
            if (dist <= this.def.reach + p.radius + this.radius && this.cd <= 0) {
              this.state = 'windup';
              this.stateT = 0;
            } else {
              [mx, mz] = toward();
              face();
            }
          }
          break;
        }
        case 'ranged':
        case 'summoner': {
          if (this.state === 'windup') {
            face();
            if (this.stateT >= this.def.windup) {
              if (this.def.ai === 'summoner' && g.enemies.length < 60) {
                for (let i = 0; i < 2; i++) {
                  const a = Math.random() * Math.PI * 2;
                  g.spawnEnemy('husk', this.pos.x + Math.cos(a) * 1.5, this.pos.z + Math.sin(a) * 1.5, true);
                }
                g.fx.burst(this.pos.x, 1, this.pos.z, 0x7affb0, 20, 5);
              } else {
                g.enemyShoot(this, Math.atan2(dx, dz), this.def.projSpeed, this.dmg);
              }
              this.state = 'chase';
              this.cd = this.def.cd * (0.8 + Math.random() * 0.4);
            }
          } else {
            face();
            if (los && dist < this.def.range) {
              if (this.cd <= 0) {
                this.state = 'windup';
                this.stateT = 0;
                if (this.def.ai === 'summoner') sfx.windup();
              } else if (dist < 5) {
                mx = -dx / dist;
                mz = -dz / dist;
              } else {
                // strafe
                const s = Math.sin(this.wander + g.time * 0.8) > 0 ? 1 : -1;
                mx = (-dz / dist) * s * 0.6;
                mz = (dx / dist) * s * 0.6;
              }
            } else {
              [mx, mz] = toward();
            }
          }
          break;
        }
        case 'charger': {
          if (this.state === 'windup') {
            this.body.position.x = Math.sin(this.stateT * 60) * 0.06;
            if (this.stateT >= this.def.windup) {
              this.state = 'charge';
              this.stateT = 0;
              this.hitThisCharge = false;
            }
          } else if (this.state === 'charge') {
            const cx = Math.sin(this.facing) * 14 * dt;
            const cz = Math.cos(this.facing) * 14 * dt;
            const hitWall = w.moveCircle(this.pos, cx, cz, this.radius);
            if (!this.hitThisCharge && dist < this.radius + p.radius + 0.4) {
              this.hitThisCharge = true;
              g.damagePlayer(this.dmg, this);
            }
            if (hitWall || this.stateT > 0.55) {
              this.state = 'stunned';
              this.stateT = 0;
              this.cd = this.def.cd;
              if (hitWall) {
                g.shake(0.25);
                g.fx.burst(this.pos.x, 0.5, this.pos.z, 0x9a8a7a, 12, 4);
              }
            }
          } else if (this.state === 'stunned') {
            this.body.position.x = 0;
            if (this.stateT > 0.9) this.state = 'chase';
          } else {
            this.state = 'chase';
            face();
            if (los && dist < 9 && dist > 2 && this.cd <= 0) {
              this.state = 'windup';
              this.stateT = 0;
              sfx.windup();
            } else if (dist <= this.def.reach + p.radius + this.radius && this.cd <= 0) {
              g.damagePlayer(this.dmg * 0.7, this);
              this.cd = 1.2;
            } else {
              [mx, mz] = toward();
            }
          }
          break;
        }
        case 'bomber': {
          if (this.state === 'windup') {
            // fuse: swell, flash and beep, then burst
            if (Math.floor(this.stateT * 8) !== Math.floor((this.stateT - dt) * 8)) sfx.fuse();
            if (this.stateT >= this.def.windup) {
              this.exploded = true;
              g.explode(this.pos.x, this.pos.z, this.def.blast * (this.elite ? 1.3 : 1), this.dmg, this);
              g.killEnemy(this, true);
              return;
            }
          } else {
            this.state = 'chase';
            face();
            if (dist <= this.def.reach + p.radius + this.radius) {
              this.state = 'windup';
              this.stateT = 0;
            } else [mx, mz] = toward();
          }
          break;
        }
        case 'boss':
          [mx, mz] = this.updateBoss(dt, g, dx, dz, dist, toward);
          break;
      }
    } else {
      // idle shuffle
      this.wander += dt;
      this.body.rotation.y = Math.sin(this.wander) * 0.3;
    }

    // separation from other enemies
    for (const o of g.enemies) {
      if (o === this) continue;
      const ox = this.pos.x - o.pos.x;
      const oz = this.pos.z - o.pos.z;
      const min = this.radius + o.radius;
      const d2 = ox * ox + oz * oz;
      if (d2 < min * min && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        mx += (ox / d) * (min - d) * 2;
        mz += (oz / d) * (min - d) * 2;
      }
    }

    const sp = this.state === 'windup' || this.state === 'stunned' || this.state === 'charge' || this.state === 'spiral' ? 0 : this.speed * (this.phase === 2 ? 1.35 : 1);
    w.moveCircle(this.pos, (mx * sp + this.knock.x) * dt, (mz * sp + this.knock.y) * dt, this.radius);
    this.knock.multiplyScalar(Math.max(0, 1 - dt * 8));

    // visuals
    this.mesh.position.set(this.pos.x, this.def.float ? Math.sin(g.time * 4 + this.wander) * 0.15 : 0, this.pos.z);
    this.mesh.rotation.y = this.facing;
    const windup = this.state === 'windup' || this.state === 'spiral';
    if (this.flash > 0) this.mat.emissive.setRGB(1, 1, 1);
    else if (windup) this.mat.emissive.setRGB(0.6 + Math.sin(this.stateT * 40) * 0.3, 0.1, 0.05);
    else this.mat.emissive.copy(this.baseEmissive);
    const s = windup ? 1 + Math.min(1, this.stateT / this.def.windup) * 0.15 : 1;
    this.body.scale.setScalar(this.type === 'spitter' ? 1 : s);
    if (this.type === 'spitter') this.body.scale.set(s, 1.3 * s, s);
  }

  updateBoss(dt, g, dx, dz, dist, toward) {
    if (this.phase === 1 && this.hp < this.maxHp * 0.5) {
      this.phase = 2;
      sfx.roar();
      g.shake(0.6);
      g.ui.toast('The Warden is enraged!');
      this.mat.color.set(0x8a2a4a);
    }
    this.facing = Math.atan2(dx, dz);
    this.body.rotation.y += dt * (this.phase === 2 ? 2 : 0.8);
    if (this.state === 'spiral') {
      // twin rotating streams of bullets
      this.spiralAcc = (this.spiralAcc || 0) + dt;
      while (this.spiralAcc > 0.09) {
        this.spiralAcc -= 0.09;
        const a = this.spiralBase + this.stateT * 2.6;
        for (let k = 0; k < 3; k++) g.enemyShoot(this, a + (k * Math.PI * 2) / 3, this.def.projSpeed * 0.75, this.dmg * 0.6, true);
      }
      if (this.stateT > 2.6) {
        this.state = 'chase';
        this.cd = this.def.cd;
      }
      return [0, 0];
    }
    if (this.state === 'windup') {
      if (this.stateT < this.def.windup) return [0, 0];
      const pattern = this.pattern;
      const a = Math.atan2(dx, dz);
      if (pattern === 'nova') {
        const n = this.phase === 2 ? 22 : 16;
        const off = Math.random();
        for (let i = 0; i < n; i++) g.enemyShoot(this, ((i + off) / n) * Math.PI * 2, this.def.projSpeed * 0.85, this.dmg * 0.8);
      } else if (pattern === 'fan') {
        const n = this.phase === 2 ? 7 : 5;
        for (let i = 0; i < n; i++) g.enemyShoot(this, a + (i - (n - 1) / 2) * 0.16, this.def.projSpeed * 1.2, this.dmg * 0.8);
      } else if (pattern === 'summon') {
        for (let i = 0; i < (this.phase === 2 ? 4 : 3); i++) {
          const ang = (i / 3) * Math.PI * 2;
          g.spawnEnemy(Math.random() < 0.5 ? 'husk' : 'wisp', this.pos.x + Math.cos(ang) * 3, this.pos.z + Math.sin(ang) * 3, true);
        }
        g.fx.burst(this.pos.x, 1.5, this.pos.z, 0xb070ff, 30, 6);
      } else if (pattern === 'spiral') {
        this.state = 'spiral';
        this.stateT = 0;
        this.spiralBase = a;
        return [0, 0];
      } else if (pattern === 'slam') {
        g.shake(0.4);
        g.fx.ring(this.pos.x, this.pos.z, 4.5, 0xff5a8a);
        if (dist < 4.5 + g.player.radius) g.damagePlayer(this.dmg * 1.3, this);
      }
      this.state = 'chase';
      this.cd = this.def.cd * (this.phase === 2 ? 0.65 : 1);
      return [0, 0];
    }
    if (this.cd <= 0) {
      const patterns = dist < 4.5 ? ['slam', 'nova'] : this.phase === 2 ? ['spiral', 'fan', 'nova', 'summon', 'fan'] : ['nova', 'fan', 'fan', 'summon'];
      this.pattern = patterns[this.patternIdx++ % patterns.length];
      if (this.pattern === 'summon' && g.enemies.length > 14) this.pattern = 'fan';
      this.state = 'windup';
      this.stateT = 0;
      sfx.windup();
      return [0, 0];
    }
    return dist > 3 ? toward() : [0, 0];
  }

  wake(g) {
    if (this.awake) return;
    this.awake = true;
    if (this.type === 'boss') {
      g.bossAwake(this);
    }
    for (const o of g.enemies) {
      if (!o.awake && o !== this && (o.pos.x - this.pos.x) ** 2 + (o.pos.z - this.pos.z) ** 2 < 49) o.awake = true;
    }
  }
}
