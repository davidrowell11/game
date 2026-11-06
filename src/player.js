import * as THREE from 'three';
import { baseStats } from './perks.js';
import { upgradeLevel } from './save.js';
import { blobShadow } from './enemies.js';

export const xpForLevel = (lvl) => Math.round(12 + lvl * 9 + lvl * lvl * 1.5);

export class Player {
  constructor(scene, save) {
    this.scene = scene;
    this.stats = baseStats(save);
    this.hp = this.stats.maxHp;
    this.radius = 0.42;
    this.pos = new THREE.Vector3();
    this.facing = 0;
    this.level = 1;
    this.xp = 0;
    this.xpNext = xpForLevel(1);
    this.gold = 0;
    this.potions = 1 + upgradeLevel(save, 'satchel');
    this.secondWind = upgradeLevel(save, 'secondWind') > 0;
    this.taken = {};
    this.kills = 0;

    this.attackTimer = 0;
    this.swingT = -1;
    this.swingDir = 1;
    this.boltTimer = 0;
    this.dashTimer = 0;
    this.dashT = 0;
    this.dashDir = new THREE.Vector2();
    this.invuln = 0;
    this.hurtFlash = 0;
    this.regenAcc = 0;

    this._buildModel();
  }

  _buildModel() {
    const g = new THREE.Group();
    const cloth = new THREE.MeshStandardMaterial({ color: 0x2f5fa8, roughness: 0.7 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xe2b48c, roughness: 0.8 });
    const metal = new THREE.MeshStandardMaterial({ color: 0xc8ccd4, metalness: 0.9, roughness: 0.25 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x3a2a1e, roughness: 0.8 });
    this.materials = [cloth, skin, metal, dark];

    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 0.55, 4, 10), cloth);
    body.position.y = 0.72;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 14, 10), skin);
    head.position.y = 1.42;
    const hood = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.42, 10), cloth);
    hood.position.y = 1.68;
    const belt = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.05, 6, 16), dark);
    belt.rotation.x = Math.PI / 2;
    belt.position.y = 0.62;
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x9fe8ff });
    const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 6), eyeMat);
    const eyeR = eyeL.clone();
    eyeL.position.set(-0.09, 1.45, 0.21);
    eyeR.position.set(0.09, 1.45, 0.21);

    // Sword on a pivot so it can sweep around the body.
    this.swordPivot = new THREE.Group();
    this.swordPivot.position.y = 0.9;
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.04, 1.25), metal);
    blade.position.set(0.35, 0, 0.95);
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.06, 0.08), dark);
    guard.position.set(0.35, 0, 0.32);
    this.swordPivot.add(blade, guard);

    // Swing trail
    const trailGeo = new THREE.RingGeometry(0.6, 2.4, 24, 1, -Math.PI * 0.9, Math.PI * 0.8);
    trailGeo.rotateX(-Math.PI / 2);
    this.trailMat = new THREE.MeshBasicMaterial({ color: 0xbfe6ff, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
    this.trail = new THREE.Mesh(trailGeo, this.trailMat);
    this.trail.position.y = 0.9;

    // Faint ground arc showing where the sword will reach.
    const aimGeo = new THREE.RingGeometry(0.55, 1, 32, 1, -Math.PI / 2 - Math.PI * 0.4, Math.PI * 0.8);
    aimGeo.rotateX(-Math.PI / 2);
    this.aimMat = new THREE.MeshBasicMaterial({ color: 0xffe2b8, transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide });
    this.aim = new THREE.Mesh(aimGeo, this.aimMat);
    this.aim.position.y = 0.04;
    this.shadow = blobShadow(this.radius);

    const light = new THREE.PointLight(0xffe2b8, 9, 13, 1.3);
    light.position.y = 2.6;

    g.add(this.shadow, this.aim, body, head, hood, belt, eyeL, eyeR, this.swordPivot, this.trail, light);
    g.traverse((o) => {
      if (o.isMesh && o !== this.trail && o !== this.aim && o !== this.shadow) o.castShadow = true;
    });
    this.mesh = g;
    this.body = body;
    this.scene.add(g);
  }

  heal(n) {
    this.hp = Math.min(this.stats.maxHp, this.hp + n);
  }

  get dashReady() {
    return this.dashTimer <= 0;
  }

  updateVisual(dt, moving, time) {
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.y = this.facing;
    // bob while walking
    this.body.position.y = 0.72 + (moving ? Math.abs(Math.sin(time * 12)) * 0.06 : 0);
    // swing animation
    if (this.swingT >= 0) {
      this.swingT += dt;
      const dur = Math.min(0.2, 0.9 / this.stats.attackRate);
      const k = Math.min(1, this.swingT / dur);
      const ease = 1 - (1 - k) ** 3;
      const half = this.stats.swingArc / 2;
      this.swordPivot.rotation.y = this.swingDir * (half - ease * half * 2);
      this.trailMat.opacity = 0.45 * (1 - k);
      const s = this.stats.swingRange / 2.4;
      this.trail.scale.set(s * this.swingDir, 1, s);
      if (k >= 1) this.swingT = -1;
    } else {
      this.swordPivot.rotation.y += (0.9 - this.swordPivot.rotation.y) * Math.min(1, dt * 10);
      this.trailMat.opacity = 0;
    }
    // aim arc matches the current sword reach and arc
    const r = this.stats.swingRange;
    this.aim.scale.set(r * (this.stats.swingArc / (Math.PI * 0.8)), 1, r);
    this.aimMat.opacity = this.attackTimer > 0 ? 0.04 : 0.1;
    // hurt flash + dash ghosting
    const flash = this.hurtFlash > 0 ? 0.8 : 0;
    this.materials[0].emissive.setRGB(flash, flash * 0.1, flash * 0.1);
    this.mesh.visible = !(this.invuln > 0 && this.dashT <= 0 && Math.floor(time * 20) % 2 === 0);
  }

  dispose() {
    this.scene.remove(this.mesh);
  }
}
