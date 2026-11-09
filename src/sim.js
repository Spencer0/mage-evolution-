// Headless run simulation. No rendering, no DOM: the renderer reads state and
// drains `events`; tools/balance.mjs drives the very same code to tune numbers.
import {
  RUNES, ENEMIES, CHAMPIONS, CAVE_LENGTH, MAGE_SPEED, SPAWN_AHEAD, CAST_RANGE,
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
function generatePacks(rng, stats) {
  const packs = [];
  let d = 11, n = 0;
  while (d < CAVE_LENGTH - 40) {
    const nearChampion = CHAMPIONS.some(c => Math.abs(c.d - d) < 9);
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
      if (d > 40 && rng() < stats.lootChance) members.push('loot');
      packs.push({ d, members, horde });
    }
    n++;
    d += 5.4 + rng() * 3.2 - 1.2 * (d / CAVE_LENGTH);
  }
  for (const c of CHAMPIONS) packs.push({ d: c.d, members: ['champion', 'grunt', 'grunt', 'whelp', 'whelp'], championName: c.name });
  packs.push({ d: CAVE_LENGTH, members: ['boss'] });
  packs.sort((a, b) => a.d - b.d);
  return packs;
}

export class RunSim {
  /**
   * @param opts.stats   from computeStats(save)
   * @param opts.slots   [{ rune, power, haste }]
   * @param opts.seed
   */
  constructor(opts) {
    const stats = this.stats = opts.stats;
    this.rng = mulberry32(opts.seed || 1);
    this.t = 0;
    this.events = [];
    this.mage = {
      x: 0, d: 0, hp: stats.maxHp, maxHp: stats.maxHp,
      maxShield: stats.maxHp * stats.shield, shield: stats.maxHp * stats.shield, shieldDelay: 0,
      alive: true, blocked: false, speedFrac: 1, invuln: 0, revives: stats.phoenix, castT: 0, castSlot: 0,
    };
    this.slots = opts.slots.map((s, i) => ({
      idx: i, rune: s.rune, def: RUNES[s.rune], power: s.power, haste: 1 + (s.haste || 0),
      cd: 0.3 + i * 0.22, maxCd: 1,
    }));
    this.enemies = [];
    this.projectiles = [];
    this.zones = [];
    this.pending = [];
    this.packs = generatePacks(this.rng, stats);
    this.packIdx = 0;
    this.gold = 0;
    this.kills = 0;
    this.combo = 0;
    this.comboT = 0;
    this.bestCombo = 0;
    this.over = false;
    this.victory = false;
    this.boss = null;
    this.bossDead = false;
    this.wispCd = [];
    for (let i = 0; i < stats.wisps; i++) this.wispCd.push(0.6 + i * 0.4);
    this.meteorCd = stats.meteor ? 3 : Infinity;
    this.dmgDealt = 0;
  }

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
      burnT: 0, burnDps: 0, burnTick: 0, chillT: 0, shockT: 0, freezeT: 0, freezeImm: 0, stunT: 0,
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
    while (this.packIdx < this.packs.length && this.mage.d + SPAWN_AHEAD >= this.packs[this.packIdx].d) {
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
  inRange(e, range = CAST_RANGE) {
    const m = this.mage;
    return e.alive && e.d - m.d < range && e.d - m.d > -9;
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
  pickTarget() {
    const m = this.mage;
    let best = null, bd = Infinity;
    for (const e of this.enemies) {
      if (!this.inRange(e)) continue;
      const q = Math.hypot(e.x - m.x, e.d - m.d) - (e.fleeing ? 4 : 0);
      if (q < bd) { bd = q; best = e; }
    }
    return best;
  }
  clusterTarget(radius) {
    let best = null, bn = -1;
    for (const e of this.enemies) {
      if (!this.inRange(e)) continue;
      let n = e.def.elite ? 2 : 0;
      for (const o of this.enemies) {
        if (o.alive && Math.hypot(o.x - e.x, o.d - e.d) < radius) n += o.def.heavy ? 2 : 1;
      }
      if (n > bn) { bn = n; best = e; }
    }
    return best;
  }

  // ------------------------------------------------------------ casting
  hasteMult() {
    const s = this.stats;
    return s.haste * (1 + Math.min(this.combo, s.comboCap) * 0.005 * s.frenzy);
  }

  cast(slot, echo) {
    const m = this.mage, def = slot.def, s = this.stats;
    const target = def.id === 'void' ? this.clusterTarget(def.radius) : this.pickTarget();
    if (!target) return false;
    const dmg = def.dmg * s.dmgMult * slot.power;
    const ox = m.x + 0.55, od = m.d + 0.7;
    m.castT = 0.28; m.castSlot = slot.idx;
    this.emit({ type: 'cast', rune: def.id, slot: slot.idx, x: ox, d: od, tx: target.x, td: target.d, echo: !!echo });
    switch (def.id) {
      case 'ember':
        this.projectiles.push({
          id: NEXT_ID++, kind: 'fireball', x: ox, d: od, target, tx: target.x, td: target.d,
          speed: 46, dmg, radius: def.radius, life: 2,
        });
        break;
      case 'frost': {
        const dx = target.x - ox, dd = target.d - od, l = Math.hypot(dx, dd) || 1;
        this.projectiles.push({
          id: NEXT_ID++, kind: 'lance', x: ox, d: od, vx: (dx / l) * 58, vd: (dd / l) * 58,
          dmg, pierce: def.pierce, hit: new Set(), life: 0.52,
        });
        break;
      }
      case 'arcane': {
        const used = new Set();
        for (let i = 0; i < def.missiles; i++) {
          let t = this.nearestEnemy(m.x, m.d + 2, CAST_RANGE + 2, used) || target;
          used.add(t.id);
          const side = i - (def.missiles - 1) / 2;
          this.projectiles.push({
            id: NEXT_ID++, kind: 'missile', x: ox, d: od, vx: side * 11, vd: 12 + this.rng() * 4,
            target: t, dmg, speed: 36, life: 2, delay: i * 0.04,
          });
        }
        break;
      }
      case 'storm': {
        const hit = new Set();
        const pts = [{ x: ox, d: od, src: true }];
        let cur = target, power = dmg;
        for (let i = 0; i <= def.chains && cur; i++) {
          hit.add(cur.id);
          pts.push({ x: cur.x, d: cur.d, r: cur.r, id: cur.id });
          const from = cur;
          this.damage(cur, power, 'storm');
          power *= 0.82;
          cur = this.nearestEnemy(from.x, from.d, def.chainRange, hit);
          if (cur && !this.inRange(cur, CAST_RANGE + 6)) cur = null;
        }
        this.emit({ type: 'bolt', pts });
        break;
      }
      case 'void':
        this.zones.push({
          id: NEXT_ID++, kind: 'void', x: target.x, d: target.d, r: def.radius,
          t: 0, dur: def.duration, tick: 0, dmg,
        });
        this.emit({ type: 'zone', z: this.zones[this.zones.length - 1] });
        break;
    }
    if (!echo && this.rng() < s.echo) this.pending.push({ t: 0.16, fn: () => this.cast(slot, true) });
    return true;
  }

  // ------------------------------------------------------------ damage
  damage(e, amount, element, opts = {}) {
    if (!e.alive || amount <= 0) return;
    const s = this.stats;
    let dmg = amount, crit = false;
    if (!opts.noCrit && s.critChance > 0 && this.rng() < s.critChance) { dmg *= s.critMult; crit = true; }
    if (!opts.noReact) {
      if (element === 'fire' && e.chillT > 0) {
        dmg *= 2; e.chillT = 0;
        this.emit({ type: 'react', name: 'thermal', x: e.x, d: e.d });
      } else if (element === 'storm' && e.burnT > 0) {
        e.burnT = 0;
        const x = e.x, d = e.d, blast = amount * 1.2;
        this.pending.push({ t: 0.05, fn: () => this.explode(x, d, 3, blast, 'fire', 'overload', { noReact: true, noStatus: true }) });
        this.emit({ type: 'react', name: 'overload', x, d });
      } else if (element === 'frost' && e.shockT > 0 && e.freezeImm <= 0) {
        e.shockT = 0;
        e.freezeT = e.def.elite ? 0.6 : 1.7;
        e.freezeImm = 5;
        dmg *= 1.5;
        this.emit({ type: 'react', name: 'freeze', x: e.x, d: e.d });
      }
    }
    if (e.shockT > 0) dmg *= 1.2;
    if (!opts.noStatus) {
      if (element === 'fire') { e.burnT = 3; e.burnDps = Math.max(e.burnDps, amount * 0.28); }
      else if (element === 'frost') e.chillT = 3;
      else if (element === 'storm') e.shockT = 2.5;
      else if (element === 'arcane') e.mark = true;
    }
    e.hp -= dmg;
    e.hitFlash = 0.12;
    this.dmgDealt += dmg;
    if (!opts.silent) this.emit({ type: 'hit', id: e.id, amount: dmg, crit, element, x: e.x, d: e.d, r: e.r, dot: !!opts.dot });
    if (e.hp <= 0) this.kill(e, element);
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

  kill(e, element) {
    if (!e.alive) return;
    e.alive = false;
    const s = this.stats;
    this.kills++;
    this.combo++;
    this.comboT = 2.5;
    if (this.combo > this.bestCombo) this.bestCombo = this.combo;
    const comboMult = 1 + Math.min(this.combo, s.comboCap) * 0.02;
    const gold = e.gold * s.goldMult * comboMult * (e.mark ? 1.6 : 1);
    this.gold += gold;
    if (s.leech > 0 && this.mage.alive) {
      this.mage.hp = Math.min(this.mage.maxHp, this.mage.hp + this.mage.maxHp * s.leech);
    }
    this.emit({ type: 'kill', e, gold, element, x: e.x, d: e.d, combo: this.combo, marked: e.mark });
    if (s.corpse > 0 && !e.def.elite) {
      const x = e.x, d = e.d, blast = e.maxHp * s.corpse;
      this.pending.push({ t: 0.12, fn: () => this.explode(x, d, 3.2, blast, 'phys', 'corpse', { noCrit: true, noReact: true, noStatus: true }) });
    }
    if (e.type === 'boss') {
      this.bossDead = true;
      this.mage.invuln = 99;
      this.emit({ type: 'bossDead', e });
      let delay = 0.25;
      for (const o of this.enemies) {
        if (o.alive) { const oo = o; this.pending.push({ t: delay, fn: () => this.kill(oo, 'phys') }); delay += 0.08; }
      }
      this.pending.push({ t: Math.max(2.4, delay + 1.2), fn: () => { this.over = true; this.victory = true; this.emit({ type: 'victory' }); } });
    }
  }

  hurtMage(amount, src) {
    const m = this.mage;
    if (!m.alive || m.invuln > 0 || this.over) return;
    let amt = amount * this.stats.armor;
    m.shieldDelay = 3;
    let absorbed = 0;
    if (m.shield > 0) {
      absorbed = Math.min(m.shield, amt);
      m.shield -= absorbed; amt -= absorbed;
      if (m.shield <= 0) this.emit({ type: 'shieldBreak' });
    }
    if (amt > 0) m.hp -= amt;
    this.emit({ type: 'mageHit', amount: amt, absorbed, src });
    if (m.hp <= 0) {
      if (m.revives > 0) {
        m.revives--;
        m.hp = m.maxHp * 0.6;
        m.shield = m.maxShield;
        m.invuln = 1.6;
        this.emit({ type: 'revive' });
        this.explode(m.x, m.d, 9, 32 * this.stats.dmgMult, 'fire', 'nova', { knock: 9 });
      } else {
        m.hp = 0; m.alive = false; this.over = true;
        this.emit({ type: 'mageDead' });
      }
    }
  }

  // ------------------------------------------------------------ step
  step(dt) {
    if (this.over) return;
    this.t += dt;
    const m = this.mage, s = this.stats;

    this.spawnPacks();

    // --- mage
    m.invuln = Math.max(0, m.invuln - dt);
    m.castT = Math.max(0, m.castT - dt);
    if (m.maxShield > 0) {
      m.shieldDelay -= dt;
      if (m.shieldDelay <= 0 && m.shield < m.maxShield) {
        const was = m.shield;
        m.shield = Math.min(m.maxShield, m.shield + m.maxShield * 0.5 * dt);
        if (was <= 0) this.emit({ type: 'shieldUp' });
      }
    }
    // The mage never stops for fodder: every goblin hanging on just drags the
    // sprint down a little. Only heavies (brutes, champions, the boss) are walls.
    let drag = 0, wall = this.bossDead;
    for (const e of this.enemies) {
      if (!e.alive || e.fleeing) continue;
      if (e.def.heavy) {
        const fd = e.d - m.d;
        if (fd > -0.6 && fd < e.r + 1.6 && Math.abs(e.x - m.x) < e.r + 1.5) wall = true;
      } else if (e.engaged) drag++;
    }
    const want = wall ? 0 : Math.max(0.42, 1 - 0.1 * drag);
    m.speedFrac += (want - m.speedFrac) * Math.min(1, dt * (want < m.speedFrac ? 12 : 5));
    m.blocked = m.speedFrac < 0.12;
    m.d = Math.min(CAVE_LENGTH - 4, m.d + MAGE_SPEED * m.speedFrac * dt);

    if (this.comboT > 0) {
      this.comboT -= dt;
      if (this.comboT <= 0) { this.combo = 0; this.emit({ type: 'comboEnd' }); }
    }

    // --- spells
    if (!this.bossDead) {
      const haste = this.hasteMult();
      for (const slot of this.slots) {
        slot.cd -= dt;
        if (slot.cd <= 0) {
          if (this.cast(slot)) {
            slot.maxCd = slot.def.cd / (haste * slot.haste);
            slot.cd += slot.maxCd;
            if (slot.cd < 0) slot.cd = 0;
          } else slot.cd = 0;
        }
      }
      for (let i = 0; i < this.wispCd.length; i++) {
        this.wispCd[i] -= dt;
        if (this.wispCd[i] <= 0) {
          const t = this.pickTarget();
          if (t) {
            this.wispCd[i] = 0.6 / Math.sqrt(haste);
            this.projectiles.push({
              id: NEXT_ID++, kind: 'wisp', wisp: i, x: m.x, d: m.d, vx: (this.rng() - 0.5) * 8, vd: 5,
              target: t, dmg: 2.6 * s.dmgMult, speed: 44, life: 2,
            });
            this.emit({ type: 'wispShot', wisp: i });
          } else this.wispCd[i] = 0;
        }
      }
      this.meteorCd -= dt;
      if (this.meteorCd <= 0) {
        const t = this.clusterTarget(4.5);
        if (t) {
          this.meteorCd = 11 - 2 * s.meteor;
          const x = t.x, d = Math.max(m.d + 3, t.d - (t.moving ? 4 : 0));
          this.emit({ type: 'meteor', x, d, delay: 0.75, r: 4.6 });
          this.pending.push({ t: 0.75, fn: () => this.explode(x, d, 4.6, 38 * s.dmgMult, 'fire', 'meteor', { knock: 5 }) });
        } else this.meteorCd = 0.2;
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
          this.damage(e, e.burnDps * 0.5, 'fire', { noReact: true, noStatus: true, noCrit: true, dot: true });
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
      const slow = e.chillT > 0 ? (e.def.elite ? 0.8 : 0.6) : 1;
      const dx = m.x - e.x, dd = m.d - e.d, dist = Math.hypot(dx, dd);
      let speed = e.speed * slow * (e.buffed ? 1.25 : 1) * (e.enraged ? 1.3 : 1);
      // fodder that has caught the mage clings on at his pace (unless chilled)
      if (!e.def.heavy && dist < 7) speed = Math.max(speed, (MAGE_SPEED * m.speedFrac + 3.5) * slow);
      const atkRate = slow * (e.enraged ? 1.35 : 1);
      const dmgMult = e.buffed ? 1.3 : 1;
      e.moving = false;
      e.engaged = false;

      // shaken off: too far behind to matter
      if (!e.def.heavy && dd > 20) { e.alive = false; this.emit({ type: 'lost', e }); continue; }

      if (e.type === 'loot') {
        if (!e.fleeing) {
          if (dist > 14) this.moveToward(e, m.x, m.d + 12, speed, dt);
          else { e.taunt += dt; e.d += MAGE_SPEED * m.speedFrac * 0.8 * dt; if (e.taunt > 0.9) { e.fleeing = true; this.emit({ type: 'lootFlee', e }); } }
        } else {
          e.d += Math.max(e.speed * 1.2, MAGE_SPEED * 1.25) * slow * dt; e.moving = true;
          if (e.d - m.d > 46) { e.alive = false; e.escaped = true; this.emit({ type: 'escape', e }); }
        }
        continue;
      }

      const ranged = e.def.range && dist > e.def.reach + 1.4;
      if (ranged) {
        const want = e.def.range;
        const strafe = Math.sin(this.t * 2.6 + e.weave) * 3.2;
        if (dist > want + 1) this.moveToward(e, m.x + e.slot * 1.6 + strafe * 0.4, m.d + want - 1, speed, dt);
        else if (dd < 0 && dist < want - 3) {
          // backpedal ahead of the sprinting mage, hurling as it goes
          e.d += MAGE_SPEED * m.speedFrac * 0.74 * slow * dt;
          e.x += strafe * dt;
          e.moving = true;
        } else { e.x += strafe * 0.6 * dt; e.moving = Math.abs(strafe) > 1; }
        e.atkT -= dt * atkRate;
        if (e.atkT <= 0 && dist < want + 4) {
          e.atkT = e.def.atk * (0.85 + this.rng() * 0.3);
          e.attackAnim = e.attackDur = 0.35;
          this.projectiles.push({
            id: NEXT_ID++, kind: e.type === 'shaman' ? 'hex' : 'axe', hostile: true,
            x: e.x, d: e.d, speed: e.type === 'shaman' ? 17 : 23, dmg: e.dmg * dmgMult, life: 3,
          });
          this.emit({ type: 'enemyShoot', e });
        }
        continue;
      }

      const reach = e.def.reach + 0.2;
      if (dist > reach) {
        // zig-zag on the way in, then go for a spot around the mage
        const far = Math.min(1, Math.max(0, (dist - 4) / 8));
        const weave = e.def.heavy ? 0 : Math.sin(this.t * 4.2 + e.weave) * 2.4 * far;
        const tx = m.x + Math.sin(e.slot) * e.def.reach * 0.85 + weave;
        const td = m.d + Math.cos(e.slot) * e.def.reach * 0.85;
        this.moveToward(e, tx, td, speed, dt);
        e.windup = 0;
      } else {
        e.engaged = true;
        // keep pace with the mage while hacking at him
        if (!e.def.heavy) { e.d += MAGE_SPEED * m.speedFrac * slow * dt; e.moving = m.speedFrac > 0.2; }
        if (e.windup > 0) {
          e.windup -= dt * atkRate;
          if (e.windup <= 0) {
            this.hurtMage(e.dmg * dmgMult, e);
            this.emit({ type: 'enemyHit', e });
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
          this.pending.push({ t: 0.8, fn: () => { if (boss.alive) { this.hurtMage(boss.dmg * 1.6, boss); this.emit({ type: 'slamHit', e: boss }); } } });
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
      if (a.def.heavy && a.d < m.d + a.r * 0.6 + 0.5) a.d = m.d + a.r * 0.6 + 0.5;
      if (a.d > CAVE_LENGTH + 6) a.d = CAVE_LENGTH + 6;
    }

    // --- projectiles
    for (const p of this.projectiles) {
      if (p.dead) continue;
      if (p.delay > 0) { p.delay -= dt; continue; }
      p.life -= dt;
      if (p.hostile) {
        const dx = m.x - p.x, dd = m.d + 0.2 - p.d, dist = Math.hypot(dx, dd), stepLen = p.speed * dt;
        if (dist <= stepLen + 0.5) {
          p.dead = true;
          this.hurtMage(p.dmg, p);
          this.emit({ type: 'projEnd', p, hit: true });
        } else { p.x += (dx / dist) * stepLen; p.d += (dd / dist) * stepLen; }
        if (p.life <= 0 && !p.dead) { p.dead = true; this.emit({ type: 'projEnd', p, hit: false }); }
        continue;
      }
      switch (p.kind) {
        case 'fireball': {
          if (p.target && p.target.alive) { p.tx = p.target.x; p.td = p.target.d; }
          const dx = p.tx - p.x, dd = p.td - p.d, dist = Math.hypot(dx, dd), stepLen = p.speed * dt;
          if (dist <= stepLen + 0.4 || p.life <= 0) {
            p.dead = true; p.x = p.tx; p.d = p.td;
            this.emit({ type: 'projEnd', p, hit: true });
            this.explode(p.x, p.d, p.radius, p.dmg, 'fire', 'fire', { primary: p.target, falloff: 0.65, knock: 2.2 });
          } else { p.x += (dx / dist) * stepLen; p.d += (dd / dist) * stepLen; }
          break;
        }
        case 'lance': {
          p.x += p.vx * dt; p.d += p.vd * dt;
          for (const e of this.enemies) {
            if (!e.alive || p.hit.has(e.id)) continue;
            if (Math.hypot(e.x - p.x, e.d - p.d) < e.r + 0.75) {
              p.hit.add(e.id);
              this.damage(e, p.dmg, 'frost');
              p.dmg *= 0.88;
              if (--p.pierce <= 0) { p.dead = true; break; }
            }
          }
          if (p.life <= 0) p.dead = true;
          if (p.dead) this.emit({ type: 'projEnd', p, hit: p.hit.size > 0 });
          break;
        }
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
            if (dist < t.r + 1.5) this.damage(t, p.dmg, p.kind === 'wisp' ? 'wisp' : 'arcane');
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
          if (e.alive && Math.hypot(z.x - e.x, z.d - e.d) < z.r + e.r) this.damage(e, z.dmg, 'void');
        }
      }
      if (end) {
        z.dead = true;
        this.explode(z.x, z.d, z.r * 0.8, z.dmg * 3.5, 'void', 'void', {});
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
    const depth = Math.min(CAVE_LENGTH, this.victory ? CAVE_LENGTH : this.mage.d);
    const killGold = Math.floor(this.gold);
    const depthBonus = Math.floor(depth * 0.07 * depthGold(depth * 0.5) * this.stats.goldMult);
    const record = depth > bestDepth + 0.5 && !this.victory;
    const recordBonus = record ? Math.floor((killGold + depthBonus) * 0.2) : 0;
    const victoryBonus = this.victory ? Math.floor((killGold + depthBonus) * 0.5) : 0;
    return {
      depth, time: this.t, kills: this.kills, bestCombo: this.bestCombo, victory: this.victory,
      killGold, depthBonus, record, recordBonus, victoryBonus,
      total: killGold + depthBonus + recordBonus + victoryBonus,
    };
  }
}
