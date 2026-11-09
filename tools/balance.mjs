// Headless balance check: a simple bot plays the real simulation, buys the
// cheapest upgrade it can afford, and prints how runs lengthen over time.
//   node tools/balance.mjs [quality=0.8] [seed=1] [--verbose]
import { RunSim, mulberry32 } from '../src/sim.js';
import {
  UPGRADES, upgradeCost, computeStats, newSave, runePower, evolutionTier, totalLevels,
  EVOLUTIONS, CAVE_LENGTH,
} from '../src/data.js';

const quality = parseFloat(process.argv[2] ?? '0.8');
const seed = parseInt(process.argv[3] ?? '1', 10);
const verbose = process.argv.includes('--verbose');
const rng = mulberry32(seed * 7919);

function pickRunes(stats, style) {
  const pref = style === 'greedy'
    ? ['arcane', 'void', 'ember', 'frost', 'storm']
    : ['void', 'ember', 'storm', 'frost', 'arcane'];
  const have = pref.filter(r => stats.runes.includes(r));
  const out = [];
  for (let i = 0; i < stats.slots; i++) out.push(have[i % have.length]);
  return out;
}

export function playthrough({ quality, maxRuns = 200, log = false }) {
  const save = newSave();
  const rows = [];
  let playTime = 0;
  for (let run = 1; run <= maxRuns; run++) {
    const stats = computeStats(save);
    const q = Math.max(0, Math.min(1, quality + (rng() - 0.5) * 0.2));
    const slots = pickRunes(stats).map(rune => ({ rune, power: runePower(q, stats.mastery), haste: 0.1 }));
    const sim = new RunSim({ stats, slots, seed: seed * 1000 + run });
    let guard = 0;
    while (!sim.over && guard++ < 60 * 60 * 12) { sim.step(1 / 60); sim.events.length = 0; }
    const sum = sim.summary(save.bestDepth);
    save.gold += sum.total; save.totalGold += sum.total; save.runs++;
    save.bestDepth = Math.max(save.bestDepth, sum.depth);
    playTime += sum.time + 14; // draw + results + shopping overhead
    const bought = [];
    for (;;) {
      let best = null;
      for (const u of UPGRADES) {
        const l = save.upgrades[u.id] || 0;
        if (l >= u.max) continue;
        const c = upgradeCost(u, l);
        if (c <= save.gold && (!best || c < best.c)) best = { u, c };
      }
      if (!best) break;
      save.gold -= best.c;
      save.upgrades[best.u.id] = (save.upgrades[best.u.id] || 0) + 1;
      bought.push(best.u.id);
    }
    rows.push({ run, t: sum.time, depth: sum.depth, kills: sum.kills, gold: sum.total, lv: totalLevels(save), tier: evolutionTier(save), win: sum.victory });
    if (log) {
      console.log(
        `#${String(run).padStart(3)}  ${sum.time.toFixed(1).padStart(6)}s  depth ${sum.depth.toFixed(0).padStart(4)}m  ` +
        `kills ${String(sum.kills).padStart(4)}  +${String(sum.total).padStart(9)}g  lv ${String(totalLevels(save)).padStart(3)} ` +
        `${EVOLUTIONS[evolutionTier(save)].name.padEnd(10)} ${sum.victory ? 'VICTORY' : ''}` +
        (verbose ? '  ' + bought.join(',') : ''));
    }
    if (sum.victory) break;
  }
  return { rows, playTime, save };
}

const res = playthrough({ quality, log: true });
const last = res.rows[res.rows.length - 1];
console.log(`\nquality ${quality}: ${res.rows.length} runs, first run ${res.rows[0].t.toFixed(1)}s, ` +
  `final run ${last.t.toFixed(0)}s ${last.win ? '(victory)' : '(no victory)'}, ~${(res.playTime / 60).toFixed(0)} min of play, ` +
  `levels ${last.lv}/${UPGRADES.reduce((a, u) => a + u.max, 0)}, cave ${CAVE_LENGTH}m`);
