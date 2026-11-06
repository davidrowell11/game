// Run-scoped upgrades offered on level-up and from treasure chests.
import { upgradeLevel } from './save.js';

export function baseStats(save) {
  return {
    maxHp: 100 + 12 * upgradeLevel(save, 'vitality'),
    dmg: 14 * (1 + 0.08 * upgradeLevel(save, 'might')),
    attackRate: 2.4, // swings per second
    swingRange: 2.6,
    swingArc: Math.PI * 0.8,
    moveSpeed: 6.2 * (1 + 0.04 * upgradeLevel(save, 'swiftness')),
    boltDmg: 11 * (1 + 0.08 * upgradeLevel(save, 'might')),
    boltCd: 0.85,
    boltCount: 1,
    boltPierce: 0,
    boltSpeed: 19,
    crit: 0.05,
    critMult: 2,
    lifesteal: 0,
    dashCd: 1.1,
    armor: 0,
    regen: 0,
    magnet: 3.2,
    goldMult: 1 + 0.15 * upgradeLevel(save, 'fortune'),
    thorns: 0,
    knockback: 7,
  };
}

export const PERKS = [
  { id: 'whetstone', name: 'Whetstone', icon: '⚔', desc: '+20% sword damage', apply: (s) => (s.dmg *= 1.2) },
  { id: 'fleet', name: 'Fleetfoot', icon: '👣', desc: '+10% move speed', apply: (s) => (s.moveSpeed *= 1.1) },
  { id: 'quick', name: 'Quick Hands', icon: '✋', desc: '+15% attack speed', apply: (s) => (s.attackRate *= 1.15) },
  { id: 'reach', name: 'Long Reach', icon: '↔', desc: '+18% sword reach, wider arc', apply: (s) => ((s.swingRange *= 1.18), (s.swingArc = Math.min(Math.PI * 1.4, s.swingArc * 1.12))) },
  { id: 'focus', name: 'Arcane Focus', icon: '✦', desc: '+30% bolt damage', apply: (s) => (s.boltDmg *= 1.3) },
  { id: 'split', name: 'Split Bolt', icon: '⋔', desc: '+1 bolt per cast', max: 4, apply: (s) => (s.boltCount += 1) },
  { id: 'pierce', name: 'Piercing Bolt', icon: '➶', desc: 'Bolts pass through +1 enemy', max: 3, apply: (s) => (s.boltPierce += 1) },
  { id: 'overcharge', name: 'Overcharge', icon: '⚡', desc: '-18% bolt cooldown', apply: (s) => (s.boltCd *= 0.82) },
  { id: 'oak', name: 'Heart of Oak', icon: '♥', desc: '+25 max health and heal 25', apply: (s, p) => ((s.maxHp += 25), p.heal(25)) },
  { id: 'keen', name: 'Keen Eye', icon: '◎', desc: '+8% critical chance', apply: (s) => (s.crit += 0.08) },
  { id: 'brutal', name: 'Brutality', icon: '☠', desc: 'Critical hits deal +50% more', apply: (s) => (s.critMult += 0.5) },
  { id: 'vamp', name: 'Vampiric Edge', icon: '🩸', desc: 'Heal 4% of damage dealt', apply: (s) => (s.lifesteal += 0.04) },
  { id: 'iron', name: 'Iron Skin', icon: '⛨', desc: '-3 damage from every hit', apply: (s) => (s.armor += 3) },
  { id: 'regen', name: 'Regrowth', icon: '❀', desc: 'Regenerate 1 health per second', apply: (s) => (s.regen += 1) },
  { id: 'shadow', name: 'Shadowstep', icon: '»', desc: '-25% dash cooldown', apply: (s) => (s.dashCd *= 0.75) },
  { id: 'greed', name: 'Greed', icon: '◈', desc: '+40% gold, wider pickup radius', apply: (s) => ((s.goldMult += 0.4), (s.magnet *= 1.4)) },
  { id: 'thorns', name: 'Thornmail', icon: '✶', desc: 'Attackers take 12 damage', apply: (s) => (s.thorns += 12) },
  { id: 'heavy', name: 'Heavy Blows', icon: '⬣', desc: 'Much stronger knockback, +8% damage', apply: (s) => ((s.knockback *= 1.6), (s.dmg *= 1.08)) },
];

export function rollPerks(taken, count = 3, rand = Math.random) {
  const available = PERKS.filter((p) => !p.max || (taken[p.id] || 0) < p.max);
  const out = [];
  while (out.length < count && available.length) {
    const i = Math.floor(rand() * available.length);
    out.push(available.splice(i, 1)[0]);
  }
  return out;
}
