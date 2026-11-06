// DOM overlay: HUD, minimap, menus and modal screens.
import { UPGRADES, upgradeLevel } from './save.js';
import { WALL } from './dungeon.js';
import { sfx } from './audio.js';

const $ = (id) => document.getElementById(id);

export class UI {
  constructor() {
    this.el = {
      hud: $('hud'),
      hpFill: $('hp-fill'),
      hpText: $('hp-text'),
      xpFill: $('xp-fill'),
      xpText: $('xp-text'),
      level: $('level'),
      gold: $('gold'),
      kills: $('kills'),
      floor: $('floor-label'),
      minimap: $('minimap'),
      potionCount: $('potion-count'),
      bossBar: $('boss-bar'),
      bossName: $('boss-name'),
      bossFill: $('boss-fill'),
      prompt: $('prompt'),
      perkList: $('perk-list'),
      vignette: $('vignette'),
      banner: $('banner'),
      toast: $('toast'),
      dmgLayer: $('dmg-layer'),
    };
    this.cd = {
      swing: $('ab-swing').querySelector('i'),
      bolt: $('ab-bolt').querySelector('i'),
      dash: $('ab-dash').querySelector('i'),
    };
    this.screens = ['menu', 'armory', 'controls', 'perks', 'shop', 'pause', 'death'].reduce((o, id) => ((o[id] = $(id)), o), {});
    this.mm = this.el.minimap.getContext('2d');
    this.mmLarge = false;
    this._toastTimer = 0;
    this._lastPerkKey = '';
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
    this.el.minimap.classList.toggle('large', this.mmLarge);
    const s = this.mmLarge ? 640 : 200;
    this.el.minimap.width = this.el.minimap.height = s;
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

  toast(text, seconds = 2) {
    this.el.toast.textContent = text;
    this.el.toast.classList.add('show');
    this._toastTimer = seconds;
  }

  prompt(text) {
    if (!text) this.el.prompt.classList.add('hidden');
    else {
      this.el.prompt.textContent = text;
      this.el.prompt.classList.remove('hidden');
    }
  }

  update(dt, game) {
    const p = game.player;
    const s = p.stats;
    this.el.hpFill.style.width = `${(Math.max(0, p.hp) / s.maxHp) * 100}%`;
    this.el.hpText.textContent = `${Math.ceil(Math.max(0, p.hp))} / ${Math.round(s.maxHp)}`;
    this.el.xpFill.style.width = `${(p.xp / p.xpNext) * 100}%`;
    this.el.xpText.textContent = `${p.xp} / ${p.xpNext}`;
    this.el.level.textContent = `Lv ${p.level}`;
    this.el.gold.textContent = `◈ ${p.gold}`;
    this.el.kills.textContent = `☠ ${p.kills}`;
    this.el.potionCount.textContent = p.potions;
    this.cd.swing.style.height = `${Math.max(0, p.attackTimer * s.attackRate) * 100}%`;
    this.cd.bolt.style.height = `${Math.max(0, p.boltTimer / s.boltCd) * 100}%`;
    this.cd.dash.style.height = `${Math.max(0, p.dashTimer / s.dashCd) * 100}%`;
    this.el.vignette.style.opacity = String(Math.max(p.hurtFlash * 2, p.hp / s.maxHp < 0.3 ? 0.35 + Math.sin(game.time * 5) * 0.15 : 0));

    const boss = game.boss;
    if (boss && !boss.dead) {
      this.el.bossBar.classList.remove('hidden');
      this.el.bossFill.style.width = `${(boss.hp / boss.maxHp) * 100}%`;
    } else this.el.bossBar.classList.add('hidden');

    const key = Object.entries(p.taken).map(([k, v]) => k + v).join();
    if (key !== this._lastPerkKey) {
      this._lastPerkKey = key;
      this.el.perkList.innerHTML = '';
      for (const [id, n] of Object.entries(p.taken)) {
        const perk = game.perkById[id];
        const d = document.createElement('div');
        d.textContent = `${perk.icon} ${perk.name}${n > 1 ? ' ×' + n : ''}`;
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
    // small map is centred on the player; large map shows the whole floor
    const view = this.mmLarge ? Math.max(w.W, w.H) : 44;
    const cell = size / view;
    const ox = this.mmLarge ? 0 : ptx - view / 2;
    const oy = this.mmLarge ? 0 : pty - view / 2;
    for (let y = Math.max(0, Math.floor(oy)); y < Math.min(w.H, oy + view + 1); y++) {
      for (let x = Math.max(0, Math.floor(ox)); x < Math.min(w.W, ox + view + 1); x++) {
        const k = y * w.W + x;
        if (w.tiles[k] === WALL) {
          // draw walls that border explored floor
          let edge = false;
          for (let j = -1; j <= 1 && !edge; j++)
            for (let i = -1; i <= 1; i++) {
              const nx = x + i;
              const ny = y + j;
              if (nx >= 0 && ny >= 0 && nx < w.W && ny < w.H && w.explored[ny * w.W + nx]) {
                edge = true;
                break;
              }
            }
          if (!edge) continue;
          ctx.fillStyle = '#6a5a48';
        } else if (w.explored[k]) ctx.fillStyle = '#2c2822';
        else continue;
        ctx.fillRect((x - ox) * cell, (y - oy) * cell, Math.ceil(cell), Math.ceil(cell));
      }
    }
    const dot = (tx, ty, color, r) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc((tx - ox + 0.5) * cell, (ty - oy + 0.5) * cell, r, 0, Math.PI * 2);
      ctx.fill();
    };
    const st = w.d.stairs;
    if (w.explored[st.y * w.W + st.x]) dot(st.x, st.y, game.stairsLocked ? '#ff4a6a' : '#5ad8ff', Math.max(3, cell));
    for (const it of game.interactables) {
      if (it.used || it.kind === 'stairs') continue;
      const [tx, ty] = w.toTile(it.x, it.z);
      if (w.explored[ty * w.W + tx]) dot(tx, ty, { chest: '#f0c860', shrine: '#6aff9a', merchant: '#c08aff' }[it.kind], Math.max(2.5, cell * 0.8));
    }
    for (const e of game.enemies) {
      if (!e.awake) continue;
      const [tx, ty] = w.toTile(e.pos.x, e.pos.z);
      if (w.explored[ty * w.W + tx]) dot(tx, ty, e.type === 'boss' ? '#ff4aa0' : '#e04040', e.type === 'boss' ? 5 : 2);
    }
    dot(ptx, pty, '#ffffff', 3.5);
  }

  showPerks(title, perks, onPick) {
    $('perks-title').textContent = title;
    const wrap = $('perk-cards');
    wrap.innerHTML = '';
    perks.forEach((perk, i) => {
      const c = document.createElement('div');
      c.className = 'perk';
      c.innerHTML = `<div class="icon"></div><h3></h3><p></p><div class="key">Press ${i + 1}</div>`;
      c.querySelector('.icon').textContent = perk.icon;
      c.querySelector('h3').textContent = perk.name;
      c.querySelector('p').textContent = perk.desc;
      c.addEventListener('click', () => onPick(perk));
      wrap.appendChild(c);
    });
    this.show('perks');
  }

  renderShop(gold, offers, onBuy) {
    $('shop-gold').textContent = `◈ ${gold}`;
    const list = $('shop-items');
    list.innerHTML = '';
    offers.forEach((o) => {
      const c = document.createElement('div');
      c.className = 'perk shop-item';
      c.innerHTML = `<div class="icon"></div><h3></h3><p></p><button></button>`;
      c.querySelector('.icon').textContent = o.icon;
      c.querySelector('h3').textContent = o.name;
      c.querySelector('p').textContent = o.desc;
      const b = c.querySelector('button');
      b.textContent = o.ok ? `Buy · ◈ ${o.cost}` : 'Not needed';
      b.disabled = !o.ok || gold < o.cost;
      b.addEventListener('click', () => onBuy(o));
      list.appendChild(c);
    });
  }

  renderMenuStats(save) {
    $('menu-stats').innerHTML =
      `Banked gold: <b style="color:var(--gold)">◈ ${save.gold}</b><br>` +
      `Deepest floor: ${save.bestDepth} · Runs: ${save.runs} · Victories: ${save.wins} · Lifetime kills: ${save.kills}`;
  }

  renderArmory(save, onBuy) {
    $('armory-gold').textContent = `◈ ${save.gold}`;
    const list = $('armory-list');
    list.innerHTML = '';
    for (const u of UPGRADES) {
      const lvl = upgradeLevel(save, u.id);
      const maxed = lvl >= u.max;
      const cost = maxed ? 0 : u.cost(lvl);
      const card = document.createElement('div');
      card.className = 'upgrade';
      card.innerHTML = `<h3></h3><div class="pips"></div><p></p><button></button>`;
      card.querySelector('h3').textContent = u.name;
      card.querySelector('.pips').textContent = '◆'.repeat(lvl) + '◇'.repeat(u.max - lvl);
      card.querySelector('p').textContent = u.desc;
      const b = card.querySelector('button');
      b.textContent = maxed ? 'Maxed' : `Buy · ◈ ${cost}`;
      b.disabled = maxed || save.gold < cost;
      b.addEventListener('click', () => {
        sfx.coin();
        onBuy(u, cost);
      });
      list.appendChild(card);
    }
  }

  showDeath(title, rows) {
    $('death-title').textContent = title;
    const s = $('death-stats');
    s.innerHTML = '';
    for (const [k, v] of rows) {
      const a = document.createElement('div');
      a.textContent = k;
      const b = document.createElement('div');
      b.textContent = v;
      s.append(a, b);
    }
    this.show('death');
  }
}
