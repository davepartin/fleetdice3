/**
 * The balance lab — deeper tools than sim/simulate.mjs.
 *
 * simulate.mjs measures a fleet with `valueOfTally`, which is the AI's *opinion*
 * of what a roll is worth. That opinion is a guess. Everything in here instead
 * settles arguments by playing real matches and counting who wins, which cannot
 * be wrong about the game even if the AI's weights are.
 *
 *   node sim/lab.mjs arena     [n]   fixed fleets, no shop, head to head
 *   node sim/lab.mjs ladder    [n]   is each upgrade step worth its Energy?
 *   node sim/lab.mjs budget    [n]   same Energy, spent differently
 *   node sim/lab.mjs purchases [n]   what the brains actually buy, and when
 *   node sim/lab.mjs straights [n]   how often each straight length lands
 *   node sim/lab.mjs formation [n]   formation rate by fleet shape
 *   node sim/lab.mjs flagship  [n]   does levelling the flagship pay?
 *   node sim/lab.mjs reactor   [n]   does the Reactor face matter?
 *   node sim/lab.mjs length    [n]   match length, HP sweep
 *   node sim/lab.mjs all       [n]
 */

import { bundlePath } from "./bundle.mjs";
const G = await import(bundlePath);

const {
  PLANS,
  PLAN_LABEL,
  TUNING,
  applyAction,
  makeRng,
  newBrain,
  newMatch,
  newPlayer,
  nextActions,
  setRng,
  tally,
  priceOf,
  valueOfTally,
} = G;

/* ------------------------------------------------------------------ */
/* Printing                                                            */
/* ------------------------------------------------------------------ */

function pct(n) {
  return `${(n * 100).toFixed(1)}%`;
}
function pad(text, width, right = false) {
  const value = String(text);
  return right ? value.padStart(width) : value.padEnd(width);
}
export function table(headers, rows) {
  const widths = headers.map((header, index) =>
    Math.max(String(header).length, ...rows.map((row) => String(row[index] ?? "").length)),
  );
  const line = (cells, right) =>
    cells.map((cell, index) => pad(cell ?? "", widths[index], right && index > 0)).join("  ");
  console.log(line(headers, false));
  console.log(widths.map((width) => "-".repeat(width)).join("  "));
  for (const row of rows) console.log(line(row, true));
}
/** 95% confidence half-width for a proportion, in percentage points. */
function ciPct(p, n) {
  return 1.96 * Math.sqrt((p * (1 - p)) / Math.max(1, n)) * 100;
}
/** 95% confidence half-width for a mean. */
function ciMean(values) {
  const n = values.length;
  if (n < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / n;
  const varr = values.reduce((s, v) => s + (v - mean) * (v - mean), 0) / (n - 1);
  return 1.96 * Math.sqrt(varr / n);
}
function meanOf(values) {
  return values.reduce((s, v) => s + v, 0) / Math.max(1, values.length);
}

/* ------------------------------------------------------------------ */
/* Arena — fixed fleets, no shopping                                   */
/* ------------------------------------------------------------------ */

/** Build a player with an exact fleet. `fleet` is a list of die sizes. */
function fixedPlayer(uid, fleet, flagLevel = 1) {
  const player = newPlayer(uid, uid, "ready");
  player.open = Array.from({ length: 8 }, (_, i) => i < fleet.length);
  player.ships = fleet.map((sides, slot) => ({
    id: `${uid}${slot}`,
    sides,
    disabledRound: null,
    slot,
  }));
  player.flag.level = flagLevel;
  return player;
}

/**
 * Play one match with both fleets frozen. The shipyard never opens, so the only
 * thing being measured is what the ships themselves do in combat.
 */
export function arenaMatch(fleetA, fleetB, opts = {}) {
  const { flagA = 1, flagB = 1, difficulty = "medium", seed = 0, income = 0 } = opts;
  if (seed) setRng(makeRng(seed));
  const state = newMatch("lab", "0000", "A", "A", "versus");
  state.players.host = fixedPlayer("A", fleetA, flagA);
  state.players.guest = fixedPlayer("B", fleetB, flagB);
  state.status = "active";
  state.players.host.phase = "ready";
  state.players.guest.phase = "ready";
  // A flat allowance keeps paid rerolls in play without letting fleets change.
  state.players.host.baseEnergy = income;
  state.players.guest.baseEnergy = income;

  const brains = { host: newBrain("balanced", difficulty), guest: newBrain("balanced", difficulty) };
  let guard = 0;
  while (state.status !== "finished" && guard < 4000) {
    guard += 1;
    let moved = false;
    for (const side of ["host", "guest"]) {
      const player = state.players[side];
      // Skip the shipyard entirely: the fleets are the experiment.
      const actions =
        player.phase === "shop" ? [{ type: "ready" }] : nextActions(state, side, brains[side]);
      for (const action of actions) {
        if (state.status === "finished") break;
        try {
          applyAction(state, side, action);
          moved = true;
        } catch {
          /* action went stale because the match ended — fine */
        }
      }
    }
    if (!moved) break;
  }
  return {
    winner: state.winner,
    rounds: Math.max(state.players.host.round, state.players.guest.round),
  };
}

/**
 * Win rate of fleet A against fleet B, sides swapped half the time so any
 * first-mover quirk cancels out.
 */
export function arena(fleetA, fleetB, n = 600, opts = {}) {
  let wins = 0;
  const lengths = [];
  for (let i = 0; i < n; i += 1) {
    const swap = i % 2 === 1;
    const result = arenaMatch(swap ? fleetB : fleetA, swap ? fleetA : fleetB, {
      ...opts,
      flagA: swap ? (opts.flagB ?? 1) : (opts.flagA ?? 1),
      flagB: swap ? (opts.flagA ?? 1) : (opts.flagB ?? 1),
      seed: 90001 + i * 7919,
    });
    lengths.push(result.rounds);
    const aSide = swap ? "guest" : "host";
    if (result.winner === aSide) wins += 1;
    else if (result.winner === "draw") wins += 0.5;
  }
  const rate = wins / n;
  return { rate, ci: ciPct(rate, n), rounds: meanOf(lengths), n };
}

const named = (fleet) => {
  const counts = new Map();
  for (const s of fleet) counts.set(s, (counts.get(s) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([s, c]) => `${c}×d${s}`)
    .join(" + ");
};
const cost = (fleet) => fleet.reduce((s, side) => s + priceOf(side), 0);

/* ------------------------------------------------------------------ */
/* Per-round output of an arbitrary fleet                              */
/* ------------------------------------------------------------------ */

/** Roll a fleet `rounds` times with the brain's rerolls and average everything. */
export function fleetRound(fleet, rounds = 4000, flagLevel = 1, seed = 12345) {
  setRng(makeRng(seed));
  const totals = {
    attack: 0, defense: 0, energy: 0, heal: 0, direct: 0,
    run: 0, runLen: 0, rowLines: 0, colLines: 0, anyLine: 0, value: 0,
  };
  const values = [];
  for (let i = 0; i < rounds; i += 1) {
    const player = fixedPlayer("x", fleet, flagLevel);
    const state = { status: "active", round: 1, players: { host: player, guest: null } };
    applyAction(state, "host", { type: "roll", dice: [] });
    for (let r = 0; r < 2; r += 1) {
      const reroll = G.chooseReroll(player, { samples: 24, candidates: 8, greed: 1, pressure: 0.3 });
      if (reroll.length) applyAction(state, "host", { type: "roll", dice: reroll });
    }
    const take = G.chooseStraightTake(player, 0.3);
    const t = tally(player.dice, flagLevel, take);
    totals.attack += t.attack;
    totals.defense += t.defense;
    totals.energy += t.energy;
    totals.heal += t.heal;
    totals.direct += t.direct;
    if (t.run) { totals.run += 1; totals.runLen += t.run.taken; }
    totals.rowLines += t.lines.filter((l) => l.kind === "row").length;
    totals.colLines += t.lines.filter((l) => l.kind === "col").length;
    totals.anyLine += t.lines.length ? 1 : 0;
    const v = valueOfTally(t);
    totals.value += v;
    values.push(v);
  }
  const out = {};
  for (const key of Object.keys(totals)) out[key] = totals[key] / rounds;
  out.valueCi = ciMean(values);
  out.cost = cost(fleet);
  return out;
}

/* ------------------------------------------------------------------ */
/* Modes                                                               */
/* ------------------------------------------------------------------ */

function modeArena(n) {
  console.log(`\n=== ARENA — fixed fleets, no shopping, ${n} matches a pairing ===\n`);
  console.log("Both sides play the Captain brain. Win rate is fleet A's.\n");
  const pairs = [
    [[4,4,4,4,4,4,4,4], [6,6,6,6,6,6,6,6]],
    [[6,6,6,6,6,6,6,6], [8,8,8,8,8,8,8,8]],
    [[8,8,8,8,8,8,8,8], [10,10,10,10,10,10,10,10]],
    [[4,4,4,4,4,4,4,4], [8,8,8,8,8,8,8,8]],
    [[4,4,4,4,4,4,4,4], [10,10,10,10,10,10,10,10]],
    [[4,4,4,4,4,4,4,4], [4,4,4,4,4,4,4,6]],
    [[4,4,4,4,4,4,4,4], [4,4,4,4,6,6,6,6]],
  ];
  const rows = [];
  for (const [a, b] of pairs) {
    const r = arena(a, b, n, { income: 2 });
    rows.push([named(a), cost(a), named(b), cost(b), pct(r.rate), `±${r.ci.toFixed(1)}`, r.rounds.toFixed(1)]);
  }
  table(["fleet A", "⚡A", "fleet B", "⚡B", "A wins", "95% ci", "rounds"], rows);
}

function modeLadder(n) {
  console.log(`\n=== THE UPGRADE LADDER — is each step worth its Energy? ===\n`);
  const rounds = n * 4;
  console.log(`Per-round output of a full 8-ship fleet, ${rounds} rounds each.\n`);
  const sizes = [4, 6, 8, 10];
  const measured = sizes.map((s) => ({ s, m: fleetRound(Array(8).fill(s), rounds) }));
  table(
    ["fleet", "cost", "attack", "shields", "energy", "repair", "direct", "straight", "row3", "col3", "value", "±", "per ⚡"],
    measured.map(({ s, m }) => [
      `8 × d${s}`, m.cost,
      m.attack.toFixed(1), m.defense.toFixed(1), m.energy.toFixed(1), m.heal.toFixed(1), m.direct.toFixed(2),
      pct(m.run), m.rowLines.toFixed(2), m.colLines.toFixed(2),
      m.value.toFixed(1), `±${m.valueCi.toFixed(1)}`, (m.value / m.cost).toFixed(3),
    ]),
  );

  console.log(`\nWhat one upgrade step buys, per Energy spent (all 8 ships upgraded):\n`);
  const steps = [];
  for (let i = 0; i < sizes.length - 1; i += 1) {
    const from = measured[i], to = measured[i + 1];
    const spend = to.m.cost - from.m.cost;
    const gain = to.m.value - from.m.value;
    const err = Math.hypot(from.m.valueCi, to.m.valueCi);
    steps.push([
      `d${from.s} → d${to.s}`, spend, gain.toFixed(1), `±${err.toFixed(1)}`,
      (gain / spend).toFixed(3), (gain / 8).toFixed(2),
    ]);
  }
  table(["step", "⚡ for 8", "value gain", "±", "per ⚡", "per ship"], steps);

  console.log(`\nThe same question settled by fighting. Upgraded fleet vs the fleet it came from:\n`);
  const fights = [];
  for (let i = 0; i < sizes.length - 1; i += 1) {
    const lo = Array(8).fill(sizes[i]);
    const hi = Array(8).fill(sizes[i + 1]);
    const r = arena(hi, lo, n, { income: 2 });
    fights.push([
      `8×d${sizes[i + 1]} vs 8×d${sizes[i]}`, cost(hi) - cost(lo),
      pct(r.rate), `±${r.ci.toFixed(1)}`, ((r.rate - 0.5) * 100 / (cost(hi) - cost(lo))).toFixed(2),
    ]);
  }
  table(["fight", "⚡ spent", "big fleet wins", "95% ci", "win pts per ⚡"], fights);
}

function modeBudget(n) {
  console.log(`\n=== SAME ENERGY, SPENT DIFFERENTLY ===\n`);
  console.log(
    "Every commander starts with 4 cells and 4 d4s (16⚡ of hulls, cells free).\n" +
    "Cells 5–8 cost 7, 8, 9 and 10. So width is expensive. These are the real choices.\n",
  );
  // total spend beyond the free start, for reference
  const slotCost = (fromCells, toCells) => {
    let sum = 0;
    for (let c = fromCells; c < toCells; c += 1) sum += c + 1 + TUNING.slotCostOffset;
    return sum;
  };
  const builds = [
    { label: "4 cells, 4×d10", fleet: [10,10,10,10], extra: 0 },
    { label: "4 cells, 4×d8", fleet: [8,8,8,8], extra: 0 },
    { label: "6 cells, 6×d6", fleet: [6,6,6,6,6,6], extra: slotCost(4, 6) },
    { label: "6 cells, 6×d8", fleet: [8,8,8,8,8,8], extra: slotCost(4, 6) },
    { label: "8 cells, 8×d4", fleet: [4,4,4,4,4,4,4,4], extra: slotCost(4, 8) },
    { label: "8 cells, 8×d6", fleet: [6,6,6,6,6,6,6,6], extra: slotCost(4, 8) },
    { label: "8 cells, 8×d8", fleet: [8,8,8,8,8,8,8,8], extra: slotCost(4, 8) },
  ];
  for (const b of builds) b.total = cost(b.fleet) + b.extra;
  table(
    ["build", "hulls ⚡", "cells ⚡", "total ⚡"],
    builds.map((b) => [b.label, cost(b.fleet), b.extra, b.total]),
  );

  console.log(`\nRound-robin between them, ${n} matches a pairing. Cell cost is sunk, so this\nasks: for what you paid, which board actually wins?\n`);
  const rows = [];
  for (const a of builds) {
    const row = [a.label];
    let w = 0, tot = 0;
    for (const b of builds) {
      if (a === b) { row.push("—"); continue; }
      const r = arena(a.fleet, b.fleet, n, { income: 2 });
      row.push(pct(r.rate));
      w += r.rate * n; tot += n;
    }
    row.push(pct(w / tot));
    row.push(`±${ciPct(w / tot, tot).toFixed(1)}`);
    row.push((((w / tot) - 0.5) * 100 / (a.total / 10)).toFixed(2));
    rows.push(row);
  }
  table([...["build"], ...builds.map((b) => b.label.split(", ")[1]), "overall", "±", "pts per 10⚡"], rows);
}

function modePurchases(n) {
  console.log(`\n=== WHAT THE BRAINS ACTUALLY BUY ===\n`);
  const counts = {};
  const shipsBought = { 4: 0, 6: 0, 8: 0, 10: 0 };
  const upgradesFrom = { 4: 0, 6: 0, 8: 0 };
  let matches = 0, flagLevels = [], finalFleets = [], finalSizes = [], cellsOpened = [];
  const byRound = new Map();

  for (let i = 0; i < n; i += 1) {
    const plan = PLANS[i % PLANS.length];
    const other = PLANS[(i + 2) % PLANS.length];
    setRng(makeRng(70001 + i * 7919));
    const state = newMatch("lab", "0000", "A", "A", "versus");
    state.players.guest = newPlayer("B", "B", "ready");
    state.status = "active";
    state.players.host.phase = "ready";
    const brains = { host: newBrain(plan, "medium"), guest: newBrain(other, "medium") };
    let guard = 0;
    while (state.status !== "finished" && guard < 4000) {
      guard += 1;
      let moved = false;
      for (const side of ["host", "guest"]) {
        const player = state.players[side];
        const round = player.round;
        const actions = nextActions(state, side, brains[side]);
        for (const action of actions) {
          if (state.status === "finished") break;
          try {
            applyAction(state, side, action);
            moved = true;
            if (action.type === "shop") {
              const key = action.operation === "buy" ? `buy d${action.sides}` : action.operation;
              counts[key] = (counts[key] ?? 0) + 1;
              if (action.operation === "buy") shipsBought[action.sides] += 1;
              if (action.operation === "upgrade") {
                const ship = player.ships.find((s) => s.id === action.shipId);
                // already upgraded by now, so read the target back one step
                const from = ship ? { 6: 4, 8: 6, 10: 8 }[ship.sides] : null;
                if (from) upgradesFrom[from] += 1;
              }
              const bucket = byRound.get(round) ?? {};
              bucket[key] = (bucket[key] ?? 0) + 1;
              byRound.set(round, bucket);
            }
          } catch { /* stale */ }
        }
      }
      if (!moved) break;
    }
    matches += 1;
    for (const side of ["host", "guest"]) {
      const p = state.players[side];
      flagLevels.push(p.flag.level);
      finalFleets.push(p.ships.length);
      cellsOpened.push(p.open.filter(Boolean).length);
      for (const ship of p.ships) finalSizes.push(ship.sides);
    }
  }

  const totalBuys = Object.values(counts).reduce((s, v) => s + v, 0);
  table(
    ["purchase", "times", "share", "per commander"],
    Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => [k, v, pct(v / totalBuys), (v / (matches * 2)).toFixed(2)]),
  );
  console.log(
    `\n${matches} matches. Average final fleet ${meanOf(finalFleets).toFixed(1)} ships, ` +
      `${meanOf(cellsOpened).toFixed(1)} cells open, flagship level ${meanOf(flagLevels).toFixed(2)}.`,
  );
  const sizeCount = { 4: 0, 6: 0, 8: 0, 10: 0 };
  for (const s of finalSizes) sizeCount[s] += 1;
  table(
    ["final hull", "share of all ships"],
    [4, 6, 8, 10].map((s) => [`d${s}`, pct(sizeCount[s] / finalSizes.length)]),
  );
  console.log("\nUpgrades taken, by the size being upgraded:");
  table(
    ["from", "times", "per commander"],
    [4, 6, 8].map((s) => [`d${s}`, upgradesFrom[s], (upgradesFrom[s] / (matches * 2)).toFixed(2)]),
  );
  console.log("\nWhat gets bought in each round (per commander):");
  const keys = Object.keys(counts).sort();
  table(
    ["round", ...keys],
    [...byRound.entries()]
      .sort((a, b) => a[0] - b[0])
      .filter(([r]) => r <= 12)
      .map(([r, bucket]) => [r, ...keys.map((k) => ((bucket[k] ?? 0) / (matches * 2)).toFixed(2))]),
  );
}

function modeStraights(n) {
  console.log(`\n=== THE STRAIGHT LADDER ===\n`);
  const rounds = n * 4;
  const fleets = [
    ["8 × d6", [6,6,6,6,6,6,6,6]],
    ["8 × d8", [8,8,8,8,8,8,8,8]],
    ["8 × d10", [10,10,10,10,10,10,10,10]],
    ["mixed", [4,6,6,8,8,8,10,10]],
  ];
  console.log(`How often a straight lands and what it pays, ${rounds} rounds each.\n`);
  const rows = [];
  for (const [label, fleet] of fleets) {
    setRng(makeRng(31337));
    const lens = new Map();
    let paid = 0, hits = 0;
    for (let i = 0; i < rounds; i += 1) {
      const player = fixedPlayer("x", fleet, 1);
      const state = { status: "active", round: 1, players: { host: player, guest: null } };
      applyAction(state, "host", { type: "roll", dice: [] });
      for (let r = 0; r < 2; r += 1) {
        const reroll = G.chooseReroll(player, { samples: 24, candidates: 8, greed: 1, pressure: 0.3 });
        if (reroll.length) applyAction(state, "host", { type: "roll", dice: reroll });
      }
      const take = G.chooseStraightTake(player, 0.3);
      const t = tally(player.dice, 1, take);
      if (t.run) {
        hits += 1;
        lens.set(t.run.taken, (lens.get(t.run.taken) ?? 0) + 1);
        paid += (t.run.reward.attack ?? 0) + (t.run.reward.energy ?? 0) * 1.45;
      }
    }
    rows.push([
      label, pct(hits / rounds),
      pct((lens.get(5) ?? 0) / rounds), pct((lens.get(6) ?? 0) / rounds), pct((lens.get(7) ?? 0) / rounds),
      (paid / rounds).toFixed(1),
    ]);
  }
  table(["fleet", "any straight", "took 5", "took 6", "took 7", "avg value"], rows);

  console.log("\nWhat the ladder pays, by length and by the biggest ship in the line:\n");
  table(
    ["length", "d4", "d6", "d8", "d10"],
    [5, 6, 7].map((len) => [len, ...[4, 6, 8, 10].map((s) => G.straightReward(len, s).label)]),
  );
}

function modeFormation(n) {
  console.log(`\n=== FORMATION RATE BY FLEET SHAPE ===\n`);
  const rounds = n * 4;
  console.log(
    `A bonus that fires most rounds is not a bonus. Past about 75% it is base\n` +
    `attack with extra steps. ${rounds} rounds each.\n`,
  );
  const fleets = [
    ["8 × d4", [4,4,4,4,4,4,4,4]],
    ["8 × d6", [6,6,6,6,6,6,6,6]],
    ["8 × d8", [8,8,8,8,8,8,8,8]],
    ["8 × d10", [10,10,10,10,10,10,10,10]],
    ["4 × d4", [4,4,4,4]],
    ["6 × d4", [4,4,4,4,4,4]],
    ["mixed", [4,6,6,8,8,8,10,10]],
  ];
  const rows = [];
  for (const [label, fleet] of fleets) {
    const m = fleetRound(fleet, rounds);
    rows.push([
      label, m.cost, pct(m.anyLine), m.rowLines.toFixed(2), m.colLines.toFixed(2),
      (m.rowLines * TUNING.lineAcrossEnergy).toFixed(1),
      (m.colLines * TUNING.lineDownAttack).toFixed(1),
      (m.rowLines * TUNING.lineAcrossEnergy * 1.45 + m.colLines * TUNING.lineDownAttack).toFixed(1),
      pct((m.rowLines * TUNING.lineAcrossEnergy * 1.45 + m.colLines * TUNING.lineDownAttack) / m.value),
    ]);
  }
  table(["fleet", "cost", "any line", "rows", "cols", "⚡ from rows", "atk from cols", "value", "share of all value"], rows);
}

function modeFlagship(n) {
  console.log(`\n=== DOES LEVELLING THE FLAGSHIP PAY? ===\n`);
  console.log(`Level 1 → 2 costs ${TUNING.flagCost[1]}⚡, 2 → 3 costs ${TUNING.flagCost[2]}⚡.`);
  console.log(`Bonus size: ${TUNING.flagBonus[1]} / ${TUNING.flagBonus[2]} / ${TUNING.flagBonus[3]}.\n`);
  const rounds = n * 4;
  const fleets = [["8 × d6", [6,6,6,6,6,6,6,6]], ["8 × d8", [8,8,8,8,8,8,8,8]], ["mixed", [4,6,6,8,8,8,10,10]]];
  const rows = [];
  for (const [label, fleet] of fleets) {
    const m = [1, 2, 3].map((lvl) => fleetRound(fleet, rounds, lvl));
    rows.push([
      label,
      m[0].value.toFixed(1), m[1].value.toFixed(1), m[2].value.toFixed(1),
      ((m[1].value - m[0].value) / TUNING.flagCost[1]).toFixed(3),
      ((m[2].value - m[1].value) / TUNING.flagCost[2]).toFixed(3),
    ]);
  }
  table(["fleet", "lvl 1", "lvl 2", "lvl 3", "1→2 per ⚡", "2→3 per ⚡"], rows);

  console.log(`\nThe same money spent on hulls instead. Fight it out:\n`);
  const fights = [
    { label: `flag 2 + 8×d6 vs flag 1 + 8×d6 (${TUNING.flagCost[1]}⚡ free)`, a: [6,6,6,6,6,6,6,6], b: [6,6,6,6,6,6,6,6], fa: 2, fb: 1 },
    { label: `flag 3 + 8×d6 vs flag 1 + 8×d6`, a: [6,6,6,6,6,6,6,6], b: [6,6,6,6,6,6,6,6], fa: 3, fb: 1 },
    { label: `flag 2 + 8×d6 (10⚡) vs flag 1 + 6×d6+2×d8 (6⚡ of upgrades)`, a: [6,6,6,6,6,6,6,6], b: [6,6,6,6,6,6,8,8], fa: 2, fb: 1 },
    { label: `flag 3 + 8×d6 (26⚡) vs flag 1 + 8×d8 (24⚡ of upgrades)`, a: [6,6,6,6,6,6,6,6], b: [8,8,8,8,8,8,8,8], fa: 3, fb: 1 },
  ];
  const frows = [];
  for (const f of fights) {
    const r = arena(f.a, f.b, n, { flagA: f.fa, flagB: f.fb, income: 2 });
    frows.push([f.label, pct(r.rate), `±${r.ci.toFixed(1)}`, r.rounds.toFixed(1)]);
  }
  table(["fight", "A wins", "95% ci", "rounds"], frows);
}

function modeReactor(n) {
  console.log(`\n=== THE REACTOR ===\n`);
  console.log(
    `A flagship 1 raises base income by ${TUNING.flagBonus[1]} a round, capped at ` +
    `${TUNING.reactorCap}, then pays ${TUNING.reactorOverflow} instead.\n`,
  );
  let matches = 0;
  const base = [], faceCount = new Map(), reactorRounds = [], totalRounds = [];
  for (let i = 0; i < n; i += 1) {
    const plan = PLANS[i % PLANS.length];
    setRng(makeRng(51001 + i * 7919));
    const state = newMatch("lab", "0000", "A", "A", "versus");
    state.players.guest = newPlayer("B", "B", "ready");
    state.status = "active";
    state.players.host.phase = "ready";
    const brains = { host: newBrain(plan, "medium"), guest: newBrain(PLANS[(i + 2) % PLANS.length], "medium") };
    const seen = { host: 0, guest: 0 };
    let guard = 0;
    while (state.status !== "finished" && guard < 4000) {
      guard += 1;
      let moved = false;
      for (const side of ["host", "guest"]) {
        const actions = nextActions(state, side, brains[side]);
        for (const action of actions) {
          if (state.status === "finished") break;
          try {
            const wasSubmit = action.type === "submit";
            applyAction(state, side, action);
            moved = true;
            if (wasSubmit) {
              const f = state.players[side].tally?.face ?? 0;
              faceCount.set(f, (faceCount.get(f) ?? 0) + 1);
              if (f === 1) seen[side] += 1;
            }
          } catch { /* stale */ }
        }
      }
      if (!moved) break;
    }
    matches += 1;
    for (const side of ["host", "guest"]) {
      base.push(state.players[side].baseEnergy);
      reactorRounds.push(seen[side]);
      totalRounds.push(state.players[side].round);
    }
  }
  const totalFaces = [...faceCount.values()].reduce((s, v) => s + v, 0);
  table(
    ["flagship face", "rounds shown", "share"],
    [1, 2, 3, 4, 5, 6].map((f) => [f, faceCount.get(f) ?? 0, pct((faceCount.get(f) ?? 0) / totalFaces)]),
  );
  console.log(
    `\nAverage base income at the end of a match: ${meanOf(base).toFixed(2)}⚡ a round ` +
      `(cap ${TUNING.reactorCap}). Reactor showed ${meanOf(reactorRounds).toFixed(1)} times ` +
      `in ${meanOf(totalRounds).toFixed(1)} rounds. Capped in ` +
      `${pct(base.filter((b) => b >= TUNING.reactorCap).length / base.length)} of commanders.`,
  );
}

function modeLength(n) {
  console.log(`\n=== MATCH LENGTH ===\n`);
  const lengths = [];
  const hp = TUNING.hp;
  for (let i = 0; i < n; i += 1) {
    const plan = PLANS[i % PLANS.length];
    const other = PLANS[(i + 2) % PLANS.length];
    setRng(makeRng(11001 + i * 7919));
    const state = newMatch("lab", "0000", "A", "A", "versus");
    state.players.guest = newPlayer("B", "B", "ready");
    state.status = "active";
    state.players.host.phase = "ready";
    const brains = { host: newBrain(plan, "medium"), guest: newBrain(other, "medium") };
    let guard = 0;
    while (state.status !== "finished" && guard < 4000) {
      guard += 1;
      let moved = false;
      for (const side of ["host", "guest"]) {
        const actions = nextActions(state, side, brains[side]);
        for (const action of actions) {
          if (state.status === "finished") break;
          try { applyAction(state, side, action); moved = true; } catch { /* stale */ }
        }
      }
      if (!moved) break;
    }
    lengths.push(Math.max(state.players.host.round, state.players.guest.round));
  }
  lengths.sort((a, b) => a - b);
  const mean = meanOf(lengths);
  const buckets = new Map();
  for (const l of lengths) {
    const b = l <= 6 ? "≤6" : l <= 9 ? "7–9" : l <= 13 ? "10–13" : l <= 20 ? "14–20" : l < TUNING.roundLimit ? "21–39" : "40 (backstop)";
    buckets.set(b, (buckets.get(b) ?? 0) + 1);
  }
  table(
    ["length", "matches", "share"],
    ["≤6", "7–9", "10–13", "14–20", "21–39", "40 (backstop)"].map((b) => [b, buckets.get(b) ?? 0, pct((buckets.get(b) ?? 0) / lengths.length)]),
  );
  console.log(
    `\nHP ${hp}. Mean ${mean.toFixed(1)} ±${ciMean(lengths).toFixed(2)} rounds. ` +
      `Median ${lengths[Math.floor(lengths.length / 2)]}. Range ${lengths[0]}–${lengths[lengths.length - 1]}. ` +
      `Backstop hits: ${lengths.filter((l) => l >= TUNING.roundLimit).length}.`,
  );
}


/* ------------------------------------------------------------------ */
/* Head starts — the exchange rate between Energy and everything else   */
/* ------------------------------------------------------------------ */

/** Play a full match, shopping and all, with an optional head start for A. */
function fullMatch(planA, planB, seed, setupA = () => {}, setupB = () => {}) {
  setRng(makeRng(seed));
  const state = newMatch("lab", "0000", "A", "A", "versus");
  state.players.guest = newPlayer("B", "B", "ready");
  state.status = "active";
  state.players.host.phase = "ready";
  setupA(state.players.host);
  setupB(state.players.guest);
  const brains = { host: newBrain(planA, "medium"), guest: newBrain(planB, "medium") };
  let guard = 0;
  while (state.status !== "finished" && guard < 4000) {
    guard += 1;
    let moved = false;
    for (const side of ["host", "guest"]) {
      const actions = nextActions(state, side, brains[side]);
      for (const action of actions) {
        if (state.status === "finished") break;
        try { applyAction(state, side, action); moved = true; } catch { /* stale */ }
      }
    }
    if (!moved) break;
  }
  return { winner: state.winner, rounds: Math.max(state.players.host.round, state.players.guest.round) };
}

/** Win rate of a head start, sides swapped half the time. */
function headStart(setup, n, plan = null) {
  let wins = 0;
  const lengths = [];
  for (let i = 0; i < n; i += 1) {
    const swap = i % 2 === 1;
    const p = plan ?? PLANS[i % PLANS.length];
    const q = plan ?? PLANS[(i + 2) % PLANS.length];
    const r = swap
      ? fullMatch(q, p, 60011 + i * 7919, () => {}, setup)
      : fullMatch(p, q, 60011 + i * 7919, setup, () => {});
    lengths.push(r.rounds);
    const side = swap ? "guest" : "host";
    if (r.winner === side) wins += 1;
    else if (r.winner === "draw") wins += 0.5;
  }
  const rate = wins / n;
  return { rate, ci: ciPct(rate, n), rounds: meanOf(lengths) };
}

const asUpgrade = (count, from, to) => (p) => {
  let done = 0;
  for (const ship of p.ships) { if (done >= count) break; if (ship.sides === from) { ship.sides = to; done += 1; } }
};

function modeWorth(n) {
  console.log(`\n=== HEAD STARTS — what is one Energy actually worth? ===\n`);
  console.log(
    `Full matches, shipyard open, both sides played by the Captain brain.\n` +
    `A gets a head start; B gets nothing. 50% means the head start was free money\n` +
    `that bought nothing. ${n} matches a row.\n`,
  );
  const rows = [];
  const cases = [
    ["+2⚡ in the bank", 2, (p) => { p.energy += 2; }],
    ["+4⚡ in the bank", 4, (p) => { p.energy += 4; }],
    ["+8⚡ in the bank", 8, (p) => { p.energy += 8; }],
    ["+16⚡ in the bank", 16, (p) => { p.energy += 16; }],
    ["+24⚡ in the bank", 24, (p) => { p.energy += 24; }],
    ["1 of 4 starting d4 → d6", 2, asUpgrade(1, 4, 6)],
    ["2 of 4 starting d4 → d6", 4, asUpgrade(2, 4, 6)],
    ["all 4 starting d4 → d6", 8, asUpgrade(4, 4, 6)],
    ["all 4 starting d4 → d8", 20, asUpgrade(4, 4, 8)],
    ["all 4 starting d4 → d10", 36, asUpgrade(4, 4, 10)],
    ["flagship starts at level 2", 10, (p) => { p.flag.level = 2; }],
    ["flagship starts at level 3", 26, (p) => { p.flag.level = 3; }],
    ["one more cell, opened and empty", TUNING.startSlots + 3, openCell()],
    ["one more cell with a d4 in it", TUNING.startSlots + 3 + priceOf(4), addShip(4)],
    ["one more cell with a d6 in it", TUNING.startSlots + 3 + priceOf(6), addShip(6)],
  ];
  for (const [label, spend, setup] of cases) {
    const r = headStart(setup, n);
    rows.push([
      label, spend, pct(r.rate), `±${r.ci.toFixed(1)}`,
      spend ? (((r.rate - 0.5) * 100) / spend).toFixed(2) : "—",
    ]);
  }
  table(["head start", "worth ⚡", "A wins", "95% ci", "win pts per ⚡"], rows);
  console.log(
    "\nRead the last column as the exchange rate. If a head start buys fewer win\n" +
    "points per Energy than plain Energy in the bank does, that purchase is a trap.",
  );
}


/** A vs B where each side gets a different head start. Sides swapped half the time. */
function duel(setupA, setupB, n) {
  let wins = 0;
  const lengths = [];
  for (let i = 0; i < n; i += 1) {
    const swap = i % 2 === 1;
    const p = PLANS[i % PLANS.length];
    const q = PLANS[(i + 2) % PLANS.length];
    const r = swap
      ? fullMatch(q, p, 40031 + i * 7919, setupB, setupA)
      : fullMatch(p, q, 40031 + i * 7919, setupA, setupB);
    lengths.push(r.rounds);
    const side = swap ? "guest" : "host";
    if (r.winner === side) wins += 1;
    else if (r.winner === "draw") wins += 0.5;
  }
  const rate = wins / n;
  return { rate, ci: ciPct(rate, n), rounds: meanOf(lengths) };
}

const cash = (amount) => (p) => { p.energy += amount; };

/**
 * Is a purchase fairly priced? Side A is handed the thing. Side B is handed the
 * Energy it costs. Both then play a normal match. 50% means the price is right.
 */
function modeFair(n) {
  console.log(`\n=== IS EACH PURCHASE FAIRLY PRICED? ===\n`);
  console.log(
    `Side A is handed the thing. Side B is handed the exact Energy it costs, to\n` +
    `spend however it likes. Both play a full match. 50% means the price is right.\n` +
    `Above 50% the thing is a bargain; below 50% it is a trap. ${n} matches a row.\n`,
  );
  const cases = [
    ["1 upgrade d4 → d6", 2, asUpgrade(1, 4, 6)],
    ["2 upgrades d4 → d6", 4, asUpgrade(2, 4, 6)],
    ["4 upgrades d4 → d6", 8, asUpgrade(4, 4, 6)],
    ["4 upgrades d4 → d8", 20, asUpgrade(4, 4, 8)],
    ["4 upgrades d4 → d10", 36, asUpgrade(4, 4, 10)],
    ["flagship level 2", TUNING.flagCost[1], (p) => { p.flag.level = 2; }],
    ["flagship level 3", TUNING.flagCost[1] + TUNING.flagCost[2], (p) => { p.flag.level = 3; }],
    ["one more cell (empty)", TUNING.startSlots + 1 + TUNING.slotCostOffset, openCell()],
    ["one more cell + a d4", TUNING.startSlots + 1 + TUNING.slotCostOffset + priceOf(4), addShip(4)],
    ["two more cells + 2×d4", 2 * TUNING.startSlots + 3 + 2 * TUNING.slotCostOffset + 2 * priceOf(4), chain(addShip(4), addShip(4))],
  ];
  const rows = [];
  for (const [label, spend, setup] of cases) {
    const r = duel(setup, cash(spend), n);
    const verdict = r.rate - r.ci / 100 > 0.5 ? "bargain" : r.rate + r.ci / 100 < 0.5 ? "TRAP" : "fair";
    rows.push([label, spend, pct(r.rate), `±${r.ci.toFixed(1)}`, verdict]);
  }
  table(["thing A is handed", "⚡ B gets instead", "A wins", "95% ci", "verdict"], rows);
}


/* ------------------------------------------------------------------ */
/* Spending packages — equal Energy, different shopping list           */
/* ------------------------------------------------------------------ */

/** The lowest cell that has no ship in it, opening it if it is still locked. */
function nextFreeSlot(p) {
  for (let slot = 0; slot < 8; slot += 1) {
    if (!p.ships.some((s) => s.slot === slot)) return slot;
  }
  return null;
}
/** What it costs this commander to open one more cell. */
function openCost(p, extra = 0) {
  return p.open.filter(Boolean).length + extra + 1 + TUNING.slotCostOffset;
}
const addShip = (sides) => (p) => {
  const slot = nextFreeSlot(p);
  if (slot === null) return;
  p.open[slot] = true;
  p.ships.push({ id: `x${slot}${p.ships.length}`, sides, disabledRound: null, slot });
};
const chain = (...fns) => (p) => { for (const fn of fns) fn(p); };
const openCell = () => (p) => { const slot = nextFreeSlot(p); if (slot !== null) p.open[slot] = true; };
const flagTo = (lvl) => (p) => { p.flag.level = lvl; };

/** Packages of roughly equal Energy, so we can ask which list is the right list. */
function packages() {
  const opened = TUNING.startSlots;
  const cell5 = opened + 1 + TUNING.slotCostOffset;
  const cell6 = opened + 2 + TUNING.slotCostOffset;
  const u46 = priceOf(6) - priceOf(4);
  const u68 = priceOf(8) - priceOf(6);
  const u810 = priceOf(10) - priceOf(8);
  return {
    small: [
      ["one more cell + a d4", cell5 + priceOf(4), addShip(4)],
      ["4 upgrades to d6, 1 to d8", 4 * u46 + u68, chain(asUpgrade(4, 4, 6), asUpgrade(1, 6, 8))],
      ["2 upgrades to d8", 2 * (u46 + u68), asUpgrade(2, 4, 8)],
      ["flagship level 2", TUNING.flagCost[1], flagTo(2)],
      ["nothing, just the Energy", 0, () => {}],
    ],
    big: [
      ["two more cells + two d4", cell5 + cell6 + 2 * priceOf(4), chain(addShip(4), addShip(4))],
      ["one more cell + a d6 + 4 upgrades", cell5 + priceOf(6) + 4 * u46, chain(addShip(6), asUpgrade(4, 4, 6))],
      ["4 upgrades to d8", 4 * (u46 + u68), asUpgrade(4, 4, 8)],
      ["flagship level 2 + 4 upgrades to d6", TUNING.flagCost[1] + 4 * u46, chain(flagTo(2), asUpgrade(4, 4, 6))],
      ["flagship level 3", TUNING.flagCost[1] + TUNING.flagCost[2], flagTo(3)],
      ["2 upgrades to d10", 2 * (u46 + u68 + u810), asUpgrade(2, 4, 10)],
    ],
  };
}

function modeSpend(n) {
  console.log(`\n=== THE SAME ENERGY, SPENT DIFFERENTLY ===\n`);
  console.log(
    `Both commanders are handed a shopping list of roughly the same Energy, then\n` +
    `play a full match and shop normally from there. Any difference is the list.\n` +
    `Every list is topped up with cash so both sides have spent exactly the same.\n` +
    `${n} matches a pairing.\n`,
  );
  const groups = packages();
  for (const [name, list] of Object.entries(groups)) {
    const budget = Math.max(...list.map((entry) => entry[1]));
    console.log(`\n--- ${budget}⚡ budget ---\n`);
    const rows = [];
    for (const [labelA, costA, setupA] of list) {
      const row = [labelA, costA];
      let w = 0, tot = 0;
      for (const [labelB, costB, setupB] of list) {
        if (labelA === labelB) { row.push("—"); continue; }
        const r = duel(
          chain(setupA, cash(budget - costA)),
          chain(setupB, cash(budget - costB)),
          n,
        );
        row.push(pct(r.rate));
        w += r.rate * n; tot += n;
      }
      row.push(pct(w / tot));
      row.push(`±${ciPct(w / tot, tot).toFixed(1)}`);
      rows.push(row);
    }
    const short = list.map((entry) => entry[0].split(" ").slice(0, 2).join(" "));
    table(["shopping list", "⚡", ...short, "overall", "±"], rows);
  }
}

/* ------------------------------------------------------------------ */

const mode = process.argv[2] ?? "all";
const n = Number(process.argv[3]) || 400;

console.log("Fleet Dice 3 — balance lab");
console.log(
  `HP ${TUNING.hp} · prices ${JSON.stringify(TUNING.prices)} · cells +${TUNING.slotCostOffset} · ` +
  `across ${TUNING.lineAcrossEnergy}⚡ · down ${TUNING.lineDownAttack} atk · run ${TUNING.runMin}–${TUNING.runMax}`,
);

if (mode === "all" || mode === "ladder") modeLadder(n);
if (mode === "all" || mode === "arena") modeArena(n);
if (mode === "all" || mode === "budget") modeBudget(n);
if (mode === "all" || mode === "formation") modeFormation(n);
if (mode === "all" || mode === "straights") modeStraights(n);
if (mode === "all" || mode === "purchases") modePurchases(n);
if (mode === "all" || mode === "flagship") modeFlagship(n);
if (mode === "all" || mode === "reactor") modeReactor(n);
if (mode === "all" || mode === "worth") modeWorth(n);
if (mode === "all" || mode === "fair") modeFair(n);
if (mode === "all" || mode === "spend") modeSpend(n);
if (mode === "all" || mode === "length") modeLength(n);
console.log("");
