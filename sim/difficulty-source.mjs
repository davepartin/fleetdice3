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
 * Every padded condition reads Expert's real numbers out of DIFFICULTY rather
 * than repeating them here, and the shipped baseline is measured rather than
 * quoted. This file used to hardcode "+20HP/+3E" and compare against a
 * remembered 68.4%; Expert had long since moved to +10HP and neither number was
 * true any more, so the headline it printed was answering about a hull twice as
 * thick as the real one. A measuring stick has to be re-cut when the thing it
 * measures moves.
 *
 * What it has consistently shown: `samples` is saturated well below 40, and
 * Expert's knob tweaks add little on their own — the tier is carried by what it
 * starts with. That is an argument for making a tier *play* differently, not
 * for more padding.
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

/**
 * Every way a tier can start ahead, in one place. Adding a new starting edge to
 * DifficultyKnobs means adding it here too, or "padding removed" quietly stops
 * removing all of it — which is exactly what happened when `startBaseEnergy`
 * arrived and this list still named only the other two.
 */
const NO_PADDING = { startHpBonus: 0, startEnergyBonus: 0, startBaseEnergy: 0 };
/** Expert's real starting edge, read from the game rather than remembered. */
const EXPERT_PADDING = Object.fromEntries(
  Object.keys(NO_PADDING).map((k) => [k, orig.expert[k]]),
);
const describe = (p) =>
  Object.entries(p).filter(([, v]) => v)
    .map(([k, v]) => `+${v}${k === "startHpBonus" ? "HP" : k === "startBaseEnergy" ? "base" : "E"}`)
    .join("/") || "nothing";

console.log(`\n=== WHAT ACTUALLY MAKES A TIER HARDER? (${n} matches each) ===\n`);

// 0. The baseline every other line is read against, measured not quoted.
restore();
const shipped = duel("expert", "hard", n);
console.log(`0. Shipped Expert vs Hard                              : ${pct(shipped)} ±${ci(shipped, n)}`);
console.log(`   Expert's starting edge is ${describe(EXPERT_PADDING)}.\n`);

// 1. Is `samples` saturated? Hard at 120 vs the same brain at 40.
//    Both sides stripped: Hard carries its own +1 base now, so unpadding only
//    the challenger would measure that head start instead of the thinking.
restore();
Object.assign(DIFFICULTY.hard, NO_PADDING);
Object.assign(DIFFICULTY.expert, orig.hard, { samples: 40 }, NO_PADDING);
let r = duel("hard", "expert", n);
console.log(`1. Hard(samples 120) vs identical brain at samples 40   : ${pct(r)} ±${ci(r, n)}`);
console.log(`   50% here means extra thinking buys nothing.\n`);

// 2. How much of Expert's edge is what it starts with, not how it thinks?
//    Both sides stripped again, for the same reason.
restore();
Object.assign(DIFFICULTY.hard, NO_PADDING);
Object.assign(DIFFICULTY.expert, NO_PADDING);
r = duel("expert", "hard", n);
console.log(`2. Both brains, neither starting edge, Expert vs Hard   : ${pct(r)} ±${ci(r, n)}`);
console.log(`   The gap up to ${pct(shipped)} is what Expert starts with, not better play.\n`);

// 3. Hard brain + Expert's starting edge: does the brain matter at all?
restore();
Object.assign(DIFFICULTY.expert, orig.hard, EXPERT_PADDING);
r = duel("expert", "hard", n);
console.log(`3. Hard brain WITH Expert's ${describe(EXPERT_PADDING).padEnd(13)}, vs Hard : ${pct(r)} ±${ci(r, n)}`);
console.log(`   If this ≈ ${pct(shipped)}, Expert is Hard in a thicker hull.\n`);
restore();
