/**
 * Where does a difficulty tier's strength actually come from?
 *
 * `sweep.mjs difficulty` answers "is the ladder ordered?". This answers the
 * follow-up: *why*. It holds one thing constant at a time and re-measures, so
 * a knob that does nothing shows up as a coin flip instead of hiding inside a
 * tier that also happens to be stronger for another reason.
 *
 * DIFFICULTY is a plain object the brain reads at call time, so this file can
 * swap a tier's knobs, measure, and put them back — the same trick sweep.mjs
 * uses on TUNING. Nothing here changes the game.
 *
 *   node sim/difficulty-source.mjs [n]     (default 1200 matches per condition)
 *
 * Measured at n=900, against Hard:
 *   1. samples 120 vs 40 ....... 51.4% ±3.3  extra thinking buys nothing
 *   2. Expert knobs, no padding  48.2% ±3.3  the knob tweaks add no skill
 *   3. Hard brain + Expert stats 66.6% ±3.1  ≈ shipped Expert's 68.4%
 *
 * Read together: Expert is Hard in a thicker hull, and `samples` is saturated
 * well below 40. If you make a tier harder, make it *play* differently — these
 * two dials are spent.
 */

import { bundlePath } from "./bundle.mjs";
const G = await import(bundlePath);
const { PLANS, DIFFICULTY, applyAction, applyDifficultyStart, makeRng,
        newBrain, newMatch, newPlayer, nextActions, setRng } = G;

const pct = (n) => `${(n * 100).toFixed(1)}%`;
const ci = (p, n) => (1.96 * Math.sqrt((p * (1 - p)) / Math.max(1, n)) * 100).toFixed(1);

function match(planA, dA, planB, dB, seed) {
  setRng(makeRng(seed));
  const state = newMatch("xp", "0000", "A", "A", "versus");
  state.players.guest = newPlayer("B", "B", "ready");
  applyDifficultyStart(state.players.host, dA);
  applyDifficultyStart(state.players.guest, dB);
  state.status = "active";
  state.players.host.phase = "ready";
  const brains = { host: newBrain(planA, dA), guest: newBrain(planB, dB) };
  let guard = 0;
  while (state.status !== "finished" && guard < 4000) {
    guard += 1;
    let moved = false;
    for (const side of ["host", "guest"]) {
      for (const action of nextActions(state, side, brains[side])) {
        if (state.status === "finished") break;
        try { applyAction(state, side, action); moved = true; } catch { /* stale */ }
      }
    }
    if (!moved) break;
  }
  return state.winner ?? "draw";
}

/** A vs B over n matches, sides and plans balanced. */
function duel(dA, dB, n) {
  let w = 0;
  for (let i = 0; i < n; i += 1) {
    const swap = i % 2 === 1;
    const p = PLANS[i % PLANS.length], q = PLANS[(i + 2) % PLANS.length];
    const r = swap ? match(q, dB, p, dA, 30011 + i * 7919) : match(p, dA, q, dB, 30011 + i * 7919);
    const side = swap ? "guest" : "host";
    if (r === side) w += 1; else if (r === "draw") w += 0.5;
  }
  return w / n;
}

const n = Number(process.argv[2] ?? 1200);
const orig = JSON.parse(JSON.stringify(DIFFICULTY));
const restore = () => { for (const k of Object.keys(orig)) Object.assign(DIFFICULTY[k], orig[k]); };

console.log(`\n=== WHAT ACTUALLY MAKES A TIER HARDER? (${n} matches each) ===\n`);

// 1. Is `samples` saturated? Hard at 120 vs the same brain at 40.
restore();
Object.assign(DIFFICULTY.expert, orig.hard, { samples: 40, startHpBonus: 0, startEnergyBonus: 0 });
let r = duel("hard", "expert", n);
console.log(`1. Hard(samples 120) vs identical brain at samples 40 : ${pct(r)} ±${ci(r, n)}`);
console.log(`   50% here means extra thinking buys nothing.\n`);

// 2. How much of Expert's edge is the +20HP/+3E padding, not the knobs?
restore();
Object.assign(DIFFICULTY.expert, { startHpBonus: 0, startEnergyBonus: 0 });
r = duel("expert", "hard", n);
console.log(`2. Expert knobs only, stat padding removed, vs Hard     : ${pct(r)} ±${ci(r, n)}`);
console.log(`   Shipped Expert beats Hard 68.4%. The gap between that`);
console.log(`   and this number is pure health, not better play.\n`);

// 3. Hard brain + Expert's padding vs real Expert: does the brain matter at all?
restore();
Object.assign(DIFFICULTY.expert, orig.hard, { startHpBonus: 20, startEnergyBonus: 3 });
r = duel("expert", "hard", n);
console.log(`3. Hard brain WITH Expert's +20HP/+3E, vs Hard          : ${pct(r)} ±${ci(r, n)}`);
console.log(`   If this ≈ 68.4%, Expert is Hard in a thicker hull.\n`);
restore();
