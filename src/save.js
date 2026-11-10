// Persistent meta-progression (gold banked between runs and permanent upgrades).
const KEY = 'depthwarden-save-v1';

export const UPGRADES = [
  { id: 'vitality', icon: 'heart', name: 'Vitality', desc: '+12 max health', max: 5, cost: (l) => 40 + l * 40 },
  { id: 'might', icon: 'sword', name: 'Might', desc: '+8% damage', max: 5, cost: (l) => 50 + l * 50 },
  { id: 'swiftness', icon: 'boot', name: 'Swiftness', desc: '+4% move speed', max: 4, cost: (l) => 40 + l * 45 },
  { id: 'fortune', icon: 'coin', name: 'Fortune', desc: '+15% gold found', max: 4, cost: (l) => 60 + l * 50 },
  { id: 'satchel', icon: 'flask', name: 'Satchel', desc: '+1 starting potion', max: 2, cost: (l) => 80 + l * 80 },
  { id: 'secondWind', icon: 'flame', name: 'Second Wind', desc: 'Revive once per run at 50% health', max: 1, cost: () => 400 },
];

export const QUALITIES = ['low', 'medium', 'high'];
const defaultSettings = () => ({ quality: 'medium', screenShake: true, damageNumbers: true });
const defaults = () => ({ gold: 0, upgrades: {}, bestDepth: 0, runs: 0, kills: 0, wins: 0, volume: 0.6, settings: defaultSettings() });

// Coerce untrusted JSON into a well-formed save: a hand-edited or partially
// written file must never crash the game or produce NaN gold.
export function sanitizeSave(obj) {
  const d = defaults();
  if (!obj || typeof obj !== 'object') return d;
  const num = (v, fallback, min = 0, max = 1e9) => (Number.isFinite(Number(v)) ? Math.min(max, Math.max(min, Math.floor(Number(v)))) : fallback);
  const out = {
    gold: num(obj.gold, 0),
    bestDepth: num(obj.bestDepth, 0),
    runs: num(obj.runs, 0),
    kills: num(obj.kills, 0),
    wins: num(obj.wins, 0),
    volume: Number.isFinite(Number(obj.volume)) ? Math.min(1, Math.max(0, Number(obj.volume))) : d.volume,
    upgrades: {},
    settings: defaultSettings(),
  };
  for (const u of UPGRADES) out.upgrades[u.id] = num(obj.upgrades?.[u.id], 0, 0, u.max);
  const s = obj.settings || {};
  if (QUALITIES.includes(s.quality)) out.settings.quality = s.quality;
  if (typeof s.screenShake === 'boolean') out.settings.screenShake = s.screenShake;
  if (typeof s.damageNumbers === 'boolean') out.settings.damageNumbers = s.damageNumbers;
  return out;
}

export function loadSave() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return sanitizeSave(JSON.parse(raw));
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
