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
  // ---- gnome
  longshot: {
    id: 'longshot', cls: 'gnome', name: 'Longshot', element: 'lead', spell: 'Sniper Round',
    color: '#ffd84a', hex: 0xffd040,
    glyph: [[-0.7, -0.9], [-0.7, 0.8], [0.8, 0.8]], closed: false, complexity: 0.8, shape: 'an L',
    blurb: 'One huge round into the toughest orc in sight.',
    cd: 1.05, dmg: 17, range: 32,
  },
  drone: {
    id: 'drone', cls: 'gnome', name: 'Drone', element: 'tech', spell: 'Gun Drone',
    color: '#5ad8ff', hex: 0x4ad0ff,
    glyph: [[-0.8, -0.85], [-0.8, 0.2], [-0.5, 0.75], [0, 0.9], [0.5, 0.75], [0.8, 0.2], [0.8, -0.85]], closed: false, complexity: 1, shape: 'a U',
    blurb: 'A hovering gun that never stops firing.',
    cd: 0.17, dmg: 0.95, range: 22,
  },
  bomb: {
    id: 'bomb', cls: 'gnome', name: 'Bomb', element: 'fire', spell: 'Grenade',
    color: '#ff8a3a', hex: 0xff7a2a,
    glyph: [[-0.8, -0.85], [0.8, -0.85], [-0.8, 0.85], [0.8, 0.85]], closed: false, complexity: 1, shape: 'a Z',
    blurb: 'Lobbed grenades that flatten a whole pack.',
    cd: 0.8, dmg: 7.5, radius: 3.3, range: 22,
  },
  orbital: {
    id: 'orbital', cls: 'gnome', name: 'Orbital', element: 'spirit', spell: 'Orbital Strike',
    color: '#ff6ad0', hex: 0xff5ac8,
    glyph: [[-0.85, -0.85], [0.85, -0.85], [0.85, 0.85], [-0.85, 0.85], [-0.85, -0.85]], closed: true, complexity: 1.4, shape: 'a square',
    blurb: 'A beam from the sky walks through the horde.',
    cd: 2.1, dmg: 9, radius: 3.4, range: 24, blasts: 4,
  },
  // ---- nurse
  mend: {
    id: 'mend', cls: 'nurse', name: 'Mend', element: 'heal', spell: 'Mending Touch',
    color: '#7dffb0', hex: 0x6dffa8,
    glyph: [[0.75, -0.7], [0.3, -0.92], [-0.3, -0.85], [-0.75, -0.4], [-0.85, 0.2], [-0.55, 0.75], [0, 0.92], [0.5, 0.8], [0.8, 0.5]], closed: false, complexity: 1, shape: 'a C',
    blurb: 'Patches up whoever is hurting most.',
    cd: 1.0, dmg: 0, heal: 0.045, support: true,
  },
  toxin: {
    id: 'toxin', cls: 'nurse', name: 'Toxin', element: 'toxin', spell: 'Loaded Syringes',
    color: '#b8ff4a', hex: 0xa8f040,
    glyph: [[-0.9, 0], [-0.35, 0.85], [0.9, -0.85]], closed: false, complexity: 0.8, shape: 'a tick mark',
    blurb: 'Syringes that leave orcs rotting on their feet.',
    cd: 0.3, dmg: 1.5, range: 22,
  },
  adrenaline: {
    id: 'adrenaline', cls: 'nurse', name: 'Adrenaline', element: 'heal', spell: 'Adrenaline Shot',
    color: '#ffe36a', hex: 0xffd850,
    glyph: [[-0.9, 0.8], [0, -0.9], [0.9, 0.8]], closed: false, complexity: 0.8, shape: 'a peak, like an upside-down V',
    blurb: 'Jabs the whole party into a frenzy.',
    cd: 5, dmg: 0, rush: 0.4, rushTime: 3, support: true,
  },
  defib: {
    id: 'defib', cls: 'nurse', name: 'Defib', element: 'storm', spell: 'Clear!',
    color: '#8fd0ff', hex: 0x7fc4ff,
    glyph: [[-1, 0], [-0.45, 0], [-0.18, -0.9], [0.18, 0.9], [0.45, 0], [1, 0]], closed: false, complexity: 1.4, shape: 'a heartbeat line',
    blurb: 'A shock that stuns the horde, heals the party and raises the fallen.',
    cd: 3.6, dmg: 6, radius: 7, range: 8, heal: 0.08,
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
  lead:   { react: { on: 'chill', kind: 'double', name: 'shatter' } },
  tech:   { applies: 'shock' },
  toxin:  { applies: 'burn', toxic: true },
  heal: {},
};
export const REACTIONS = {
  thermal: { name: 'THERMAL SHOCK' }, overload: { name: 'OVERLOAD' }, freeze: { name: 'DEEP FREEZE' },
  execute: { name: 'EXECUTE' }, rupture: { name: 'RUPTURE' }, petrify: { name: 'PETRIFY' }, shatter: { name: 'SHATTER' },
};

// Rune quality (0..1 from the recogniser) -> power multiplier.
export function runePower(quality) {
  return 0.6 + 0.9 * quality;
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
export const SCALE = { hp: 165, dmg: 250, gold: 300, goldBase: 0.5, budget: 150, cost: 1.0, costBase: 1.4 };
export function depthHp(d)   { return Math.exp(d / SCALE.hp); }
export function depthDmg(d)  { return Math.exp(d / SCALE.dmg); }
export function depthGold(d) { return SCALE.goldBase * Math.exp(d / SCALE.gold); }
export function packBudget(d) { return 1.1 + d / SCALE.budget; }

// ---------------------------------------------------------------- gear
// A slain champion drops two pieces; the one you take is worn by one hero
// until the run ends. `mod` multiplies (or for chance-style keys, adds to)
// that hero's modifiers. Slots: weapon, head, back, and up to three charms.
export function newMods() { return { dmg: 1, haste: 1, hp: 1, armor: 1, gold: 1, echo: 0, crit: 0, leech: 0, heavy: 1, speed: 1, drag: 1 }; }
const G = (id, cls, slot, name, desc, mod, color, icon) => ({ id, cls, slot, name, desc, mod, color, icon });
export const GEAR = [
  G('m_staff',  'mage', 'weapon', 'Emberwood Staff',   '+40% spell damage.',              { dmg: 1.4 },    0xff7a2a, 'might'),
  G('m_rod',    'mage', 'weapon', 'Stormcaller Rod',   'Cast 30% faster.',                { haste: 1.3 },  0x7fc4ff, 'haste'),
  G('m_hat',    'mage', 'head',   'Archivist’s Hat', '+20% critical chance.',        { crit: 0.2 },   0xffd060, 'crit'),
  G('m_crown',  'mage', 'head',   'Crown of Echoes',   '+25% chance to cast twice.',      { echo: 0.25 },  0xc58bff, 'echo'),
  G('m_cloak',  'mage', 'back',   'Cloak of Ash',      'Take 30% less damage.',           { armor: 0.7 },  0x5a5a66, 'armor'),
  G('m_mantle', 'mage', 'back',   'Mantle of the Deep', 'Heal to full, +40% health.',     { hp: 1.4 },     0x2f7a5a, 'vital'),
  G('m_ring',   'mage', 'charm',  'Midas Ring',        'His kills drop 60% more gold.',   { gold: 1.6 },   0xffc83a, 'greed'),
  G('m_cup',    'mage', 'charm',  'Blood Chalice',     'His kills heal him 1.5%.',        { leech: 0.015 }, 0xff3a5a, 'leech'),
  G('m_tome',   'mage', 'charm',  'Giantsbane Tome',   '+80% damage to brutes, champions and the Warlord.', { heavy: 1.8 }, 0x9fe6ff, 'corpse'),

  G('w_sword',  'warrior', 'weapon', 'Great Longsword',  '+20% critical chance.',          { crit: 0.2 },   0xe8e8f4, 'crit'),
  G('w_edge',   'warrior', 'weapon', 'Butcher’s Edge', '+40% damage.',                { dmg: 1.4 },    0xff4a3a, 'might'),
  G('w_horns',  'warrior', 'head',   'Horned Helm',      'Attack 30% faster.',             { haste: 1.3 },  0xe8e0c8, 'haste'),
  G('w_bull',   'warrior', 'head',   'Helm of the Bull', '+80% damage to brutes, champions and the Warlord.', { heavy: 1.8 }, 0xb0482a, 'corpse'),
  G('w_banner', 'warrior', 'back',   'War Banner',       '+25% chance to strike twice.',   { echo: 0.25 },  0xc02820, 'echo'),
  G('w_wolf',   'warrior', 'back',   'Wolfskin Cloak',   'The party sprints 15% faster and goblins drag half as much.', { speed: 1.15, drag: 0.5 }, 0x8a8a94, 'boot'),
  G('w_purse',  'warrior', 'charm',  'Plunderer’s Purse', 'His kills drop 60% more gold.', { gold: 1.6 }, 0xffc83a, 'greed'),
  G('w_fang',   'warrior', 'charm',  'Vampiric Fang',    'His kills heal him 1.5%.',       { leech: 0.015 }, 0xff3a5a, 'leech'),
  G('w_heart',  'warrior', 'charm',  'Heart of the Mountain', 'Heal to full, +40% health.', { hp: 1.4 },    0x84e08e, 'vital'),

  G('g_scope',  'gnome', 'weapon', 'Dragonglass Scope',  '+20% critical chance.',          { crit: 0.2 },   0xff6ad0, 'crit'),
  G('g_barrel', 'gnome', 'weapon', 'Overbored Barrel',   '+40% damage.',                   { dmg: 1.4 },    0xffd040, 'might'),
  G('g_goggles', 'gnome', 'head',  'Clockwork Goggles',  'Fire 30% faster.',               { haste: 1.3 },  0x4ad0ff, 'haste'),
  G('g_cap',    'gnome', 'head',   'Tinfoil Cap',        'Take 30% less damage.',          { armor: 0.7 },  0xc8d0dc, 'armor'),
  G('g_pack',   'gnome', 'back',   'Rocket Pack',        'The party sprints 15% faster and goblins drag half as much.', { speed: 1.15, drag: 0.5 }, 0xff7a2a, 'boot'),
  G('g_coil',   'gnome', 'back',   'Tesla Coil',         '+25% chance to fire twice.',     { echo: 0.25 },  0x9fe6ff, 'echo'),
  G('g_magnet', 'gnome', 'charm',  'Coin Magnet',        'His kills drop 60% more gold.',  { gold: 1.6 },   0xffc83a, 'greed'),
  G('g_gear',   'gnome', 'charm',  'Spare Cog',          'Heal to full, +40% health.',     { hp: 1.4 },     0x84e08e, 'vital'),
  G('g_shell',  'gnome', 'charm',  'Armour-Piercing Shell', '+80% damage to brutes, champions and the Warlord.', { heavy: 1.8 }, 0xb0b0c0, 'corpse'),

  G('n_needle', 'nurse', 'weapon', 'Gilded Needle',      '+40% healing and damage.',       { dmg: 1.4 },    0xffd060, 'might'),
  G('n_pump',   'nurse', 'weapon', 'Twin-Pump Injector', 'Act 30% faster.',                { haste: 1.3 },  0x7dffb0, 'haste'),
  G('n_cap',    'nurse', 'head',   'Head Nurse’s Cap', '+25% chance to dose twice.',  { echo: 0.25 },  0xff4a6a, 'echo'),
  G('n_halo',   'nurse', 'head',   'Night-Shift Halo',   '+20% critical chance.',          { crit: 0.2 },   0xffe890, 'crit'),
  G('n_coat',   'nurse', 'back',   'Surgeon’s Coat', 'Take 30% less damage.',         { armor: 0.7 },  0xe8f0f4, 'armor'),
  G('n_wings',  'nurse', 'back',   'Paper Wings',        'The party sprints 15% faster and goblins drag half as much.', { speed: 1.15, drag: 0.5 }, 0xffb0d0, 'boot'),
  G('n_tips',   'nurse', 'charm',  'Tip Jar',            'Her kills drop 60% more gold.',  { gold: 1.6 },   0xffc83a, 'greed'),
  G('n_drip',   'nurse', 'charm',  'Saline Drip',        'Heal to full, +40% health.',     { hp: 1.4 },     0x84e08e, 'vital'),
  G('n_vial',   'nurse', 'charm',  'Leech Jar',          'Her kills heal her 1.5%.',       { leech: 0.015 }, 0xff3a5a, 'leech'),
];

// ---------------------------------------------------------------- upgrades and talents
// Each hero has exactly two things to buy: Damage and Defense.
// cost(level) = base * growth^(level * SCALE.cost), rounded to something tidy.
const pct = v => `${Math.round(v * 100)}%`;
const upgrades = (hp, dmgName, defName, dmgDesc) => [
  { id: 'power', icon: 'might', name: dmgName, max: 99, base: 6, growth: 1.335, desc: dmgDesc,
    value: l => `×${Math.pow(1.16, l).toFixed(l < 12 ? 2 : l < 30 ? 1 : 0)}` },
  { id: 'vital', icon: 'vital', name: defName, max: 99, base: 6, growth: 1.335, desc: '+17% health per level.',
    value: l => `${fmt(Math.round(hp * Math.pow(1.17, l)))} health` },
];
export function upgradeCost(u, level) {
  const raw = u.base * SCALE.costBase * Math.pow(u.growth, level * SCALE.cost);
  if (raw < 100) return Math.round(raw);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)) - 1);
  return Math.round(raw / mag) * mag;
}

// A talent point arrives on a hero's 1st upgrade, then the 3rd, 6th, 10th...
export const TALENT_AT = [];
for (let n = 1, t = 1; t <= 120; n++, t += n) TALENT_AT.push(t);
export function talentPointsEarned(levels) { let n = 0; for (const t of TALENT_AT) if (levels >= t) n++; return n; }
export function nextTalentAt(levels) { for (const t of TALENT_AT) if (levels < t) return t; return null; }

// Talents are laid out in three branches; each needs the one above it.
// `fx` is what the simulation reads; rune and sigil talents are understood by name.
const T = (id, name, desc, icon, fx) => ({ id, name, desc, icon, fx: fx || {} });
const runeT = id => ({ id: 'rune_' + id, name: RUNES[id].name, desc: `Learn ${RUNES[id].name} (${RUNES[id].shape}): ${RUNES[id].blurb.charAt(0).toLowerCase()}${RUNES[id].blurb.slice(1)}`, icon: 'rune', rune: id, fx: {} });
const sigil = (n, word) => T('sigil' + n, n === 2 ? 'Second ' + word : 'Third ' + word, `Draw ${n === 2 ? 'two' : 'three'} ${word.toLowerCase()}s before each run and mix their effects.`, 'slots', { slots: 1 });

export const CLASSES = {
  mage: {
    id: 'mage', name: 'Mage', word: 'rune', book: 'Your grimoire', cost: 0, hp: 40, armor: 1, starter: 'ember', pronoun: 'his',
    blurb: 'Blasts the horde from range. Fragile, explosive.',
    runes: ['ember', 'storm', 'frost', 'arcane', 'void'],
    evolutions: ['Apprentice', 'Adept', 'Conjurer', 'Sorcerer', 'Archmage', 'Ascendant'],
    blurbs: ['A borrowed robe and a stick that hums.', 'A proper staff. The orcs have noticed.', 'Gilded trim and a crystal that bites.', 'Runes circle you of their own accord.', 'The cave itself leans away from you.', 'Less a mage than a weather system.'],
    upgrades: upgrades(40, 'Damage', 'Defense', 'Every spell hits 16% harder per level.'),
    branches: [
      { name: 'Runes', talents: [runeT('storm'), runeT('frost'), sigil(2, 'Rune'), runeT('arcane'), sigil(3, 'Rune'), runeT('void')] },
      { name: 'Sorcery', talents: [
        T('fork', 'Forked Magic', 'Your spells jump: fireballs bounce to a second orc, lightning chains further, lances fan out, missiles multiply.', 'fork', { fork: 1 }),
        T('echo', 'Spell Echo', 'One cast in four goes off twice.', 'echo', { echo: 0.25 }),
        T('critburst', 'Critical Mass', 'Spells crit 15% of the time, and every crit explodes.', 'crit', { crit: 0.15, critBurst: 1 }),
        T('corpse', 'Chain Reaction', 'Slain orcs burst and hurt everything next to them.', 'corpse', { corpse: 0.25 }),
        T('timewarp', 'Time Warp', 'Orcs near the mage move and swing 30% slower.', 'haste', { slowAura: 1 }),
      ] },
      { name: 'Conjuring', talents: [
        T('wisp', 'Wisp Familiar', 'A wisp orbits the mage and snipes orcs on its own.', 'wisp', { wisps: 1 }),
        T('meteor', 'Cataclysm', 'Every few seconds a meteor hammers the thickest pack.', 'meteor', { meteor: 2 }),
        T('shield', 'Mana Barrier', 'A barrier soaks hits and recharges when he is left alone for 3s.', 'shield', { shield: 0.4 }),
        T('wisp2', 'Wisp Swarm', 'Two more wisps join the first.', 'wisp', { wisps: 2 }),
        T('phoenix', 'Phoenix Feather', 'Once per run he rises from death in a blast of fire.', 'phoenix', { phoenix: 1 }),
      ] },
    ],
  },
  warrior: {
    id: 'warrior', name: 'Warrior', word: 'war mark', book: 'Your war marks', cost: 500, hp: 58, armor: 0.8, drag: 0.45, starter: 'cleave', pronoun: 'his',
    blurb: 'Takes point and soaks the blows. Tough, relentless, up close.',
    runes: ['cleave', 'hurl', 'quake', 'whirl', 'crown'],
    evolutions: ['Recruit', 'Footman', 'Veteran', 'Vanguard', 'Warbringer', 'Titan'],
    blurbs: ['A dented sword and a lot of nerve.', 'A real shield. It already has notches.', 'Steel plate, and the scars to match.', 'Orcs tell their whelps stories about you.', 'The horde parts before the banner.', 'The mountain learned to walk.'],
    upgrades: upgrades(58, 'Damage', 'Defense', 'Every blow lands 16% harder per level.'),
    branches: [
      { name: 'War Marks', talents: [runeT('hurl'), runeT('quake'), sigil(2, 'Mark'), runeT('whirl'), sigil(3, 'Mark'), runeT('crown')] },
      { name: 'Fury', talents: [
        T('fork', 'Sweeping Blows', 'Everything reaches further: cleaves go all the way round, axes fly three at a time, quakes and whirlwinds widen.', 'sweep', { fork: 1 }),
        T('echo', 'Follow Through', 'One swing in four lands twice.', 'echo', { echo: 0.25 }),
        T('critburst', 'Brutal Strikes', 'Blows crit 15% of the time, and every crit sends out a shockwave.', 'crit', { crit: 0.15, critBurst: 1 }),
        T('corpse', 'Gore Burst', 'Slain orcs burst and hurt everything next to them.', 'corpse', { corpse: 0.25 }),
        T('trample', 'Juggernaut', 'Goblins no longer slow the party, and anything he runs into gets trampled.', 'boot', { trample: 1 }),
      ] },
      { name: 'Bulwark', talents: [
        T('thorns', 'Spiked Armour', 'Every orc that hits him is hit back.', 'thorns', { thorns: 1 }),
        T('warcry', 'War Cry', 'Every 6s a roar stuns nearby orcs and turns them all on him.', 'horn', { warcry: 1 }),
        T('shield', 'Tower Shield', 'A guard soaks hits and recovers when he is left alone for 3s.', 'shield', { shield: 0.4 }),
        T('blades', 'Spirit Blades', 'Two ghostly blades circle him, striking on their own.', 'wisp', { wisps: 2 }),
        T('phoenix', 'Second Wind', 'Once per run he gets back up in a blast of fury.', 'phoenix', { phoenix: 1 }),
      ] },
    ],
  },
  gnome: {
    id: 'gnome', name: 'Gnome', word: 'schematic', book: 'Your schematics', cost: 3000, hp: 34, armor: 1, starter: 'longshot', pronoun: 'his',
    blurb: 'Sniper and engineer. Picks off the big ones from the back.',
    runes: ['longshot', 'drone', 'bomb', 'orbital'],
    evolutions: ['Tinkerer', 'Marksman', 'Gadgeteer', 'Artificer', 'Master Engineer', 'Mad Genius'],
    blurbs: ['A rifle taller than he is.', 'Goggles on. He has stopped missing.', 'Everything he owns now beeps.', 'The backpack has its own backpack.', 'He bills the orcs for ammunition.', 'Nobody is sure what half of it does.'],
    upgrades: upgrades(34, 'Damage', 'Defense', 'Every shot and gadget hits 16% harder per level.'),
    branches: [
      { name: 'Schematics', talents: [runeT('drone'), sigil(2, 'Schematic'), runeT('bomb'), sigil(3, 'Schematic'), runeT('orbital')] },
      { name: 'Gunnery', talents: [
        T('fork', 'Ricochet', 'Rounds punch through to more orcs, drones fire twin shots, bombs scatter bomblets, the beam walks further.', 'fork', { fork: 1 }),
        T('echo', 'Double Tap', 'One shot in four fires twice.', 'echo', { echo: 0.25 }),
        T('critburst', 'Headshot', 'Shots crit 15% of the time, and every crit explodes.', 'crit', { crit: 0.15, critBurst: 1 }),
        T('corpse', 'Booby Traps', 'Slain orcs burst and hurt everything next to them.', 'corpse', { corpse: 0.25 }),
      ] },
      { name: 'Workshop', talents: [
        T('wisp', 'Helper Bot', 'A little bot circles him, plinking orcs on its own.', 'wisp', { wisps: 1 }),
        T('meteor', 'Airstrike', 'Every few seconds a shell lands on the thickest pack.', 'meteor', { meteor: 2 }),
        T('shield', 'Force Field', 'A field soaks hits and recharges when he is left alone for 3s.', 'shield', { shield: 0.4 }),
        T('wisp2', 'Bot Swarm', 'Two more bots join the first.', 'wisp', { wisps: 2 }),
        T('phoenix', 'Emergency Teleport', 'Once per run he blinks out of death in a blast.', 'phoenix', { phoenix: 1 }),
      ] },
    ],
  },
  nurse: {
    id: 'nurse', name: 'Nurse', word: 'remedy', book: 'Your remedies', cost: 15000, hp: 36, armor: 1, starter: 'mend', pronoun: 'her',
    blurb: 'Keeps everyone on their feet, and poisons what she cannot cure.',
    runes: ['mend', 'toxin', 'adrenaline', 'defib'],
    evolutions: ['Trainee', 'Night Nurse', 'Medic', 'Head Nurse', 'Surgeon General', 'Angel of Mercy'],
    blurbs: ['Fresh out of school, straight into a cave.', 'Does her rounds in heels. Do not ask.', 'Has seen worse. Has caused worse.', 'The orcs form an orderly queue.', 'Her bedside manner is a war crime.', 'Death has stopped taking her calls.'],
    upgrades: upgrades(36, 'Potency', 'Defense', 'Heals and poisons are 16% stronger per level.'),
    branches: [
      { name: 'Remedies', talents: [runeT('toxin'), sigil(2, 'Remedy'), runeT('adrenaline'), sigil(3, 'Remedy'), runeT('defib')] },
      { name: 'Bedside', talents: [
        T('fork', 'Triage', 'Mend reaches two patients, syringes fly three at a time, adrenaline also adds damage, the defib raises a second ally.', 'fork', { fork: 1 }),
        T('echo', 'Double Dose', 'One treatment in four is given twice.', 'echo', { echo: 0.25 }),
        T('regen', 'Bedside Manner', 'While she stands, the whole party slowly heals.', 'vital', { regen: 0.008 }),
        T('corpse', 'Contagion', 'Slain orcs burst and hurt everything next to them.', 'corpse', { corpse: 0.25 }),
      ] },
      { name: 'Ward', talents: [
        T('wisp', 'IV Drone', 'A drip-fed drone circles her, stinging orcs on its own.', 'wisp', { wisps: 1 }),
        T('shield', 'Sterile Field', 'A field soaks hits and recharges when she is left alone for 3s.', 'shield', { shield: 0.4 }),
        T('angel', 'Guardian Angel', 'Once per run, the first ally to fall is pulled back from the brink.', 'phoenix', { angel: 1 }),
        T('phoenix', 'Second Opinion', 'Once per run she gets back up herself.', 'phoenix', { phoenix: 1 }),
      ] },
    ],
  },
};
export const CLASS_ORDER = ['mage', 'warrior', 'gnome', 'nurse'];
export const CLASS_SCREEN_AFTER_RUNS = 2;     // the party screen appears once you have this many runs
export const EVO_AT = [0, 6, 16, 30, 48, 70];
export const EVO_MULT = [1, 1.25, 1.6, 2.1, 2.8, 3.8];
for (const id in CLASSES) {
  const C = CLASSES[id];
  C.talents = C.branches.flatMap((b, bi) => b.talents.map((t, row) => Object.assign(t, { branch: bi, row, req: row ? b.talents[row - 1].id : null })));
  C.evolutions = C.evolutions.map((name, i) => ({ at: EVO_AT[i], name, mult: EVO_MULT[i], blurb: C.blurbs[i] }));
}

export function findUpgrade(cls, id) { return CLASSES[cls].upgrades.find(u => u.id === id); }
export function findTalent(cls, id) { return CLASSES[cls].talents.find(t => t.id === id); }

// ---------------------------------------------------------------- progress helpers
export function totalLevels(save, cls = save.cur) {
  const up = save.cls[cls].upgrades;
  return (up.power || 0) + (up.vital || 0);
}
export function evolutionTier(save, cls = save.cur) {
  const n = totalLevels(save, cls);
  let t = 0;
  EVO_AT.forEach((at, i) => { if (n >= at) t = i; });
  return t;
}
export function talentPoints(save, cls = save.cur) {
  const earned = talentPointsEarned(totalLevels(save, cls)), spent = save.cls[cls].talents.length;
  return { earned, spent, free: Math.max(0, earned - spent), next: nextTalentAt(totalLevels(save, cls)) };
}
/** Can this talent be learned right now? */
export function canLearn(save, cls, id) {
  const t = findTalent(cls, id), have = save.cls[cls].talents;
  return !!t && !have.includes(id) && (!t.req || have.includes(t.req)) && talentPoints(save, cls).free > 0;
}

// ---------------------------------------------------------------- derived stats
export function computeStats(save, cls = save.cur) {
  const C = CLASSES[cls], mine = save.cls[cls], up = mine.upgrades;
  const tier = evolutionTier(save, cls), evo = EVO_MULT[tier];
  // sum up what the learned talents grant
  const fx = { fork: 0, echo: 0, crit: 0, critBurst: 0, corpse: 0, slowAura: 0, wisps: 0, meteor: 0, shield: 0, phoenix: 0, slots: 0, trample: 0, thorns: 0, warcry: 0, regen: 0, angel: 0 };
  const runes = [C.starter];
  for (const id of mine.talents) {
    const t = findTalent(cls, id);
    if (!t) continue;
    if (t.rune) runes.push(t.rune);
    for (const k in t.fx) fx[k] += t.fx[k];
  }
  return {
    cls, tier,
    maxHp: C.hp * Math.pow(1.17, up.vital || 0) * (1 + (evo - 1) * 0.6),
    dmgMult: Math.pow(1.16, up.power || 0) * evo,
    haste: 1, goldMult: 1, armor: C.armor, leech: 0,
    critChance: fx.crit, critMult: 2.5, critBurst: !!fx.critBurst,
    echo: fx.echo, slots: 1 + fx.slots, shield: fx.shield, phoenix: fx.phoenix,
    wisps: fx.wisps, meteor: fx.meteor, corpse: fx.corpse,
    fork: !!fx.fork, slowAura: !!fx.slowAura, trample: !!fx.trample, thorns: !!fx.thorns, warcry: !!fx.warcry,
    regen: fx.regen, angel: fx.angel,
    healMult: 1 + 0.05 * (up.power || 0),          // healing grows gently, not exponentially
    lootChance: 0.035,
    drag: fx.trample ? 0 : (C.drag || 1),          // how much clinging fodder slows the sprint
    runes: C.runes.filter(r => runes.includes(r)),
  };
}

// ---------------------------------------------------------------- save data
export function newSave() {
  const out = { v: 3, gold: 0, totalGold: 0, runs: 0, bestDepth: 0, victories: 0, bestTime: 0, muted: false, cur: 'mage', ff: 1, cls: {} };
  for (const id of CLASS_ORDER) out.cls[id] = { unlocked: id === 'mage', upgrades: {}, talents: [], runs: 0, bestDepth: 0, lastRunes: [], lastDraw: [] };
  return out;
}
/** Accepts anything a previous version stored and returns a current save. */
export function migrateSave(s) {
  const out = newSave();
  if (!s || typeof s !== 'object') return out;
  for (const k of ['gold', 'totalGold', 'runs', 'bestDepth', 'victories', 'bestTime', 'muted', 'ff']) if (s[k] !== undefined) out[k] = s[k];
  const old = s.v === 1 ? { mage: { unlocked: true, upgrades: s.upgrades, runs: s.runs, bestDepth: s.bestDepth } } : (s.cls || {});
  for (const id of CLASS_ORDER) {
    const o = old[id];
    if (!o) continue;
    const c = out.cls[id], up = o.upgrades || {};
    c.unlocked = id === 'mage' || !!o.unlocked;
    c.upgrades = { power: Math.min(99, up.power || 0), vital: Math.min(99, up.vital || 0) };
    c.runs = o.runs || 0; c.bestDepth = o.bestDepth || 0;
    c.lastRunes = Array.isArray(o.lastRunes) ? o.lastRunes : [];
    if (s.v === 3) { c.talents = (o.talents || []).filter(t => findTalent(id, t)); c.lastDraw = o.lastDraw || []; }
    out.bestDepth = Math.max(out.bestDepth, c.bestDepth);
  }
  if (s.v !== 3) {
    // Older saves spread gold over many upgrades that no longer exist: hand a
    // share of lifetime earnings back, and let the talent points be re-spent.
    out.gold += Math.floor((s.totalGold || 0) * 0.3);
  }
  if (CLASSES[s.cur] && out.cls[s.cur].unlocked) out.cur = s.cur;
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
