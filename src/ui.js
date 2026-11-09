// DOM layer: HUD, grimoire, results tally, shop and overlays.
import {
  RUNES, RUNE_ORDER, UPGRADES, UPGRADE_BY_ID, CATEGORIES, upgradeCost, EVOLUTIONS, evolutionTier, totalLevels,
  fmt, BIOMES, CHAMPIONS, CAVE_LENGTH, biomeAt, REACTIONS,
} from './data.js';

const $ = id => document.getElementById(id);
const SVG_OPEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
const ICONS = {
  might: '<path d="M20 4 9 15M20 4h-4.500M20 4v4.500M6.500 12.500l5 5M8 16l-4 4"/>',
  haste: '<path d="M7 3h10M7 21h10M8 3c0 5 8 5 8 9s-8 4-8 9M16 3c0 5-8 5-8 9s8 4 8 9"/>',
  crit: '<circle cx="12" cy="12" r="7.500"/><circle cx="12" cy="12" r="2.500"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>',
  mastery: '<path d="M20 4c-7 0-12 5-13 13l-2 3M7 17c4 0 8-2 10-6M12 8l3 3"/>',
  echo: '<circle cx="9" cy="12" r="5.500"/><circle cx="15" cy="12" r="5.500"/>',
  vital: '<path d="M12 20s-7.500-4.600-7.500-10A4.300 4.300 0 0 1 12 7.200 4.300 4.300 0 0 1 19.500 10c0 5.400-7.500 10-7.500 10z"/>',
  armor: '<path d="M12 3l7.500 3v5.500c0 4.600-3.200 8-7.500 9.500-4.300-1.500-7.500-4.900-7.500-9.500V6z"/>',
  leech: '<path d="M12 3.500c3.500 4.500 6 7.300 6 10.500a6 6 0 0 1-12 0c0-3.200 2.500-6 6-10.500z"/>',
  shield: '<circle cx="12" cy="12" r="8.500"/><path d="M8 9.500a5 5 0 0 1 4-2.500"/>',
  phoenix: '<path d="M12 21c-4 0-6.500-2.800-6.500-6.200 0-3 2-4.800 3.200-7.300.6 1.600 1.300 2.400 2.300 3C11 7.500 12 5 11.500 3c4 2.500 7 6.500 7 11.300 0 3.700-2.500 6.700-6.500 6.700z"/>',
  greed: '<circle cx="12" cy="12" r="8.500"/><path d="M12 7v10M14.600 9.600c-.5-.9-1.400-1.400-2.600-1.400-1.500 0-2.500.8-2.500 1.900 0 2.600 5.200 1.200 5.200 3.900 0 1.100-1.100 1.900-2.700 1.900-1.300 0-2.300-.5-2.800-1.500"/>',
  frenzy: '<path d="M6 4l4 16M11 3l4 18M16 4l3 14"/>',
  bounty: '<path d="M9 3h6l-1.500 3.500c3.500 1.500 5.500 5 5.500 8.500 0 3.500-2.500 6-7 6s-7-2.500-7-6c0-3.500 2-7 5.500-8.500zM9.500 6.500h5"/>',
  slots: '<path d="M8 5l4.500 7L8 19 3.500 12zM16 5l4.500 7-4.500 7-4.500-7z"/>',
  wisp: '<circle cx="14" cy="10" r="4.500"/><path d="M10.500 13.500C8 16 6 17 3 18c3 2 7 1.500 10-1.500"/>',
  corpse: '<path d="M12 2.500l2 5.500 5.500-2-2 5.500 4 3-5 1.500 1 5.500-4.500-3.500-4.500 3.500 1-5.500-5-1.500 4-3-2-5.500 5.500 2z"/>',
  meteor: '<circle cx="9" cy="15" r="5"/><path d="M13 11l7-7M16 13.500l5-5M10.500 8.500l5-5"/>',
};
const CAT_COLOR = { might: '#ff9a5a', survival: '#7be3a0', fortune: '#f4c452', arcana: '#c58bff' };

export function glyphSvg(id, sw = 0.2) {
  const pts = RUNES[id].glyph.map(p => `${p[0].toFixed(3)},${p[1].toFixed(3)}`).join(' ');
  return `<svg viewBox="-1.25 -1.25 2.5 2.5" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="${pts}"/></svg>`;
}
const icon = u => u.icon === 'rune' ? glyphSvg(u.rune) : SVG_OPEN + ICONS[u.icon] + '</svg>';
const timeStr = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export class UI {
  constructor(game) {
    this.game = game;
    this.screens = ['title', 'draw', 'hud', 'results', 'shop'].map($);
    this.floats = [];
    this.floatFree = [];
    this.cache = {};
    this.cards = {};
    this.bannerT = null;

    const g = game;
    $('btn-start').addEventListener('click', () => g.onStart());
    $('btn-to-shop').addEventListener('click', () => g.toShop(true));
    $('btn-results').addEventListener('click', () => this.finishResults(true));
    $('results').addEventListener('pointerdown', e => { if (e.target.id !== 'btn-results') this.finishResults(false); });
    $('btn-go').addEventListener('click', () => g.toDraw());
    $('btn-mute').addEventListener('click', () => g.toggleMute());
    $('btn-menu').addEventListener('click', () => this.openMenu());
    $('btn-menu-close').addEventListener('click', () => { $('menu').hidden = true; g.sfx.click(); });
    $('btn-reset').addEventListener('click', () => { $('btn-reset').hidden = true; $('btn-reset-confirm').hidden = false; g.sfx.deny(); });
    $('btn-reset-confirm').addEventListener('click', () => g.resetProgress());
    this.buildDepthTrack();
  }

  show(name) {
    for (const s of this.screens) s.classList.toggle('active', s.id === name);
    $('rune-canvas').classList.toggle('on', name === 'draw');
    if (name !== 'hud') { $('floats').textContent = ''; this.floats.length = 0; this.floatFree.length = 0; }
  }
  fade(on) { $('fade').classList.toggle('on', on); }
  loaded() { $('loading').classList.add('gone'); setTimeout(() => $('loading').remove(), 700); }

  // ------------------------------------------------------------ title
  setTitle(save) {
    $('btn-start').textContent = save.runs > 0 ? 'Continue' : 'Enter the cave';
    $('title-meta').textContent = save.runs > 0
      ? `${EVOLUTIONS[evolutionTier(save)].name} · record ${Math.floor(save.bestDepth)} m · ${save.runs} run${save.runs === 1 ? '' : 's'}`
      : 'Mouse or finger. One level. About forty minutes to the throne.';
  }

  // ------------------------------------------------------------ rune drawing
  setupDraw({ index, count, chosen, unlocked, canShop, first }) {
    $('draw-heading').textContent = count > 1 ? `Draw rune ${index + 1} of ${count}` : 'Draw your rune';
    $('draw-sub').textContent = first ? 'Trace the triangle in one stroke to conjure Ember.'
      : count > 1 && index > 0 ? 'Mix elements to set off reactions.'
      : 'Clean lines hit harder. Quick strokes cast faster.';
    $('btn-to-shop').style.visibility = canShop ? 'visible' : 'hidden';
    if (index === 0) { const rr = $('rune-result'); rr.className = 'rune-result'; rr.textContent = ''; }   // no stale banner from last run
    const pips = $('draw-pips');
    pips.textContent = '';
    if (count > 1) {
      for (let i = 0; i < count; i++) {
        const p = document.createElement('div');
        p.className = 'pip' + (i === index ? ' now' : '');
        if (chosen[i]) { p.innerHTML = glyphSvg(chosen[i].rune, 0.26); p.style.color = RUNES[chosen[i].rune].color; p.style.borderColor = RUNES[chosen[i].rune].color; }
        pips.appendChild(p);
      }
    }
    const wrap = $('grimoire-cards');
    wrap.textContent = '';
    this.runeCards = {};
    for (const id of RUNE_ORDER) {
      const R = RUNES[id], has = unlocked.includes(id);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'rcard' + (has ? '' : ' locked');
      b.style.setProperty('--rc', R.color);
      b.innerHTML = `${glyphSvg(id)}<b>${R.name}</b><small>${has ? R.blurb : 'Learn it in the shop'}</small>`;
      b.addEventListener('click', () => this.game.onRuneCard(id, has));
      wrap.appendChild(b);
      this.runeCards[id] = b;
    }
  }
  selectRuneCard(id) { for (const k in this.runeCards) this.runeCards[k].classList.toggle('sel', k === id); }
  runeResult(r) {
    const el = $('rune-result'), R = RUNES[r.rune];
    el.style.setProperty('--rc', R.color);
    el.innerHTML = `<div class="rr-name">${R.name}</div><div class="rr-grade">${r.grade}</div>
      <div class="rr-stats"><span>Power <b>×${r.power.toFixed(2)}</b></span><span>Tempo <b>+${Math.round(r.haste * 100)}%</b> haste</span></div>
      <div class="rr-msg">${r.grade === 'S' ? 'A flawless rune!' : r.grade === 'A' ? 'Strong lines.' : r.grade === 'B' ? 'It holds.' : 'Wobbly, but it will burn.'}</div>`;
    el.className = 'rune-result';
    void el.offsetWidth;
    el.className = 'rune-result show';
  }
  runeFizzle(title, msg) {
    const el = $('rune-result');
    el.style.setProperty('--rc', '#9aa0b8');
    el.innerHTML = `<div class="rr-name" style="font-size:clamp(26px,7vw,42px)">${title}</div><div class="rr-msg">${msg}</div>`;
    el.className = 'rune-result';
    void el.offsetWidth;
    el.className = 'rune-result fizz';
  }

  // ------------------------------------------------------------ HUD
  buildDepthTrack() {
    const track = $('depth-track');
    BIOMES.forEach((b, i) => {
      const z = document.createElement('div');
      const to = i + 1 < BIOMES.length ? BIOMES[i + 1].from : CAVE_LENGTH;
      z.className = 'depth-zone';
      z.style.left = (b.from / CAVE_LENGTH * 100) + '%';
      z.style.width = ((to - b.from) / CAVE_LENGTH * 100) + '%';
      z.style.background = '#' + b.accent.toString(16).padStart(6, '0');
      track.insertBefore(z, track.firstChild);
    });
    for (const c of CHAMPIONS) {
      const t = document.createElement('div');
      t.className = 'depth-tick'; t.style.left = (c.d / CAVE_LENGTH * 100) + '%';
      track.appendChild(t);
    }
    const t = document.createElement('div');
    t.className = 'depth-tick boss'; t.style.left = '100%';
    track.appendChild(t);
  }
  startRun(slots, bestDepth) {
    this.cache = {};
    const wrap = $('slots');
    wrap.textContent = '';
    this.slotEls = slots.map(s => {
      const el = document.createElement('div');
      el.className = 'slot';
      el.style.setProperty('--rc', RUNES[s.rune].color);
      el.innerHTML = glyphSvg(s.rune, 0.24) + `<em>${s.grade}</em>`;
      wrap.appendChild(el);
      return el;
    });
    $('depth-best').style.left = (Math.min(1, bestDepth / CAVE_LENGTH) * 100) + '%';
    $('depth-best').style.display = bestDepth > 1 ? '' : 'none';
    $('boss-bar').hidden = true;
    $('combo').hidden = true;
    $('hp-lag').style.width = '100%';
    $('toasts').textContent = '';
    this.setGold(0);
  }
  set(key, value, fn) { if (this.cache[key] !== value) { this.cache[key] = value; fn(value); } }
  setGold(n, pop) {
    this.set('gold', fmt(n), v => { $('hud-gold-n').textContent = v; });
    if (pop) { const el = $('hud-gold'); el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); }
  }
  updateRun(sim, elite) {
    const m = sim.mage;
    this.set('depth', Math.floor(m.d), v => { $('hud-depth').textContent = v; });
    this.set('depthPct', Math.round(m.d / CAVE_LENGTH * 1000) / 10, v => { $('depth-fill').style.width = v + '%'; $('depth-me').style.left = v + '%'; });
    this.set('zone', biomeAt(m.d).name, v => { $('hud-zone').textContent = v; });
    this.set('kills', sim.kills, v => { $('hud-kills').textContent = v; });
    this.set('hp', Math.max(0, Math.round(m.hp / m.maxHp * 200) / 2), v => { $('hp-fill').style.width = v + '%'; $('hp-lag').style.width = v + '%'; });
    this.set('hpt', `${fmt(Math.max(0, Math.ceil(m.hp)))} / ${fmt(Math.ceil(m.maxHp))}`, v => { $('hp-text').textContent = v; });
    this.set('hasShield', m.maxShield > 0, v => { $('bar-shield').hidden = !v; });
    if (m.maxShield > 0) this.set('shield', Math.round(m.shield / m.maxShield * 100), v => { $('shield-fill').style.width = v + '%'; });
    const combo = sim.combo;
    this.set('comboOn', combo >= 3, v => { $('combo').hidden = !v; });
    if (combo >= 3) {
      this.set('combo', combo, v => {
        $('combo-n').textContent = '×' + v;
        const el = $('combo'); el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
        el.style.transform = `scale(${Math.min(1.6, 1 + v * 0.008)})`;
      });
      $('combo-fill').style.width = Math.max(0, sim.comboT / 3 * 100) + '%';
    }
    for (let i = 0; i < sim.slots.length; i++) {
      const s = sim.slots[i], el = this.slotEls[i];
      if (el) el.style.setProperty('--cd', Math.max(0, Math.min(1, s.cd / s.maxCd)).toFixed(2));
    }
    this.set('elite', elite ? elite.id : 0, () => { $('boss-bar').hidden = !elite; if (elite) $('boss-name').textContent = elite.name; });
    if (elite) this.set('eliteHp', Math.max(0, Math.round(elite.hp / elite.maxHp * 200) / 2), v => { $('boss-fill').style.width = v + '%'; });
  }
  slotFired(i) { const el = this.slotEls && this.slotEls[i]; if (el) { el.classList.remove('fire'); void el.offsetWidth; el.classList.add('fire'); } }
  hpHit() { const el = $('bar-hp'); el.classList.remove('hit'); void el.offsetWidth; el.classList.add('hit'); }
  banner(title, sub = '', color = '') {
    const el = $('banner');
    $('banner-title').textContent = title; $('banner-sub').textContent = sub;
    el.style.setProperty('--bc', color || '#ece7d8');
    el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  }
  toast(text) {
    const t = document.createElement('div');
    t.className = 'toast'; t.textContent = text;
    $('toasts').appendChild(t);
    setTimeout(() => t.remove(), 2500);
  }
  /** Floating combat text at a screen position. */
  float(x, y, text, cls) {
    if (this.floats.length > 44) return;
    let el = this.floatFree.pop();
    if (!el) {
      el = document.createElement('div');
      el.addEventListener('animationend', () => { el.remove(); const i = this.floats.indexOf(el); if (i >= 0) this.floats.splice(i, 1); this.floatFree.push(el); });
    }
    el.className = 'float ' + cls;
    el.textContent = text;
    el.style.setProperty('--x', Math.round(x) + 'px');
    el.style.setProperty('--y', Math.round(y) + 'px');
    el.style.setProperty('--dx', Math.round((Math.random() - 0.5) * 50) + 'px');
    $('floats').appendChild(el);
    this.floats.push(el);
  }
  reaction(x, y, name) {
    const now = performance.now();
    if (now - (this.lastReact || 0) < 380) return;
    this.lastReact = now;
    this.float(x, y, REACTIONS[name].name, 'react ' + name);
  }

  // ------------------------------------------------------------ results
  showResults(sum, save, onDone) {
    this.resDone = onDone;
    this.resFinished = false;
    const panel = document.querySelector('.results-panel');
    panel.classList.toggle('win', sum.victory);
    $('res-eyebrow').textContent = `Run ${save.runs}`;
    $('res-title').textContent = sum.victory ? 'The Warlord falls' : sum.depth < 30 ? 'You perished' : sum.depth < 400 ? 'Overrun' : 'So very close';
    $('res-meta').textContent = `${Math.floor(sum.depth)} m deep · ${timeStr(sum.time)} · best combo ×${sum.bestCombo}`;
    const rows = [
      [`Orcs slain <small>×${sum.kills}</small>`, sum.killGold, false],
      [`Depth bonus <small>${Math.floor(sum.depth)} m</small>`, sum.depthBonus, false],
    ];
    if (sum.record) rows.push(['New depth record', sum.recordBonus, true]);
    if (sum.victory) rows.push(['Throne plundered', sum.victoryBonus, true]);
    const ul = $('res-tally');
    ul.textContent = '';
    this.resRows = rows.map(([label, value, hot]) => {
      const li = document.createElement('li');
      if (hot) li.className = 'hot';
      li.innerHTML = `<span>${label}</span><span>+${fmt(value)}</span>`;
      ul.appendChild(li);
      return { li, value };
    });
    $('res-total').textContent = '0';
    $('btn-results').textContent = 'Spend your gold';
    this.resTotal = sum.total;
    this.resShown = 0;
    this.resTarget = 0;
    this.resRow = 0;
    this.resT = 0.25;
    this.show('results');
  }
  /** Drives the count-up; called every frame while the results are open. */
  updateResults(dt) {
    if (this.resFinished || !this.resRows) return;
    this.resT -= dt;
    if (this.resT <= 0 && this.resRow < this.resRows.length) {
      const r = this.resRows[this.resRow++];
      r.li.classList.add('in');
      this.resTarget += r.value;
      this.resT = 0.42;
      this.game.sfx.tally();
    }
    if (this.resShown < this.resTarget) {
      const step = Math.max(1, (this.resTarget - this.resShown) * Math.min(1, dt * 9));
      this.resShown = Math.min(this.resTarget, this.resShown + step);
      $('res-total').textContent = fmt(this.resShown);
      this.game.sfx.tick(Math.min(12, Math.floor(this.resShown / Math.max(1, this.resTotal) * 12)));
      const el = document.querySelector('.res-total'); el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
    } else if (this.resRow >= this.resRows.length) this.resFinished = true;
  }
  finishResults(leave) {
    if (!this.resRows) return;
    if (!this.resFinished) {
      for (const r of this.resRows) r.li.classList.add('in');
      this.resRow = this.resRows.length;
      this.resShown = this.resTarget = this.resTotal;
      $('res-total').textContent = fmt(this.resTotal);
      this.resFinished = true;
      if (!leave) return;
    }
    if (leave && this.resDone) { const f = this.resDone; this.resDone = null; this.resRows = null; f(); }
  }

  // ------------------------------------------------------------ shop
  buildShop(save) {
    const scroll = $('shop-scroll');
    scroll.textContent = '';
    this.cards = {};
    for (const cat of CATEGORIES) {
      const h = document.createElement('h3');
      h.className = 'shop-cat'; h.textContent = cat.name;
      scroll.appendChild(h);
      const grid = document.createElement('div');
      grid.className = 'shop-grid';
      for (const u of UPGRADES.filter(x => x.cat === cat.id)) {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'upg'; b.id = 'upg-' + u.id;
        b.style.setProperty('--ic', u.rune ? RUNES[u.rune].color : CAT_COLOR[u.cat]);
        b.innerHTML = `<span class="upg-icon">${icon(u)}</span>
          <span class="upg-body"><span class="upg-name"><span>${u.name}</span><small></small></span><span class="upg-desc">${u.desc}</span><span class="upg-val"></span></span>
          <span class="upg-cost"></span>`;
        b.addEventListener('click', () => this.game.buy(u.id));
        grid.appendChild(b);
        this.cards[u.id] = { el: b, lvl: b.querySelector('small'), val: b.querySelector('.upg-val'), cost: b.querySelector('.upg-cost') };
      }
      scroll.appendChild(grid);
    }
    this.refreshShop(save);
  }
  refreshShop(save) {
    $('shop-gold').textContent = fmt(save.gold);
    for (const u of UPGRADES) {
      const c = this.cards[u.id];
      if (!c) continue;
      const l = save.upgrades[u.id] || 0, maxed = l >= u.max, cost = maxed ? 0 : upgradeCost(u, l);
      c.lvl.textContent = u.max > 1 ? `${l} / ${u.max}` : '';
      c.val.innerHTML = maxed ? u.value(l) : u.max === 1 ? '' : `${u.value(l)} <i>→ ${u.value(l + 1)}</i>`;
      c.cost.innerHTML = maxed ? (u.max === 1 ? 'Owned' : 'Max') : `<i class="coin"></i>${fmt(cost)}`;
      c.el.classList.toggle('maxed', maxed);
      c.el.classList.toggle('afford', !maxed && save.gold >= cost);
    }
    const tier = evolutionTier(save), n = totalLevels(save), evo = EVOLUTIONS[tier], next = EVOLUTIONS[tier + 1];
    $('evo-step').textContent = `${tier + 1} / ${EVOLUTIONS.length}`;
    $('evo-name').textContent = evo.name;
    $('evo-blurb').textContent = evo.blurb;
    if (next) {
      $('evo-fill').style.width = ((n - evo.at) / (next.at - evo.at) * 100) + '%';
      const left = next.at - n;
      $('evo-next').textContent = `${left} more upgrade${left === 1 ? '' : 's'} to become ${/^[AEIOU]/.test(next.name) ? 'an' : 'a'} ${next.name}`;
    } else { $('evo-fill').style.width = '100%'; $('evo-next').textContent = 'Final form reached.'; }
    const go = $('btn-go');
    go.firstChild.textContent = save.runs === 0 ? 'Draw a rune ' : 'Back to the cave ';
  }
  boughtFx(id, ok) {
    const c = this.cards[id];
    if (!c) return;
    c.el.classList.remove('bought', 'nope'); void c.el.offsetWidth;
    c.el.classList.add(ok ? 'bought' : 'nope');
    if (!ok) return;
    const purse = $('purse'); purse.classList.remove('spend'); void purse.offsetWidth; purse.classList.add('spend');
    // coins spray out of the card
    const host = $('shop'), hr = host.getBoundingClientRect(), r = c.cost.getBoundingClientRect();
    for (let i = 0; i < 9; i++) {
      const s = document.createElement('i');
      s.className = 'spark';
      s.style.left = (r.left - hr.left + r.width / 2 - 5) + 'px'; s.style.top = (r.top - hr.top + r.height / 2 - 5) + 'px';
      const a = Math.random() * 6.283, d = 30 + Math.random() * 60;
      s.style.setProperty('--sx', Math.cos(a) * d + 'px'); s.style.setProperty('--sy', (Math.sin(a) * d - 20) + 'px');
      host.appendChild(s);
      setTimeout(() => s.remove(), 620);
    }
  }
  showEvolve(tier) {
    const el = $('evolve'), evo = EVOLUTIONS[tier];
    $('evolve-name').textContent = evo.name;
    $('evolve-bonus').textContent = `All spell damage ×${(evo.mult / EVOLUTIONS[tier - 1].mult).toFixed(2)} · tougher body`;
    el.hidden = true; void el.offsetWidth; el.hidden = false;
    clearTimeout(this.evolveT);
    this.evolveT = setTimeout(() => { el.hidden = true; }, 3000);
  }
  setMuted(m) { $('btn-mute').classList.toggle('off', m); }
  openMenu() {
    const s = this.game.save;
    $('menu-stats').innerHTML = `Runs: <b>${s.runs}</b><br>Deepest: <b>${Math.floor(s.bestDepth)} m</b><br>Gold earned: <b>${fmt(s.totalGold)}</b><br>` +
      `Warlord kills: <b>${s.victories}</b>${s.bestTime ? `<br>Fastest clear: <b>${timeStr(s.bestTime)}</b>` : ''}`;
    $('btn-reset').hidden = false; $('btn-reset-confirm').hidden = true;
    $('menu').hidden = false;
    this.game.sfx.click();
  }
  closeMenu() { $('menu').hidden = true; }
}
export { UPGRADE_BY_ID };
