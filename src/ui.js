// DOM overlay: HUD, minimap, menus and modal screens.
//
// Performance note: the HUD is refreshed every frame, but the DOM is only
// written when a displayed value actually changes (see `set*` helpers), so we
// don't force style recalculation dozens of times per frame.
import { UPGRADES, upgradeLevel } from './save.js';
import { WALL } from './dungeon.js';
import { sfx } from './audio.js';
import { icon } from './icons.js';

const $ = (id) => document.getElementById(id);

const QUALITY_HINTS = {
  low: 'Fastest. No glow or post-processing; good for older laptops.',
  medium: 'Bloom, colour grading and atmosphere particles.',
  high: 'Everything, plus real-time shadows from your lantern. Needs a decent GPU.',
};

export class UI {
  constructor() {
    for (const el of document.querySelectorAll('[data-icon]')) el.innerHTML = icon(el.dataset.icon);
    this.el = {
      hud: $('hud'),
      hpFill: $('hp-fill'),
      hpChip: $('hp-chip'),
      hpText: $('hp-text'),
      xpFill: $('xp-fill'),
      level: $('level'),
      gold: $('gold'),
      kills: $('kills'),
      floor: $('floor-label'),
      floorSub: $('floor-sub'),
      minimap: $('minimap'),
      mapFrame: $('map-frame'),
      potionCount: $('potion-count'),
      potionSlot: $('ab-potion'),
      bossBar: $('boss-bar'),
      bossName: $('boss-name'),
      bossFill: $('boss-fill'),
      bossChip: $('boss-chip'),
      prompt: $('prompt'),
      perkList: $('perk-list'),
      banner: $('banner'),
      toast: $('toast'),
      dmgLayer: $('dmg-layer'),
    };
    // CSS fallback vignette for the Low preset (no post-processing there)
    this.el.vignette = document.createElement('div');
    this.el.vignette.id = 'vignette';
    $('app').insertBefore(this.el.vignette, this.el.dmgLayer);

    this.cd = {};
    for (const k of ['swing', 'bolt', 'dash']) this.cd[k] = { slot: $(`ab-${k}`), cd: $(`ab-${k}`).querySelector('.cd'), last: 0 };
    this.screens = ['menu', 'armory', 'controls', 'settings', 'perks', 'shop', 'pause', 'death'].reduce((o, id) => ((o[id] = $(id)), o), {});
    this.mm = this.el.minimap.getContext('2d');
    this.mmLarge = false;
    this._toastTimer = 0;
    this._cache = new Map();
    this._lastPerkKey = '';
  }

  // write-if-changed helpers
  _set(key, el, prop, value) {
    if (this._cache.get(key) === value) return;
    this._cache.set(key, value);
    if (prop === 'text') el.textContent = value;
    else if (prop === 'width') el.style.width = value;
    else if (prop === 'opacity') el.style.opacity = value;
    else el.style.setProperty(prop, value);
  }

  show(name) {
    for (const [k, el] of Object.entries(this.screens)) el.classList.toggle('hidden', k !== name);
  }
  hideAll() {
    this.show(null);
  }
  setHud(visible) {
    this.el.hud.classList.toggle('hidden', !visible);
  }

  toggleMap() {
    this.mmLarge = !this.mmLarge;
    this.el.mapFrame.classList.toggle('large', this.mmLarge);
    const s = this.mmLarge ? 720 : 200;
    this.el.minimap.width = this.el.minimap.height = s;
  }

  setFloor(title, sub) {
    this.el.floor.textContent = title;
    this.el.floorSub.textContent = sub;
  }

  banner(title, sub) {
    const b = this.el.banner;
    b.classList.remove('hidden');
    $('banner-title').textContent = title;
    $('banner-sub').textContent = sub;
    b.style.animation = 'none';
    void b.offsetWidth; // restart animation
    b.style.animation = '';
  }

  hideBanner() {
    this.el.banner.classList.add('hidden');
  }

  toast(text, seconds = 2) {
    this.el.toast.textContent = text;
    this.el.toast.classList.add('show');
    this._toastTimer = seconds;
  }

  // text like "[E] Descend" renders the key as a keycap
  prompt(text, locked = false) {
    const p = this.el.prompt;
    if (this._cache.get('prompt') === text + locked) return;
    this._cache.set('prompt', text + locked);
    if (!text) {
      p.classList.add('hidden');
      return;
    }
    p.classList.remove('hidden');
    p.classList.toggle('locked', locked);
    p.textContent = '';
    const m = /^\[(\w+)\]\s*(.*)$/.exec(text);
    if (m) {
      const k = document.createElement('kbd');
      k.textContent = m[1];
      p.append(k, m[2]);
    } else p.textContent = text;
  }

  update(dt, game) {
    const p = game.player;
    const s = p.stats;
    const hpPct = `${(Math.max(0, p.hp) / s.maxHp) * 100}%`;
    this._set('hp', this.el.hpFill, 'width', hpPct);
    // the white "chip" lags behind damage but snaps up on heals
    const chipNow = parseFloat(this._cache.get('hpChip') || '100');
    if (parseFloat(hpPct) > chipNow) this.el.hpChip.style.transition = 'none';
    else this.el.hpChip.style.transition = '';
    this._set('hpChip', this.el.hpChip, 'width', hpPct);
    this._set('hpText', this.el.hpText, 'text', `${Math.ceil(Math.max(0, p.hp))} / ${Math.round(s.maxHp)}`);
    this._set('xp', this.el.xpFill, 'width', `${(p.xp / p.xpNext) * 100}%`);
    this._set('level', this.el.level, 'text', String(p.level));
    this._set('gold', this.el.gold, 'text', String(p.gold));
    this._set('kills', this.el.kills, 'text', String(p.kills));
    this._set('potions', this.el.potionCount, 'text', String(p.potions));
    this.el.potionSlot.classList.toggle('empty', p.potions === 0);
    this.el.hud.classList.toggle('low-hp', p.hp / s.maxHp < 0.3);

    const cds = { swing: Math.max(0, p.attackTimer * s.attackRate), bolt: Math.max(0, p.boltTimer / s.boltCd), dash: Math.max(0, p.dashTimer / s.dashCd) };
    for (const [k, v] of Object.entries(cds)) {
      const c = this.cd[k];
      const q = Math.round(v * 60) / 60;
      if (q !== c.last) {
        c.cd.style.setProperty('--p', q);
        if (q === 0 && c.last > 0.15 && k !== 'swing') {
          // flash when a long cooldown comes back
          c.slot.classList.remove('ready');
          void c.slot.offsetWidth;
          c.slot.classList.add('ready');
        }
        c.last = q;
      }
    }

    // fallback vignette when post-processing is off
    const fx = game.renderer.fx;
    const cssVig = game.renderer.composer ? 0 : Math.min(1, fx.hurt + fx.lowHp * (0.5 + 0.2 * Math.sin(game.time * 5)));
    this._set('vig', this.el.vignette, 'opacity', cssVig.toFixed(2));

    const boss = game.boss;
    if (boss && !boss.dead) {
      this.el.bossBar.classList.remove('hidden');
      const pct = `${(Math.max(0, boss.hp) / boss.maxHp) * 100}%`;
      this._set('boss', this.el.bossFill, 'width', pct);
      this._set('bossChip', this.el.bossChip, 'width', pct);
    } else this.el.bossBar.classList.add('hidden');

    const key = Object.entries(p.taken)
      .map(([k, v]) => k + v)
      .join();
    if (key !== this._lastPerkKey) {
      this._lastPerkKey = key;
      this.el.perkList.innerHTML = '';
      for (const [id, n] of Object.entries(p.taken)) {
        const perk = game.perkById[id];
        const d = document.createElement('div');
        d.className = 'pk';
        d.title = `${perk.name}: ${perk.desc}`;
        d.innerHTML = icon(perk.icon) + (n > 1 ? `<b>${n}</b>` : '');
        this.el.perkList.appendChild(d);
      }
    }

    if (this._toastTimer > 0) {
      this._toastTimer -= dt;
      if (this._toastTimer <= 0) this.el.toast.classList.remove('show');
    }
  }

  drawMinimap(game) {
    const w = game.world;
    const ctx = this.mm;
    const size = this.el.minimap.width;
    ctx.clearRect(0, 0, size, size);
    const p = game.player;
    const [ptx, pty] = w.toTile(p.pos.x, p.pos.z);
    // small map follows the player; large map shows the whole floor
    const view = this.mmLarge ? Math.max(w.W, w.H) : 40;
    const cell = size / view;
    const ox = this.mmLarge ? 0 : ptx - view / 2;
    const oy = this.mmLarge ? 0 : pty - view / 2;
    const x0 = Math.max(0, Math.floor(ox));
    const y0 = Math.max(0, Math.floor(oy));
    const x1 = Math.min(w.W, Math.ceil(ox + view) + 1);
    const y1 = Math.min(w.H, Math.ceil(oy + view) + 1);
    const seen = (x, y) => x >= 0 && y >= 0 && x < w.W && y < w.H && w.explored[y * w.W + x];
    // floor
    ctx.fillStyle = '#3a3226';
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) if (w.tiles[y * w.W + x] !== WALL && seen(x, y)) ctx.fillRect((x - ox) * cell, (y - oy) * cell, Math.ceil(cell), Math.ceil(cell));
    // wall edges drawn as gold lines where explored floor meets wall
    ctx.strokeStyle = '#a8864a';
    ctx.lineWidth = Math.max(1, cell * 0.22);
    ctx.beginPath();
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        if (w.tiles[y * w.W + x] === WALL || !seen(x, y)) continue;
        const sx = (x - ox) * cell;
        const sy = (y - oy) * cell;
        if (!w.walkable(x - 1, y)) (ctx.moveTo(sx, sy), ctx.lineTo(sx, sy + cell));
        if (!w.walkable(x + 1, y)) (ctx.moveTo(sx + cell, sy), ctx.lineTo(sx + cell, sy + cell));
        if (!w.walkable(x, y - 1)) (ctx.moveTo(sx, sy), ctx.lineTo(sx + cell, sy));
        if (!w.walkable(x, y + 1)) (ctx.moveTo(sx, sy + cell), ctx.lineTo(sx + cell, sy + cell));
      }
    ctx.stroke();

    const dot = (tx, ty, color, r, glow = false) => {
      const cx = (tx - ox + 0.5) * cell;
      const cy = (ty - oy + 0.5) * cell;
      if (glow) {
        ctx.fillStyle = color + '44';
        ctx.beginPath();
        ctx.arc(cx, cy, r * 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    };
    const st = w.d.stairs;
    if (seen(st.x, st.y)) dot(st.x, st.y, game.stairsLocked ? '#ff4a6a' : '#5ad8ff', Math.max(3.5, cell * 0.9), true);
    for (const it of game.interactables) {
      if (it.used || it.kind === 'stairs') continue;
      const [tx, ty] = w.toTile(it.x, it.z);
      if (seen(tx, ty)) dot(tx, ty, { chest: '#f0c860', shrine: '#6aff9a', merchant: '#c08aff' }[it.kind], Math.max(2.8, cell * 0.7), true);
    }
    for (const e of game.enemies) {
      if (!e.awake) continue;
      const [tx, ty] = w.toTile(e.pos.x, e.pos.z);
      if (seen(tx, ty)) dot(tx, ty, e.type === 'boss' ? '#ff4aa0' : '#e04848', e.type === 'boss' ? 5 : 2.2);
    }
    // player: an arrow pointing where they aim
    const cx = (p.pos.x / 2 - ox) * cell;
    const cy = (p.pos.z / 2 - oy) * cell;
    const a = p.facing;
    const r = Math.max(5, cell * 1.1);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-a + Math.PI);
    ctx.fillStyle = '#fff4d6';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.lineTo(r * 0.65, r * 0.7);
    ctx.lineTo(0, r * 0.35);
    ctx.lineTo(-r * 0.65, r * 0.7);
    ctx.closePath();
    ctx.stroke();
    ctx.fill();
    ctx.restore();
    // soft vignette inside the small map
    if (!this.mmLarge) {
      const g = ctx.createRadialGradient(size / 2, size / 2, size * 0.3, size / 2, size / 2, size * 0.72);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,0.75)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, size, size);
    }
  }

  _card({ iconName, title, desc, foot, pickable, stack }) {
    const c = document.createElement('div');
    c.className = 'card' + (pickable ? ' pickable' : '');
    c.innerHTML = `<div class="medal">${icon(iconName)}</div><h3></h3><p></p>${stack ? '<div class="stack"></div>' : ''}<div class="foot"></div>`;
    c.querySelector('h3').textContent = title;
    c.querySelector('p').textContent = desc;
    if (stack) c.querySelector('.stack').textContent = stack;
    if (foot) c.querySelector('.foot').append(foot);
    return c;
  }

  showPerks(title, perks, onPick, taken = {}) {
    $('perks-title').textContent = title;
    const wrap = $('perk-cards');
    wrap.innerHTML = '';
    perks.forEach((perk, i) => {
      const key = document.createElement('kbd');
      key.textContent = String(i + 1);
      const n = taken[perk.id] || 0;
      const c = this._card({ iconName: perk.icon, title: perk.name, desc: perk.desc, foot: key, pickable: true, stack: n ? `Owned ×${n}` : '' });
      c.addEventListener('click', () => onPick(perk));
      wrap.appendChild(c);
    });
    this.show('perks');
  }

  renderShop(gold, offers, onBuy) {
    $('shop-gold').innerHTML = `${icon('coin')} ${gold}`;
    const list = $('shop-items');
    list.innerHTML = '';
    offers.forEach((o) => {
      const b = document.createElement('button');
      b.innerHTML = o.ok ? `Buy · ${icon('coin')} ${o.cost}` : 'Not needed';
      b.disabled = !o.ok || gold < o.cost;
      b.addEventListener('click', () => onBuy(o));
      list.appendChild(this._card({ iconName: o.icon, title: o.name, desc: o.desc, foot: b }));
    });
  }

  renderMenuStats(save) {
    const s = $('menu-stats');
    s.innerHTML = '';
    for (const [label, value, cls] of [
      ['Banked gold', save.gold, 'gold'],
      ['Deepest floor', save.bestDepth],
      ['Runs', save.runs],
      ['Victories', save.wins],
      ['Slain', save.kills],
    ]) {
      const d = document.createElement('div');
      if (cls) d.className = cls;
      const b = document.createElement('b');
      b.textContent = value;
      d.append(b, label);
      s.appendChild(d);
    }
  }

  renderArmory(save, onBuy) {
    $('armory-gold').innerHTML = `${icon('coin')} ${save.gold}`;
    const list = $('armory-list');
    list.innerHTML = '';
    for (const u of UPGRADES) {
      const lvl = upgradeLevel(save, u.id);
      const maxed = lvl >= u.max;
      const cost = maxed ? 0 : u.cost(lvl);
      const card = document.createElement('div');
      card.className = 'upgrade';
      card.innerHTML = `<div class="medal">${icon(u.icon)}</div><h3></h3><p></p><div class="pips">${'<i class="on"></i>'.repeat(lvl)}${'<i></i>'.repeat(u.max - lvl)}</div><button></button>`;
      card.querySelector('h3').textContent = u.name;
      card.querySelector('p').textContent = u.desc;
      const b = card.querySelector('button');
      b.innerHTML = maxed ? 'Mastered' : `Buy · ${icon('coin')} ${cost}`;
      b.disabled = maxed || save.gold < cost;
      b.addEventListener('click', () => {
        sfx.coin();
        onBuy(u, cost);
      });
      list.appendChild(card);
    }
  }

  showDeath(title, rows, victory = false) {
    $('death-title').textContent = title;
    this.screens.death.classList.toggle('victory', victory);
    const s = $('death-stats');
    s.innerHTML = '';
    for (const [k, v] of rows) {
      const d = document.createElement('div');
      const b = document.createElement('b');
      b.textContent = v;
      d.append(k, b);
      s.appendChild(d);
    }
    this.show('death');
  }

  // ---- settings screen
  bindSettings(save, onChange) {
    for (const b of $('set-quality').querySelectorAll('button'))
      b.addEventListener('click', () => {
        sfx.click();
        onChange('quality', b.dataset.v);
        this.syncSettings(save);
      });
    const vol = $('volume');
    vol.addEventListener('input', () => {
      vol.style.setProperty('--v', `${vol.value * 100}%`);
      onChange('volume', Number(vol.value));
    });
    for (const [id, key] of [
      ['set-shake', 'screenShake'],
      ['set-numbers', 'damageNumbers'],
    ])
      $(id).addEventListener('click', () => {
        sfx.click();
        onChange(key, !save.settings[key]);
        this.syncSettings(save);
      });
  }

  syncSettings(save) {
    for (const b of $('set-quality').querySelectorAll('button')) b.classList.toggle('on', b.dataset.v === save.settings.quality);
    $('quality-hint').textContent = QUALITY_HINTS[save.settings.quality];
    const vol = $('volume');
    vol.value = save.volume;
    vol.style.setProperty('--v', `${save.volume * 100}%`);
    for (const [id, key] of [
      ['set-shake', 'screenShake'],
      ['set-numbers', 'damageNumbers'],
    ]) {
      const t = $(id);
      t.classList.toggle('on', save.settings[key]);
      t.setAttribute('aria-checked', String(save.settings[key]));
    }
  }
}
