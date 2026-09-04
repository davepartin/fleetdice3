/**
 * Try a change, measure it, keep it or throw it away.
 *
 * Every candidate here mutates `TUNING` at runtime and replays the same seeded
 * matches, so two settings are compared on identical dice. What comes out is a
 * spread — how far apart the best and worst strategies finish — plus the match
 * length, because a change that closes the spread by making every game a
 * grind is not an improvement.
 *
 *   node sim/tune.mjs            every candidate, 120 matches a pairing
 *   node sim/tune.mjs 250        slower and more certain
 */

import { bundlePath } from "./bundle.mjs";
const G = await import(bundlePath);

const { PLANS, PLAN_LABEL, TUNING, applyAction, makeRng, newBrain, newMatch, newPlayer, nextActions, setRng } = G;

const PER_PAIR = Number(process.argv[2]) || 120;

function playMatch(planA, planB, seed) {
  setRng(makeRng(seed));
  const state = newMatch("sim", "0000", "A", "A", "versus");
  state.players.guest = newPlayer("B", "B", "ready");
  state.status = "active";
  state.players.host.phase = "ready";
  const brains = { host: newBrain(planA, "medium"), guest: newBrain(planB, "medium") };

  let guard = 0;
  while (state.status !== "finished" && guard < 4000) {
    guard += 1;
    let moved = false;
    for (const side of ["host", "guest"]) {
      for (const action of nextActions(state, side, brains[side])) {
        if (state.status === "finished") break;
        try {
          applyAction(state, side, action);
          moved = true;
        } catch {
          /* no longer legal */
        }
      }
    }
    if (!moved) break;
  }
  return {
    winner: state.winner,
    rounds: Math.max(state.players.host.round, state.players.guest.round),
    froze: state.status !== "finished",
  };
}

function measure() {
  const wins = Object.fromEntries(PLANS.map((plan) => [plan, { w: 0, n: 0 }]));
  const lengths = [];
  let froze = 0;
  let seed = 20260820;

  for (const a of PLANS) {
    for (const b of PLANS) {
      if (a === b) continue;
      for (let i = 0; i < PER_PAIR; i += 1) {
        seed += 7;
        const result = playMatch(a, b, seed);
        lengths.push(result.rounds);
        if (result.froze) froze += 1;
        const aWins = result.winner === "host" ? 1 : result.winner === "draw" ? 0.5 : 0;
        wins[a].w += aWins;
        wins[a].n += 1;
        wins[b].w += 1 - aWins;
        wins[b].n += 1;
      }
    }
  }

  const rates = PLANS.map((plan) => ({
    plan,
    rate: wins[plan].w / wins[plan].n,
    n: wins[plan].n,
  })).sort((a, b) => b.rate - a.rate);

  lengths.sort((x, y) => x - y);
  const mean = lengths.reduce((s, n) => s + n, 0) / lengths.length;
  const ci = 1.96 * Math.sqrt(0.25 / rates[0].n) * 200; // worst-case half-width on a difference, in points

  return {
    rates,
    spread: (rates[0].rate - rates[rates.length - 1].rate) * 100,
    ci,
    mean,
    median: lengths[Math.floor(lengths.length / 2)],
    short: lengths.filter((r) => r <= 6).length / lengths.length,
    long: lengths.filter((r) => r >= 20).length / lengths.length,
    froze,
  };
}

/* ------------------------------------------------------------------ */

const CANDIDATES = [
  {
    name: "as shipped",
    apply() {},
  },
  {
    name: "cells cost +2 (offset 4)",
    why: "A cell is the strongest buy in the game. Make width pay for itself.",
    apply() {
      TUNING.slotCostOffset = 4;
    },
  },
  {
    name: "cells cost +3 (offset 5)",
    why: "Same idea, harder.",
    apply() {
      TUNING.slotCostOffset = 5;
    },
  },
  {
    name: "big hulls cheaper (d8 8, d10 11)",
    why: "Close the gap from the other side: let a capital fleet actually be afforded.",
    apply() {
      TUNING.prices[8] = 8;
      TUNING.prices[10] = 11;
    },
  },
  {
    name: "big hulls much cheaper (d8 7, d10 9)",
    why: "How far does repricing alone go?",
    apply() {
      TUNING.prices[8] = 7;
      TUNING.prices[10] = 9;
    },
  },
  {
    name: "cells +2 and big hulls cheaper",
    why: "Both levers at once, each turned less far.",
    apply() {
      TUNING.slotCostOffset = 4;
      TUNING.prices[8] = 8;
      TUNING.prices[10] = 11;
    },
  },
  {
    name: "d4 costs 5",
    why: "Price the swarm's cheapest hull closer to what it produces.",
    apply() {
      TUNING.prices[4] = 5;
    },
  },
  {
    name: "d4 costs 5 and cells +2",
    why: "Both ends of the wide strategy.",
    apply() {
      TUNING.prices[4] = 5;
      TUNING.slotCostOffset = 4;
    },
  },
];

const baseline = {
  slotCostOffset: TUNING.slotCostOffset,
  prices: { ...TUNING.prices },
  flagCost: { ...TUNING.flagCost },
  startSlots: TUNING.startSlots,
};

function reset() {
  TUNING.slotCostOffset = baseline.slotCostOffset;
  Object.assign(TUNING.prices, baseline.prices);
  Object.assign(TUNING.flagCost, baseline.flagCost);
  TUNING.startSlots = baseline.startSlots;
}

console.log(`Fleet Dice — tuning sweep, ${PER_PAIR} matches a pairing\n`);
console.log("A spread is the gap between the best and worst strategy. Under about");
console.log("10 points means no single plan is running away with the game.\n");

const rows = [];
for (const candidate of CANDIDATES) {
  reset();
  candidate.apply();
  const result = measure();
  rows.push([
    candidate.name,
    `${result.spread.toFixed(1)}`,
    result.rates[0].plan === "width" ? "Wolfpack" : PLAN_LABEL[result.rates[0].plan],
    PLAN_LABEL[result.rates[result.rates.length - 1].plan],
    result.mean.toFixed(1),
    `${(result.short * 100).toFixed(0)}%`,
    `${(result.long * 100).toFixed(0)}%`,
    result.froze,
  ]);
  console.log(
    `${candidate.name.padEnd(34)} spread ${result.spread.toFixed(1).padStart(5)}  ` +
      `best ${PLAN_LABEL[result.rates[0].plan].padEnd(10)} worst ${PLAN_LABEL[result.rates[result.rates.length - 1].plan].padEnd(10)} ` +
      `length ${result.mean.toFixed(1)}`,
  );
}
reset();

console.log("\nFull table\n");
const head = ["candidate", "spread", "best", "worst", "length", "≤6", "≥20", "froze"];
const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
console.log(head.map((h, i) => h.padEnd(widths[i])).join("  "));
console.log(widths.map((w) => "-".repeat(w)).join("  "));
for (const row of rows) console.log(row.map((cell, i) => String(cell).padEnd(widths[i])).join("  "));
console.log("");
