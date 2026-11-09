// Game data: runes, enemies, upgrades, evolutions and every balance knob.
// Pure data + pure functions, shared by the simulation, the UI and tools/balance.mjs.

export const CAVE_LENGTH = 800;      // metres to the Warlord's throne
export const MAGE_SPEED = 4.8;       // metres per second while not blocked
export const SPAWN_AHEAD = 34;       // packs wake up when the mage gets this close
export const CAST_RANGE = 19;

// ---------------------------------------------------------------- biomes
export const BIOMES = [
  { id: 'entrance', name: 'The Maw',           from: 0,   fog: 0x0b1020, ambient: 0x4a5a86, accent: 0xff9a3c },
  { id: 'crystal',  name: 'Crystal Hollows',   from: 160, fog: 0x070d24, ambient: 0x3c5cae, accent: 0x4fd8ff },
  { id: 'fungal',   name: 'Glowcap Deeps',     from: 330, fog: 0x06140f, ambient: 0x2f7a5a, accent: 0x6dffa8 },
  { id: 'magma',    name: 'The Ember Forge',   from: 520, fog: 0x1a0704, ambient: 0x8a3a22, accent: 0xff5a1f },
  { id: 'throne',   name: "Warlord's Throne",  from: 720, fog: 0x12040f, ambient: 0x7a2a4a, accent: 0xff2a55 },
];

export function biomeAt(d) {
  let b = BIOMES[0];
  for (const x of BIOMES) if (d >= x.from) b = x;
  return b;
}

// ---------------------------------------------------------------- runes
// Glyph points live in a [-1,1] box, y pointing down (screen space).
const circle = [];
for (let i = 0; i <= 40; i++) {
  const a = -Math.PI / 2 + (i / 40) * Math.PI * 2;
  circle.push([Math.cos(a) * 0.95, Math.sin(a) * 0.95]);
}
const star = [];
for (let i = 0; i <= 5; i++) {
  const a = -Math.PI / 2 + i * (Math.PI * 4 / 5);
  star.push([Math.cos(a), Math.sin(a)]);
}

export const RUNES = {
  ember: {
    id: 'ember', name: 'Ember', element: 'fire', spell: 'Fireball',
    color: '#ff7a2a', hex: 0xff6a1a, hex2: 0xffd27a,
    glyph: [[0, -0.95], [0.95, 0.8], [-0.95, 0.8], [0, -0.95]], closed: true, complexity: 1,
    blurb: 'Explodes on impact and sets orcs ablaze.',
    tip: 'Splash damage. Burning orcs take damage over time.',
    cd: 1.05, dmg: 9, radius: 2.7,
  },
  storm: {
    id: 'storm', name: 'Storm', element: 'storm', spell: 'Chain Lightning',
    color: '#8fd0ff', hex: 0x7fc4ff, hex2: 0xe8f6ff,
    glyph: [[0.45, -1], [-0.55, 0.08], [0.55, -0.08], [-0.45, 1]], closed: false, complexity: 1,
    blurb: 'Instant bolts that leap from orc to orc.',
    tip: 'Fast casts, chains to 3 extra orcs. Shocked orcs take +20% damage.',
    cd: 0.52, dmg: 3.6, chains: 3, chainRange: 7,
  },
  frost: {
    id: 'frost', name: 'Frost', element: 'frost', spell: 'Ice Lance',
    color: '#7ff2ff', hex: 0x5fe6ff, hex2: 0xe6feff,
    glyph: [[-0.8, -0.95], [0.8, -0.95], [-0.8, 0.95], [0.8, 0.95], [-0.8, -0.95]], closed: true, complexity: 1.4,
    blurb: 'Piercing lances that chill everything in line.',
    tip: 'Pierces 4 orcs. Chilled orcs move and attack 40% slower.',
    cd: 0.85, dmg: 6.6, pierce: 4,
  },
  arcane: {
    id: 'arcane', name: 'Arcane', element: 'arcane', spell: 'Seeker Missiles',
    color: '#c58bff', hex: 0xb06cff, hex2: 0xf0dcff,
    glyph: circle, closed: true, complexity: 1,
    blurb: 'Homing missiles that turn orcs into gold.',
    tip: 'Marked orcs drop +60% gold, whoever lands the kill.',
    cd: 0.95, dmg: 3.2, missiles: 3,
  },
  void: {
    id: 'void', name: 'Void', element: 'void', spell: 'Singularity',
    color: '#ff5ad1', hex: 0xff3fc8, hex2: 0x2a0030,
    glyph: star, closed: true, complexity: 1.9,
    blurb: 'Tears a hole in the world that devours packs.',
    tip: 'Pulls orcs together and crushes them. Hardest rune to draw.',
    cd: 2.5, dmg: 6.3, radius: 5.5, duration: 1.8,
  },
};
export const RUNE_ORDER = ['ember', 'storm', 'frost', 'arcane', 'void'];

export const REACTIONS = {
  thermal: { name: 'THERMAL SHOCK', color: '#ffb24a' },   // fire on chilled
  overload: { name: 'OVERLOAD', color: '#ffe36a' },       // storm on burning
  freeze: { name: 'DEEP FREEZE', color: '#9ff4ff' },      // frost on shocked
};

// Rune quality (0..1 from the recogniser) -> power multiplier.
export function runePower(quality, mastery = 0) {
  return 0.6 + (0.9 + 0.12 * mastery) * quality;
}
export function runeGrade(quality) {
  if (quality >= 0.9) return 'S';
  if (quality >= 0.74) return 'A';
  if (quality >= 0.55) return 'B';
  if (quality >= 0.35) return 'C';
  return 'D';
}
// Drawing fast grants bonus cast speed (0 .. +25%).
export function runeTempo(seconds, complexity = 1) {
  const fast = 0.7 * complexity, slow = 3.2 * complexity;
  const k = Math.max(0, Math.min(1, (slow - seconds) / (slow - fast)));
  return 0.25 * k;
}

// ---------------------------------------------------------------- enemies
export const ENEMIES = {
  grunt:    { name: 'Orc Grunt',     hp: 24,  dmg: 9,   atk: 1.0,  speed: 4.8, reach: 1.6, r: 0.6,  gold: 4,   cost: 1 },
  whelp:    { name: 'Orc Whelp',     hp: 8,   dmg: 4.2, atk: 0.62, speed: 7.6, reach: 1.3, r: 0.42, gold: 1.4, cost: 0.42 },
  archer:   { name: 'Spear Thrower', hp: 15,  dmg: 7.5, atk: 2.2,  speed: 4.4, reach: 1.5, r: 0.55, gold: 4,   cost: 1.4, range: 12 },
  brute:    { name: 'Orc Brute',     hp: 95,  dmg: 24,  atk: 1.7,  speed: 3.3, reach: 2.2, r: 1.0,  gold: 15,  cost: 3.2, heavy: true },
  shaman:   { name: 'Orc Shaman',    hp: 42,  dmg: 11,   atk: 2.8,  speed: 3.8, reach: 1.5, r: 0.6,  gold: 13,  cost: 2.6, range: 10, aura: 7 },
  loot:     { name: 'Loot Hauler',   hp: 55,  dmg: 0,   atk: 9,    speed: 5.2, reach: 1.5, r: 0.65, gold: 45,  cost: 0 },
  champion: { name: 'Champion',      hp: 160, dmg: 22,  atk: 1.4,  speed: 3.7, reach: 2.5, r: 1.25, gold: 160, cost: 0, heavy: true, elite: true },
  boss:     { name: 'Gor’mak the Warlord', hp: 280, dmg: 16, atk: 1.6, speed: 2.9, reach: 3.2, r: 1.9, gold: 2500, cost: 0, heavy: true, elite: true },
};
export const CHAMPIONS = [
  { d: 200, name: 'Krug Bonechewer' },
  { d: 400, name: 'Mogra the Flayer' },
  { d: 600, name: 'Ashfang Ironjaw' },
];

// How much tougher / richer the cave gets with depth.
export const SCALE = { hp: 110, dmg: 166, gold: 330, budget: 80, cost: 1.25 };
export function depthHp(d)   { return Math.exp(d / SCALE.hp); }
export function depthDmg(d)  { return Math.exp(d / SCALE.dmg); }
export function depthGold(d) { return Math.exp(d / SCALE.gold); }
export function packBudget(d) { return d < 14 ? 1 : 1.9 + d / SCALE.budget; }

// ---------------------------------------------------------------- upgrades
// Levelled stats: cost(level) = base * growth^(level * SCALE.cost), rounded to something tidy.
// Perks with only a few levels list their prices outright.
const pct = v => `${Math.round(v * 100)}%`;
export const UPGRADES = [
  // --- Might
  { id: 'power', cat: 'might', icon: 'might', name: 'Arcane Might', max: 40, base: 6, growth: 1.335,
    desc: 'Every spell hits 16% harder.',
    value: l => `×${Math.pow(1.16, l).toFixed(l < 12 ? 2 : 1)} damage` },
  { id: 'haste', cat: 'might', icon: 'haste', name: 'Quickening', max: 15, base: 30, growth: 1.62,
    desc: 'Cast all spells 7% faster.',
    value: l => `+${pct(0.07 * l)} cast speed` },
  { id: 'crit', cat: 'might', icon: 'crit', name: 'Fatal Insight', max: 8, base: 90, growth: 2.05,
    desc: '+5% chance for spells to crit for ×2.5.',
    value: l => `${pct(0.05 * l)} crit chance` },
  { id: 'mastery', cat: 'might', icon: 'mastery', name: 'Rune Mastery', max: 6, base: 160, growth: 2.3,
    desc: 'A well-drawn rune grants even more power.',
    value: l => `S-rank rune = ×${runePower(1, l).toFixed(2)}` },
  { id: 'echo', cat: 'might', icon: 'echo', name: 'Spell Echo', max: 5, costs: [600, 2500, 9000, 30000, 90000],
    desc: '+10% chance to instantly cast a spell twice.',
    value: l => `${pct(0.1 * l)} echo chance` },

  // --- Survival
  { id: 'vital', cat: 'survival', icon: 'vital', name: 'Vitality', max: 34, base: 6, growth: 1.335,
    desc: '+17% maximum health.',
    value: l => `${Math.round(40 * Math.pow(1.17, l))} health` },
  { id: 'armor', cat: 'survival', icon: 'armor', name: 'Stoneskin', max: 12, base: 45, growth: 1.75,
    desc: 'Take 6% less damage from every blow.',
    value: l => `-${pct(1 - Math.pow(0.94, l))} damage taken` },
  { id: 'leech', cat: 'survival', icon: 'leech', name: 'Soul Siphon', max: 8, base: 70, growth: 1.95,
    desc: 'Each kill restores 0.5% of your health.',
    value: l => `${(0.5 * l).toFixed(1)}% health per kill` },
  { id: 'shield', cat: 'survival', icon: 'shield', name: 'Mana Barrier', max: 4, costs: [350, 2500, 15000, 70000],
    desc: 'A barrier soaks damage and recharges when you are not hit for 3s.',
    value: l => l ? `Barrier = ${pct(0.2 + 0.1 * l)} of health` : 'No barrier' },
  { id: 'phoenix', cat: 'survival', icon: 'phoenix', name: 'Phoenix Feather', max: 2, costs: [5000, 120000],
    desc: 'Rise from death once per run in a blast of fire.',
    value: l => l ? `${l} revive${l > 1 ? 's' : ''} per run` : 'No revive' },

  // --- Fortune
  { id: 'greed', cat: 'fortune', icon: 'greed', name: 'Midas Touch', max: 30, base: 14, growth: 1.42,
    desc: 'Orcs drop 12% more gold.',
    value: l => `+${pct(0.12 * l)} gold` },
  { id: 'frenzy', cat: 'fortune', icon: 'frenzy', name: 'Bloodrush', max: 5, costs: [250, 1200, 5000, 20000, 70000],
    desc: 'Combo cap +10. Each combo stack also speeds up your casting.',
    value: l => `Combo cap ${25 + 10 * l}` },
  { id: 'bounty', cat: 'fortune', icon: 'bounty', name: 'Orc Payroll', max: 5, costs: [150, 700, 3000, 12000, 45000],
    desc: 'Gold-hauling orcs wander the cave far more often.',
    value: l => `${pct(0.05 + 0.045 * l)} per pack` },

  // --- Arcana (perks)
  { id: 'rune_storm', cat: 'arcana', icon: 'rune', rune: 'storm', name: 'Rune of Storm', max: 1, costs: [30],
    desc: 'Learn the Storm rune: chain lightning.', value: l => l ? 'Learned' : 'New rune' },
  { id: 'rune_frost', cat: 'arcana', icon: 'rune', rune: 'frost', name: 'Rune of Frost', max: 1, costs: [220],
    desc: 'Learn the Frost rune: piercing, chilling lances.', value: l => l ? 'Learned' : 'New rune' },
  { id: 'rune_arcane', cat: 'arcana', icon: 'rune', rune: 'arcane', name: 'Rune of Arcana', max: 1, costs: [600],
    desc: 'Learn the Arcane rune: seeker missiles and +60% gold.', value: l => l ? 'Learned' : 'New rune' },
  { id: 'rune_void', cat: 'arcana', icon: 'rune', rune: 'void', name: 'Rune of the Void', max: 1, costs: [25000],
    desc: 'Learn the Void rune: singularities that devour whole packs.', value: l => l ? 'Learned' : 'New rune' },
  { id: 'slots', cat: 'arcana', icon: 'slots', name: 'Extra Sigil', max: 2, costs: [1500, 60000],
    desc: 'Draw one more rune before each run. Mix elements to trigger reactions.',
    value: l => `${1 + l} rune${l ? 's' : ''} per run` },
  { id: 'wisp', cat: 'arcana', icon: 'wisp', name: 'Wisp Familiar', max: 3, costs: [400, 4000, 40000],
    desc: 'A wisp orbits you, sniping orcs on its own.',
    value: l => `${l} wisp${l === 1 ? '' : 's'}` },
  { id: 'corpse', cat: 'arcana', icon: 'corpse', name: 'Chain Reaction', max: 4, costs: [600, 3500, 18000, 80000],
    desc: 'Slain orcs burst, hurting neighbours for a share of their health.',
    value: l => l ? `${pct(0.1 * l)} of health as blast` : 'No blast' },
  { id: 'meteor', cat: 'arcana', icon: 'meteor', name: 'Cataclysm', max: 4, costs: [2500, 12000, 50000, 160000],
    desc: 'Meteors hammer the thickest pack every few seconds.',
    value: l => l ? `Meteor every ${(11 - 2 * l)}s` : 'No meteors' },
];
export const UPGRADE_BY_ID = Object.fromEntries(UPGRADES.map(u => [u.id, u]));
export const CATEGORIES = [
  { id: 'might', name: 'Might' },
  { id: 'survival', name: 'Survival' },
  { id: 'fortune', name: 'Fortune' },
  { id: 'arcana', name: 'Arcana' },
];

export function upgradeCost(u, level) {
  if (u.costs) return u.costs[Math.min(level, u.costs.length - 1)];
  const raw = u.base * Math.pow(u.growth, level * SCALE.cost);
  if (raw < 100) return Math.round(raw);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)) - 1);
  return Math.round(raw / mag) * mag;
}

// ---------------------------------------------------------------- evolutions
// The mage visibly evolves as total upgrade levels pile up.
export const EVOLUTIONS = [
  { at: 0,   name: 'Apprentice', mult: 1.0,  blurb: 'A borrowed robe and a stick that hums.' },
  { at: 10,  name: 'Adept',      mult: 1.25, blurb: 'A proper staff. The orcs have noticed.' },
  { at: 28,  name: 'Conjurer',   mult: 1.6,  blurb: 'Gilded trim and a crystal that bites.' },
  { at: 55,  name: 'Sorcerer',   mult: 2.1,  blurb: 'Runes circle you of their own accord.' },
  { at: 90,  name: 'Archmage',   mult: 2.8,  blurb: 'The cave itself leans away from you.' },
  { at: 130, name: 'Ascendant',  mult: 3.8,  blurb: 'Less a mage than a weather system.' },
];

export function totalLevels(save) {
  let n = 0;
  for (const u of UPGRADES) n += save.upgrades[u.id] || 0;
  return n;
}
export function evolutionTier(save) {
  const n = totalLevels(save);
  let t = 0;
  EVOLUTIONS.forEach((e, i) => { if (n >= e.at) t = i; });
  return t;
}

// ---------------------------------------------------------------- derived stats
export function computeStats(save) {
  const L = id => save.upgrades[id] || 0;
  const tier = evolutionTier(save);
  const evo = EVOLUTIONS[tier].mult;
  const runes = ['ember'];
  for (const r of ['storm', 'frost', 'arcane', 'void']) if (L('rune_' + r)) runes.push(r);
  return {
    tier,
    maxHp: 40 * Math.pow(1.17, L('vital')) * (1 + (evo - 1) * 0.6),
    dmgMult: Math.pow(1.16, L('power')) * evo,
    haste: 1 + 0.07 * L('haste'),
    goldMult: 1 + 0.12 * L('greed'),
    armor: Math.pow(0.94, L('armor')),
    leech: 0.005 * L('leech'),
    critChance: 0.05 * L('crit'),
    critMult: 2.5,
    mastery: L('mastery'),
    echo: 0.1 * L('echo'),
    slots: 1 + L('slots'),
    shield: L('shield') ? 0.2 + 0.1 * L('shield') : 0,
    phoenix: L('phoenix'),
    wisps: L('wisp'),
    meteor: L('meteor'),
    frenzy: L('frenzy'),
    comboCap: 25 + 10 * L('frenzy'),
    corpse: 0.1 * L('corpse'),
    lootChance: 0.05 + 0.045 * L('bounty'),
    runes,
  };
}

export function newSave() {
  return {
    v: 1, gold: 0, totalGold: 0, upgrades: {}, runs: 0, bestDepth: 0, bestKills: 0,
    victories: 0, bestTime: 0, seenTier: 0, muted: false, lastRunes: [],
  };
}

export function fmt(n) {
  n = Math.floor(n);
  if (n < 1000) return String(n);
  const units = ['K', 'M', 'B', 'T'];
  let u = -1;
  while (n >= 1000 && u < units.length - 1) { n /= 1000; u++; }
  return (n < 10 ? n.toFixed(2) : n < 100 ? n.toFixed(1) : n.toFixed(0)) + units[u];
}
