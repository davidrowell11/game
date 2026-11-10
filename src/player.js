import * as THREE from 'three';
import { baseStats } from './perks.js';
import { upgradeLevel } from './save.js';
import { blobShadow } from './enemies.js';
import { disposeTree } from './world.js';

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
    const cloth = new THREE.MeshStandardMaterial({ color: 0x2c5aa0, roughness: 0.75 });
    const cape = new THREE.MeshStandardMaterial({ color: 0x8a1e2a, roughness: 0.85, side: THREE.DoubleSide });
    const skin = new THREE.MeshStandardMaterial({ color: 0xe2b48c, roughness: 0.8 });
    const metal = new THREE.MeshStandardMaterial({ color: 0xd0d4dc, metalness: 0.95, roughness: 0.22 });
    const leather = new THREE.MeshStandardMaterial({ color: 0x4a3222, roughness: 0.8 });
    const gold = new THREE.MeshStandardMaterial({ color: 0xe8b84a, metalness: 1, roughness: 0.3 });
    this.materials = [cloth, skin, metal, leather, cape, gold];

    const body = new THREE.Group();
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.33, 0.5, 4, 12), cloth);
    torso.position.y = 0.72;
    const belt = new THREE.Mesh(new THREE.TorusGeometry(0.335, 0.055, 6, 18), leather);
    belt.rotation.x = Math.PI / 2;
    belt.position.y = 0.6;
    const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 0.05), gold);
    buckle.position.set(0, 0.6, 0.34);
    const pauldronGeo = new THREE.SphereGeometry(0.17, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    const pl = new THREE.Mesh(pauldronGeo, metal);
    pl.position.set(-0.33, 1.08, 0);
    const pr = pl.clone();
    pr.position.x = 0.33;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.23, 16, 12), skin);
    head.position.y = 1.4;
    const hood = new THREE.Mesh(new THREE.SphereGeometry(0.27, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.62), cloth);
    hood.position.y = 1.43;
    hood.rotation.x = -0.25;
    const eyeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x9fe8ff).multiplyScalar(2.5) });
    const eyeGeo = new THREE.SphereGeometry(0.035, 6, 6);
    const eyeL = new THREE.Mesh(eyeGeo, eyeMat);
    const eyeR = new THREE.Mesh(eyeGeo, eyeMat);
    eyeL.position.set(-0.08, 1.42, 0.205);
    eyeR.position.set(0.08, 1.42, 0.205);
    // cape: a curved sheet behind the shoulders, swaying when moving
    const capeGeo = new THREE.CylinderGeometry(0.36, 0.5, 1.05, 14, 4, true, Math.PI * 0.62, Math.PI * 0.76);
    this.cape = new THREE.Mesh(capeGeo, cape);
    this.cape.position.set(0, 0.62, -0.02);
    body.add(torso, belt, buckle, pl, pr, head, hood, eyeL, eyeR, this.cape);

    // Sword on a pivot so it can sweep around the body; the fuller glows.
    this.swordPivot = new THREE.Group();
    this.swordPivot.position.y = 0.9;
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.035, 1.2), metal);
    blade.position.set(0.35, 0, 0.98);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.2, 4), metal);
    tip.rotation.x = Math.PI / 2;
    tip.rotation.y = Math.PI / 4;
    tip.position.set(0.35, 0, 1.68);
    this.runeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x7ad8ff).multiplyScalar(1.6) });
    const rune = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.04, 0.9), this.runeMat);
    rune.position.set(0.35, 0.002, 0.98);
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.07, 0.08), gold);
    guard.position.set(0.35, 0, 0.36);
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.3, 6), leather);
    grip.rotation.x = Math.PI / 2;
    grip.position.set(0.35, 0, 0.18);
    this.swordPivot.add(blade, tip, rune, guard, grip);

    // Swing trail and ground aim arc (geometry rebuilt when the arc changes)
    this.trailMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xbfe6ff).multiplyScalar(1.5), transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
    this.trail = new THREE.Mesh(new THREE.BufferGeometry(), this.trailMat);
    this.trail.position.y = 0.9;
    this.aimMat = new THREE.MeshBasicMaterial({ color: 0xffe2b8, transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide });
    this.aim = new THREE.Mesh(new THREE.BufferGeometry(), this.aimMat);
    this.aim.position.y = 0.04;
    this._arc = -1;
    this.shadow = blobShadow(this.radius);

    // The hero's lantern: the key light of the whole game. It can cast real
    // shadows (enabled on the High preset by setShadows()).
    this.light = new THREE.PointLight(0xffe2b8, 14, 16, 1.25);
    this.light.position.set(0, 2.1, 0);
    this.light.shadow.mapSize.set(512, 512);
    this.light.shadow.camera.near = 0.3;
    this.light.shadow.camera.far = 16;
    this.light.shadow.bias = -0.004;
    this.light.shadow.radius = 3;

    g.add(this.shadow, this.aim, body, this.swordPivot, this.trail, this.light);
    // The hero never casts lantern shadows: the light hangs above their head,
    // so their own body would drop a black disc around their feet.
    g.traverse((o) => {
      if (o.isMesh) o.castShadow = false;
    });
    this.mesh = g;
    this.body = body;
    this.scene.add(g);
  }

  setShadows(on) {
    this.light.castShadow = on;
  }

  // Rebuild the trail/aim sectors so they always match the true hit arc.
  _rebuildArc(arc) {
    this._arc = arc;
    const start = -Math.PI / 2 - arc / 2;
    const trail = new THREE.RingGeometry(0.6, 1, 28, 1, start, arc).rotateX(-Math.PI / 2);
    const aim = new THREE.RingGeometry(0.55, 1, 36, 1, start, arc).rotateX(-Math.PI / 2);
    this.trail.geometry.dispose();
    this.aim.geometry.dispose();
    this.trail.geometry = trail;
    this.aim.geometry = aim;
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
    if (this._arc !== this.stats.swingArc) this._rebuildArc(this.stats.swingArc);
    // bob and cape sway while walking
    this.body.position.y = moving ? Math.abs(Math.sin(time * 12)) * 0.06 : 0;
    const sway = moving ? 0.25 + Math.sin(time * 12) * 0.08 : 0.05 + Math.sin(time * 2) * 0.03;
    this.cape.rotation.x += (sway - this.cape.rotation.x) * Math.min(1, dt * 8);
    const r = this.stats.swingRange;
    // swing animation
    if (this.swingT >= 0) {
      this.swingT += dt;
      const dur = Math.min(0.2, 0.9 / this.stats.attackRate);
      const k = Math.min(1, this.swingT / dur);
      const ease = 1 - (1 - k) ** 3;
      const half = this.stats.swingArc / 2;
      this.swordPivot.rotation.y = this.swingDir * (half - ease * half * 2);
      this.trailMat.opacity = 0.55 * (1 - k);
      this.trail.scale.set(r, 1, r);
      this.runeMat.color.setRGB(0.6, 1.8, 2.6);
      if (k >= 1) this.swingT = -1;
    } else {
      this.swordPivot.rotation.y += (0.9 - this.swordPivot.rotation.y) * Math.min(1, dt * 10);
      this.trailMat.opacity = 0;
      this.runeMat.color.setRGB(0.4, 1.1, 1.6);
    }
    this.aim.scale.set(r, 1, r);
    this.aimMat.opacity = this.attackTimer > 0 ? 0.025 : 0.06;
    // hurt flash + invulnerability blink (not while dashing)
    const flash = this.hurtFlash > 0 ? 0.8 : 0;
    this.materials[0].emissive.setRGB(flash, flash * 0.1, flash * 0.1);
    this.mesh.visible = !(this.invuln > 0 && this.dashT <= 0 && Math.floor(time * 20) % 2 === 0);
  }

  dispose() {
    this.scene.remove(this.mesh);
    disposeTree(this.mesh);
  }
}
