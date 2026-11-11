// Headless balance check: a simple bot plays the real simulation, recruits the
// next hero when it can afford them, buys the cheapest upgrade across the
// party, and prints how runs lengthen over time.
//   node tools/balance.mjs [quality=0.8] [seed=1] [--solo] [--verbose] [--quiet]
import { RunSim, mulberry32 } from '../src/sim.js';
import {
  CLASSES, CLASS_ORDER, upgradeCost, computeStats, newSave, runePower, evolutionTier, totalLevels, CAVE_LENGTH,
} from '../src/data.js';

const pos = process.argv.slice(2).filter(a => !a.startsWith('--'));
const quality = parseFloat(pos[0] ?? '0.8');
const seed = parseInt(pos[1] ?? '1', 10);
const flag = f => process.argv.includes('--' + f);
const solo = flag('solo'), verbose = flag('verbose'), quiet = flag('quiet');
const rng = mulberry32(seed * 7919);
const PREF = { mage: ['void', 'ember', 'storm', 'frost', 'arcane'], warrior: ['crown', 'cleave', 'whirl', 'quake', 'hurl'] };

const save = newSave();
const rows = [];
let playTime = 0, recruitedAt = 0;
for (let run = 1; run <= 200; run++) {
  const party = CLASS_ORDER.filter(c => save.cls[c].unlocked);
  const heroes = party.map(cls => {
    const stats = computeStats(save, cls);
    const q = Math.max(0, Math.min(1, quality + (rng() - 0.5) * 0.2));
    const have = PREF[cls].filter(r => stats.runes.includes(r));
    const slots = [];
    for (let i = 0; i < stats.slots; i++) slots.push({ rune: have[i % have.length], power: runePower(q, stats.mastery), haste: 0.1 });
    return { cls, stats, slots };
  });
  const sim = new RunSim({ heroes, seed: seed * 1000 + run });
  let guard = 0, peak = 0;
  while (!sim.over && guard++ < 60 * 60 * 12) {
    sim.step(1 / 60);
    if (sim.offer) sim.chooseBoon((rng() * 2) | 0);
    sim.events.length = 0;
    if (sim.enemies.length > peak) peak = sim.enemies.length;
  }
  const sum = sim.summary(save.bestDepth);
  save.gold += sum.total; save.totalGold += sum.total; save.runs++;
  save.bestDepth = Math.max(save.bestDepth, sum.depth);
  playTime += sum.time + 14 + 4 * heroes.length;     // drawing, results and shopping overhead
  const bought = [];
  for (;;) {
    let best = null;
    if (!solo) for (const c of CLASS_ORDER) {
      if (!save.cls[c].unlocked && save.gold >= CLASSES[c].cost) best = { recruit: c, c: 0 };
    }
    if (!best) for (const c of party) {
      for (const u of CLASSES[c].upgrades) {
        const l = save.cls[c].upgrades[u.id] || 0;
        if (l >= u.max) continue;
        const cost = upgradeCost(u, l);
        if (cost <= save.gold && (!best || cost < best.c)) best = { u, c: cost, cls: c };
      }
    }
    if (!best) break;
    if (best.recruit) { save.gold -= CLASSES[best.recruit].cost; save.cls[best.recruit].unlocked = true; party.push(best.recruit); recruitedAt = run; bought.push('RECRUIT ' + best.recruit); continue; }
    save.gold -= best.c;
    save.cls[best.cls].upgrades[best.u.id] = (save.cls[best.cls].upgrades[best.u.id] || 0) + 1;
    bought.push(best.cls[0] + ':' + best.u.id);
  }
  rows.push({ run, t: sum.time, depth: sum.depth, kills: sum.kills, gold: sum.total, win: sum.victory });
  if (!quiet) console.log(
    `#${String(run).padStart(3)}  ${sum.time.toFixed(1).padStart(6)}s  depth ${sum.depth.toFixed(0).padStart(4)}m  ` +
    `kills ${String(sum.kills).padStart(4)}  +${String(sum.total).padStart(9)}g  ` +
    party.map(c => `${CLASSES[c].evolutions[evolutionTier(save, c)].name} lv${totalLevels(save, c)}`).join(' + ').padEnd(34) +
    ` boons ${sum.boons.length} peak ${peak} ${sum.victory ? 'VICTORY' : ''}` + (verbose ? '  ' + bought.join(',') : ''));
  if (sum.victory) break;
}
const last = rows[rows.length - 1];
const pick = [0, 2, 4, 7, 11, 15, 19].filter(i => i < rows.length - 1).map(i => `#${i + 1}:${rows[i].t.toFixed(0)}s/${rows[i].depth.toFixed(0)}m`).join(' ');
console.log(`q${quality} seed ${seed}${solo ? ' solo' : ''}: ${rows.length} runs, first ${rows[0].t.toFixed(1)}s/${rows[0].kills} kills/${rows[0].gold}g, ` +
  `final ${last.t.toFixed(0)}s ${last.win ? '(victory)' : '(no victory)'}, ~${(playTime / 60).toFixed(0)} min, ` +
  `warrior joined run ${recruitedAt || '-'}, cave ${CAVE_LENGTH}m | ${pick}`);
