import * as THREE from 'three';
import { generateDungeon, isBossFloor, FINAL_DEPTH } from './dungeon.js';
import { hashSeed } from './rng.js';
import { World, tileCenter, themeFor } from './world.js';
import { Player, xpForLevel } from './player.js';
import { Enemy, ENEMY_DEFS } from './enemies.js';
import { Effects, Projectiles, Pickups, DamageNumbers } from './effects.js';
import { PERKS, rollPerks } from './perks.js';
import { UI } from './ui.js';
import { loadSave, writeSave } from './save.js';
import { sfx, unlockAudio, setVolume, startDrone } from './audio.js';
import { glowTexture } from './textures.js';

const CAM_OFFSET = new THREE.Vector3(0, 19, 12.5);

class Input {
  constructor(canvas) {
    this.keys = new Set();
    this.pressed = new Set();
    this.mouse = { x: 0, y: 0, left: false, right: false };
    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this.pressed.add(e.code);
      if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => {
      this.keys.clear();
      this.mouse.left = this.mouse.right = false;
    });
    addEventListener('mousemove', (e) => {
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
    });
    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) this.mouse.left = true;
      if (e.button === 2) this.mouse.right = true;
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2) this.mouse.right = false;
    });
    addEventListener('contextmenu', (e) => e.preventDefault());
  }
  down(...codes) {
    return codes.some((c) => this.keys.has(c));
  }
  hit(...codes) {
    return codes.some((c) => this.pressed.has(c));
  }
  endFrame() {
    this.pressed.clear();
  }
}

export class Game {
  constructor() {
    this.canvas = document.getElementById('view');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(48, 1, 0.1, 200);
    this.hemi = new THREE.HemisphereLight(0x3a4a6a, 0x120c08, 0.9);
    this.scene.add(this.hemi);

    this.input = new Input(this.canvas);
    this.ui = new UI();
    this.fx = new Effects(this.scene);
    this.projectiles = new Projectiles(this.scene);
    this.pickups = new Pickups(this.scene);
    this.numbers = new DamageNumbers(this.ui.el.dmgLayer);
    this.raycaster = new THREE.Raycaster();
    this.aimPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -1.0);
    this.aimPoint = new THREE.Vector3();
    this.camTarget = new THREE.Vector3();
    this.shakeAmt = 0;
    this.time = 0;
    this.save = loadSave();
    setVolume(this.save.volume);
    this.perkById = Object.fromEntries(PERKS.map((p) => [p.id, p]));
    this.enemies = [];
    this.interactables = [];
    this.state = 'menu';
    this.world = null;
    this.player = null;

    this._bindUI();
    this._resize();
    addEventListener('resize', () => this._resize());
    addEventListener('blur', () => this.state === 'playing' && this.pause());
    document.addEventListener('visibilitychange', () => document.hidden && this.state === 'playing' && this.pause());
    this.toMenu();
    this._last = performance.now();
    requestAnimationFrame((t) => this._frame(t));
  }

  // ---------------------------------------------------------------- UI wiring
  _bindUI() {
    const on = (id, fn) =>
      document.getElementById(id).addEventListener('click', () => {
        unlockAudio();
        sfx.click();
        fn();
      });
    on('btn-start', () => this.startRun(document.getElementById('seed-input').value.trim()));
    on('btn-armory', () => this.openArmory());
    on('btn-controls', () => this.ui.show('controls'));
    on('btn-resume', () => this.resume());
    on('btn-abandon', () => {
      this.endRun();
      this.toMenu();
    });
    on('btn-retry', () => {
      if (this.victory) {
        this.victory = false;
        this.ui.hideAll();
        this.state = 'playing';
        return;
      }
      this.startRun(this.lastSeedText);
    });
    on('btn-menu', () => {
      this.endRun();
      this.toMenu();
    });
    for (const b of document.querySelectorAll('.screen .back'))
      b.addEventListener('click', () => {
        sfx.click();
        this.toMenu();
      });
    const quit = document.getElementById('btn-quit');
    if (window.depthwarden?.quit) quit.addEventListener('click', () => window.depthwarden.quit());
    else quit.classList.add('hidden');
    const vol = document.getElementById('volume');
    vol.value = this.save.volume;
    vol.addEventListener('input', () => {
      this.save.volume = Number(vol.value);
      setVolume(this.save.volume);
      writeSave(this.save);
    });
    addEventListener('keydown', (e) => {
      if (e.code === 'F11' && !window.depthwarden) {
        e.preventDefault();
        if (document.fullscreenElement) document.exitFullscreen();
        else document.documentElement.requestFullscreen?.();
      }
      if (this.state === 'perks' && ['Digit1', 'Digit2', 'Digit3'].includes(e.code)) {
        const cards = document.querySelectorAll('#perk-cards .perk');
        cards[Number(e.code.slice(-1)) - 1]?.click();
      }
    });
  }

  _resize() {
    const w = innerWidth;
    const h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.vw = w;
    this.vh = h;
  }

  // ---------------------------------------------------------------- flow
  toMenu() {
    this.state = 'menu';
    this.victory = false;
    this.ui.setHud(false);
    this.ui.renderMenuStats(this.save);
    this.ui.show('menu');
    this._clearFloor();
    if (this.player) {
      this.player.dispose();
      this.player = null;
    }
    // A slowly orbiting fly-over of a random dungeon as the menu backdrop.
    const d = generateDungeon((Math.random() * 1e9) | 0, 1 + ((Math.random() * 12) | 0));
    this._applyTheme(d.depth);
    this.world = new World(this.scene, d);
    this.world.explored.fill(1);
    const c = tileCenter(d.start.x, d.start.y);
    this.menuCenter = new THREE.Vector3(c.x, 0, c.z);
  }

  openArmory() {
    const render = () =>
      this.ui.renderArmory(this.save, (u, cost) => {
        if (this.save.gold < cost) return;
        this.save.gold -= cost;
        this.save.upgrades[u.id] = (this.save.upgrades[u.id] || 0) + 1;
        writeSave(this.save);
        render();
      });
    render();
    this.ui.show('armory');
  }

  startRun(seedText) {
    unlockAudio();
    startDrone();
    this.lastSeedText = seedText;
    this.runSeedText = seedText || Math.random().toString(36).slice(2, 8).toUpperCase();
    this.runSeed = hashSeed(this.runSeedText);
    this.runEnded = false;
    this.victory = false;
    this.runStart = this.time;
    if (this.player) this.player.dispose();
    this.player = new Player(this.scene, this.save);
    this.pendingLevels = 0;
    this.pendingChests = 0;
    this.ui.hideAll();
    this.ui.setHud(true);
    this.loadFloor(1);
    this.state = 'playing';
  }

  _applyTheme(depth) {
    const th = themeFor(depth);
    this.scene.background = new THREE.Color(th.bg);
    this.scene.fog = new THREE.Fog(th.bg, 24, 46);
    this.hemi.color.set(th.hemi[0]);
    this.hemi.groundColor.set(th.hemi[1]);
  }

  _clearFloor() {
    if (this.world) this.world.dispose();
    this.world = null;
    for (const e of this.enemies) this.scene.remove(e.mesh);
    this.enemies = [];
    for (const it of this.interactables) this.scene.remove(it.mesh);
    this.interactables = [];
    this.projectiles.clear();
    this.pickups.clear();
    this.fx.clear();
    this.numbers.clear();
    this.boss = null;
  }

  loadFloor(depth) {
    this._clearFloor();
    this.depth = depth;
    const d = generateDungeon(hashSeed(`${this.runSeed}:${depth}`), depth);
    this.dungeon = d;
    this._applyTheme(depth);
    this.world = new World(this.scene, d);
    const s = tileCenter(d.start.x, d.start.y);
    this.player.pos.set(s.x, 0, s.z);
    this.camTarget.copy(this.player.pos);
    for (const sp of d.spawns) {
      const c = tileCenter(sp.x, sp.y);
      this.spawnEnemy(sp.type, c.x, c.z, false, sp.elite);
    }
    for (const it of d.items) {
      const c = tileCenter(it.x, it.y);
      if (it.kind === 'potion') this.pickups.spawn('potion', c.x, c.z);
      else this._makeInteractable(it.kind, c.x, c.z);
    }
    const st = tileCenter(d.stairs.x, d.stairs.y);
    this.stairs = this._makeInteractable('stairs', st.x, st.z);
    this.stairsLocked = d.boss;
    this._updateStairsLook();
    this.flowTimer = 0;
    this.revealTimer = 0;
    this.world.computeFlow(this.player.pos.x, this.player.pos.z);
    this.world.reveal(this.player.pos.x, this.player.pos.z);
    const th = themeFor(depth);
    this.ui.el.floor.textContent = `Floor ${depth} · ${th.name} · Seed ${this.runSeedText}`;
    this.ui.banner(d.boss ? `Floor ${depth} — Guardian` : `Floor ${depth}`, th.name);
    if (this.ui.mmLarge) this.ui.toggleMap();
  }

  _makeInteractable(kind, x, z) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    const it = { kind, x, z, mesh: g, used: false };
    if (kind === 'stairs') {
      const pit = new THREE.Mesh(new THREE.CircleGeometry(1.3, 32), new THREE.MeshBasicMaterial({ color: 0x000000 }));
      pit.rotation.x = -Math.PI / 2;
      pit.position.y = 0.02;
      it.ringMat = new THREE.MeshBasicMaterial({ color: 0x5ad8ff });
      it.ring = new THREE.Mesh(new THREE.TorusGeometry(1.35, 0.1, 8, 40), it.ringMat);
      it.ring.rotation.x = -Math.PI / 2;
      it.ring.position.y = 0.1;
      it.ring2 = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.05, 6, 32), it.ringMat);
      it.ring2.rotation.x = -Math.PI / 2;
      it.ring2.position.y = 0.6;
      it.light = new THREE.PointLight(0x5ad8ff, 10, 9, 1.4);
      it.light.position.y = 1.2;
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0x5ad8ff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      glow.scale.setScalar(3.5);
      glow.position.y = 0.4;
      it.glow = glow;
      g.add(pit, it.ring, it.ring2, it.light, glow);
    } else if (kind === 'chest') {
      const wood = new THREE.MeshStandardMaterial({ color: 0x7a4a24, roughness: 0.8 });
      const trim = new THREE.MeshStandardMaterial({ color: 0xe8b84a, metalness: 0.9, roughness: 0.3, emissive: 0x2a1a00 });
      const base = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.6, 0.75), wood);
      base.position.y = 0.3;
      const band = new THREE.Mesh(new THREE.BoxGeometry(1.14, 0.1, 0.79), trim);
      band.position.y = 0.55;
      it.lid = new THREE.Group();
      it.lid.position.set(0, 0.6, -0.375);
      const lid = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.25, 0.75), wood);
      lid.position.set(0, 0.125, 0.375);
      const lock = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.2, 0.06), trim);
      lock.position.set(0, 0, 0.77);
      it.lid.add(lid, lock);
      it.light = new THREE.PointLight(0xffc860, 4, 5, 1.5);
      it.light.position.y = 1.3;
      g.add(base, band, it.lid, it.light);
    } else if (kind === 'shrine') {
      const stone = new THREE.MeshStandardMaterial({ color: 0x8a8a90, roughness: 0.9 });
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.1, 0.5, 10), stone);
      base.position.y = 0.25;
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.3, 1.0, 8), stone);
      pillar.position.y = 1.0;
      it.orbMat = new THREE.MeshBasicMaterial({ color: 0x6aff9a });
      it.orb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.32, 1), it.orbMat);
      it.orb.position.y = 1.85;
      it.light = new THREE.PointLight(0x6aff9a, 8, 9, 1.4);
      it.light.position.y = 2;
      g.add(base, pillar, it.orb, it.light);
    }
    this.scene.add(g);
    this.interactables.push(it);
    return it;
  }

  _updateStairsLook() {
    const c = this.stairsLocked ? 0xff3a5a : 0x5ad8ff;
    this.stairs.ringMat.color.set(c);
    this.stairs.light.color.set(c);
    this.stairs.glow.material.color.set(c);
  }

  pause() {
    this.state = 'paused';
    this.ui.show('pause');
  }
  resume() {
    this.state = 'playing';
    this.ui.hideAll();
  }

  endRun() {
    if (this.runEnded || !this.player) return;
    this.runEnded = true;
    const p = this.player;
    this.save.gold += p.gold;
    this.save.bestDepth = Math.max(this.save.bestDepth, this.depth);
    this.save.runs += 1;
    this.save.kills += p.kills;
    writeSave(this.save);
  }

  _runRows() {
    const p = this.player;
    const secs = Math.floor(this.time - this.runStart);
    return [
      ['Floor reached', this.depth],
      ['Level', p.level],
      ['Enemies slain', p.kills],
      ['Gold', `◈ ${p.gold}`],
      ['Time', `${Math.floor(secs / 60)}m ${secs % 60}s`],
      ['Seed', this.runSeedText],
    ];
  }

  die() {
    this.player.dead = true;
    this.state = 'dead';
    sfx.death();
    this.fx.burst(this.player.pos.x, 1, this.player.pos.z, 0xff3a3a, 60, 6, 1.2);
    this.player.mesh.visible = false;
    this.endRun();
    document.getElementById('btn-retry').textContent = 'Descend Again';
    setTimeout(() => this.ui.showDeath('You Have Fallen', [...this._runRows(), ['Gold banked', `◈ ${this.player.gold}`]]), 1200);
  }

  win() {
    this.victory = true;
    this.save.wins += 1;
    writeSave(this.save);
    this.state = 'dead';
    document.getElementById('btn-retry').textContent = 'Keep Descending (endless)';
    this.ui.showDeath('Victory! The Depths Are Sealed', this._runRows());
  }

  // ---------------------------------------------------------------- combat api
  spawnEnemy(type, x, z, awake = false, elite = false) {
    if (this.world.solidAt(x, z)) return null;
    const e = new Enemy(type, x, z, this.depth || 1, elite);
    this.scene.add(e.mesh);
    this.enemies.push(e);
    if (awake) {
      e.awake = true;
      this.fx.burst(x, 0.3, z, 0x8a6aff, 10, 3);
    }
    return e;
  }

  bossAwake(e) {
    this.boss = e;
    this.ui.el.bossName.textContent = (e.def.name + (this.depth > 4 ? ` · ${['', '', 'Reborn', 'Ascendant'][Math.min(3, this.depth / 4)] || 'Eternal'}` : '')).toUpperCase();
    sfx.roar();
    this.shake(0.5);
  }

  enemyShoot(e, angle, speed, dmg) {
    sfx.enemyShot();
    this.projectiles.spawn({ x: e.pos.x + Math.sin(angle) * e.radius, z: e.pos.z + Math.cos(angle) * e.radius, angle, speed, dmg, owner: 'enemy', radius: 0.22, life: 3 });
  }

  shake(n) {
    this.shakeAmt = Math.max(this.shakeAmt, n);
  }

  rollDamage(base) {
    const s = this.player.stats;
    const crit = Math.random() < s.crit;
    return { amount: Math.round(base * (0.9 + Math.random() * 0.2) * (crit ? s.critMult : 1)), crit };
  }

  damageEnemy(e, amount, crit, kx = 0, kz = 0) {
    if (e.dead) return;
    e.hp -= amount;
    e.flash = 0.09;
    e.wake(this);
    const kb = this.player.stats.knockback * (e.type === 'boss' ? 0.08 : e.type === 'brute' ? 0.35 : 1);
    e.knock.x += kx * kb;
    e.knock.y += kz * kb;
    this.numbers.spawn(e.pos.x, 2, e.pos.z, String(amount), crit ? 'crit' : '');
    this.fx.burst(e.pos.x, 1, e.pos.z, e.def.color, crit ? 10 : 5, 3.5, 0.4);
    if (crit) sfx.crit();
    else sfx.hit();
    const ls = this.player.stats.lifesteal;
    if (ls > 0) this.player.heal(amount * ls);
    if (e.hp <= 0) this.killEnemy(e);
  }

  killEnemy(e) {
    e.dead = true;
    this.scene.remove(e.mesh);
    this.enemies.splice(this.enemies.indexOf(e), 1);
    this.player.kills += 1;
    sfx.enemyDie();
    this.fx.burst(e.pos.x, 0.8, e.pos.z, e.def.color, e.type === 'boss' ? 80 : 18, e.type === 'boss' ? 9 : 5, 0.9);
    let xp = e.xp;
    while (xp > 0) {
      const v = Math.min(xp, 5);
      this.pickups.spawn('xp', e.pos.x, e.pos.z, v);
      xp -= v;
    }
    const goldMul = this.player.stats.goldMult;
    const goldChance = e.def.gold * (e.elite ? 2 : 1);
    if (e.type === 'boss') {
      for (let i = 0; i < 20; i++) this.pickups.spawn('gold', e.pos.x, e.pos.z, Math.round((3 + this.depth) * goldMul));
      this.pickups.spawn('potion', e.pos.x, e.pos.z);
      this.stairsLocked = false;
      this._updateStairsLook();
      this.ui.toast('The way down is open');
      this.shake(0.8);
      this.pendingChests += 1; // a guaranteed boon for the kill
      if (this.depth === FINAL_DEPTH) setTimeout(() => this.state !== 'menu' && this.win(), 1800);
    } else if (Math.random() < goldChance) {
      const n = 1 + ((Math.random() * 2) | 0);
      for (let i = 0; i < n; i++) this.pickups.spawn('gold', e.pos.x, e.pos.z, Math.max(1, Math.round((1 + this.depth * 0.5) * goldMul)));
    }
    if (Math.random() < (e.elite ? 0.4 : 0.035)) this.pickups.spawn('potion', e.pos.x, e.pos.z);
  }

  damagePlayer(amount, src) {
    const p = this.player;
    if (p.invuln > 0 || p.dead) return;
    const dmg = Math.max(1, Math.round(amount - p.stats.armor));
    p.hp -= dmg;
    p.invuln = 0.5;
    p.hurtFlash = 0.25;
    this.shake(0.3);
    sfx.hurt();
    this.numbers.spawn(p.pos.x, 2.2, p.pos.z, `-${dmg}`, 'hurt');
    if (p.stats.thorns && src && !src.dead && src.hp !== undefined) this.damageEnemy(src, p.stats.thorns, false);
    if (p.hp <= 0) {
      if (p.secondWind) {
        p.secondWind = false;
        p.hp = p.stats.maxHp * 0.5;
        p.invuln = 2;
        this.ui.toast('Second Wind!');
        sfx.levelUp();
        this.fx.ring(p.pos.x, p.pos.z, 5, 0x6aff9a);
        for (const e of this.enemies) {
          const dx = e.pos.x - p.pos.x;
          const dz = e.pos.z - p.pos.z;
          const d = Math.hypot(dx, dz) || 1;
          if (d < 6) e.knock.set((dx / d) * 18, (dz / d) * 18);
        }
      } else this.die();
    }
  }

  gainXp(n) {
    const p = this.player;
    p.xp += n;
    while (p.xp >= p.xpNext) {
      p.xp -= p.xpNext;
      p.level += 1;
      p.xpNext = xpForLevel(p.level);
      this.pendingLevels += 1;
      p.heal(p.stats.maxHp * 0.1);
    }
  }

  openPerks(title) {
    this.state = 'perks';
    const choices = rollPerks(this.player.taken, 3);
    this.ui.showPerks(title, choices, (perk) => {
      sfx.click();
      perk.apply(this.player.stats, this.player);
      this.player.taken[perk.id] = (this.player.taken[perk.id] || 0) + 1;
      this.ui.hideAll();
      this.state = 'playing';
    });
  }

  // ---------------------------------------------------------------- frame
  _frame(now) {
    const dt = Math.min(0.05, (now - this._last) / 1000);
    this._last = now;
    this.time += dt;
    const state = this.state;
    if (state === 'menu') this._updateMenu(dt);
    else if (state === 'playing') this._update(dt);
    else if (state === 'dead') this._updateFx(dt);
    else if (state === 'paused' && this.input.hit('Escape', 'KeyP')) this.resume();
    this.renderer.render(this.scene, this.camera);
    this.input.endFrame();
    requestAnimationFrame((t) => this._frame(t));
  }

  _updateMenu(dt) {
    const t = this.time * 0.08;
    const c = this.menuCenter;
    this.camera.position.set(c.x + Math.cos(t) * 26, 24, c.z + Math.sin(t) * 26);
    this.camera.lookAt(c.x, 0, c.z);
    this.world.update(dt, this.time, c.x + Math.cos(t * 2) * 10, c.z + Math.sin(t * 2) * 10);
  }

  _updateFx(dt) {
    this.ui.update(dt, this);
    this.fx.update(dt);
    this.numbers.update(dt, this.camera, this.vw, this.vh);
    this.world.update(dt, this.time, this.player.pos.x, this.player.pos.z);
    this._updateCamera(dt);
  }

  _update(dt) {
    const p = this.player;
    const s = p.stats;
    const inp = this.input;
    const w = this.world;

    if (inp.hit('Escape', 'KeyP')) return this.pause();
    if (inp.hit('Tab')) this.ui.toggleMap();

    // ---- aim
    const ndc = new THREE.Vector2((inp.mouse.x / this.vw) * 2 - 1, -(inp.mouse.y / this.vh) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    if (this.raycaster.ray.intersectPlane(this.aimPlane, this.aimPoint)) {
      p.facing = Math.atan2(this.aimPoint.x - p.pos.x, this.aimPoint.z - p.pos.z);
    }

    // ---- timers
    p.attackTimer -= dt;
    p.boltTimer -= dt;
    p.dashTimer -= dt;
    p.invuln -= dt;
    p.hurtFlash -= dt;
    if (s.regen > 0 && p.hp < s.maxHp) p.heal(s.regen * dt);

    // ---- movement
    let mx = (inp.down('KeyD', 'ArrowRight') ? 1 : 0) - (inp.down('KeyA', 'ArrowLeft') ? 1 : 0);
    let mz = (inp.down('KeyS', 'ArrowDown') ? 1 : 0) - (inp.down('KeyW', 'ArrowUp') ? 1 : 0);
    const ml = Math.hypot(mx, mz);
    if (ml > 0) {
      mx /= ml;
      mz /= ml;
    }
    if (inp.hit('Space', 'ShiftLeft', 'ShiftRight') && p.dashReady) {
      p.dashT = 0.17;
      p.dashTimer = s.dashCd;
      p.invuln = Math.max(p.invuln, 0.24);
      if (ml > 0) p.dashDir.set(mx, mz);
      else p.dashDir.set(Math.sin(p.facing), Math.cos(p.facing));
      sfx.dash();
    }
    if (p.dashT > 0) {
      p.dashT -= dt;
      w.moveCircle(p.pos, p.dashDir.x * 19 * dt, p.dashDir.y * 19 * dt, p.radius);
      if (Math.random() < 0.8) this.fx.burst(p.pos.x, 0.6, p.pos.z, 0x9ad8ff, 2, 1, 0.3);
    } else {
      w.moveCircle(p.pos, mx * s.moveSpeed * dt, mz * s.moveSpeed * dt, p.radius);
    }

    // ---- sword sweep
    if (inp.mouse.left && p.attackTimer <= 0) {
      p.attackTimer = 1 / s.attackRate;
      p.swingT = 0;
      p.swingDir = -p.swingDir;
      sfx.swing();
      const reach = s.swingRange;
      for (const e of this.enemies.slice()) {
        const dx = e.pos.x - p.pos.x;
        const dz = e.pos.z - p.pos.z;
        const d = Math.hypot(dx, dz);
        if (d > reach + e.radius) continue;
        let diff = Math.atan2(dx, dz) - p.facing;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        if (Math.abs(diff) > s.swingArc / 2 && d > e.radius + p.radius) continue;
        const { amount, crit } = this.rollDamage(s.dmg);
        this.damageEnemy(e, amount, crit, dx / (d || 1), dz / (d || 1));
      }
      // deflect enemy projectiles
      const list = this.projectiles.list;
      for (let i = list.length - 1; i >= 0; i--) {
        const pr = list[i];
        if (pr.owner !== 'enemy') continue;
        const dx = pr.x - p.pos.x;
        const dz = pr.z - p.pos.z;
        if (Math.hypot(dx, dz) > reach) continue;
        let diff = Math.atan2(dx, dz) - p.facing;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        if (Math.abs(diff) > s.swingArc / 2) continue;
        this.fx.burst(pr.x, 1, pr.z, 0xffa0d0, 6, 3, 0.3);
        this.projectiles.remove(i);
      }
    }

    // ---- arcane bolt
    if (inp.mouse.right && p.boltTimer <= 0) {
      p.boltTimer = s.boltCd;
      sfx.bolt();
      const n = s.boltCount;
      for (let i = 0; i < n; i++) {
        const a = p.facing + (i - (n - 1) / 2) * 0.17;
        const { amount, crit } = this.rollDamage(s.boltDmg);
        this.projectiles.spawn({ x: p.pos.x + Math.sin(a) * 0.6, z: p.pos.z + Math.cos(a) * 0.6, angle: a, speed: s.boltSpeed, dmg: amount, crit, owner: 'player', pierce: s.boltPierce, life: 1.3 });
      }
    }

    // ---- potion
    if (inp.hit('KeyQ') && p.potions > 0 && p.hp < s.maxHp) {
      p.potions -= 1;
      const h = Math.round(s.maxHp * 0.4);
      p.heal(h);
      sfx.potion();
      this.numbers.spawn(p.pos.x, 2.2, p.pos.z, `+${h}`, 'heal');
      this.fx.burst(p.pos.x, 1, p.pos.z, 0xff6a8a, 16, 2.5);
    }

    // ---- enemies
    this.flowTimer -= dt;
    if (this.flowTimer <= 0) {
      this.flowTimer = 0.25;
      w.computeFlow(p.pos.x, p.pos.z);
    }
    for (const e of this.enemies.slice()) if (!e.dead) e.update(dt, this);
    if (p.dead) return this._updateFx(dt);

    this._updateProjectiles(dt);
    this._updatePickups(dt);
    this._updateInteractables(dt);

    // ---- fog of war & minimap
    this.revealTimer -= dt;
    if (this.revealTimer <= 0) {
      this.revealTimer = 0.12;
      w.reveal(p.pos.x, p.pos.z);
      this.ui.drawMinimap(this);
    }

    p.updateVisual(dt, ml > 0, this.time);
    this._updateFx(dt);

    if (this.state === 'playing') {
      if (this.pendingChests > 0) {
        this.pendingChests -= 1;
        sfx.chest();
        this.openPerks('Treasure!');
      } else if (this.pendingLevels > 0) {
        this.pendingLevels -= 1;
        sfx.levelUp();
        this.openPerks(`Level ${p.level - this.pendingLevels}!`);
      }
    }
  }

  _updateProjectiles(dt) {
    const list = this.projectiles.list;
    const p = this.player;
    for (let i = list.length - 1; i >= 0; i--) {
      const pr = list[i];
      pr.life -= dt;
      pr.x += pr.vx * dt;
      pr.z += pr.vz * dt;
      pr.mesh.position.set(pr.x, 1.0, pr.z);
      if (pr.life <= 0 || this.world.solidAt(pr.x, pr.z)) {
        this.fx.burst(pr.x, 1, pr.z, pr.owner === 'player' ? 0x6ad0ff : 0xff5ab0, 5, 2, 0.3);
        this.projectiles.remove(i);
        continue;
      }
      if (pr.owner === 'player') {
        let removed = false;
        for (const e of this.enemies.slice()) {
          if (pr.hit.has(e)) continue;
          if ((e.pos.x - pr.x) ** 2 + (e.pos.z - pr.z) ** 2 < (e.radius + pr.radius) ** 2) {
            pr.hit.add(e);
            const l = Math.hypot(pr.vx, pr.vz);
            this.damageEnemy(e, pr.dmg, pr.crit, (pr.vx / l) * 0.5, (pr.vz / l) * 0.5);
            if (pr.pierce-- <= 0) {
              this.projectiles.remove(i);
              removed = true;
              break;
            }
          }
        }
        if (removed) continue;
      } else if ((p.pos.x - pr.x) ** 2 + (p.pos.z - pr.z) ** 2 < (p.radius + pr.radius) ** 2) {
        if (p.dashT > 0) continue; // dash through bullets
        this.damagePlayer(pr.dmg, null);
        this.projectiles.remove(i);
      }
    }
  }

  _updatePickups(dt) {
    const p = this.player;
    const list = this.pickups.list;
    for (let i = list.length - 1; i >= 0; i--) {
      const it = list[i];
      it.t += dt;
      it.age += dt;
      const dx = p.pos.x - it.x;
      const dz = p.pos.z - it.z;
      const d = Math.hypot(dx, dz);
      if (it.age > 0.35 && d < p.stats.magnet && (it.kind !== 'potion' || d < 1.4)) it.magnet = true;
      if (it.magnet) {
        const sp = 6 + it.t * 6;
        it.x += (dx / d) * Math.min(d, sp * dt);
        it.z += (dz / d) * Math.min(d, sp * dt);
      } else {
        const ox = it.x;
        const oz = it.z;
        it.x += it.vx * dt;
        it.z += it.vz * dt;
        if (this.world.solidAt(it.x, it.z)) {
          it.x = ox;
          it.z = oz;
          it.vx = it.vz = 0;
        }
        it.vx *= 1 - Math.min(1, dt * 4);
        it.vz *= 1 - Math.min(1, dt * 4);
      }
      it.mesh.position.set(it.x, 0.45 + Math.sin(it.t * 4) * 0.12, it.z);
      it.mesh.rotation.y += dt * 3;
      if (d < 0.6) {
        if (it.kind === 'xp') {
          this.gainXp(it.value);
          sfx.pickup();
        } else if (it.kind === 'gold') {
          p.gold += it.value;
          sfx.coin();
          this.numbers.spawn(p.pos.x, 2.4, p.pos.z, `+${it.value}◈`, 'gold');
        } else if (it.kind === 'potion') {
          if (p.potions < 5) p.potions += 1;
          else p.heal(20);
          sfx.potion();
          this.ui.toast('Potion', 1);
        }
        this.scene.remove(it.mesh);
        list.splice(i, 1);
      }
    }
  }

  _updateInteractables(dt) {
    const p = this.player;
    let nearest = null;
    let nd = 2.2;
    for (const it of this.interactables) {
      if (it.kind === 'stairs') {
        it.ring.rotation.z += dt * 0.8;
        it.ring2.rotation.z -= dt * 1.6;
        it.ring2.position.y = 0.6 + Math.sin(this.time * 2) * 0.25;
      } else if (it.kind === 'shrine' && !it.used) {
        it.orb.rotation.y += dt;
        it.orb.position.y = 1.85 + Math.sin(this.time * 2) * 0.1;
      } else if (it.kind === 'chest' && it.used && it.lid.rotation.x > -1.9) {
        it.lid.rotation.x -= dt * 6;
      }
      if (it.used) continue;
      const d = Math.hypot(it.x - p.pos.x, it.z - p.pos.z);
      if (d < nd) {
        nd = d;
        nearest = it;
      }
    }
    const labels = {
      stairs: this.stairsLocked ? 'Sealed — defeat the guardian' : '[E] Descend',
      chest: '[E] Open chest',
      shrine: '[E] Pray at the shrine',
    };
    this.ui.prompt(nearest ? labels[nearest.kind] : '');
    if (nearest && this.input.hit('KeyE')) this._interact(nearest);
  }

  _interact(it) {
    const p = this.player;
    if (it.kind === 'stairs') {
      if (this.stairsLocked) {
        this.ui.toast('The guardian still lives');
        return;
      }
      sfx.stairs();
      p.heal(p.stats.maxHp * 0.15);
      this.loadFloor(this.depth + 1);
    } else if (it.kind === 'chest') {
      it.used = true;
      it.light.intensity = 1;
      const n = 4 + ((Math.random() * 4) | 0);
      for (let i = 0; i < n; i++) this.pickups.spawn('gold', it.x, it.z, Math.max(1, Math.round((2 + this.depth) * p.stats.goldMult)));
      this.fx.burst(it.x, 1, it.z, 0xffd04a, 30, 5);
      this.pendingChests += 1;
    } else if (it.kind === 'shrine') {
      it.used = true;
      it.orbMat.color.set(0x334038);
      it.light.intensity = 0;
      const h = Math.round(p.stats.maxHp * 0.6);
      p.stats.maxHp += 5;
      p.heal(h + 5);
      sfx.potion();
      this.numbers.spawn(p.pos.x, 2.2, p.pos.z, `+${h}`, 'heal');
      this.fx.ring(it.x, it.z, 3, 0x6aff9a);
      this.ui.toast('The shrine restores you (+5 max health)');
    }
  }

  _updateCamera(dt) {
    const p = this.player;
    this.camTarget.lerp(p.pos, Math.min(1, dt * 8));
    // lean the camera slightly toward the aim point
    const lead = new THREE.Vector3(Math.sin(p.facing), 0, Math.cos(p.facing)).multiplyScalar(1.5);
    const tgt = this.camTarget.clone().add(lead);
    this.camera.position.copy(tgt).add(CAM_OFFSET);
    if (this.shakeAmt > 0) {
      this.camera.position.x += (Math.random() - 0.5) * this.shakeAmt;
      this.camera.position.z += (Math.random() - 0.5) * this.shakeAmt;
      this.shakeAmt = Math.max(0, this.shakeAmt - dt * 2);
    }
    this.camera.lookAt(tgt.x, 0, tgt.z);
  }
}

export { ENEMY_DEFS, isBossFloor };
