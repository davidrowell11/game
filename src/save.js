// Persistent meta-progression (gold banked between runs and permanent upgrades).
const KEY = 'depthwarden-save-v1';

export const UPGRADES = [
  { id: 'vitality', name: 'Vitality', desc: '+12 max health', max: 5, cost: (l) => 40 + l * 40 },
  { id: 'might', name: 'Might', desc: '+8% damage', max: 5, cost: (l) => 50 + l * 50 },
  { id: 'swiftness', name: 'Swiftness', desc: '+4% move speed', max: 4, cost: (l) => 40 + l * 45 },
  { id: 'fortune', name: 'Fortune', desc: '+15% gold found', max: 4, cost: (l) => 60 + l * 50 },
  { id: 'satchel', name: 'Satchel', desc: '+1 starting potion', max: 2, cost: (l) => 80 + l * 80 },
  { id: 'secondWind', name: 'Second Wind', desc: 'Revive once per run at 50% health', max: 1, cost: () => 400 },
];

const defaults = () => ({ gold: 0, upgrades: {}, bestDepth: 0, runs: 0, kills: 0, wins: 0, volume: 0.6 });

export function loadSave() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...defaults(), ...JSON.parse(raw) };
  } catch {
    /* storage unavailable or corrupt: start fresh */
  }
  return defaults();
}

export function writeSave(save) {
  try {
    localStorage.setItem(KEY, JSON.stringify(save));
  } catch {
    /* ignore */
  }
}

export const upgradeLevel = (save, id) => save.upgrades[id] || 0;
