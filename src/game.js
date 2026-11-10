import * as THREE from 'three';
import { generateDungeon, isBossFloor, FINAL_DEPTH } from './dungeon.js';
import { hashSeed } from './rng.js';
import { World, tileCenter, themeFor, disposeTree } from './world.js';
import { Renderer } from './render.js';
import { Player, xpForLevel } from './player.js';
import { Enemy, ENEMY_DEFS } from './enemies.js';
import { Effects, Projectiles, Pickups, DamageNumbers } from './effects.js';
import { PERKS, rollPerks } from './perks.js';
import { UI } from './ui.js';
import { loadSave, writeSave } from './save.js';
import { sfx, unlockAudio, setVolume, startDrone } from './audio.js';
import { makeTrap, makeUrn, makeMerchant, makePortal, setPortalColor, makeChest, makeShrine, trapState, TRAP_PERIOD } from './props.js';

const CAM_OFFSET = new THREE.Vector3(0, 19, 12.5);
const _v2 = new THREE.Vector2();
const _v3 = new THREE.Vector3();

class Input {
  constructor(canvas) {
    this.keys = new Set();
    this.pressed = new Set();
    this.mouse = { x: 0, y: 0, left: false, right: false };
    // Typing into a text field (the seed box) is not game input.
    const typing = (e) => e.target instanceof HTMLElement && (e.target.tagName === 'INPUT' || e.target.isContentEditable);
    addEventListener('keydown', (e) => {
      if (e.repeat || typing(e)) return;
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
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(46, 1, 0.1, 200);
    this.renderer = new Renderer(this.canvas, this.scene, this.camera);
    this.hemi = new THREE.HemisphereLight(0x3a4a6a, 0x120c08, 1.15);
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
    this.settings = this.save.settings;
    this.renderer.setQuality(this.settings.quality);
    this.numbers.enabled = this.settings.damageNumbers;
    this.timers = []; // game-time timers (never wall-clock setTimeout)
    this.simTime = 0;
    this.fadeEl = document.getElementById('fade');
    this.perkById = Object.fromEntries(PERKS.map((p) => [p.id, p]));
    this.enemies = [];
    this.interactables = [];
    this.traps = [];
    this.urns = [];
    this.dying = [];
    this.blasts = [];
    this.hitStop = 0;
    this._frozenFrames = 0;
    this.deathDelay = 0;
    this.state = 'menu';
    this.world = null;
    this.player = null;

    this._bindUI();
    this._resize();
    addEventListener('resize', () => this._resize());
    matchMedia?.('(resolution: 1dppx)')?.addEventListener?.('change', () => this._resize());
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
    on('btn-settings', () => this.openSettings('menu'));
    on('btn-pause-settings', () => this.openSettings('pause'));
    on('btn-resume', () => this.resume());
    on('btn-leave-shop', () => this.closeShop());
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
        if (this.settingsFrom === 'pause' && b.closest('#settings')) {
          this.settingsFrom = null;
          this.ui.show('pause');
          return;
        }
        this.settingsFrom = null;
        this.ui.show('menu');
        this.ui.renderMenuStats(this.save);
      });
    const quit = document.getElementById('btn-quit');
    if (window.depthwarden?.quit) quit.addEventListener('click', () => window.depthwarden.quit());
    else quit.classList.add('hidden');
    this.ui.bindSettings(this.save, (key, value) => {
      if (key === 'volume') {
        this.save.volume = value;
        setVolume(value);
      } else {
        this.settings[key] = value;
        if (key === 'quality') this._applyQuality();
        if (key === 'damageNumbers') this.numbers.enabled = value;
      }
      writeSave(this.save);
    });
    addEventListener('keydown', (e) => {
      if (e.code === 'F11' && !window.depthwarden) {
        e.preventDefault();
        if (document.fullscreenElement) document.exitFullscreen();
        else document.documentElement.requestFullscreen?.();
      }
      if (this.state === 'perks' && ['Digit1', 'Digit2', 'Digit3'].includes(e.code)) {
        const cards = document.querySelectorAll('#perk-cards .card');
        cards[Number(e.code.slice(-1)) - 1]?.click();
      }
    });
  }

  openSettings(from) {
    this.settingsFrom = from;
    this.ui.syncSettings(this.save);
    this.ui.show('settings');
  }

  _applyQuality() {
    const q = this.settings.quality;
    this.renderer.setQuality(q);
    this.player?.setShadows(q === 'high');
    this._frozenFrames = 0;
    // particle budgets are chosen when a floor is built; rebuild the backdrop
    if (this.state === 'menu') this._buildMenuWorld();
  }

  _resize() {
    const w = innerWidth;
    const h = innerHeight;
    this.renderer.resize(w, h); // also re-reads devicePixelRatio
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.vw = w;
    this.vh = h;
  }

  // ---------------------------------------------------------------- flow
  toMenu() {
    this.closeLargeMap();
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
    this.fadeEl.style.opacity = '0';
    this._buildMenuWorld();
  }

  // A slowly orbiting fly-over of a random dungeon as the menu backdrop.
  _buildMenuWorld() {
    if (this.world) this.world.dispose();
    const d = generateDungeon((Math.random() * 1e9) | 0, 1 + ((Math.random() * 12) | 0));
    this._applyTheme(d.depth);
    this.world = new World(this.scene, d, { quality: this.settings.quality });
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
    this.simTime = 0;
    this.timers = [];
    if (this.player) this.player.dispose();
    this.player = new Player(this.scene, this.save);
    this.player.setShadows(this.settings.quality === 'high');
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
    this.scene.fog = new THREE.FogExp2(th.bg, 0.024);
    this.hemi.color.set(th.hemi[0]);
    this.hemi.groundColor.set(th.hemi[1]);
  }

  _clearFloor() {
    if (this.world) this.world.dispose();
    this.world = null;
    // remove AND free GPU resources (shared/cached ones are skipped)
    const drop = (o) => {
      this.scene.remove(o.mesh);
      disposeTree(o.mesh);
    };
    this.enemies.forEach(drop);
    this.enemies = [];
    this.interactables.forEach(drop);
    this.interactables = [];
    [...this.traps, ...this.urns, ...this.dying].forEach(drop);
    this.traps = [];
    this.urns = [];
    this.dying = [];
    this.blasts = [];
    this.timers = this.timers.filter((t) => t.persist);
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
    this.world = new World(this.scene, d, { quality: this.settings.quality });
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
    for (const t of d.traps) {
      const c = tileCenter(t.x, t.y);
      const trap = makeTrap(c.x, c.z);
      this.scene.add(trap.mesh);
      this.traps.push({ ...trap, x: c.x, z: c.z, tx: t.x, ty: t.y, phase: t.phase * TRAP_PERIOD, cycle: -1 });
    }
    d.urns.forEach((u, i) => {
      const c = tileCenter(u.x, u.y);
      const mesh = makeUrn(c.x, c.z, u.x * 7 + u.y * 13 + i);
      this.scene.add(mesh);
      this.urns.push({ x: c.x, z: c.z, mesh, broken: false });
    });
    this.merchantBoons = 0;
    const st = tileCenter(d.stairs.x, d.stairs.y);
    this.stairs = this._makeInteractable('stairs', st.x, st.z);
    this.stairsLocked = d.boss;
    this._updateStairsLook();
    this.flowTimer = 0;
    this.revealTimer = 0;
    this.world.computeFlow(this.player.pos.x, this.player.pos.z);
    this.world.reveal(this.player.pos.x, this.player.pos.z);
    const th = themeFor(depth);
    this.ui.setFloor(d.boss ? `Floor ${depth} · Guardian` : `Floor ${depth}`, `${th.name} · Seed ${this.runSeedText}`);
    this.ui.banner(d.boss ? `The Guardian's Lair` : `Floor ${depth}`, d.boss ? `Floor ${depth} · ${th.name}` : th.name);
    if (this.ui.mmLarge) this.ui.toggleMap();
    this.ui.drawMinimap(this);
  }

  _makeInteractable(kind, x, z) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    const it = { kind, x, z, mesh: g, used: false };
    const w = this.world;
    if (kind === 'stairs') {
      it.portal = makePortal();
      g.add(it.portal.mesh);
      it.emitter = w.addEmitter({ x, z, y: 1.4, color: 0x5ad8ff, intensity: 18, distance: 11, priority: 6 });
    } else if (kind === 'chest') {
      const c = makeChest();
      it.lid = c.lid;
      g.add(c.mesh);
      it.emitter = w.addEmitter({ x, z, y: 1.4, color: 0xffc860, intensity: 6, distance: 6, priority: 2 });
    } else if (kind === 'merchant') {
      g.add(makeMerchant());
      it.emitter = w.addEmitter({ x: x + 0.5, z, y: 1.9, color: 0xffc88a, intensity: 14, distance: 9, priority: 4, flicker: 1 });
    } else if (kind === 'shrine') {
      const sh = makeShrine();
      it.orb = sh.orb;
      it.orbMat = sh.orbMat;
      g.add(sh.mesh);
      it.emitter = w.addEmitter({ x, z, y: 2.2, color: 0x6aff9a, intensity: 12, distance: 9, priority: 4 });
    }
    this.scene.add(g);
    this.interactables.push(it);
    return it;
  }

  _updateStairsLook() {
    const c = this.stairsLocked ? 0xff3a5a : 0x5ad8ff;
    setPortalColor(this.stairs.portal, c);
    this.stairs.emitter.color.set(c);
  }

  // Game-time timer: advances only while the simulation runs, and is dropped
  // when the floor or run is torn down (unlike setTimeout).
  after(seconds, fn) {
    this.timers.push({ t: seconds, fn });
  }

  _tickTimers(dt) {
    for (let i = this.timers.length - 1; i >= 0; i--) {
      const t = this.timers[i];
      t.t -= dt;
      if (t.t <= 0) {
        this.timers.splice(i, 1);
        t.fn();
      }
    }
  }

  closeLargeMap() {
    if (this.ui.mmLarge) this.ui.toggleMap();
  }

  pause() {
    this.closeLargeMap();
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
    const secs = Math.floor(this.simTime);
    return [
      ['Floor reached', this.depth],
      ['Level', p.level],
      ['Enemies slain', p.kills],
      ['Gold', p.gold],
      ['Time', `${Math.floor(secs / 60)}m ${secs % 60}s`],
      ['Seed', this.runSeedText],
    ];
  }

  die() {
    this.closeLargeMap();
    this.player.dead = true;
    this.state = 'dead';
    sfx.death();
    this.fx.burst(this.player.pos.x, 1, this.player.pos.z, 0xff3a3a, 60, 6, 1.2);
    this.player.mesh.visible = false;
    this.endRun();
    document.getElementById('btn-retry').textContent = 'Descend Again';
    this.deathDelay = 1.4; // show the death screen once the death effect has played
    this.renderer.fx.hurt = 1;
  }

  win() {
    if (this.player.dead || this.state === 'menu') return;
    this.victory = true;
    this.deathDelay = 0;
    this.save.wins += 1;
    writeSave(this.save);
    this.state = 'dead';
    document.getElementById('btn-retry').textContent = 'Keep Descending (endless)';
    this.ui.showDeath('The Depths Are Sealed', this._runRows(), true);
  }

  // ---------------------------------------------------------------- combat api
  spawnEnemy(type, x, z, awake = false, elite = false) {
    if (this.world.solidAt(x, z)) return null;
    const e = new Enemy(type, x, z, this.depth || 1, elite);
    this.scene.add(e.mesh);
    this.enemies.push(e);
    if (e.lightSpec) e.emitter = this.world.addEmitter({ ...e.lightSpec, x, z, follow: e.mesh });
    if (awake) {
      e.awake = true;
      this.fx.burst(x, 0.3, z, 0x8a6aff, 10, 3);
    }
    return e;
  }

  bossAwake(e) {
    this.boss = e;
    this.ui.hideBanner(); // the boss bar takes over the top of the screen
    this.ui.el.bossName.textContent = (e.def.name + (this.depth > 4 ? ` · ${['', '', 'Reborn', 'Ascendant'][Math.min(3, this.depth / 4)] || 'Eternal'}` : '')).toUpperCase();
    sfx.roar();
    this.shake(0.5);
  }

  enemyShoot(e, angle, speed, dmg, quiet = false) {
    if (!quiet) sfx.enemyShot();
    this.projectiles.spawn({ x: e.pos.x + Math.sin(angle) * e.radius, z: e.pos.z + Math.cos(angle) * e.radius, angle, speed, dmg, owner: 'enemy', radius: 0.22, life: 3 });
  }

  shake(n) {
    if (!this.settings.screenShake) return;
    this.shakeAmt = Math.max(this.shakeAmt, n);
  }

  rollDamage(base) {
    const s = this.player.stats;
    const crit = Math.random() < s.crit;
    return { amount: Math.round(base * (0.9 + Math.random() * 0.2) * (crit ? s.critMult : 1)), crit };
  }

  damageEnemy(e, amount, crit, kx = 0, kz = 0) {
    if (e.dead) return;
    const dealt = Math.min(amount, Math.max(0, e.hp)); // overkill doesn't count for lifesteal
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
    if (ls > 0) this.player.heal(dealt * ls);
    if (e.hp <= 0) this.killEnemy(e);
  }

  killEnemy(e, selfDestruct = false) {
    if (e.dead && !selfDestruct) return;
    e.dead = true;
    const i = this.enemies.indexOf(e);
    if (i >= 0) this.enemies.splice(i, 1);
    e.mat.emissive.setRGB(1, 1, 1);
    this.dying.push({ mesh: e.mesh, t: 0, s: e.mesh.scale.x });
    if (e.emitter) this.world.removeEmitter(e.emitter);
    if (selfDestruct) return; // a Bloater that blew itself up gives no reward
    if (e.type === 'bloater' && !e.exploded) {
      e.exploded = true;
      this.blasts.push({ x: e.pos.x, z: e.pos.z, t: 0.4, r: e.def.blast * 0.85, dmg: e.dmg * 0.8 });
      this.fx.ring(e.pos.x, e.pos.z, e.def.blast * 0.85, 0xc8e04a);
      sfx.fuse();
    }
    this.hitStop = Math.max(this.hitStop, e.type === 'boss' ? 0.6 : e.elite ? 0.09 : 0.045);
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
      if (this.depth === FINAL_DEPTH) this.after(1.8, () => this.win());
    } else if (Math.random() < goldChance) {
      const n = 1 + ((Math.random() * 2) | 0);
      for (let i = 0; i < n; i++) this.pickups.spawn('gold', e.pos.x, e.pos.z, Math.max(1, Math.round((1 + this.depth * 0.5) * goldMul)));
    }
    if (Math.random() < (e.elite ? 0.4 : 0.035)) this.pickups.spawn('potion', e.pos.x, e.pos.z);
  }

  explode(x, z, r, dmg, src) {
    sfx.boom();
    this.shake(0.6);
    this.fx.ring(x, z, r, 0xd8f05a);
    this.fx.burst(x, 0.6, z, 0xb8d84a, 40, 8, 0.8);
    this.fx.burst(x, 0.6, z, 0xff9a3a, 24, 6, 0.6);
    const p = this.player;
    if (Math.hypot(p.pos.x - x, p.pos.z - z) < r + p.radius) this.damagePlayer(dmg, null);
    for (const e of this.enemies.slice()) {
      if (e === src || e.dead) continue;
      const d = Math.hypot(e.pos.x - x, e.pos.z - z);
      if (d < r + e.radius) this.damageEnemy(e, Math.round(dmg * 1.5), false, (e.pos.x - x) / (d || 1), (e.pos.z - z) / (d || 1));
    }
    for (const u of this.urns) if (!u.broken && Math.hypot(u.x - x, u.z - z) < r) this.breakUrn(u);
  }

  breakUrn(u) {
    u.broken = true;
    this.scene.remove(u.mesh);
    sfx.shatter();
    this.fx.burst(u.x, 0.5, u.z, 0xa8643a, 14, 4, 0.6);
    const roll = Math.random();
    if (roll < 0.55) {
      const n = 1 + ((Math.random() * 3) | 0);
      for (let i = 0; i < n; i++) this.pickups.spawn('gold', u.x, u.z, Math.max(1, Math.round((1 + this.depth * 0.4) * this.player.stats.goldMult)));
    } else if (roll < 0.65) this.pickups.spawn('potion', u.x, u.z);
    else if (roll < 0.85) this.pickups.spawn('xp', u.x, u.z, 2 + this.depth);
  }

  openShop() {
    this.state = 'shop';
    const p = this.player;
    const d = this.depth;
    const render = () => {
      const offers = [
        { icon: 'flask', name: 'Healing Draught', desc: '+1 potion (carry up to 5)', cost: 12 + 3 * d, ok: p.potions < 5, buy: () => (p.potions += 1) },
        { icon: 'heart', name: 'Full Restore', desc: 'Heal to full health', cost: 18 + 5 * d, ok: p.hp < p.stats.maxHp, buy: () => (p.hp = p.stats.maxHp) },
        {
          icon: 'star',
          name: 'Mystery Boon',
          desc: 'Choose 1 of 3 perks',
          cost: Math.round((35 + 10 * d) * (1 + 0.6 * this.merchantBoons)),
          ok: true,
          buy: () => {
            this.merchantBoons += 1;
            this.pendingChests += 1;
            this.closeShop();
          },
        },
      ];
      this.ui.renderShop(p.gold, offers, (o) => {
        if (p.gold < o.cost || !o.ok) return;
        p.gold -= o.cost;
        sfx.buy();
        o.buy();
        if (this.state === 'shop') render();
      });
    };
    render();
    this.ui.show('shop');
  }

  closeShop() {
    this.ui.hideAll();
    this.state = 'playing';
  }

  _updateTraps(dt) {
    const p = this.player;
    const [ptx, pty] = this.world.toTile(p.pos.x, p.pos.z);
    for (const tr of this.traps) {
      const t = (this.time + tr.phase) % TRAP_PERIOD;
      const cycle = Math.floor((this.time + tr.phase) / TRAP_PERIOD);
      const st = trapState(t);
      const target = st === 'up' ? 0 : st === 'warn' ? -0.55 : -0.75;
      tr.spikes.position.y += (target - tr.spikes.position.y) * Math.min(1, dt * (st === 'up' ? 30 : 8));
      if (st !== 'up') continue;
      if (tr.cycle !== cycle) {
        tr.cycle = cycle;
        if (Math.hypot(tr.x - p.pos.x, tr.z - p.pos.z) < 14) sfx.spike();
      }
      if (ptx === tr.tx && pty === tr.ty && p.dashT <= 0) this.damagePlayer(8 + this.depth * 2, null);
      for (const e of this.enemies.slice()) {
        if (e.def.float || e.type === 'boss' || e._trapCycle === cycle) continue;
        const [ex, ey] = this.world.toTile(e.pos.x, e.pos.z);
        if (ex === tr.tx && ey === tr.ty) {
          e._trapCycle = cycle;
          this.damageEnemy(e, 12 + this.depth * 3, false);
        }
      }
    }
  }

  damagePlayer(amount, src) {
    const p = this.player;
    if (p.invuln > 0 || p.dead) return;
    const dmg = Math.max(1, Math.round(amount - p.stats.armor));
    p.hp -= dmg;
    p.invuln = 0.5;
    p.hurtFlash = 0.25;
    this.renderer.fx.hurt = Math.min(1, 0.35 + dmg / p.stats.maxHp * 3);
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
      if (this.state !== 'perks') return; // ignore double clicks
      sfx.click();
      perk.apply(this.player.stats, this.player);
      this.player.taken[perk.id] = (this.player.taken[perk.id] || 0) + 1;
      this.ui.hideAll();
      this.state = 'playing';
    }, this.player.taken);
  }

  // ---------------------------------------------------------------- frame
  _frame(now) {
    const dt = Math.min(0.05, (now - this._last) / 1000);
    this._last = now;
    this.time += dt;
    const state = this.state;
    let render = true;
    if (state === 'menu') this._updateMenu(dt);
    else if (state === 'playing') {
      // brief hit-stop on kills and big hits gives impacts some weight
      let simDt = dt;
      if (this.hitStop > 0) {
        this.hitStop -= dt;
        simDt = dt * 0.1;
      }
      this._update(simDt);
    } else if (state === 'transition') this._updateTransition(dt);
    else if (state === 'dead') {
      this._updateFx(dt);
      if (this.deathDelay > 0 && (this.deathDelay -= dt) <= 0) this.ui.showDeath('You Have Fallen', this._runRows().map(([k, v]) => (k === 'Gold' ? ['Gold banked', v] : [k, v])));
    } else {
      // paused / perks / shop / settings: the scene is frozen, so don't burn
      // the GPU re-rendering an identical frame (the canvas keeps the last one)
      render = this._frozenFrames++ < 2;
      if (state === 'paused' && this.input.hit('Escape', 'KeyP')) this.resume();
      else if (state === 'shop' && this.input.hit('Escape', 'KeyE')) this.closeShop();
    }
    if (state !== 'paused' && state !== 'perks' && state !== 'shop' && state !== 'settings') this._frozenFrames = 0;
    // post-processing inputs decay over time
    const fx = this.renderer.fx;
    fx.hurt = Math.max(0, fx.hurt - dt * 2.2);
    fx.lowHp = this.player && !this.player.dead && this.state !== 'menu' ? Math.max(0, 1 - this.player.hp / this.player.stats.maxHp / 0.3) : 0;
    if (render) this.renderer.render(this.time);
    this.input.endFrame();
    requestAnimationFrame((t) => this._frame(t));
  }

  // Fade to black, build the next floor, fade back in.
  descend() {
    this.state = 'transition';
    this.transT = 0;
    this.transLoaded = false;
    sfx.stairs();
  }

  _updateTransition(dt) {
    this.transT += dt;
    if (!this.transLoaded) {
      this.fadeEl.style.opacity = String(Math.min(1, this.transT / 0.45));
      this._updateFx(dt);
      if (this.transT >= 0.5) {
        this.transLoaded = true;
        const p = this.player;
        p.heal(p.stats.maxHp * 0.15);
        this.loadFloor(this.depth + 1);
        this.transT = 0;
      }
    } else {
      this.fadeEl.style.opacity = String(Math.max(0, 1 - this.transT / 0.6));
      this._updateFx(dt);
      if (this.transT >= 0.6) {
        this.fadeEl.style.opacity = '0';
        this.state = 'playing';
      }
    }
  }

  _updateMenu(dt) {
    const t = this.time * 0.08;
    const c = this.menuCenter;
    this.camera.position.set(c.x + Math.cos(t) * 17, 15, c.z + Math.sin(t) * 17);
    this.camera.lookAt(c.x, 0, c.z);
    this.world.update(dt, this.time, c.x, c.z, false);
  }

  _updateFx(dt) {
    this.ui.update(dt, this);
    this.fx.update(dt);
    for (let i = this.dying.length - 1; i >= 0; i--) {
      const d = this.dying[i];
      d.t += dt;
      const k = 1 - d.t / 0.22;
      if (k <= 0) {
        this.scene.remove(d.mesh);
        disposeTree(d.mesh);
        this.dying.splice(i, 1);
        continue;
      }
      d.mesh.scale.set(d.s * (1 + (1 - k) * 0.4), d.s * k, d.s * (1 + (1 - k) * 0.4));
    }
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
    if (inp.hit('Tab')) {
      this.ui.toggleMap();
      this.ui.drawMinimap(this);
    }
    this.simTime += dt;
    this._tickTimers(dt);

    // ---- aim
    const ndc = _v2.set((inp.mouse.x / this.vw) * 2 - 1, -(inp.mouse.y / this.vh) * 2 + 1);
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
      for (const u of this.urns) {
        if (u.broken) continue;
        const dx = u.x - p.pos.x;
        const dz = u.z - p.pos.z;
        const d = Math.hypot(dx, dz);
        if (d > reach + 0.4) continue;
        let diff = Math.atan2(dx, dz) - p.facing;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        if (Math.abs(diff) <= s.swingArc / 2 || d < 0.9) this.breakUrn(u);
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
    this._updateTraps(dt);
    for (let i = this.blasts.length - 1; i >= 0; i--) {
      const b = this.blasts[i];
      b.t -= dt;
      if (b.t <= 0) {
        this.blasts.splice(i, 1);
        this.explode(b.x, b.z, b.r, b.dmg, null);
      }
    }

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
        this.openPerks('Treasure Found');
      } else if (this.pendingLevels > 0) {
        this.pendingLevels -= 1;
        sfx.levelUp();
        this.openPerks(`Level ${p.level - this.pendingLevels}`);
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
      if (Math.random() < 0.7) this.fx.trail(pr.x, 1.0, pr.z, pr.trail, pr.owner === 'player' ? 0.28 : 0.2);
      if (pr.life <= 0 || this.world.solidAt(pr.x, pr.z)) {
        this.fx.burst(pr.x, 1, pr.z, pr.owner === 'player' ? 0x6ad0ff : 0xff5ab0, 5, 2, 0.3);
        this.projectiles.remove(i);
        continue;
      }
      if (pr.owner === 'player') {
        const urn = this.urns.find((u) => !u.broken && (u.x - pr.x) ** 2 + (u.z - pr.z) ** 2 < 0.45);
        if (urn) {
          this.breakUrn(urn);
          this.projectiles.remove(i);
          continue;
        }
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
        if (d > 1e-6) {
          // guard: d == 0 would produce NaN and the pickup could never be collected
          const sp = 6 + it.t * 6;
          it.x += (dx / d) * Math.min(d, sp * dt);
          it.z += (dz / d) * Math.min(d, sp * dt);
        }
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
    // chests, shrines and the merchant's stall are solid
    const solid = { chest: 0.75, shrine: 1.0, merchant: 1.1 };
    for (const it of this.interactables) {
      const r = solid[it.kind];
      if (!r) continue;
      const dx = p.pos.x - it.x;
      const dz = p.pos.z - it.z;
      const d = Math.hypot(dx, dz);
      const min = r + p.radius;
      if (d < min && d > 1e-4) {
        p.pos.x = it.x + (dx / d) * min;
        p.pos.z = it.z + (dz / d) * min;
      }
    }
    let nearest = null;
    let nd = 2.2;
    for (const it of this.interactables) {
      if (it.kind === 'stairs') {
        it.portal.shader.uniforms.uTime.value = this.time;
        it.portal.ring.position.y = 0.55 + Math.sin(this.time * 2) * 0.2;
        it.portal.ring.rotation.y += dt;
        if (!this.stairsLocked && Math.random() < 0.3) this.fx.sparks(it.x + (Math.random() - 0.5) * 2, 0.2, it.z + (Math.random() - 0.5) * 2, 0x5ad8ff, 1, 0.6, 1.2, -1.5);
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
      merchant: '[E] Trade with the merchant',
    };
    this.ui.prompt(nearest ? labels[nearest.kind] : '', nearest?.kind === 'stairs' && this.stairsLocked);
    if (nearest && this.input.hit('KeyE')) this._interact(nearest);
  }

  _interact(it) {
    const p = this.player;
    if (it.kind === 'stairs') {
      if (this.stairsLocked) {
        this.ui.toast('The guardian still lives');
        return;
      }
      this.descend();
    } else if (it.kind === 'chest') {
      it.used = true;
      it.emitter.intensity = 3;
      const n = 4 + ((Math.random() * 4) | 0);
      for (let i = 0; i < n; i++) this.pickups.spawn('gold', it.x, it.z, Math.max(1, Math.round((2 + this.depth) * p.stats.goldMult)));
      this.fx.burst(it.x, 1, it.z, 0xffd04a, 30, 5);
      this.pendingChests += 1;
    } else if (it.kind === 'merchant') {
      this.openShop();
    } else if (it.kind === 'shrine') {
      it.used = true;
      it.orbMat.color.set(0x334038);
      it.emitter.intensity = 0;
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
    const tgt = _v3.set(Math.sin(p.facing) * 1.5, 0, Math.cos(p.facing) * 1.5).add(this.camTarget);
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
