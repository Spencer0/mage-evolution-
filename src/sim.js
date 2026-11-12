// Headless run simulation. No rendering, no DOM: the renderer reads state and
// drains `events`; tools/balance.mjs drives the very same code to tune numbers.
import {
  RUNES, ENEMIES, CHAMPIONS, CAVE_LENGTH, MAGE_SPEED, SPAWN_AHEAD, CAST_RANGE, ELEMENTS, GEAR, newMods,
  depthHp, depthDmg, depthGold, packBudget,
} from './data.js';

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const LANE = 4.2;
let NEXT_ID = 1;

const MAX_ALIVE = 44;

// The cave is one long stream of small groups a few metres apart, so the
// mage is always running into something, with a goblin tide every so often.
function generatePacks(rng, lootChance) {
  const packs = [];
  let d = 11, n = 0;
  while (d < CAVE_LENGTH - 40) {
    const nearChampion = CHAMPIONS.some(c => Math.abs(c.d - d) < 7);
    if (!nearChampion) {
      const horde = n > 5 && n % 13 === 12;
      let budget = packBudget(d) * (horde ? 1.8 : d < 50 ? 1 : 0.7 + rng() * 0.6);
      const roll = rng();
      const theme = horde || roll < 0.3 ? 'swarm' : roll < 0.45 ? 'heavy' : roll < 0.62 ? 'ranged' : 'mixed';
      const members = [];
      let shamans = 0, brutes = 0;
      const max = horde ? 14 : 9;
      while (budget > 0.3 && members.length < max) {
        const opts = [['whelp', theme === 'swarm' ? 9 : 3], ['grunt', d < 24 ? 0 : theme === 'mixed' ? 3 : theme === 'swarm' ? 0.6 : 1.5]];
        if (d > 45) opts.push(['archer', theme === 'ranged' ? 5 : 0.9]);
        if (d > 330 && budget >= 2.8 && brutes < 2) opts.push(['brute', theme === 'heavy' ? 4 : 0.5]);
        if (d > 510 && budget >= 2.2 && shamans < 1) opts.push(['shaman', 0.7]);
        let total = 0;
        for (const o of opts) total += o[1];
        let r = rng() * total, pick = 'whelp';
        for (const o of opts) { r -= o[1]; if (r <= 0) { pick = o[0]; break; } }
        if (ENEMIES[pick].cost > budget + 0.25) pick = 'whelp';
        if (pick === 'shaman') shamans++;
        if (pick === 'brute') brutes++;
        members.push(pick);
        budget -= ENEMIES[pick].cost;
      }
      if (d > 40 && rng() < lootChance) members.push('loot');
      packs.push({ d, members, horde });
    }
    n++;
    d += 5.4 + rng() * 3.2 - 1.2 * (d / CAVE_LENGTH);
  }
  for (const c of CHAMPIONS) packs.push({ d: c.d, members: ['champion', 'grunt', 'whelp', 'whelp'], championName: c.name });
  packs.push({ d: CAVE_LENGTH, members: ['boss'] });
  packs.sort((a, b) => a.d - b.d);
  return packs;
}

const FORMATION = {
  warrior: { ox: -0.7, od: 1.6 }, mage: { ox: 0.9, od: -0.9 }, gnome: { ox: -1.5, od: -1.7 }, nurse: { ox: 0.1, od: -2.7 },
};
/** Where a hero stands relative to the party anchor: fighters up front, casters behind. */
export function formation(cls, solo) {
  if (solo) return { ox: 0, od: 0 };
  return FORMATION[cls] || { ox: 0, od: 0 };
}

export class RunSim {
  /**
   * @param opts.heroes  [{ cls, stats, slots: [{ rune, power, haste }] }]  the party, one or more
   *                     (a single `opts.stats` + `opts.slots` is still accepted)
   * @param opts.seed
   */
  constructor(opts) {
    const defs = opts.heroes || [{ cls: opts.stats.cls, stats: opts.stats, slots: opts.slots }];
    this.rng = mulberry32(opts.seed || 1);
    this.t = 0;
    this.events = [];
    // The party moves as one. Melee heroes take the front, casters hang back.
    this.party = { x: 0, d: 0, speedFrac: 1, blocked: false, alive: true };
    const solo = defs.length === 1;
    this.slots = [];
    this.heroes = defs.map((h, idx) => {
      const st = h.stats, f = formation(st.cls, solo);
      const hero = {
        idx, cls: st.cls, stats: st,
        ox: f.ox, od: f.od,
        x: 0, d: 0, hp: st.maxHp, maxHp: st.maxHp,
        maxShield: st.maxHp * st.shield, shield: st.maxHp * st.shield, shieldDelay: 0,
        alive: true, invuln: 0, revives: st.phoenix, castT: 0, hurtT: 0,
        mod: newMods(), gear: [],          // what this hero has picked up this run
        rushT: 0, rushAmt: 0, rushDmg: 1, cryCd: 4, trampleT: 0, angel: st.angel, raises: 0,
        wispCd: [], meteorCd: st.meteor ? 3 + idx : Infinity, slots: [],
      };
      for (let i = 0; i < st.wisps; i++) hero.wispCd.push(0.6 + i * 0.4);
      h.slots.forEach((s, i) => {
        const slot = { idx: this.slots.length, hero, rune: s.rune, def: RUNES[s.rune], power: s.power, haste: 1 + (s.haste || 0), cd: 0.3 + i * 0.22 + idx * 0.11, maxCd: 1 };
        hero.slots.push(slot); this.slots.push(slot);
      });
      hero.x = hero.ox; hero.d = hero.od;
      return hero;
    });
    this.enemies = [];
    this.projectiles = [];
    this.zones = [];
    this.pending = [];
    this.packs = generatePacks(this.rng, Math.max(...this.heroes.map(h => h.stats.lootChance)));
    this.packIdx = 0;
    this.gold = 0;
    this.kills = 0;
    this.gear = [];              // ids of the gear picked up this run
    this.offer = null;           // [gear, gear] while the run waits for a choice
    this.over = false;
    this.victory = false;
    this.boss = null;
    this.bossDead = false;
    this.dmgDealt = 0;
  }

  /** The party anchor: position, sprint and whether anyone is still standing. */
  get mage() { return this.party; }
  /** The hero taking point: the front-most one still alive. */
  get lead() {
    let best = null;
    for (const h of this.heroes) if (h.alive && (!best || h.od > best.od)) best = h;
    return best || this.heroes[0];
  }
  anyAlive() { return this.heroes.some(h => h.alive); }

  emit(e) { this.events.push(e); }
  drainEvents() { const e = this.events; this.events = []; return e; }

  // ------------------------------------------------------------ spawning
  spawnEnemy(type, x, d, extra) {
    const def = ENEMIES[type];
    const depth = Math.min(d, CAVE_LENGTH);
    const hpM = depthHp(depth), dmgM = depthDmg(depth);
    const e = {
      id: NEXT_ID++, type, def, x, d, r: def.r,
      hp: def.hp * hpM, maxHp: def.hp * hpM, dmg: def.dmg * dmgM, gold: def.gold * depthGold(depth),
      speed: def.speed * (0.92 + this.rng() * 0.16),
      atkT: def.atk * (0.3 + this.rng() * 0.5), windup: 0,
      slot: (this.rng() * 2 - 1) * (def.heavy ? 0.7 : 2.3), weave: this.rng() * 6.28, engaged: false,
      pick: this.rng(),             // decides which hero this one goes for
      burnT: 0, burnDps: 0, burnTick: 0, burnBy: null, chillT: 0, shockT: 0, freezeT: 0, freezeImm: 0, stunT: 0,
      mark: false, alive: true, kx: 0, kd: 0, hitFlash: 0, buffed: false,
      age: 0, taunt: 0, fleeing: false, moving: true, attackAnim: 0, attackDur: 0.45,
      summonT: 7, slamT: 5, enraged: false, name: def.name,
      ...extra,
    };
    this.enemies.push(e);
    this.emit({ type: 'spawn', e });
    return e;
  }

  spawnPacks() {
    while (this.packIdx < this.packs.length && this.party.d + SPAWN_AHEAD >= this.packs[this.packIdx].d) {
      const p = this.packs[this.packIdx++];
      if (p.horde) this.emit({ type: 'horde', d: p.d });
      p.members.forEach((type, i) => {
        if (type !== 'boss' && type !== 'champion' && this.enemies.length >= MAX_ALIVE) return;
        if (type === 'boss') {
          this.boss = this.spawnEnemy('boss', 0, p.d + 1, {});
          this.emit({ type: 'bossIntro', e: this.boss });
        } else if (type === 'champion') {
          const e = this.spawnEnemy('champion', 0, p.d, { name: p.championName });
          this.emit({ type: 'champion', e });
        } else {
          const x = (this.rng() * 2 - 1) * LANE;
          this.spawnEnemy(type, x, p.d + i * 0.6 + this.rng() * 3, {});
        }
      });
    }
  }

  // ------------------------------------------------------------ targeting
  /** Which hero an orc is after. Heavies and most melee go for the front line. */
  targetOf(e) {
    const lead = this.lead;
    if (e.tauntT > 0 && e.tauntBy && e.tauntBy.alive) return e.tauntBy;
    if (this.heroes.length === 1 || e.def.heavy) return lead;
    const frontChance = e.def.range ? 0.45 : 0.72;
    if (e.pick < frontChance) return lead;
    // the rest pick one of the heroes hanging back
    const back = this.heroes.filter(h => h.alive && h !== lead);
    return back.length ? back[Math.floor(e.pick * 97) % back.length] : lead;
  }
  inRange(e, range = CAST_RANGE, from = this.party) {
    return e.alive && e.d - from.d < range && e.d - from.d > -9;
  }
  nearestEnemy(x, d, range, skip) {
    let best = null, bd = range * range;
    for (const e of this.enemies) {
      if (!e.alive || (skip && skip.has(e.id))) continue;
      const dx = e.x - x, dd = e.d - d, q = dx * dx + dd * dd;
      if (q < bd) { bd = q; best = e; }
    }
    return best;
  }
  pickTarget(from, range = CAST_RANGE) {
    let best = null, bd = Infinity;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const dist = Math.hypot(e.x - from.x, e.d - from.d);
      if (dist > range + e.r || e.d - from.d < -9) continue;
      const q = dist - (e.fleeing ? 4 : 0);
      if (q < bd) { bd = q; best = e; }
    }
    return best;
  }
  clusterTarget(from, radius, range = CAST_RANGE) {
    let best = null, bn = -1;
    for (const e of this.enemies) {
      if (!this.inRange(e, range, from)) continue;
      let n = e.def.elite ? 2 : 0;
      for (const o of this.enemies) {
        if (o.alive && Math.hypot(o.x - e.x, o.d - e.d) < radius) n += o.def.heavy ? 2 : 1;
      }
      if (n > bn) { bn = n; best = e; }
    }
    return best;
  }

  // ------------------------------------------------------------ gear
  /** Take one of the two pieces on offer; its owner wears it for the rest of the run. */
  chooseGear(i) {
    if (!this.offer) return null;
    const g = this.offer[i] || this.offer[0];
    this.offer = null;
    const h = this.heroes.find(x => x.cls === g.cls) || this.lead, m = h.mod;
    this.gear.push(g.id);
    h.gear.push(g);
    for (const k in g.mod) {
      if (k === 'echo' || k === 'crit' || k === 'leech') m[k] += g.mod[k]; else m[k] *= g.mod[k];
    }
    if (g.mod.hp) { h.maxHp *= g.mod.hp; h.maxShield *= g.mod.hp; h.hp = h.maxHp; h.shield = h.maxShield; }
    this.emit({ type: 'gearTaken', gear: g, hero: h.idx });
    return g;
  }
  offerGear() {
    // only for heroes still standing, and only into a free slot (three charms fit)
    const pool = GEAR.filter(g => {
      const h = this.heroes.find(x => x.cls === g.cls);
      if (!h || !h.alive || h.gear.includes(g)) return false;
      const worn = h.gear.filter(x => x.slot === g.slot).length;
      return worn < (g.slot === 'charm' ? 3 : 1);
    });
    if (pool.length < 2) return;
    const a = pool.splice((this.rng() * pool.length) | 0, 1)[0];
    // prefer a second piece that is a real alternative: another slot or another hero
    const elsewhere = pool.filter(g => g.cls !== a.cls), otherSlot = pool.filter(g => g.slot !== a.slot);
    const src = elsewhere.length ? elsewhere : otherSlot.length ? otherSlot : pool;
    this.offer = [a, src[(this.rng() * src.length) | 0]];
    this.emit({ type: 'gearOffer', offer: this.offer });
  }

  // ------------------------------------------------------------ casting
  hasteMult(hero) { return hero.stats.haste * hero.mod.haste * (hero.rushT > 0 ? 1 + hero.rushAmt : 1); }

  cast(slot, echo) {
    const m = slot.hero, def = slot.def, s = m.stats;
    if (!m.alive) return false;
    const range = def.range || CAST_RANGE, fork = s.fork;
    if (def.support) return this.castSupport(slot, echo);
    let target = def.id === 'void' || def.id === 'crown' || def.id === 'bomb' || def.id === 'orbital' ? this.clusterTarget(m, def.radius, range) : this.pickTarget(m, range);
    if (def.id === 'longshot') {
      // the sniper goes for the biggest thing in sight
      let hp = -1;
      for (const e of this.enemies) if (this.inRange(e, range, m) && e.hp > hp && !e.fleeing) { hp = e.hp; target = e; }
    }
    if (!target) return false;
    const dmg = def.dmg * s.dmgMult * slot.power;
    const ox = m.x + 0.55, od = m.d + 0.7;
    const by = { by: m };
    m.castT = 0.28;
    this.emit({ type: 'cast', rune: def.id, slot: slot.idx, hero: m.idx, x: ox, d: od, tx: target.x, td: target.d, echo: !!echo });
    switch (def.id) {
      case 'ember':
        this.projectiles.push({
          id: NEXT_ID++, kind: 'fireball', by: m, x: ox, d: od, target, tx: target.x, td: target.d,
          speed: 46, dmg, radius: def.radius, life: 2, fork: fork ? 1 : 0,
        });
        break;
      case 'frost': {
        const dx = target.x - ox, dd = target.d - od, l = Math.hypot(dx, dd) || 1;
        for (const a of fork ? [0, -0.24, 0.24] : [0]) {
          const c = Math.cos(a), sn = Math.sin(a), vx = (dx * c - dd * sn) / l, vd = (dx * sn + dd * c) / l;
          this.projectiles.push({
            id: NEXT_ID++, kind: 'lance', by: m, x: ox, d: od, vx: vx * 58, vd: vd * 58,
            dmg: a ? dmg * 0.7 : dmg, pierce: def.pierce, hit: new Set(), life: 0.52,
          });
        }
        break;
      }
      case 'arcane': {
        const used = new Set();
        const count = def.missiles + (fork ? 2 : 0);
        for (let i = 0; i < count; i++) {
          const t = this.nearestEnemy(m.x, m.d + 2, CAST_RANGE + 2, used) || target;
          used.add(t.id);
          const side = i - (count - 1) / 2;
          this.projectiles.push({
            id: NEXT_ID++, kind: 'missile', by: m, x: ox, d: od, vx: side * 11, vd: 12 + this.rng() * 4,
            target: t, dmg, speed: 36, life: 2, delay: i * 0.04,
          });
        }
        break;
      }
      case 'storm': {
        const hit = new Set();
        const pts = [{ x: ox, d: od, src: true }];
        let cur = target, power = dmg;
        for (let i = 0; i <= def.chains + (fork ? 3 : 0) && cur; i++) {
          hit.add(cur.id);
          pts.push({ x: cur.x, d: cur.d, r: cur.r, id: cur.id });
          const from = cur;
          this.damage(cur, power, 'storm', by);
          power *= 0.82;
          cur = this.nearestEnemy(from.x, from.d, def.chainRange, hit);
          if (cur && !this.inRange(cur, CAST_RANGE + 6)) cur = null;
        }
        this.emit({ type: 'bolt', pts, hero: m.idx });
        break;
      }
      case 'void':
        this.zones.push({
          id: NEXT_ID++, kind: 'void', by: m, x: target.x, d: target.d, r: def.radius,
          t: 0, dur: def.duration, tick: 0, dmg, fork: fork ? 1 : 0,
        });
        this.emit({ type: 'zone', z: this.zones[this.zones.length - 1] });
        break;
      // ---- warrior
      case 'cleave': {
        const ang = Math.atan2(target.x - m.x, target.d - m.d);
        const reach = def.reach * (fork ? 1.25 : 1), arc = fork ? Math.PI : def.arc;
        this.emit({ type: 'slash', x: m.x, d: m.d, ang, r: reach, arc });
        for (const e of this.enemies) {
          if (!e.alive) continue;
          const dx = e.x - m.x, dd = e.d - m.d, dist = Math.hypot(dx, dd);
          if (dist > reach + e.r) continue;
          let da = Math.atan2(dx, dd) - ang;
          while (da > Math.PI) da -= Math.PI * 2;
          while (da < -Math.PI) da += Math.PI * 2;
          if (Math.abs(da) > arc && dist > 1.4) continue;
          if (!e.def.heavy) { e.kx += (dx / (dist + 0.1)) * 3; e.kd += (dd / (dist + 0.1)) * 3; }
          this.damage(e, dmg, 'steel', by);
        }
        break;
      }
      case 'hurl': {
        const dx = target.x - ox, dd = target.d - od, l = Math.hypot(dx, dd) || 1;
        for (const a of fork ? [0, -0.26, 0.26] : [0]) {
          const c = Math.cos(a), sn = Math.sin(a), vx = (dx * c - dd * sn) / l, vd = (dx * sn + dd * c) / l;
          this.projectiles.push({
            id: NEXT_ID++, kind: 'haxe', by: m, x: ox, d: od, vx: vx * 40, vd: vd * 40,
            dmg: a ? dmg * 0.7 : dmg, pierce: def.pierce, hit: new Set(), life: 0.6, element: 'iron',
          });
        }
        break;
      }
      case 'quake': {
        const rad = def.radius * (fork ? 1.3 : 1);
        this.explode(m.x, m.d, rad, dmg, 'earth', 'quake', { knock: 4, by: m });
        for (const e of this.enemies) {
          if (e.alive && !e.def.elite && Math.hypot(e.x - m.x, e.d - m.d) < rad + e.r) e.stunT = Math.max(e.stunT, fork ? 0.9 : 0.55);
        }
        break;
      }
      case 'whirl': {
        let hits = 0;
        const rad = def.radius * (fork ? 1.3 : 1);
        this.emit({ type: 'whirl', x: m.x, d: m.d, r: rad });
        for (const e of this.enemies) {
          if (!e.alive || Math.hypot(e.x - m.x, e.d - m.d) > rad + e.r) continue;
          this.damage(e, dmg, 'blood', by);
          hits++;
        }
        if (hits && m.alive) m.hp = Math.min(m.maxHp, m.hp + m.maxHp * def.heal * Math.min(hits, 5));
        break;
      }
      case 'crown': {
        const x = target.x, d = Math.max(m.d + 2, target.d - (target.moving && !target.engaged ? 3 : 0));
        this.emit({ type: 'meteor', x, d, delay: 0.38, r: def.radius, spirit: true });
        this.pending.push({ t: 0.38, fn: () => this.explode(x, d, def.radius, dmg, 'spirit', 'judge', { knock: 5, by: m }) });
        if (fork) {       // a second blade for the next pack along
          const t2 = this.nearestEnemy(x, d + 7, 9);
          if (t2) {
            const x2 = t2.x, d2 = t2.d;
            this.pending.push({ t: 0.3, fn: () => this.emit({ type: 'meteor', x: x2, d: d2, delay: 0.38, r: def.radius, spirit: true }) });
            this.pending.push({ t: 0.68, fn: () => this.explode(x2, d2, def.radius, dmg * 0.7, 'spirit', 'judge', { knock: 5, by: m }) });
          }
        }
        break;
      }
      // ---- gnome
      case 'longshot': {
        const pts = [{ x: ox, d: od, src: true }];
        const hit = new Set();
        let cur = target, power = dmg;
        for (let i = 0; i <= (fork ? 2 : 0) && cur; i++) {
          hit.add(cur.id);
          pts.push({ x: cur.x, d: cur.d, r: cur.r, id: cur.id });
          const from = cur;
          this.damage(cur, power, 'lead', by);
          power *= 0.6;
          cur = this.nearestEnemy(from.x, from.d, 9, hit);
        }
        this.emit({ type: 'tracer', pts, hero: m.idx });
        break;
      }
      case 'drone':
        for (let i = 0; i < (fork ? 2 : 1); i++) {
          this.projectiles.push({
            id: NEXT_ID++, kind: 'bullet', by: m, x: ox + (i ? -0.5 : 0.3), d: od + 0.4, vx: (i ? -6 : 6), vd: 30,
            target, dmg, speed: 60, life: 1.2, element: 'tech',
          });
        }
        break;
      case 'bomb':
        this.projectiles.push({
          id: NEXT_ID++, kind: 'bomb', by: m, x: ox, d: od, target, tx: target.x, td: target.d,
          speed: 30, dmg, radius: def.radius, life: 2, lock: true, cluster: fork ? 3 : 0,
        });
        break;
      case 'orbital': {
        // the beam starts on the pack and walks away from the party
        const dx = target.x - m.x, dd = target.d - m.d, l = Math.hypot(dx, dd) || 1;
        const n = def.blasts + (fork ? 2 : 0);
        for (let i = 0; i < n; i++) {
          const x = target.x + (dx / l) * i * 3.6, d = target.d + (dd / l) * i * 3.6;
          this.pending.push({ t: 0.12 + i * 0.13, fn: () => this.explode(x, d, def.radius, dmg, 'spirit', 'laser', { by: m }) });
        }
        this.emit({ type: 'orbital', x: target.x, d: target.d, dx: dx / l, dd: dd / l, n });
        break;
      }
      // ---- nurse
      case 'toxin': {
        const used = new Set();
        for (let i = 0; i < (fork ? 3 : 1); i++) {
          const t = i ? this.nearestEnemy(m.x, m.d + 2, range, used) || target : target;
          used.add(t.id);
          this.projectiles.push({
            id: NEXT_ID++, kind: 'dart', by: m, x: ox, d: od, vx: (i - 1) * 8 * (fork ? 1 : 0), vd: 26,
            target: t, dmg, speed: 52, life: 1.4, element: 'toxin', delay: i * 0.03,
          });
        }
        break;
      }
      case 'defib': {
        const lead = this.lead;
        this.explode(lead.x, lead.d, def.radius, dmg, 'storm', 'defib', { by: m });
        for (const e of this.enemies) {
          if (e.alive && !e.def.elite && Math.hypot(e.x - lead.x, e.d - lead.d) < def.radius + e.r) e.stunT = Math.max(e.stunT, 0.8);
        }
        for (const h of this.heroes) if (h.alive) this.heal(h, h.maxHp * def.heal * slot.power * s.healMult, m);
        // and one of the fallen gets back up (two with Triage)
        const fallen = this.heroes.find(h => !h.alive);
        if (fallen && m.raises < (fork ? 2 : 1)) { m.raises++; this.raise(fallen, 0.5); }
        break;
      }
    }
    if (!echo && this.rng() < s.echo + m.mod.echo) this.pending.push({ t: 0.16, fn: () => this.cast(slot, true) });
    return true;
  }

  /** Runes that help the party instead of hurting orcs. */
  castSupport(slot, echo) {
    const m = slot.hero, def = slot.def, s = m.stats;
    const power = s.dmgMult > 0 ? slot.power : 1;
    if (def.id === 'mend') {
      // whoever is worst off (two patients with Triage); nothing to do if everyone is whole
      const hurt = this.heroes.filter(h => h.alive && h.hp < h.maxHp * 0.995).sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp);
      if (!hurt.length) return false;
      for (const h of hurt.slice(0, s.fork ? 2 : 1)) this.heal(h, h.maxHp * def.heal * power * s.healMult, m);
    } else if (def.id === 'adrenaline') {
      if (!this.enemies.length) return false;
      for (const h of this.heroes) {
        if (!h.alive) continue;
        h.rushT = def.rushTime; h.rushAmt = def.rush * power; h.rushDmg = s.fork ? 1.25 : 1;
      }
      this.emit({ type: 'rush', hero: m.idx });
    }
    m.castT = 0.28;
    this.emit({ type: 'cast', rune: def.id, slot: slot.idx, hero: m.idx, x: m.x, d: m.d, echo: !!echo });
    if (!echo && this.rng() < s.echo + m.mod.echo) this.pending.push({ t: 0.2, fn: () => this.castSupport(slot, true) });
    return true;
  }
  heal(h, amount, by) {
    if (!h.alive || amount <= 0) return;
    const crit = by && by.stats.critChance + by.mod.crit > 0 && this.rng() < by.stats.critChance + by.mod.crit;
    const amt = amount * (by ? by.mod.dmg : 1) * (crit ? 2 : 1);
    h.hp = Math.min(h.maxHp, h.hp + amt);
    this.emit({ type: 'heal', hero: h.idx, amount: amt, crit });
  }
  /** Bring a fallen hero back at the party's side. */
  raise(h, frac) {
    h.alive = true; h.hp = h.maxHp * frac; h.shield = h.maxShield; h.invuln = 1.6;
    h.x = this.party.x + h.ox; h.d = this.party.d + h.od;
    this.party.alive = true;
    this.emit({ type: 'raise', hero: h.idx });
  }

  // ------------------------------------------------------------ damage
  /** opts.by is the hero who dealt it: their crit, gold and on-kill perks apply. */
  damage(e, amount, element, opts = {}) {
    if (!e.alive || amount <= 0) return;
    const by = opts.by || this.heroes[0], s = by.stats;
    const E = ELEMENTS[element] || ELEMENTS.phys, mod = by.mod;
    let dmg = amount * mod.dmg * (e.def.heavy ? mod.heavy : 1) * (by.rushT > 0 ? by.rushDmg : 1), crit = false;
    const critChance = s.critChance + mod.crit;
    if (!opts.noCrit && critChance > 0 && this.rng() < critChance) {
      dmg *= s.critMult; crit = true;
      if (s.critBurst) {
        const x = e.x, d = e.d, blast = amount * 0.8;
        this.pending.push({ t: 0.04, fn: () => this.explode(x, d, 2.8, blast, 'phys', 'crit', { noCrit: true, noReact: true, noStatus: true, by }) });
      }
    }
    const has = st => (st === 'chill' ? e.chillT : st === 'burn' ? e.burnT : e.shockT) > 0;
    const clear = st => { if (st === 'chill') e.chillT = 0; else if (st === 'burn') e.burnT = 0; else e.shockT = 0; };
    const R = E.react;
    if (!opts.noReact && R && has(R.on) && (R.kind !== 'freeze' || e.freezeImm <= 0)) {
      clear(R.on);
      if (R.kind === 'double') dmg *= 2;
      else if (R.kind === 'blast') {
        const x = e.x, d = e.d, blast = amount * 1.2;
        this.pending.push({ t: 0.05, fn: () => this.explode(x, d, 3, blast, element === 'iron' ? 'phys' : 'fire', R.name, { noReact: true, noStatus: true, by }) });
      } else {
        e.freezeT = e.def.elite ? 0.6 : 1.7;
        e.freezeImm = 5;
        e.frozenAs = R.name;
        dmg *= 1.5;
      }
      this.emit({ type: 'react', name: R.name, x: e.x, d: e.d });
    }
    if (e.shockT > 0) dmg *= 1.2;
    if (!opts.noStatus) {
      if (E.applies === 'burn') { e.burnT = E.toxic ? 4 : 3; e.burnDps = Math.max(e.burnDps, amount * (E.toxic ? 0.6 : 0.28)); e.bleed = !!E.bleed; e.toxic = !!E.toxic; e.burnBy = by; }
      else if (E.applies === 'chill') { e.chillT = 3; e.daze = !!E.daze; }
      else if (E.applies === 'shock') e.shockT = 2.5;
      else if (E.applies === 'mark') e.mark = true;
    }
    e.hp -= dmg;
    e.hitFlash = 0.12;
    this.dmgDealt += dmg;
    if (!opts.silent) this.emit({ type: 'hit', id: e.id, amount: dmg, crit, element, x: e.x, d: e.d, r: e.r, dot: !!opts.dot });
    if (e.hp <= 0) this.kill(e, element, by);
  }

  explode(x, d, radius, dmg, element, kind, opts = {}) {
    this.emit({ type: 'explode', kind, x, d, r: radius });
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const dx = e.x - x, dd = e.d - d, dist = Math.hypot(dx, dd);
      if (dist > radius + e.r) continue;
      const fall = opts.primary === e ? 1 : (opts.falloff ?? 1);
      if (opts.knock && !e.def.heavy) {
        const k = opts.knock / (dist + 0.6);
        e.kx += (dx / (dist + 0.01)) * k; e.kd += (dd / (dist + 0.01)) * k + opts.knock * 0.4;
      }
      this.damage(e, dmg * fall, element, opts);
    }
  }

  kill(e, element, by = this.heroes[0]) {
    if (!e.alive) return;
    e.alive = false;
    const s = by.stats;
    this.kills++;
    const gold = e.gold * s.goldMult * by.mod.gold * (e.mark ? 1.6 : 1);
    this.gold += gold;
    const leech = s.leech + by.mod.leech;
    const healed = by.alive ? by : this.lead;
    if (leech > 0 && healed.alive) healed.hp = Math.min(healed.maxHp, healed.hp + healed.maxHp * leech);
    this.emit({ type: 'kill', e, gold, element, x: e.x, d: e.d, marked: e.mark });
    if (e.type === 'champion') this.pending.push({ t: 0.7, fn: () => this.offerGear() });
    if (s.corpse > 0 && !e.def.elite) {
      const x = e.x, d = e.d, blast = e.maxHp * s.corpse;
      this.pending.push({ t: 0.12, fn: () => this.explode(x, d, 3.2, blast, 'phys', 'corpse', { noCrit: true, noReact: true, noStatus: true, by }) });
    }
    if (e.type === 'boss') {
      this.bossDead = true;
      for (const h of this.heroes) h.invuln = 99;
      this.emit({ type: 'bossDead', e });
      let delay = 0.25;
      for (const o of this.enemies) {
        if (o.alive) { const oo = o; this.pending.push({ t: delay, fn: () => this.kill(oo, 'phys', by) }); delay += 0.08; }
      }
      this.pending.push({ t: Math.max(2.4, delay + 1.2), fn: () => { this.over = true; this.victory = true; this.emit({ type: 'victory' }); } });
    }
  }

  hurt(m, amount, src) {
    if (!m || !m.alive || m.invuln > 0 || this.over) return;
    let amt = amount * m.stats.armor * m.mod.armor;
    // spiked armour bites back at whoever swung
    if (m.stats.thorns && src && src.def && src.alive) this.damage(src, 3.2 * m.stats.dmgMult, 'phys', { by: m, noCrit: true, noReact: true, noStatus: true });
    m.shieldDelay = 3;
    m.hurtT = 0.16;
    let absorbed = 0;
    if (m.shield > 0) {
      absorbed = Math.min(m.shield, amt);
      m.shield -= absorbed; amt -= absorbed;
      if (m.shield <= 0) this.emit({ type: 'shieldBreak', hero: m.idx });
    }
    if (amt > 0) m.hp -= amt;
    this.emit({ type: 'mageHit', hero: m.idx, amount: amt, absorbed, frac: (amt + absorbed) / m.maxHp, src });
    if (m.hp <= 0) {
      if (m.revives > 0) {
        m.revives--;
        m.hp = m.maxHp * 0.6;
        m.shield = m.maxShield;
        m.invuln = 1.6;
        this.emit({ type: 'revive', hero: m.idx });
        this.explode(m.x, m.d, 9, 32 * m.stats.dmgMult, 'fire', 'nova', { knock: 9, by: m });
      } else {
        m.hp = 0; m.alive = false;
        // a guardian angel in the party pulls the first to fall straight back
        const angel = this.heroes.find(h => h.alive && h.angel > 0);
        if (angel) { angel.angel--; this.raise(m, 0.5); return; }
        this.party.alive = this.anyAlive();
        this.emit({ type: 'heroDead', hero: m.idx, last: !this.party.alive });
        if (!this.party.alive) { this.over = true; this.emit({ type: 'mageDead' }); }
      }
    }
  }

  // ------------------------------------------------------------ step
  step(dt) {
    if (this.over || this.offer) return;
    this.t += dt;
    const P = this.party;

    this.spawnPacks();

    // --- heroes: timers, barrier
    let dragStat = 0, alive = 0, regen = 0, speedMod = 1, dragMod = 1;
    for (const m of this.heroes) {
      if (!m.alive) continue;
      alive++; dragStat += m.stats.drag;
      m.invuln = Math.max(0, m.invuln - dt);
      m.castT = Math.max(0, m.castT - dt);
      m.hurtT = Math.max(0, m.hurtT - dt);
      if (m.maxShield > 0) {
        m.shieldDelay -= dt;
        if (m.shieldDelay <= 0 && m.shield < m.maxShield) m.shield = Math.min(m.maxShield, m.shield + m.maxShield * 0.5 * dt);
      }
      if (m.rushT > 0) m.rushT -= dt;
      regen += m.stats.regen;
      speedMod = Math.max(speedMod, m.mod.speed);
      dragMod = Math.min(dragMod, m.mod.drag);
    }
    dragStat /= Math.max(1, alive);
    if (regen > 0) for (const m of this.heroes) if (m.alive && m.hp < m.maxHp) m.hp = Math.min(m.maxHp, m.hp + m.maxHp * regen * dt);
    // The party never stops for fodder: every goblin hanging on just drags the
    // sprint down a little. Only heavies (brutes, champions, the boss) are walls.
    let drag = 0, wall = this.bossDead;
    const lead = this.lead;
    for (const e of this.enemies) {
      if (!e.alive || e.fleeing) continue;
      if (e.def.heavy) {
        const fd = e.d - lead.d;
        if (fd > -0.6 && fd < e.r + 1.6 && Math.abs(e.x - lead.x) < e.r + 1.5) wall = true;
      } else if (e.engaged) drag++;
    }
    const want = wall ? 0 : Math.max(0.42, 1 - 0.1 * drag * dragMod * dragStat) * speedMod;
    P.speedFrac += (want - P.speedFrac) * Math.min(1, dt * (want < P.speedFrac ? 12 : 5));
    P.blocked = P.speedFrac < 0.12;
    P.d = Math.min(CAVE_LENGTH - 4, P.d + MAGE_SPEED * P.speedFrac * dt);
    for (const m of this.heroes) if (m.alive) { m.x = P.x + m.ox; m.d = P.d + m.od; }

    // --- spells
    if (!this.bossDead) {
      for (const m of this.heroes) {
        if (!m.alive) continue;
        const s = m.stats, haste = this.hasteMult(m);
        for (const slot of m.slots) {
          slot.cd -= dt;
          if (slot.cd <= 0) {
            if (this.cast(slot)) {
              slot.maxCd = slot.def.cd / (haste * slot.haste);
              slot.cd += slot.maxCd;
              if (slot.cd < 0) slot.cd = 0;
            } else slot.cd = 0;
          }
        }
        for (let i = 0; i < m.wispCd.length; i++) {
          m.wispCd[i] -= dt;
          if (m.wispCd[i] <= 0) {
            const t = this.pickTarget(m);
            if (t) {
              m.wispCd[i] = 0.6 / Math.sqrt(haste);
              this.projectiles.push({
                id: NEXT_ID++, kind: 'wisp', by: m, wisp: i, x: m.x, d: m.d, vx: (this.rng() - 0.5) * 8, vd: 5,
                target: t, dmg: 2.6 * s.dmgMult, speed: 44, life: 2,
              });
            } else m.wispCd[i] = 0;
          }
        }
        if (s.warcry) {
          m.cryCd -= dt;
          if (m.cryCd <= 0) {
            let any = false;
            for (const e of this.enemies) {
              if (!e.alive || Math.hypot(e.x - m.x, e.d - m.d) > 8) continue;
              any = true;
              if (!e.def.elite) e.stunT = Math.max(e.stunT, 1);
              e.tauntT = 4; e.tauntBy = m;
            }
            if (any) { m.cryCd = 6; this.emit({ type: 'warcry', x: m.x, d: m.d, hero: m.idx }); } else m.cryCd = 0.3;
          }
        }
        if (s.trample && P.speedFrac > 0.3) {
          m.trampleT -= dt;
          if (m.trampleT <= 0) {
            m.trampleT = 0.3;
            for (const e of this.enemies) {
              if (e.alive && !e.def.heavy && Math.hypot(e.x - m.x, e.d - m.d) < 2.3) this.damage(e, 2.4 * s.dmgMult, 'phys', { by: m, noCrit: true, noReact: true, noStatus: true });
            }
          }
        }
        m.meteorCd -= dt;
        if (m.meteorCd <= 0) {
          const t = this.clusterTarget(m, 4.5);
          if (t) {
            m.meteorCd = 11 - 2 * s.meteor;
            const x = t.x, d = Math.max(m.d + 3, t.d - (t.moving ? 4 : 0));
            this.emit({ type: 'meteor', x, d, delay: 0.75, r: 4.6 });
            this.pending.push({ t: 0.75, fn: () => this.explode(x, d, 4.6, 38 * s.dmgMult, 'fire', 'meteor', { knock: 5, by: m }) });
          } else m.meteorCd = 0.2;
        }
      }
    }

    // --- enemies
    let anyShaman = false;
    for (const e of this.enemies) if (e.alive && e.type === 'shaman') { anyShaman = true; break; }
    for (const e of this.enemies) {
      if (!e.alive) continue;
      e.age += dt;
      e.hitFlash = Math.max(0, e.hitFlash - dt);
      e.attackAnim = Math.max(0, e.attackAnim - dt);
      e.freezeImm -= dt;
      if (e.burnT > 0) {
        e.burnT -= dt; e.burnTick += dt;
        if (e.burnTick >= 0.5) {
          e.burnTick = 0;
          this.damage(e, e.burnDps * 0.5, 'fire', { noReact: true, noStatus: true, noCrit: true, dot: true, by: e.burnBy });
          if (!e.alive) continue;
        }
        if (e.burnT <= 0) e.burnDps = 0;
      }
      if (e.chillT > 0) e.chillT -= dt;
      if (e.shockT > 0) e.shockT -= dt;
      // knockback
      if (e.kx || e.kd) {
        e.x += e.kx * dt; e.d += e.kd * dt;
        const k = Math.exp(-7 * dt);
        e.kx *= k; e.kd *= k;
        if (Math.abs(e.kx) + Math.abs(e.kd) < 0.05) e.kx = e.kd = 0;
      }
      if (e.freezeT > 0) { e.freezeT -= dt; e.moving = false; continue; }
      if (e.stunT > 0) { e.stunT -= dt; e.moving = false; continue; }

      e.buffed = false;
      if (anyShaman && e.type !== 'shaman') {
        for (const o of this.enemies) {
          if (o.alive && o.type === 'shaman' && Math.hypot(o.x - e.x, o.d - e.d) < o.def.aura) { e.buffed = true; break; }
        }
      }
      const m = this.targetOf(e);          // the hero this orc is after
      e.tgt = m.idx;
      const pace = MAGE_SPEED * P.speedFrac;
      if (e.tauntT > 0) e.tauntT -= dt;
      let slow = e.chillT > 0 ? (e.def.elite ? 0.8 : 0.6) : 1;
      for (const h of this.heroes) if (h.alive && h.stats.slowAura && Math.hypot(h.x - e.x, h.d - e.d) < 7.5) { slow *= e.def.elite ? 0.85 : 0.7; e.warped = true; break; }
      const dx = m.x - e.x, dd = m.d - e.d, dist = Math.hypot(dx, dd);
      let speed = e.speed * slow * (e.buffed ? 1.25 : 1) * (e.enraged ? 1.3 : 1);
      // fodder that has caught the party clings on at its pace (unless chilled)
      if (!e.def.heavy && dist < 7) speed = Math.max(speed, (pace + 3.5) * slow);
      const atkRate = slow * (e.enraged ? 1.35 : 1);
      const dmgMult = e.buffed ? 1.3 : 1;
      e.moving = false;
      e.engaged = false;

      // shaken off: too far behind to matter
      if (!e.def.heavy && P.d - e.d > 21) { e.alive = false; this.emit({ type: 'lost', e }); continue; }

      if (e.type === 'loot') {
        if (!e.fleeing) {
          if (dist > 14) this.moveToward(e, m.x, m.d + 12, speed, dt);
          else { e.taunt += dt; e.d += pace * 0.8 * dt; if (e.taunt > 0.9) { e.fleeing = true; this.emit({ type: 'lootFlee', e }); } }
        } else {
          e.d += Math.max(e.speed * 1.2, MAGE_SPEED * 1.25) * slow * dt; e.moving = true;
          if (e.d - P.d > 46) { e.alive = false; e.escaped = true; this.emit({ type: 'escape', e }); }
        }
        continue;
      }

      const ranged = e.def.range && dist > e.def.reach + 1.4;
      if (ranged) {
        const want2 = e.def.range;
        const strafe = Math.sin(this.t * 2.6 + e.weave) * 3.2;
        if (dist > want2 + 1) this.moveToward(e, m.x + e.slot * 1.6 + strafe * 0.4, m.d + want2 - 1, speed, dt);
        else if (dd < 0 && dist < want2 - 3) {
          // backpedal ahead of the sprinting party, hurling as it goes
          e.d += pace * 0.74 * slow * dt;
          e.x += strafe * dt;
          e.moving = true;
        } else { e.x += strafe * 0.6 * dt; e.moving = Math.abs(strafe) > 1; }
        e.atkT -= dt * atkRate;
        if (e.atkT <= 0 && dist < want2 + 4) {
          e.atkT = e.def.atk * (0.85 + this.rng() * 0.3);
          e.attackAnim = e.attackDur = 0.35;
          this.projectiles.push({
            id: NEXT_ID++, kind: e.type === 'shaman' ? 'hex' : 'axe', hostile: true, tgt: m,
            x: e.x, d: e.d, speed: e.type === 'shaman' ? 17 : 23, dmg: e.dmg * dmgMult, life: 3,
          });
          this.emit({ type: 'enemyShoot', e });
        }
        continue;
      }

      const reach = e.def.reach + 0.2;
      if (dist > reach) {
        // zig-zag on the way in, then go for a spot around the hero
        const far = Math.min(1, Math.max(0, (dist - 4) / 8));
        const weave = e.def.heavy ? 0 : Math.sin(this.t * 4.2 + e.weave) * 2.4 * far;
        const tx = m.x + Math.sin(e.slot) * e.def.reach * 0.85 + weave;
        const td = m.d + Math.cos(e.slot) * e.def.reach * 0.85;
        this.moveToward(e, tx, td, speed, dt);
        e.windup = 0;
      } else {
        e.engaged = true;
        // keep pace with the party while hacking away
        if (!e.def.heavy) { e.d += pace * slow * dt; e.moving = P.speedFrac > 0.2; }
        if (e.windup > 0) {
          e.windup -= dt * atkRate;
          if (e.windup <= 0) {
            this.hurt(m, e.dmg * dmgMult, e);
            this.emit({ type: 'enemyHit', e, hero: m.idx });
          }
        } else {
          e.atkT -= dt * atkRate;
          if (e.atkT <= 0) {
            e.atkT = e.def.atk; e.windup = Math.min(0.2, e.def.atk * 0.35); e.attackAnim = e.attackDur = e.def.heavy ? 0.45 : 0.3;
            this.emit({ type: 'enemyAttack', e });
          }
        }
      }

      if (e.type === 'boss') {
        if (!e.enraged && e.hp < e.maxHp * 0.5) { e.enraged = true; this.emit({ type: 'bossEnrage', e }); }
        e.summonT -= dt;
        if (e.summonT <= 0 && dist < 28) {
          e.summonT = e.enraged ? 6.5 : 9;
          this.emit({ type: 'bossSummon', e });
          const n = e.enraged ? 9 : 6;
          for (let i = 0; i < n; i++) {
            this.spawnEnemy(i % 4 === 3 ? 'grunt' : 'whelp', (this.rng() * 2 - 1) * LANE, e.d + 2 + this.rng() * 5, {});
          }
        }
        e.slamT -= dt;
        if (e.slamT <= 0 && dist < 9) {
          e.slamT = e.enraged ? 4.5 : 6.5;
          e.attackAnim = e.attackDur = 0.9;
          this.emit({ type: 'bossSlam', e, delay: 0.8 });
          const boss = e;
          this.pending.push({ t: 0.8, fn: () => {
            if (!boss.alive) return;
            for (const h of this.heroes) this.hurt(h, boss.dmg * 1.6, boss);     // the shockwave catches everyone
            this.emit({ type: 'slamHit', e: boss });
          } });
        }
      }
    }

    // --- separation (keeps packs from stacking into one blob)
    const es = this.enemies;
    for (let i = 0; i < es.length; i++) {
      const a = es[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < es.length; j++) {
        const b = es[j];
        if (!b.alive) continue;
        const dx = b.x - a.x, dd = b.d - a.d, min = (a.r + b.r) * 0.92;
        const q = dx * dx + dd * dd;
        if (q < min * min) {
          const dist = Math.sqrt(q) || 0.01, push = (min - dist) * 0.5;
          const nx = dx / dist, nd = dd / dist;
          const wa = a.def.heavy ? 0.25 : 1, wb = b.def.heavy ? 0.25 : 1, w = wa + wb;
          a.x -= nx * push * (wa / w) * 2; a.d -= nd * push * (wa / w) * 2;
          b.x += nx * push * (wb / w) * 2; b.d += nd * push * (wb / w) * 2;
        }
      }
      a.x = Math.max(-LANE - 1.2, Math.min(LANE + 1.2, a.x));
      if (a.def.heavy && a.d < lead.d + a.r * 0.6 + 0.5) a.d = lead.d + a.r * 0.6 + 0.5;
      if (a.d > CAVE_LENGTH + 6) a.d = CAVE_LENGTH + 6;
    }

    // --- projectiles
    for (const p of this.projectiles) {
      if (p.dead) continue;
      if (p.delay > 0) { p.delay -= dt; continue; }
      p.life -= dt;
      if (p.hostile) {
        if (!p.tgt || !p.tgt.alive) p.tgt = this.lead;
        const m = p.tgt;
        const dx = m.x - p.x, dd = m.d + 0.2 - p.d, dist = Math.hypot(dx, dd), stepLen = p.speed * dt;
        if (dist <= stepLen + 0.5) {
          p.dead = true;
          this.hurt(m, p.dmg, p);
          this.emit({ type: 'projEnd', p, hit: true });
        } else { p.x += (dx / dist) * stepLen; p.d += (dd / dist) * stepLen; }
        if (p.life <= 0 && !p.dead) { p.dead = true; this.emit({ type: 'projEnd', p, hit: false }); }
        continue;
      }
      const by = { by: p.by };
      switch (p.kind) {
        case 'bomb':
        case 'fireball': {
          if (!p.lock && p.target && p.target.alive) { p.tx = p.target.x; p.td = p.target.d; }
          const dx = p.tx - p.x, dd = p.td - p.d, dist = Math.hypot(dx, dd), stepLen = p.speed * dt;
          if (dist <= stepLen + 0.4 || p.life <= 0) {
            p.dead = true; p.x = p.tx; p.d = p.td;
            this.emit({ type: 'projEnd', p, hit: true });
            this.explode(p.x, p.d, p.radius, p.dmg, 'fire', p.kind === 'bomb' ? 'bomb' : 'fire', { primary: p.target, falloff: 0.65, knock: 2.2, by: p.by });
            if (p.fork) {      // the fireball jumps to the next orc
              const skip = new Set(p.target ? [p.target.id] : []);
              const t2 = this.nearestEnemy(p.x, p.d, 10, skip);
              if (t2) this.projectiles.push({ id: NEXT_ID++, kind: 'fireball', by: p.by, x: p.x, d: p.d, target: t2, tx: t2.x, td: t2.d, speed: 40, dmg: p.dmg * 0.7, radius: p.radius * 0.85, life: 1.5, fork: 0, jump: true });
            }
            for (let i = 0; i < (p.cluster || 0); i++) {      // bomblets scatter round the blast
              const a = this.rng() * 6.283, r = 3 + this.rng() * 2.5, x = p.x + Math.cos(a) * r, d = p.d + Math.sin(a) * r, by = p.by, dm = p.dmg * 0.5;
              this.pending.push({ t: 0.18 + i * 0.09, fn: () => this.explode(x, d, 2.4, dm, 'fire', 'bomb', { by }) });
            }
          } else { p.x += (dx / dist) * stepLen; p.d += (dd / dist) * stepLen; }
          break;
        }
        case 'haxe':
        case 'lance': {
          p.x += p.vx * dt; p.d += p.vd * dt;
          for (const e of this.enemies) {
            if (!e.alive || p.hit.has(e.id)) continue;
            if (Math.hypot(e.x - p.x, e.d - p.d) < e.r + 0.75) {
              p.hit.add(e.id);
              this.damage(e, p.dmg, p.element || 'frost', by);
              p.dmg *= 0.88;
              if (--p.pierce <= 0) { p.dead = true; break; }
            }
          }
          if (p.life <= 0) p.dead = true;
          if (p.dead) this.emit({ type: 'projEnd', p, hit: p.hit.size > 0 });
          break;
        }
        case 'bullet':
        case 'dart':
        case 'missile':
        case 'wisp': {
          if (!p.target || !p.target.alive) p.target = this.nearestEnemy(p.x, p.d, 16);
          if (!p.target) {
            p.x += p.vx * dt; p.d += p.vd * dt;
            if (p.life <= 0.9 || p.life <= 0) { p.dead = true; this.emit({ type: 'projEnd', p, hit: false }); }
            break;
          }
          const t = p.target;
          const dx = t.x - p.x, dd = t.d - p.d, dist = Math.hypot(dx, dd) || 0.01;
          const steer = Math.min(1, dt * 9);
          p.vx += ((dx / dist) * p.speed - p.vx) * steer;
          p.vd += ((dd / dist) * p.speed - p.vd) * steer;
          p.x += p.vx * dt; p.d += p.vd * dt;
          if (dist < t.r + 0.55 || p.life <= 0) {
            p.dead = true;
            this.emit({ type: 'projEnd', p, hit: true });
            if (dist < t.r + 1.5) this.damage(t, p.dmg, p.element || (p.kind === 'wisp' ? 'wisp' : 'arcane'), by);
          }
          break;
        }
      }
    }
    if (this.projectiles.length) this.projectiles = this.projectiles.filter(p => !p.dead);

    // --- zones
    for (const z of this.zones) {
      z.t += dt; z.tick -= dt;
      const end = z.t >= z.dur;
      for (const e of this.enemies) {
        if (!e.alive) continue;
        const dx = z.x - e.x, dd = z.d - e.d, dist = Math.hypot(dx, dd);
        if (dist < z.r * 1.25 && dist > 0.3) {
          const pull = (e.def.elite ? 0.6 : e.def.heavy ? 3 : 7.5) * dt;
          e.x += (dx / dist) * Math.min(pull, dist); e.d += (dd / dist) * Math.min(pull, dist);
        }
      }
      if (z.tick <= 0 && !end) {
        z.tick = 0.25;
        for (const e of this.enemies) {
          if (e.alive && Math.hypot(z.x - e.x, z.d - e.d) < z.r + e.r) this.damage(e, z.dmg, 'void', { by: z.by });
        }
      }
      if (end) {
        z.dead = true;
        this.explode(z.x, z.d, z.r * 0.8, z.dmg * 3.5, 'void', 'void', { by: z.by });
        if (z.fork) {      // a smaller singularity opens on the next pack
          const t2 = this.nearestEnemy(z.x, z.d + z.r * 1.6, 12);
          if (t2) {
            const nz = { id: NEXT_ID++, kind: 'void', by: z.by, x: t2.x, d: t2.d, r: z.r * 0.75, t: 0, dur: z.dur * 0.7, tick: 0, dmg: z.dmg * 0.6, fork: 0 };
            this.pending.push({ t: 0.01, fn: () => { this.zones.push(nz); this.emit({ type: 'zone', z: nz }); } });
          }
        }
      }
    }
    if (this.zones.length) this.zones = this.zones.filter(z => !z.dead);

    // --- delayed actions
    if (this.pending.length) {
      const due = [];
      for (const p of this.pending) { p.t -= dt; if (p.t <= 0) due.push(p); }
      if (due.length) {
        this.pending = this.pending.filter(p => p.t > 0);
        for (const p of due) p.fn();
      }
    }

    if (this.enemies.some(e => !e.alive)) this.enemies = this.enemies.filter(e => e.alive);
  }

  moveToward(e, tx, td, speed, dt) {
    const dx = tx - e.x, dd = td - e.d, dist = Math.hypot(dx, dd);
    if (dist < 0.05) return;
    const stepLen = Math.min(dist, speed * dt);
    e.x += (dx / dist) * stepLen; e.d += (dd / dist) * stepLen;
    e.moving = true;
  }

  /** Summary used by the results screen. */
  summary(bestDepth) {
    const depth = Math.min(CAVE_LENGTH, this.victory ? CAVE_LENGTH : this.party.d);
    const killGold = Math.floor(this.gold);
    const depthBonus = Math.floor(depth * 0.07 * depthGold(depth * 0.5) * Math.max(...this.heroes.map(h => h.stats.goldMult)));
    const record = depth > bestDepth + 0.5 && !this.victory;
    const recordBonus = record ? Math.floor((killGold + depthBonus) * 0.2) : 0;
    const victoryBonus = this.victory ? Math.floor((killGold + depthBonus) * 0.5) : 0;
    return {
      depth, time: this.t, kills: this.kills, gear: this.gear.slice(), victory: this.victory,
      killGold, depthBonus, record, recordBonus, victoryBonus,
      total: killGold + depthBonus + recordBonus + victoryBonus,
    };
  }
}
