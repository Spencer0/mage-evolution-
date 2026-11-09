// Game data: runes, enemies, upgrades, evolutions and every balance knob.
// Pure data + pure functions, shared by the simulation, the UI and tools/balance.mjs.

export const CAVE_LENGTH = 1200;     // metres to the Warlord's throne
export const MAGE_SPEED = 7.7;       // sprint speed, metres per second
export const SPAWN_AHEAD = 44;       // groups charge once the mage gets this close
export const CAST_RANGE = 25;

// ---------------------------------------------------------------- biomes
export const BIOMES = [
  { id: 'entrance', name: 'The Maw',           from: 0,   fog: 0x0b1020, ambient: 0x4a5a86, accent: 0xff9a3c },
  { id: 'crystal',  name: 'Crystal Hollows',   from: 240, fog: 0x070d24, ambient: 0x3c5cae, accent: 0x4fd8ff },
  { id: 'fungal',   name: 'Glowcap Deeps',     from: 500, fog: 0x06140f, ambient: 0x2f7a5a, accent: 0x6dffa8 },
  { id: 'magma',    name: 'The Ember Forge',   from: 780, fog: 0x1a0704, ambient: 0x8a3a22, accent: 0xff5a1f },
  { id: 'throne',   name: "Warlord's Throne",  from: 1080, fog: 0x12040f, ambient: 0x7a2a4a, accent: 0xff2a55 },
];

export function biomeAt(d) {
  let b = BIOMES[0];
  for (const x of BIOMES) if (d >= x.from) b = x;
  return b;
}

// ---------------------------------------------------------------- runes and war marks
// Glyph points live in a [-1,1] box, y pointing down (screen space). Every
// glyph is a single stroke. Open shapes with few corners are the easy ones.
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
const spiral = [];
for (let i = 0; i <= 44; i++) {
  const t = i / 44, a = -Math.PI / 2 + t * Math.PI * 4.2, r = 0.12 + t * 0.86;
  spiral.push([Math.cos(a) * r, Math.sin(a) * r]);
}

export const RUNES = {
  // ---- mage
  ember: {
    id: 'ember', cls: 'mage', name: 'Ember', element: 'fire', spell: 'Fireball',
    color: '#ff7a2a', hex: 0xff6a1a,
    glyph: [[-0.9, 0.8], [0, -0.9], [0.9, 0.8]], closed: false, complexity: 0.8, shape: 'a peak, like an upside-down V',
    blurb: 'Explodes on impact and sets orcs ablaze.',
    cd: 0.5, dmg: 6, radius: 2.6,
  },
  storm: {
    id: 'storm', cls: 'mage', name: 'Storm', element: 'storm', spell: 'Chain Lightning',
    color: '#8fd0ff', hex: 0x7fc4ff,
    glyph: [[0.45, -1], [-0.55, 0.08], [0.55, -0.08], [-0.45, 1]], closed: false, complexity: 1, shape: 'a lightning zigzag',
    blurb: 'Instant bolts that leap from orc to orc.',
    cd: 0.27, dmg: 2.3, chains: 3, chainRange: 7,
  },
  frost: {
    id: 'frost', cls: 'mage', name: 'Frost', element: 'frost', spell: 'Ice Lance',
    color: '#7ff2ff', hex: 0x5fe6ff,
    glyph: [[-0.8, -0.95], [0.8, -0.95], [-0.8, 0.95], [0.8, 0.95], [-0.8, -0.95]], closed: true, complexity: 1.4, rots: [0, Math.PI / 2], shape: 'an hourglass',
    blurb: 'Piercing lances that chill everything in line.',
    cd: 0.42, dmg: 4.2, pierce: 4,
  },
  arcane: {
    id: 'arcane', cls: 'mage', name: 'Arcane', element: 'arcane', spell: 'Seeker Missiles',
    color: '#c58bff', hex: 0xb06cff,
    glyph: circle, closed: true, complexity: 1, shape: 'a circle',
    blurb: 'Homing missiles that turn orcs into gold.',
    cd: 0.5, dmg: 2.1, missiles: 3,
  },
  void: {
    id: 'void', cls: 'mage', name: 'Void', element: 'void', spell: 'Singularity',
    color: '#ff5ad1', hex: 0xff3fc8,
    glyph: star, closed: true, complexity: 1.9, rots: [0, Math.PI], shape: 'a five-point star',
    blurb: 'Tears a hole in the world that devours packs.',
    cd: 1.5, dmg: 4.2, radius: 5.5, duration: 1.2,
  },
  // ---- warrior
  cleave: {
    id: 'cleave', cls: 'warrior', name: 'Cleave', element: 'steel', spell: 'Cleave',
    color: '#ff5a4a', hex: 0xff4a3a,
    glyph: [[-0.9, -0.85], [0, 0.9], [0.9, -0.85]], closed: false, complexity: 0.8, shape: 'a V',
    blurb: 'Wide sword arcs that leave orcs bleeding.',
    cd: 0.38, dmg: 5.4, reach: 3.8, arc: 1.35, range: 4.2,
  },
  hurl: {
    id: 'hurl', cls: 'warrior', name: 'Hurl', element: 'iron', spell: 'Axe Storm',
    color: '#ffb35a', hex: 0xffa040,
    glyph: [[-0.75, -0.9], [0.85, 0], [-0.75, 0.9]], closed: false, complexity: 0.8, shape: 'an arrowhead pointing right',
    blurb: 'Thrown axes that punch through a whole line.',
    cd: 0.46, dmg: 4.6, pierce: 4, range: 20,
  },
  quake: {
    id: 'quake', cls: 'warrior', name: 'Quake', element: 'earth', spell: 'Earthshaker',
    color: '#e0b060', hex: 0xd09a48,
    glyph: [[-1, 0.75], [-0.5, -0.75], [0, 0.75], [0.5, -0.75], [1, 0.75]], closed: false, complexity: 1.2, shape: 'a double peak, like an M',
    blurb: 'Ground slams that daze everything around you.',
    cd: 1.15, dmg: 8, radius: 5.4, range: 5.2,
  },
  whirl: {
    id: 'whirl', cls: 'warrior', name: 'Whirl', element: 'blood', spell: 'Whirlwind',
    color: '#ff3a6a', hex: 0xff2a5a,
    glyph: spiral, closed: false, complexity: 1.5, shape: 'a spiral',
    blurb: 'A spinning storm of steel that heals as it cuts.',
    cd: 0.24, dmg: 1.7, radius: 4, range: 4.2, heal: 0.003,
  },
  crown: {
    id: 'crown', cls: 'warrior', name: 'Judgement', element: 'spirit', spell: 'Sky Blade',
    color: '#9fe6ff', hex: 0x8fdcff,
    glyph: [[-1, 0.8], [-1, -0.6], [-0.5, 0.1], [0, -0.9], [0.5, 0.1], [1, -0.6], [1, 0.8], [-1, 0.8]], closed: true, complexity: 1.9, shape: 'a crown',
    blurb: 'A spectral greatsword falls on the thickest pack.',
    cd: 1.7, dmg: 17, radius: 4.8, range: 17,
  },
};

// What each damage type leaves on an orc, and what it sets off.
//   double: x2 damage, consumes the status   blast: small explosion   freeze: locks the orc in place
export const ELEMENTS = {
  fire:   { applies: 'burn',  react: { on: 'chill', kind: 'double', name: 'thermal' } },
  storm:  { applies: 'shock', react: { on: 'burn',  kind: 'blast',  name: 'overload' } },
  frost:  { applies: 'chill', react: { on: 'shock', kind: 'freeze', name: 'freeze' } },
  arcane: { applies: 'mark' },
  void: {}, wisp: {}, phys: {}, blood: {},
  steel:  { applies: 'burn', bleed: true, react: { on: 'chill', kind: 'double', name: 'execute' } },
  iron:   { applies: 'shock', react: { on: 'burn',  kind: 'blast',  name: 'rupture' } },
  earth:  { applies: 'chill', daze: true, react: { on: 'shock', kind: 'freeze', name: 'petrify' } },
  spirit: { applies: 'mark' },
};
export const REACTIONS = {
  thermal: { name: 'THERMAL SHOCK' }, overload: { name: 'OVERLOAD' }, freeze: { name: 'DEEP FREEZE' },
  execute: { name: 'EXECUTE' }, rupture: { name: 'RUPTURE' }, petrify: { name: 'PETRIFY' },
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
// "heavy" enemies are walls: the hero has to stop and kill them. Everything
// else is fodder that swarms, slows the sprint and gets blown apart.
export const ENEMIES = {
  whelp:    { name: 'Goblin',        hp: 5,   dmg: 2.2, atk: 0.5,  speed: 11.5, reach: 1.3, r: 0.42, gold: 0.75, cost: 0.4 },
  grunt:    { name: 'Orc Grunt',     hp: 15,  dmg: 5,   atk: 0.8,  speed: 9,    reach: 1.6, r: 0.6,  gold: 2.4, cost: 1 },
  archer:   { name: 'Axe Thrower',   hp: 9,   dmg: 3.2, atk: 1.25, speed: 8.5,  reach: 1.5, r: 0.55, gold: 2.4, cost: 1, range: 14 },
  brute:    { name: 'Orc Brute',     hp: 120, dmg: 15,  atk: 1.25, speed: 5.5,  reach: 2.2, r: 1.0,  gold: 16,  cost: 3.4, heavy: true },
  shaman:   { name: 'Orc Shaman',    hp: 34,  dmg: 7,   atk: 2.0,  speed: 7,    reach: 1.5, r: 0.6,  gold: 12,  cost: 2.6, range: 12, aura: 8 },
  loot:     { name: 'Loot Hauler',   hp: 50,  dmg: 0,   atk: 9,    speed: 9,    reach: 1.5, r: 0.65, gold: 45,  cost: 0 },
  champion: { name: 'Champion',      hp: 230, dmg: 15,  atk: 1.1,  speed: 5.5,  reach: 2.5, r: 1.25, gold: 150, cost: 0, heavy: true, elite: true },
  boss:     { name: 'Gor’mak the Warlord', hp: 520, dmg: 13, atk: 1.3, speed: 4.5, reach: 3.2, r: 1.9, gold: 2500, cost: 0, heavy: true, elite: true },
};
// Mini-bosses. Each one slain offers a choice of two boons for the rest of the run.
export const CHAMPIONS = [
  { d: 200,  name: 'Krug Bonechewer' },
  { d: 400,  name: 'Mogra the Flayer' },
  { d: 600,  name: 'Ashfang Ironjaw' },
  { d: 800,  name: 'Druk Skullcleaver' },
  { d: 1000, name: 'Vessa Nightfang' },
];

// How much tougher / richer the cave gets with depth.
export const SCALE = { hp: 165, dmg: 250, gold: 600, goldBase: 1.1, budget: 150, cost: 1.25 };
export function depthHp(d)   { return Math.exp(d / SCALE.hp); }
export function depthDmg(d)  { return Math.exp(d / SCALE.dmg); }
export function depthGold(d) { return SCALE.goldBase * Math.exp(d / SCALE.gold); }
export function packBudget(d) { return 1.1 + d / SCALE.budget; }

// ---------------------------------------------------------------- boons
// Offered two at a time when a champion dies; they last until the run ends.
// `mod` multiplies (or for the chance-style keys, adds to) the run's modifiers.
export const BOONS = [
  { id: 'might',   name: 'Bloodlust',      desc: '+40% damage.',                          icon: 'might',   mod: { dmg: 1.4 } },
  { id: 'haste',   name: 'Battle Trance',  desc: 'Attack 30% faster.',                    icon: 'haste',   mod: { haste: 1.3 } },
  { id: 'vigor',   name: 'Second Skin',    desc: 'Heal to full and gain +30% health.',    icon: 'vital',   mod: { hp: 1.3 } },
  { id: 'guard',   name: 'Thick Hide',     desc: 'Take 30% less damage.',                 icon: 'armor',   mod: { armor: 0.7 } },
  { id: 'greed',   name: 'Gold Fever',     desc: '+60% gold for the rest of the run.',    icon: 'greed',   mod: { gold: 1.6 } },
  { id: 'echo',    name: 'Twin Strike',    desc: '+25% chance to strike twice.',          icon: 'echo',    mod: { echo: 0.25 } },
  { id: 'crit',    name: 'Killer Instinct', desc: '+20% critical chance.',                icon: 'crit',    mod: { crit: 0.2 } },
  { id: 'leech',   name: 'Vampirism',      desc: 'Every kill restores 1.5% health.',      icon: 'leech',   mod: { leech: 0.015 } },
  { id: 'slayer',  name: 'Giant Slayer',   desc: '+80% damage to brutes, champions and the Warlord.', icon: 'corpse', mod: { heavy: 1.8 } },
  { id: 'fleet',   name: 'Fleet Foot',     desc: 'Sprint 15% faster; goblins drag you half as much.', icon: 'frenzy', mod: { speed: 1.15, drag: 0.5 } },
];
export const BOON_BY_ID = Object.fromEntries(BOONS.map(b => [b.id, b]));
export function newMods() { return { dmg: 1, haste: 1, hp: 1, armor: 1, gold: 1, echo: 0, crit: 0, leech: 0, heavy: 1, speed: 1, drag: 1 }; }

// ---------------------------------------------------------------- upgrades
// Levelled stats: cost(level) = base * growth^(level * SCALE.cost), rounded to something tidy.
// Perks with only a few levels list their prices outright. Both classes share
// the same mechanics under their own names, plus their own runes.
const pct = v => `${Math.round(v * 100)}%`;
function tree(T) {
  const rune = (id, cost) => ({ id: 'rune_' + id, cat: 'arcana', icon: 'rune', rune: id, name: T.runeName(RUNES[id]), max: 1, costs: [cost],
    desc: `Learn ${RUNES[id].name}: ${RUNES[id].blurb.charAt(0).toLowerCase()}${RUNES[id].blurb.slice(1)}`, value: l => l ? 'Learned' : `New ${T.word}` });
  return [
    // --- Might
    { id: 'power', cat: 'might', icon: 'might', name: T.power[0], max: 40, base: 6, growth: 1.335,
      desc: T.power[1], value: l => `×${Math.pow(1.16, l).toFixed(l < 12 ? 2 : 1)} damage` },
    { id: 'haste', cat: 'might', icon: 'haste', name: T.haste[0], max: 15, base: 30, growth: 1.62,
      desc: T.haste[1], value: l => `+${pct(0.07 * l)} ${T.speedWord}` },
    { id: 'crit', cat: 'might', icon: 'crit', name: T.crit[0], max: 8, base: 90, growth: 2.05,
      desc: T.crit[1], value: l => `${pct(0.05 * l)} crit chance` },
    { id: 'mastery', cat: 'might', icon: 'mastery', name: T.mastery[0], max: 6, base: 160, growth: 2.3,
      desc: T.mastery[1], value: l => `S-rank ${T.word} = ×${runePower(1, l).toFixed(2)}` },
    { id: 'echo', cat: 'might', icon: 'echo', name: T.echo[0], max: 5, costs: [600, 2500, 9000, 30000, 90000],
      desc: T.echo[1], value: l => `${pct(0.1 * l)} chance` },
    // --- Survival
    { id: 'vital', cat: 'survival', icon: 'vital', name: T.vital[0], max: 34, base: 6, growth: 1.335,
      desc: '+17% maximum health.', value: l => `${Math.round(T.hp * Math.pow(1.17, l))} health` },
    { id: 'armor', cat: 'survival', icon: 'armor', name: T.armor[0], max: 12, base: 45, growth: 1.75,
      desc: 'Take 6% less damage from every blow.', value: l => `-${pct(1 - Math.pow(0.94, l))} damage taken` },
    { id: 'leech', cat: 'survival', icon: 'leech', name: T.leech[0], max: 8, base: 70, growth: 1.95,
      desc: 'Each kill restores 0.5% of your health.', value: l => `${(0.5 * l).toFixed(1)}% health per kill` },
    { id: 'shield', cat: 'survival', icon: 'shield', name: T.shield[0], max: 4, costs: [350, 2500, 15000, 70000],
      desc: T.shield[1], value: l => l ? `${pct(0.2 + 0.1 * l)} of health` : 'None' },
    { id: 'phoenix', cat: 'survival', icon: 'phoenix', name: T.phoenix[0], max: 2, costs: [5000, 120000],
      desc: T.phoenix[1], value: l => l ? `${l} revive${l > 1 ? 's' : ''} per run` : 'No revive' },
    // --- Fortune
    { id: 'greed', cat: 'fortune', icon: 'greed', name: T.greed[0], max: 30, base: 14, growth: 1.42,
      desc: 'Orcs drop 12% more gold.', value: l => `+${pct(0.12 * l)} gold` },
    { id: 'trophy', cat: 'fortune', icon: 'frenzy', name: T.trophy[0], max: 5, costs: [250, 1200, 5000, 20000, 70000],
      desc: 'Brutes, champions and the Warlord drop 50% more gold.', value: l => `+${pct(0.5 * l)} from big kills` },
    { id: 'bounty', cat: 'fortune', icon: 'bounty', name: T.bounty[0], max: 5, costs: [150, 700, 3000, 12000, 45000],
      desc: 'Gold-hauling orcs wander the cave far more often.', value: l => `${(2 + 1.8 * l).toFixed(1)}% of groups` },
    // --- class perks
    ...T.runes.map(([id, cost]) => rune(id, cost)),
    { id: 'slots', cat: 'arcana', icon: 'slots', name: T.slots[0], max: 2, costs: [1500, 60000],
      desc: T.slots[1], value: l => `${1 + l} ${T.word}${l ? 's' : ''} per run` },
    { id: 'wisp', cat: 'arcana', icon: 'wisp', name: T.wisp[0], max: 3, costs: [400, 4000, 40000],
      desc: T.wisp[1], value: l => `${l} ${T.wisp[2]}${l === 1 ? '' : 's'}` },
    { id: 'corpse', cat: 'arcana', icon: 'corpse', name: T.corpse[0], max: 4, costs: [600, 3500, 18000, 80000],
      desc: 'Slain orcs burst, hurting neighbours for a share of their health.', value: l => l ? `${pct(0.1 * l)} of health as blast` : 'No blast' },
    { id: 'meteor', cat: 'arcana', icon: 'meteor', name: T.meteor[0], max: 4, costs: [2500, 12000, 50000, 160000],
      desc: T.meteor[1], value: l => l ? `Every ${(11 - 2 * l)}s` : 'None' },
  ];
}

export const CATEGORIES = [
  { id: 'might', name: 'Might' },
  { id: 'survival', name: 'Survival' },
  { id: 'fortune', name: 'Fortune' },
  { id: 'arcana', name: { mage: 'Arcana', warrior: 'War Craft' } },
];

export const CLASSES = {
  mage: {
    id: 'mage', name: 'Mage', word: 'rune', book: 'Your grimoire', cost: 0, hp: 40, armor: 1, starter: 'ember',
    blurb: 'Blasts the horde from range. Fragile, explosive.',
    runes: ['ember', 'storm', 'frost', 'arcane', 'void'],
    evolutions: [
      { at: 0,   name: 'Apprentice', mult: 1.0,  blurb: 'A borrowed robe and a stick that hums.' },
      { at: 10,  name: 'Adept',      mult: 1.25, blurb: 'A proper staff. The orcs have noticed.' },
      { at: 28,  name: 'Conjurer',   mult: 1.6,  blurb: 'Gilded trim and a crystal that bites.' },
      { at: 55,  name: 'Sorcerer',   mult: 2.1,  blurb: 'Runes circle you of their own accord.' },
      { at: 90,  name: 'Archmage',   mult: 2.8,  blurb: 'The cave itself leans away from you.' },
      { at: 130, name: 'Ascendant',  mult: 3.8,  blurb: 'Less a mage than a weather system.' },
    ],
    upgrades: tree({
      word: 'rune', hp: 40, speedWord: 'cast speed', runeName: r => `Rune of ${r.name}`,
      power: ['Arcane Might', 'Every spell hits 16% harder.'],
      haste: ['Quickening', 'Cast all spells 7% faster.'],
      crit: ['Fatal Insight', '+5% chance for spells to crit for ×2.5.'],
      mastery: ['Rune Mastery', 'A well-drawn rune grants even more power.'],
      echo: ['Spell Echo', '+10% chance to instantly cast a spell twice.'],
      vital: ['Vitality'], armor: ['Stoneskin'], leech: ['Soul Siphon'],
      shield: ['Mana Barrier', 'A barrier soaks damage and recharges when you are not hit for 3s.'],
      phoenix: ['Phoenix Feather', 'Rise from death once per run in a blast of fire.'],
      greed: ['Midas Touch'], trophy: ['Trophy Hunter'], bounty: ['Orc Payroll'],
      runes: [['storm', 30], ['frost', 220], ['arcane', 600], ['void', 25000]],
      slots: ['Extra Sigil', 'Draw one more rune before each run. Mix elements to trigger reactions.'],
      wisp: ['Wisp Familiar', 'A wisp orbits you, sniping orcs on its own.', 'wisp'],
      corpse: ['Chain Reaction'],
      meteor: ['Cataclysm', 'Meteors hammer the thickest pack.'],
    }),
  },
  warrior: {
    id: 'warrior', name: 'Warrior', word: 'war mark', book: 'Your war marks', cost: 50000, hp: 58, armor: 0.8, drag: 0.45, starter: 'cleave',
    blurb: 'Wades in with steel. Tough, relentless, up close.',
    runes: ['cleave', 'hurl', 'quake', 'whirl', 'crown'],
    evolutions: [
      { at: 0,   name: 'Recruit',    mult: 1.0,  blurb: 'A dented sword and a lot of nerve.' },
      { at: 10,  name: 'Footman',    mult: 1.25, blurb: 'A real shield. It already has notches.' },
      { at: 28,  name: 'Veteran',    mult: 1.6,  blurb: 'Steel plate, and the scars to match.' },
      { at: 55,  name: 'Vanguard',   mult: 2.1,  blurb: 'Orcs tell their whelps stories about you.' },
      { at: 90,  name: 'Warbringer', mult: 2.8,  blurb: 'The horde parts before the banner.' },
      { at: 130, name: 'Titan',      mult: 3.8,  blurb: 'The mountain learned to walk.' },
    ],
    upgrades: tree({
      word: 'war mark', hp: 58, speedWord: 'attack speed', runeName: r => `${r.name} Mark`,
      power: ['Raw Strength', 'Every blow lands 16% harder.'],
      haste: ['Battle Fury', 'Attack 7% faster.'],
      crit: ['Brutal Strikes', '+5% chance for blows to crit for ×2.5.'],
      mastery: ['Mark Mastery', 'A well-drawn war mark grants even more power.'],
      echo: ['Follow Through', '+10% chance to strike twice in one swing.'],
      vital: ['Toughness'], armor: ['Iron Hide'], leech: ['Bloodthirst'],
      shield: ['Tower Shield', 'A guard soaks damage and recovers when you are not hit for 3s.'],
      phoenix: ['Second Wind', 'Get back up once per run in a blast of fury.'],
      greed: ['Plunder'], trophy: ['Trophy Hunter'], bounty: ['War Chest'],
      runes: [['hurl', 30], ['quake', 220], ['whirl', 600], ['crown', 25000]],
      slots: ['Extra Mark', 'Draw one more war mark before each run. Mix them to trigger reactions.'],
      wisp: ['Spirit Blade', 'A ghostly blade circles you, striking orcs on its own.', 'blade'],
      corpse: ['Gore Burst'],
      meteor: ['Catapult', 'Flaming boulders hammer the thickest pack.'],
    }),
  },
};
export const CLASS_ORDER = ['mage', 'warrior'];
export const CLASS_SCREEN_AFTER_RUNS = 2;     // the class screen appears once you have this many runs

export const upgradesOf = cls => CLASSES[cls].upgrades;
export function findUpgrade(cls, id) { return CLASSES[cls].upgrades.find(u => u.id === id); }

export function upgradeCost(u, level) {
  if (u.costs) return u.costs[Math.min(level, u.costs.length - 1)];
  const raw = u.base * Math.pow(u.growth, level * SCALE.cost);
  if (raw < 100) return Math.round(raw);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)) - 1);
  return Math.round(raw / mag) * mag;
}

// ---------------------------------------------------------------- evolutions
// The hero visibly evolves as total upgrade levels pile up.
export function totalLevels(save, cls = save.cur) {
  const up = save.cls[cls].upgrades;
  let n = 0;
  for (const u of CLASSES[cls].upgrades) n += up[u.id] || 0;
  return n;
}
export function evolutionTier(save, cls = save.cur) {
  const n = totalLevels(save, cls);
  let t = 0;
  CLASSES[cls].evolutions.forEach((e, i) => { if (n >= e.at) t = i; });
  return t;
}

// ---------------------------------------------------------------- derived stats
export function computeStats(save, cls = save.cur) {
  const C = CLASSES[cls], up = save.cls[cls].upgrades;
  const L = id => up[id] || 0;
  const tier = evolutionTier(save, cls);
  const evo = C.evolutions[tier].mult;
  const runes = C.runes.filter(r => r === C.starter || L('rune_' + r));
  return {
    cls, tier,
    maxHp: C.hp * Math.pow(1.17, L('vital')) * (1 + (evo - 1) * 0.6),
    dmgMult: Math.pow(1.16, L('power')) * evo,
    haste: 1 + 0.07 * L('haste'),
    goldMult: 1 + 0.12 * L('greed'),
    armor: C.armor * Math.pow(0.94, L('armor')),
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
    trophy: 1 + 0.5 * L('trophy'),
    corpse: 0.1 * L('corpse'),
    lootChance: 0.02 + 0.018 * L('bounty'),
    drag: C.drag || 1,          // how much clinging fodder slows the sprint
    runes,
  };
}

// ---------------------------------------------------------------- save data
export function newSave() {
  const c = unlocked => ({ unlocked, upgrades: {}, runs: 0, bestDepth: 0, lastRunes: [] });
  return {
    v: 2, gold: 0, totalGold: 0, runs: 0, victories: 0, bestTime: 0, muted: false, cur: 'mage',
    cls: { mage: c(true), warrior: c(false) },
  };
}
/** Accepts anything a previous version stored and returns a current save. */
export function migrateSave(s) {
  const out = newSave();
  if (!s || typeof s !== 'object') return out;
  if (s.v === 2) {
    Object.assign(out, s);
    for (const id of CLASS_ORDER) out.cls[id] = Object.assign(newSave().cls[id], (s.cls || {})[id]);
    if (!CLASSES[out.cur] || !out.cls[out.cur].unlocked) out.cur = 'mage';
    return out;
  }
  // v1: a single mage
  out.gold = s.gold || 0; out.totalGold = s.totalGold || 0; out.runs = s.runs || 0;
  out.victories = s.victories || 0; out.bestTime = s.bestTime || 0; out.muted = !!s.muted;
  const m = out.cls.mage;
  m.upgrades = { ...(s.upgrades || {}) };
  if (m.upgrades.frenzy) { m.upgrades.trophy = m.upgrades.frenzy; delete m.upgrades.frenzy; }
  m.runs = s.runs || 0;
  m.bestDepth = (s.bestDepth || 0) * 1;
  return out;
}

export function fmt(n) {
  n = Math.floor(n);
  if (n < 1000) return String(n);
  const units = ['K', 'M', 'B', 'T'];
  let u = -1;
  while (n >= 1000 && u < units.length - 1) { n /= 1000; u++; }
  return (n < 10 ? n.toFixed(2) : n < 100 ? n.toFixed(1) : n.toFixed(0)) + units[u];
}
