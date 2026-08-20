/**
 * Tuning sweeps.
 *
 * TUNING is a plain object the engine reads at call time, so this file can try a
 * number, measure it, put it back, and try the next one — without editing
 * lib/engine.ts. Nothing here changes the game; it only asks "what if".
 *
 *   node sim/sweep.mjs runtake  [n]  is a longer straight really worth more?
 *   node sim/sweep.mjs straight [n]  sweep the length-5 Energy multiplier
 *   node sim/sweep.mjs flag     [n]  sweep flagship cost and bonus
 *   node sim/sweep.mjs slot     [n]  sweep the cost of opening a cell
 *   node sim/sweep.mjs lines    [n]  sweep the row/column prizes
 *   node sim/sweep.mjs hp       [n]  sweep flagship health
 *   node sim/sweep.mjs marks    [n]  sweep the small-face mark ladders
 *   node sim/sweep.mjs final    [n]  the whole proposed set, one change at a time
 */

import "./bundle.mjs";
const G = await import("../.simbuild/game.mjs");

const {
  PLANS, PLAN_LABEL, TUNING, applyAction, makeRng, newBrain, newMatch, newPlayer,
  nextActions, setRng, tally, priceOf, valueOfTally,
} = G;

/* --------------------------- printing ----------------------------- */
const pct = (n) => `${(n * 100).toFixed(1)}%`;
const pad = (t, w, r = false) => (r ? String(t).padStart(w) : String(t).padEnd(w));
function table(headers, rows) {
  const widths = headers.map((h, i) => Math.max(String(h).length, ...rows.map((r) => String(r[i] ?? "").length)));
  const line = (cells, right) => cells.map((c, i) => pad(c ?? "", widths[i], right && i > 0)).join("  ");
  console.log(line(headers, false));
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  for (const r of rows) console.log(line(r, true));
}
const ciPct = (p, n) => 1.96 * Math.sqrt((p * (1 - p)) / Math.max(1, n)) * 100;
const meanOf = (v) => v.reduce((s, x) => s + x, 0) / Math.max(1, v.length);
function ciMean(v) {
  const n = v.length; if (n < 2) return 0;
  const m = meanOf(v);
  return 1.96 * Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (n - 1) / n);
}

/* --------------------------- match driver -------------------------- */

/**
 * Play a full match. `tweak` may rewrite a side's actions, which is how we test
 * "what if the commander always took the longest straight?".
 */
function fullMatch(planA, planB, seed, setupA = () => {}, setupB = () => {}, tweak = null) {
  setRng(makeRng(seed));
  const state = newMatch("sw", "0000", "A", "A", "versus");
  state.players.guest = newPlayer("B", "B", "ready");
  state.status = "active";
  state.players.host.phase = "ready";
  setupA(state.players.host);
  setupB(state.players.guest);
  const brains = { host: newBrain(planA, "captain"), guest: newBrain(planB, "captain") };
  let guard = 0;
  while (state.status !== "finished" && guard < 4000) {
    guard += 1;
    let moved = false;
    for (const side of ["host", "guest"]) {
      let actions = nextActions(state, side, brains[side]);
      if (tweak) actions = tweak(state, side, actions);
      for (const action of actions) {
        if (state.status === "finished") break;
        try { applyAction(state, side, action); moved = true; } catch { /* stale */ }
      }
    }
    if (!moved) break;
  }
  return {
    winner: state.winner,
    stuck: state.status !== "finished",
    rounds: Math.max(state.players.host.round, state.players.guest.round),
    hostShips: state.players.host.ships.length,
    guestShips: state.players.guest.ships.length,
    hostCells: state.players.host.open.filter(Boolean).length,
    guestCells: state.players.guest.open.filter(Boolean).length,
    hostFlag: state.players.host.flag.level,
    guestFlag: state.players.guest.flag.level,
  };
}

/** A vs B with different head starts. Sides swap every other match. */
function duel(setupA, setupB, n, tweakA = null) {
  let wins = 0;
  const lengths = [];
  for (let i = 0; i < n; i += 1) {
    const swap = i % 2 === 1;
    const p = PLANS[i % PLANS.length];
    const q = PLANS[(i + 2) % PLANS.length];
    const aSide = swap ? "guest" : "host";
    const tweak = tweakA ? (state, side, actions) => (side === aSide ? tweakA(state, side, actions) : actions) : null;
    const r = swap
      ? fullMatch(q, p, 40031 + i * 7919, setupB, setupA, tweak)
      : fullMatch(p, q, 40031 + i * 7919, setupA, setupB, tweak);
    lengths.push(r.rounds);
    if (r.winner === aSide) wins += 1;
    else if (r.winner === "draw") wins += 0.5;
  }
  const rate = wins / n;
  return { rate, ci: ciPct(rate, n), rounds: meanOf(lengths) };
}

/* --------------------------- helpers ------------------------------- */

const cash = (a) => (p) => { p.energy += a; };
const chain = (...fns) => (p) => { for (const fn of fns) fn(p); };
const asUpgrade = (count, from, to) => (p) => {
  let done = 0;
  for (const ship of p.ships) { if (done >= count) break; if (ship.sides === from) { ship.sides = to; done += 1; } }
};
function nextFreeSlot(p) {
  for (let slot = 0; slot < 8; slot += 1) if (!p.ships.some((s) => s.slot === slot)) return slot;
  return null;
}
const addShip = (sides) => (p) => {
  const slot = nextFreeSlot(p);
  if (slot === null) return;
  p.open[slot] = true;
  p.ships.push({ id: `x${slot}${p.ships.length}`, sides, disabledRound: null, slot });
};
const flagTo = (lvl) => (p) => { p.flag.level = lvl; };
const cellCost = () => TUNING.startSlots + 1 + TUNING.slotCostOffset;

/**
 * The strongest known rival package for a given Energy: upgrade the four
 * starting d4s, cheapest step first. Returns what it really costs and a setup.
 */
function upgradePackage(budget) {
  const steps = [];
  for (let i = 0; i < 4; i += 1) steps.push([4, 6, priceOf(6) - priceOf(4)]);
  for (let i = 0; i < 4; i += 1) steps.push([6, 8, priceOf(8) - priceOf(6)]);
  for (let i = 0; i < 4; i += 1) steps.push([8, 10, priceOf(10) - priceOf(8)]);
  const taken = [];
  let spent = 0;
  for (const [from, to, c] of steps) {
    if (spent + c > budget) continue;
    taken.push([from, to]); spent += c;
  }
  return {
    cost: spent,
    setup: (p) => { for (const [from, to] of taken) asUpgrade(1, from, to)(p); },
    label: `${taken.length} upgrade${taken.length === 1 ? "" : "s"}`,
  };
}


/** Roll a fleet many times and average the tally. */
function fleetRound(fleet, rounds, flagLevel = 1, seed = 12345) {
  setRng(makeRng(seed));
  const t = { attack: 0, defense: 0, energy: 0, heal: 0, direct: 0, run: 0, anyLine: 0, value: 0 };
  const values = [];
  for (let i = 0; i < rounds; i += 1) {
    const player = newPlayer("x", "x", "ready");
    player.open = Array.from({ length: 8 }, (_, k) => k < fleet.length);
    player.ships = fleet.map((sides, slot) => ({ id: `s${slot}`, sides, disabledRound: null, slot }));
    player.flag.level = flagLevel;
    const state = { status: "active", round: 1, players: { host: player, guest: null } };
    applyAction(state, "host", { type: "roll", dice: [] });
    for (let r = 1; r < TUNING.rollsPerRound; r += 1) {
      const rr = G.chooseReroll(player, { samples: 24, candidates: 8, greed: 1, pressure: 0.3 });
      if (rr.length) applyAction(state, "host", { type: "roll", dice: rr });
    }
    const take = G.chooseStraightTake(player, 0.3);
    const tal = tally(player.dice, flagLevel, take);
    t.attack += tal.attack; t.defense += tal.defense; t.energy += tal.energy;
    t.heal += tal.heal; t.direct += tal.direct;
    t.run += tal.run ? 1 : 0; t.anyLine += tal.lines.length ? 1 : 0;
    const v = valueOfTally(tal); t.value += v; values.push(v);
  }
  const out = {};
  for (const k of Object.keys(t)) out[k] = t[k] / rounds;
  out.valueCi = ciMean(values);
  return out;
}

/** Restore TUNING after a what-if. */
function withTuning(patch, fn) {
  const before = {};
  for (const key of Object.keys(patch)) before[key] = TUNING[key];
  Object.assign(TUNING, patch);
  try { return fn(); } finally { Object.assign(TUNING, before); }
}

/** Health of the whole game at the current TUNING: plan spread and match length. */
function healthCheck(perPair) {
  const wins = Object.fromEntries(PLANS.map((p) => [p, { w: 0, n: 0 }]));
  const lengths = [];
  const ships = [], cells = [], flags = [];
  let stuck = 0;
  let seed = 1;
  for (const a of PLANS) {
    for (const b of PLANS) {
      if (a === b) continue;
      let aw = 0;
      for (let i = 0; i < perPair; i += 1) {
        seed += 1;
        const r = fullMatch(a, b, seed);
        if (r.stuck) stuck += 1;
        lengths.push(r.rounds);
        ships.push(r.hostShips, r.guestShips);
        cells.push(r.hostCells, r.guestCells);
        flags.push(r.hostFlag, r.guestFlag);
        if (r.winner === "host") aw += 1; else if (r.winner === "draw") aw += 0.5;
      }
      wins[a].w += aw; wins[a].n += perPair;
      wins[b].w += perPair - aw; wins[b].n += perPair;
    }
  }
  const rates = PLANS.map((p) => ({ plan: p, rate: wins[p].w / wins[p].n, n: wins[p].n }));
  rates.sort((a, b) => b.rate - a.rate);
  const spread = (rates[0].rate - rates[rates.length - 1].rate) * 100;
  const spreadCi = Math.hypot(ciPct(rates[0].rate, rates[0].n), ciPct(rates[rates.length - 1].rate, rates[rates.length - 1].n));
  lengths.sort((a, b) => a - b);
  return {
    stuck,
    short: lengths.filter((l) => l <= 6).length / lengths.length,
    long: lengths.filter((l) => l > 15).length / lengths.length,
    inBand: lengths.filter((l) => l >= 10 && l <= 15).length / lengths.length,
    spread, spreadCi, rates,
    mean: meanOf(lengths), meanCi: ciMean(lengths),
    median: lengths[Math.floor(lengths.length / 2)],
    min: lengths[0], max: lengths[lengths.length - 1],
    backstop: lengths.filter((l) => l >= TUNING.roundLimit).length,
    ships: meanOf(ships), cells: meanOf(cells), flags: meanOf(flags),
    n: lengths.length,
  };
}

/* ------------------------------------------------------------------ */
/* Is a longer straight actually worth more?                           */
/* ------------------------------------------------------------------ */

/** Force a side to always cash the longest straight it has. */
const takeLongest = (state, side, actions) =>
  actions.map((a) => {
    if (a.type !== "straight-take") return a;
    const run = G.bestRun(state.players[side].dice);
    if (!run) return a;
    return { type: "straight-take", take: Math.min(run.length, TUNING.runMax) };
  });

/** Force a side to always cash the shortest (5) straight it has. */
const takeShortest = (state, side, actions) =>
  actions.map((a) => (a.type === "straight-take" ? { type: "straight-take", take: TUNING.runMin } : a));

function modeRunTake(n) {
  console.log(`\n=== IS A LONGER STRAIGHT WORTH MORE? ===\n`);
  console.log(
    `The rules say length picks the prize tier, so longer should always be better.\n` +
    `Here one commander is forced to always take the longest run available and the\n` +
    `other plays normally. ${n} matches a row.\n`,
  );
  const rows = [];
  for (const [label, tweak] of [["always take the longest", takeLongest], ["always take just 5", takeShortest]]) {
    const r = duel(() => {}, () => {}, n, tweak);
    rows.push([label, pct(r.rate), `±${r.ci.toFixed(1)}`]);
  }
  table(["forced habit", "wins vs the brain", "95% ci"], rows);

  console.log(`\nWhat the ladder pays now, and what a point of it is worth in attack:\n`);
  const erows = [];
  for (const len of [5, 6, 7]) {
    const row = [len];
    for (const s of [4, 6, 8, 10]) {
      const rew = G.straightReward(len, s);
      row.push(rew.label);
    }
    erows.push(row);
  }
  table(["length", "d4", "d6", "d8", "d10"], erows);

  console.log(
    `\nA longest-run habit beating the brain means the ladder is fine and the brain\n` +
    `is greedy for Energy. A short-run habit winning means the ladder is upside down.`,
  );
}

/* ------------------------------------------------------------------ */
/* Sweeps                                                              */
/* ------------------------------------------------------------------ */

function modeFlag(n) {
  console.log(`\n=== FLAGSHIP: WHAT PRICE MAKES IT A REAL CHOICE? ===\n`);
  console.log(
    `Side A is handed flagship level 2. Side B spends the same Energy on upgrades,\n` +
    `the strongest rival buy. 50% means the flagship price is right. ${n} matches a row.\n`,
  );
  const rows = [];
  for (const bonus of [[2, 3, 4], [2, 4, 6], [2, 5, 8]]) {
    for (const c1 of [10, 7, 5, 3]) {
      const out = withTuning(
        { flagBonus: { 1: bonus[0], 2: bonus[1], 3: bonus[2] }, flagCost: { 1: c1, 2: Math.round(c1 * 1.6) } },
        () => {
          const rival = upgradePackage(c1);
          return duel(flagTo(2), chain(rival.setup, cash(c1 - rival.cost)), n);
        },
      );
      rows.push([`${bonus.join("/")}`, c1, pct(out.rate), `\u00b1${out.ci.toFixed(1)}`]);
    }
  }
  table(["bonus ladder", "lvl 2 cost", "A wins", "95% ci"], rows);

  console.log(`\nThe same question for the whole climb to level 3:\n`);
  const rows3 = [];
  for (const bonus of [[2, 3, 4], [2, 4, 6], [2, 5, 8]]) {
    for (const [c1, c2] of [[10, 16], [7, 11], [5, 8], [3, 5]]) {
      const out = withTuning(
        { flagBonus: { 1: bonus[0], 2: bonus[1], 3: bonus[2] }, flagCost: { 1: c1, 2: c2 } },
        () => {
          const rival = upgradePackage(c1 + c2);
          return duel(flagTo(3), chain(rival.setup, cash(c1 + c2 - rival.cost)), n);
        },
      );
      rows3.push([`${bonus.join("/")}`, `${c1}+${c2}`, pct(out.rate), `\u00b1${out.ci.toFixed(1)}`]);
    }
  }
  table(["bonus ladder", "climb cost", "A wins", "95% ci"], rows3);
}

function modeSlot(n) {
  console.log(`\n=== CELLS: WHAT PRICE MAKES OPENING ONE A REAL CHOICE? ===\n`);
  console.log(
    `Side A opens a 5th cell and parks a d4 in it. Side B spends the same Energy on\n` +
    `upgrades instead, which is the strongest rival buy. Any leftover is cash. Both\n` +
    `then play a full match and shop normally. 50% means the cell price is right.\n` +
    `${n} matches a row.\n`,
  );
  const rows = [];
  for (const offset of [2, 4, 6, 8, 10, 12, 14, 17, 20]) {
    const out = withTuning({ slotCostOffset: offset }, () => {
      const spend = cellCost() + priceOf(4);
      const rival = upgradePackage(spend);
      const d = duel(addShip(4), chain(rival.setup, cash(spend - rival.cost)), n);
      return { d, spend, rival: rival.label };
    });
    rows.push([
      offset, `from ${TUNING.startSlots + 1 + offset}`, out.spend, out.rival,
      pct(out.d.rate), `\u00b1${out.d.ci.toFixed(1)}`,
    ]);
  }
  table(["offset", "cells 5-8 cost", "cell+d4 \u26a1", "B buys", "A wins", "95% ci"], rows);
  console.log("\nThe offset where A sits on 50% is the honest price of a cell.");
}

function modeStraightSweep(n) {
  console.log(`\n=== THE LENGTH-5 STRAIGHT PRIZE ===\n`);
  console.log(
    `A length-5 run pays Energy; 6 and 7 pay Attack. If the Energy is too generous\n` +
    `a five beats a six, which is upside down. Here a commander forced to always\n` +
    `take the longest run fights one that plays normally, at each setting.\n`,
  );
  console.log("Note: this sweep needs the multiplier inside straightReward, which is a");
  console.log("function, so it is measured by counting how often the brain narrows a run.\n");
  const rows = [];
  for (const fleet of [["8 × d6", Array(8).fill(6)], ["8 × d8", Array(8).fill(8)], ["mixed", [4, 6, 6, 8, 8, 8, 10, 10]]]) {
    setRng(makeRng(2024));
    let runs = 0, narrowed = 0;
    for (let i = 0; i < n * 4; i += 1) {
      const player = newPlayer("x", "x", "ready");
      player.open = Array.from({ length: 8 }, (_, k) => k < fleet[1].length);
      player.ships = fleet[1].map((sides, slot) => ({ id: `s${slot}`, sides, disabledRound: null, slot }));
      const state = { status: "active", round: 1, players: { host: player, guest: null } };
      applyAction(state, "host", { type: "roll", dice: [] });
      for (let r = 0; r < 2; r += 1) {
        const rr = G.chooseReroll(player, { samples: 24, candidates: 8, greed: 1, pressure: 0.3 });
        if (rr.length) applyAction(state, "host", { type: "roll", dice: rr });
      }
      const run = G.bestRun(player.dice);
      if (!run) continue;
      const cap = Math.min(run.length, TUNING.runMax);
      if (cap <= TUNING.runMin) continue;
      runs += 1;
      const take = G.chooseStraightTake(player, 0.3);
      if (take !== null && take < cap) narrowed += 1;
    }
    rows.push([fleet[0], runs, narrowed, pct(narrowed / Math.max(1, runs))]);
  }
  table(["fleet", "runs longer than 5", "narrowed to a shorter one", "share"], rows);
  console.log("\nA high share means the ladder pays better for a shorter run than a longer one.");
}

function modeLines(n) {
  console.log(`\n=== THE ROW AND COLUMN PRIZES ===\n`);
  console.log(
    `The owner likes 5 Energy across and 10 Attack down. This checks what they are\n` +
    `worth and how often they fire, and whether a d4 swarm lives off them.\n`,
  );
  const rounds = n * 4;
  const rows = [];
  for (const [label, fleet] of [["8 × d4", Array(8).fill(4)], ["6 × d4", Array(6).fill(4)], ["4 × d4", Array(4).fill(4)],
    ["8 × d6", Array(8).fill(6)], ["4 × d10", Array(4).fill(10)], ["mixed", [4, 6, 6, 8, 8, 8, 10, 10]]]) {
    const on = fleetRound(fleet, rounds);
    const off = withTuning({ lineAcrossEnergy: 0, lineDownAttack: 0 }, () => fleetRound(fleet, rounds));
    rows.push([
      label, pct(on.anyLine), on.value.toFixed(1), off.value.toFixed(1),
      (on.value - off.value).toFixed(1), pct((on.value - off.value) / on.value),
    ]);
  }
  table(["fleet", "line rate", "value with prizes", "without", "the prizes", "share of value"], rows);

  console.log(`\nSweeping the two prizes. Line rate cannot move — only what a line pays.\n`);
  const srows = [];
  for (const [across, down] of [[5, 10], [4, 8], [3, 6], [6, 12], [5, 12], [3, 10]]) {
    const d4 = withTuning({ lineAcrossEnergy: across, lineDownAttack: down }, () => fleetRound(Array(8).fill(4), rounds));
    const d8 = withTuning({ lineAcrossEnergy: across, lineDownAttack: down }, () => fleetRound(Array(8).fill(8), rounds));
    srows.push([`${across}⚡ / ${down} atk`, d4.value.toFixed(1), d8.value.toFixed(1), (d4.value / d8.value).toFixed(3)]);
  }
  table(["prizes", "8×d4 value", "8×d8 value", "d4 ÷ d8"], srows);
}

function modeHp(n) {
  console.log(`\n=== FLAGSHIP HEALTH AND MATCH LENGTH ===\n`);
  const rows = [];
  for (const hp of (process.env.HP_GRID ? JSON.parse(process.env.HP_GRID) : [45, 50, 55, 60, 70, 80])) {
    const h = withTuning({ hp }, () => healthCheck(Math.max(20, Math.round(n / 20))));
    rows.push([
      hp, h.mean.toFixed(1), `±${h.meanCi.toFixed(2)}`, h.median, `${h.min}–${h.max}`,
      pct(h.short), pct(h.inBand), pct(h.long), h.backstop, h.stuck, h.n,
    ]);
  }
  table(["hp", "mean rounds", "±", "median", "range", "under 7", "10-15", "over 15", "backstop", "unfinished", "matches"], rows);
}

function modeMarks(n) {
  console.log(`\n=== THE SMALL-FACE MARKS ===\n`);
  console.log(
    `Every face on a d4 pays a mark: 1 pays 2⚡, 2 pays 2 Direct, 3 repairs 3, 4 pays 1⚡.\n` +
    `That is why a d4 looks strong on paper. This measures how much of a d4's output\n` +
    `is marks, next to the bigger hulls.\n`,
  );
  const rounds = n * 4;
  const rows = [];
  for (const [label, fleet] of [["8 × d4", Array(8).fill(4)], ["8 × d6", Array(8).fill(6)],
    ["8 × d8", Array(8).fill(8)], ["8 × d10", Array(8).fill(10)]]) {
    const m = fleetRound(fleet, rounds);
    const marks = m.energy * 1.45 + m.heal * 0.95 + m.direct * 1.75;
    rows.push([
      label, m.attack.toFixed(1), m.defense.toFixed(1), m.energy.toFixed(1),
      m.heal.toFixed(1), m.direct.toFixed(2), marks.toFixed(1), m.value.toFixed(1),
      pct(marks / m.value),
    ]);
  }
  table(["fleet", "attack", "shields", "energy", "repair", "direct", "marks worth", "total value", "marks share"], rows);
}

function modeFinal(n) {
  console.log(`\n=== HEALTH CHECK AT THE CURRENT NUMBERS ===\n`);
  const h = healthCheck(n);
  table(["plan", "wins", "95% ci"], h.rates.map((r) => [PLAN_LABEL[r.plan], pct(r.rate), `±${ciPct(r.rate, r.n).toFixed(1)}`]));
  console.log(
    `\nSpread best to worst ${h.spread.toFixed(1)} ±${h.spreadCi.toFixed(1)} points over ${h.n} matches.\n` +
      `Match length mean ${h.mean.toFixed(1)} ±${h.meanCi.toFixed(2)}, median ${h.median}, range ${h.min}–${h.max}. ` +
      `Backstop hits ${h.backstop}.\n` +
      `Average final fleet ${h.ships.toFixed(1)} ships, ${h.cells.toFixed(1)} cells open, flagship level ${h.flags.toFixed(2)}.`,
  );
}


/* ------------------------------------------------------------------ */
/* More levers                                                         */
/* ------------------------------------------------------------------ */

function modeHulls(n) {
  console.log(`\n=== IS ANY HULL DEAD IN THE SHOP? ===\n`);
  console.log(
    `Side A opens a 5th cell and parks one hull in it. Side B spends the same\n` +
    `Energy on upgrades. 50% means that hull is priced right against upgrading.\n` +
    `${n} matches a row.\n`,
  );
  const rows = [];
  for (const sides of [4, 6, 8, 10]) {
    const spend = cellCost() + priceOf(sides);
    const rival = upgradePackage(spend);
    const r = duel(addShip(sides), chain(rival.setup, cash(spend - rival.cost)), n);
    rows.push([`cell + d${sides}`, spend, rival.label, pct(r.rate), `\u00b1${r.ci.toFixed(1)}`]);
  }
  table(["A buys", "\u26a1", "B buys", "A wins", "95% ci"], rows);

  console.log(`\nAnd against each other, cell already paid for. Same Energy on hulls:\n`);
  const rows2 = [];
  for (const [a, b] of [[4, 6], [6, 8], [8, 10], [4, 10]]) {
    const spend = priceOf(b) - priceOf(a);
    const r = duel(addShip(b), chain(addShip(a), cash(spend)), n);
    rows2.push([`d${b} in the cell`, `d${a} in the cell + ${spend}\u26a1`, pct(r.rate), `\u00b1${r.ci.toFixed(1)}`]);
  }
  table(["A", "B", "A wins", "95% ci"], rows2);
}

function modePrices(n) {
  console.log(`\n=== SHIP PRICES ===\n`);
  console.log(
    `Cheaper big hulls make upgrading cheaper too, because an upgrade costs the\n` +
    `difference. Does that close the gap between going wide and going big?\n` +
    `Side A opens a 5th cell with a d4; side B upgrades. ${n} matches a row.\n`,
  );
  const rows = [];
  for (const prices of [
    { 4: 4, 6: 6, 8: 9, 10: 13 },
    { 4: 4, 6: 6, 8: 8, 10: 11 },
    { 4: 4, 6: 5, 8: 7, 10: 9 },
    { 4: 5, 6: 7, 8: 10, 10: 14 },
  ]) {
    const out = withTuning({ prices }, () => {
      const spend = cellCost() + priceOf(4);
      const rival = upgradePackage(spend);
      return { d: duel(addShip(4), chain(rival.setup, cash(spend - rival.cost)), n), spend, rival: rival.label };
    });
    rows.push([
      [4, 6, 8, 10].map((k) => prices[k]).join("/"),
      [2, 3, 4].map((_, i) => prices[[6, 8, 10][i]] - prices[[4, 6, 8][i]]).join("/"),
      out.spend, out.rival, pct(out.d.rate), `\u00b1${out.d.ci.toFixed(1)}`,
    ]);
  }
  table(["prices d4/d6/d8/d10", "upgrade steps", "cell+d4 \u26a1", "B buys", "A wins", "95% ci"], rows);
}

function modeStart(n) {
  console.log(`\n=== HOW MANY CELLS SHOULD A COMMANDER START WITH? ===\n`);
  console.log(
    `Starting cells come with a free d4 each. More cells means more of the board in\n` +
    `play from round one, which is where rows and columns live.\n`,
  );
  const rows = [];
  for (const startSlots of [3, 4, 5, 6]) {
    const h = withTuning({ startSlots }, () => healthCheck(Math.max(20, Math.round(n / 20))));
    const line = withTuning({ startSlots }, () => fleetRound(Array(startSlots).fill(4), n * 4));
    rows.push([
      startSlots, h.mean.toFixed(1), `\u00b1${h.meanCi.toFixed(2)}`, h.median, `${h.min}\u2013${h.max}`, h.backstop,
      h.spread.toFixed(1), `\u00b1${h.spreadCi.toFixed(1)}`, h.ships.toFixed(1), h.cells.toFixed(1), pct(line.anyLine),
    ]);
  }
  table(["start cells", "mean rounds", "\u00b1", "median", "range", "backstop", "plan spread", "\u00b1", "final ships", "final cells", "line rate at start"], rows);
}

function modeEscalate(n) {
  console.log(`\n=== ESCALATION ===\n`);
  console.log(`Plain attack rises by a step each round after the war escalates.\n`);
  const rows = [];
  for (const [after, step] of [[8, 4], [8, 6], [7, 4], [6, 4], [10, 4], [8, 2], [6, 6]]) {
    const h = withTuning({ escalateAfterRound: after, escalateStep: step }, () => healthCheck(Math.max(20, Math.round(n / 20))));
    rows.push([
      `after ${after}, +${step}`, h.mean.toFixed(1), `\u00b1${h.meanCi.toFixed(2)}`, h.median,
      `${h.min}\u2013${h.max}`, h.backstop, h.spread.toFixed(1), `\u00b1${h.spreadCi.toFixed(1)}`,
    ]);
  }
  table(["escalation", "mean rounds", "\u00b1", "median", "range", "backstop", "plan spread", "\u00b1"], rows);
}

function modeRolls(n) {
  console.log(`\n=== FREE ROLLS A ROUND ===\n`);
  const rows = [];
  for (const rollsPerRound of [2, 3, 4]) {
    const h = withTuning({ rollsPerRound }, () => healthCheck(Math.max(20, Math.round(n / 20))));
    const out = withTuning({ rollsPerRound }, () => fleetRound([4, 6, 6, 8, 8, 8, 10, 10], n * 4));
    rows.push([
      rollsPerRound, h.mean.toFixed(1), `\u00b1${h.meanCi.toFixed(2)}`, h.median, h.backstop,
      h.spread.toFixed(1), `\u00b1${h.spreadCi.toFixed(1)}`, out.value.toFixed(1), pct(out.run), pct(out.anyLine),
    ]);
  }
  table(["free rolls", "mean rounds", "\u00b1", "median", "backstop", "plan spread", "\u00b1", "mixed fleet value", "straight", "line"], rows);
}

function modeReactorSweep(n) {
  console.log(`\n=== THE REACTOR, IF A COMMANDER ACTUALLY CHASED IT ===\n`);
  console.log(
    `The brain never chases a flagship 1, so the Reactor barely happens in a\n` +
    `simulated match. Here a commander is simply handed the income to see what it\n` +
    `would be worth if they did. ${n} matches a row.\n`,
  );
  const rows = [];
  for (const income of [1, 2, 3, 4, 6]) {
    const r = duel((p) => { p.baseEnergy = income; }, () => {}, n);
    rows.push([`+${income}\u26a1 every round, free`, pct(r.rate), `\u00b1${r.ci.toFixed(1)}`, r.rounds.toFixed(1)]);
  }
  table(["head start", "A wins", "95% ci", "rounds"], rows);
}


/** How often rows and columns actually fire in real matches, and what they pay. */
function modeLive(n) {
  console.log(`\n=== DO ROWS AND COLUMNS ACTUALLY FIRE IN A REAL MATCH? ===\n`);
  console.log(
    `The synthetic tables roll eight ships. Real commanders rarely have eight. This\n` +
    `counts every submitted round of ${n} real matches.\n`,
  );
  const rows = [];
  for (const startSlots of [4, 5, 6]) {
    const out = withTuning({ startSlots }, () => {
      let submits = 0, rowHit = 0, colHit = 0, anyHit = 0, runHit = 0;
      let energyFromRows = 0, attackFromCols = 0, totalAttack = 0, totalEnergy = 0;
      const ships = [], cells = [];
      for (let i = 0; i < n; i += 1) {
        setRng(makeRng(80021 + i * 7919));
        const state = newMatch("sw", "0000", "A", "A", "versus");
        state.players.guest = newPlayer("B", "B", "ready");
        state.status = "active";
        state.players.host.phase = "ready";
        const brains = {
          host: newBrain(PLANS[i % PLANS.length], "captain"),
          guest: newBrain(PLANS[(i + 2) % PLANS.length], "captain"),
        };
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
                  const t = state.players[side].tally;
                  if (!t) continue;
                  submits += 1;
                  const r = t.lines.filter((l) => l.kind === "row").length;
                  const c = t.lines.filter((l) => l.kind === "col").length;
                  if (r) rowHit += 1;
                  if (c) colHit += 1;
                  if (r || c) anyHit += 1;
                  if (t.run) runHit += 1;
                  energyFromRows += r * TUNING.lineAcrossEnergy;
                  attackFromCols += c * TUNING.lineDownAttack;
                  totalAttack += t.attack;
                  totalEnergy += t.energy;
                }
              } catch { /* stale */ }
            }
          }
          if (!moved) break;
        }
        for (const side of ["host", "guest"]) {
          ships.push(state.players[side].ships.length);
          cells.push(state.players[side].open.filter(Boolean).length);
        }
      }
      return { submits, rowHit, colHit, anyHit, runHit, energyFromRows, attackFromCols, totalAttack, totalEnergy, ships: meanOf(ships), cells: meanOf(cells) };
    });
    rows.push([
      startSlots, out.submits, out.ships.toFixed(1), out.cells.toFixed(1),
      pct(out.rowHit / out.submits), pct(out.colHit / out.submits), pct(out.anyHit / out.submits),
      pct(out.runHit / out.submits),
      pct(out.attackFromCols / out.totalAttack), pct(out.energyFromRows / out.totalEnergy),
    ]);
  }
  table(
    ["start cells", "rounds seen", "avg ships", "avg cells", "row fires", "col fires", "either", "straight fires", "col share of attack", "row share of energy"],
    rows,
  );
}

/** Flagship fairness on a narrow board and on a full one. */
function modeFlag2(n) {
  console.log(`\n=== FLAGSHIP, PRICED ON BOTH A NARROW AND A FULL BOARD ===\n`);
  console.log(
    `The flagship boosts matching ships, so it is worth more the more ships you own.\n` +
    `Priced only against a four-ship board it would be a bargain for a wide one.\n` +
    `Side B always spends the same Energy on upgrades. ${n} matches a row.\n`,
  );
  const wide = (p) => {
    for (let slot = 0; slot < 8; slot += 1) {
      p.open[slot] = true;
      if (!p.ships.some((s) => s.slot === slot)) p.ships.push({ id: `w${slot}`, sides: 6, disabledRound: null, slot });
    }
    for (const ship of p.ships) ship.sides = 6;
  };
  const rows = [];
  const grid = (process.env.FLAG_GRID || "").length
    ? JSON.parse(process.env.FLAG_GRID)
    : [
        [[2, 3, 4], 10, 16],
        [[2, 3, 4], 7, 9],
        [[2, 3, 4], 6, 10],
        [[2, 4, 6], 10, 16],
        [[2, 4, 6], 10, 13],
        [[2, 4, 6], 8, 12],
        [[2, 4, 5], 8, 12],
      ];
  for (const [bonus, c1, c2] of grid) {
    const out = withTuning({ flagBonus: { 1: bonus[0], 2: bonus[1], 3: bonus[2] }, flagCost: { 1: c1, 2: c2 } }, () => {
      const r2 = upgradePackage(c1);
      const r3 = upgradePackage(c1 + c2);
      const narrow2 = duel(flagTo(2), chain(r2.setup, cash(c1 - r2.cost)), n);
      const narrow3 = duel(flagTo(3), chain(r3.setup, cash(c1 + c2 - r3.cost)), n);
      const wide2 = duel(chain(wide, flagTo(2)), chain(wide, cash(c1)), n);
      const wide3 = duel(chain(wide, flagTo(3)), chain(wide, cash(c1 + c2)), n);
      return { narrow2, narrow3, wide2, wide3 };
    });
    rows.push([
      bonus.join("/"), `${c1}+${c2}`,
      pct(out.narrow2.rate), pct(out.narrow3.rate),
      pct(out.wide2.rate), pct(out.wide3.rate),
      `\u00b1${out.narrow2.ci.toFixed(1)}`,
    ]);
  }
  table(["bonus", "costs", "lvl2 narrow", "lvl3 narrow", "lvl2 wide", "lvl3 wide", "95% ci"], rows);
}


/**
 * The Reactor chaser. The brain never hunts a flagship 1 because its scoring
 * only looks at this round, and the Reactor pays every round after. This forces
 * a commander to hunt it, to see whether that is a strategy the game cannot
 * answer.
 */
function reactorChaser(state, side, actions) {
  const player = state.players[side];
  if (player.phase !== "rolling") return actions;
  const flag = player.dice.find((d) => d.flag);
  if (!flag || flag.value === 1) return actions;
  if (player.baseEnergy >= TUNING.reactorCap + 0) {
    // Cap reached; the overflow still pays, so keep hunting.
  }
  const free = player.rolls < TUNING.rollsPerRound;
  // The token can step the flagship one face; use it when it lands on a 1.
  if (!free && player.flag.token && (flag.value === 2 || flag.value === 6)) {
    return [{ type: "flag-token", direction: flag.value === 2 ? -1 : 1 }, ...actions.filter((a) => a.type !== "flag-token")];
  }
  if (!free) return actions;
  const roll = actions.find((a) => a.type === "roll");
  if (roll) {
    if (!roll.dice.includes("flag")) return [{ type: "roll", dice: [...roll.dice, "flag"] }];
    return actions;
  }
  return [{ type: "roll", dice: ["flag"] }, ...actions];
}

function modeChaser(n) {
  console.log(`\n=== A STRATEGY THE BRAIN CANNOT SEE: CHASING THE REACTOR ===\n`);
  console.log(
    `A flagship 1 raises income for the rest of the match. The brain scores only the\n` +
    `round in front of it, so it never hunts one. Here a commander does. ${n} matches a row.\n`,
  );
  const rows = [];
  for (const [cap, over] of [[TUNING.reactorCap, TUNING.reactorOverflow], [4, 2], [2, 2], [6, 0], [4, 1]]) {
    const out = withTuning({ reactorCap: cap, reactorOverflow: over }, () =>
      duel(() => {}, () => {}, n, reactorChaser),
    );
    rows.push([`cap ${cap}, overflow ${over}`, pct(out.rate), `\u00b1${out.ci.toFixed(1)}`, out.rounds.toFixed(1)]);
  }
  table(["reactor settings", "the chaser wins", "95% ci", "rounds"], rows);

  console.log(`\nAnd with a bigger flagship bonus, which is also the Reactor's step:\n`);
  const rows2 = [];
  for (const bonus of [[2, 3, 4], [2, 4, 6]]) {
    for (const cap of [6, 4]) {
      const out = withTuning({ flagBonus: { 1: bonus[0], 2: bonus[1], 3: bonus[2] }, reactorCap: cap }, () =>
        duel(() => {}, () => {}, n, reactorChaser),
      );
      rows2.push([bonus.join("/"), cap, pct(out.rate), `\u00b1${out.ci.toFixed(1)}`]);
    }
  }
  table(["flag bonus", "reactor cap", "the chaser wins", "95% ci"], rows2);
}


/* ------------------------------------------------------------------ */
/* Closing the plan spread                                             */
/* ------------------------------------------------------------------ */

/** Full plan table at one setting, with the spread and an honest error bar. */
function spreadAt(label, patch, perPair) {
  const h = withTuning(patch, () => healthCheck(perPair));
  return { label, h };
}

function printSpread(rows) {
  table(
    ["setting", ...PLANS.map((p) => PLAN_LABEL[p]), "spread", "\u00b1", "rounds", "under 7", "over 15", "backstop", "ships", "cells", "flag"],
    rows.map(({ label, h }) => {
      const byPlan = Object.fromEntries(h.rates.map((r) => [r.plan, r.rate]));
      return [
        label,
        ...PLANS.map((p) => pct(byPlan[p])),
        h.spread.toFixed(1), `\u00b1${h.spreadCi.toFixed(1)}`,
        h.mean.toFixed(1), pct(h.short), pct(h.long), h.backstop,
        h.ships.toFixed(1), h.cells.toFixed(1), h.flags.toFixed(2),
      ];
    }),
  );
}

function modeSpread(n) {
  const perPair = Math.max(40, Math.round(n / 20));
  console.log(`\n=== WHAT CLOSES THE PLAN SPREAD? — ${perPair} matches a pairing (${perPair * 20} a row) ===\n`);
  console.log(
    `Wolfpack and Formation buy cells; Capital and Command buy size. If the wide\n` +
    `plans win, the cell ladder is too cheap. These are the candidate numbers.\n`,
  );
  const which = process.env.SPREAD_WHICH || "slot";
  const rows = [];
  if (process.env.SPREAD_ONE) {
    const [label, patch] = JSON.parse(process.env.SPREAD_ONE);
    printSpread([spreadAt(label, patch, perPair)]);
    return;
  }
  if (which === "slot") {
    for (const offset of [2, 4, 5, 6, 7, 8, 10]) {
      rows.push(spreadAt(`cells +${offset}`, { slotCostOffset: offset }, perPair));
    }
  } else if (which === "prices") {
    for (const prices of [
      { 4: 4, 6: 6, 8: 9, 10: 13 },
      { 4: 4, 6: 6, 8: 8, 10: 11 },
      { 4: 5, 6: 7, 8: 9, 10: 12 },
      { 4: 5, 6: 6, 8: 8, 10: 11 },
      { 4: 6, 6: 8, 8: 11, 10: 15 },
    ]) {
      rows.push(spreadAt([4, 6, 8, 10].map((k) => prices[k]).join("/"), { prices }, perPair));
    }
  } else if (which === "combo") {
    rows.push(spreadAt("as shipped", {}, perPair));
    for (const offset of [5, 6, 7]) {
      rows.push(spreadAt(`cells +${offset}`, { slotCostOffset: offset }, perPair));
    }
    for (const startSlots of [5, 6]) {
      rows.push(spreadAt(`start ${startSlots}, cells +6`, { startSlots, slotCostOffset: 6 }, perPair));
    }
  }
  printSpread(rows);
  console.log(
    `\nThe spread's own error bar is roughly \u00b1${rows[0].h.spreadCi.toFixed(1)} here. A spread inside\n` +
    `that of 12 is fine; anything well above it is a plan that dominates.`,
  );
}

/** Do the difficulty tiers actually differ? */
function modeDifficulty(n) {
  console.log(`\n=== DO THE DIFFICULTY TIERS MEAN ANYTHING? ===\n`);
  console.log(
    `Each pairing plays ${n} matches, plans drawn evenly on both sides, so the only\n` +
    `difference between the two commanders is how hard they think.\n`,
  );
  const tiers = ["cadet", "captain", "admiral"];
  const rows = [];
  for (const a of tiers) {
    const row = [DIFFICULTY_LABEL(a)];
    for (const b of tiers) {
      if (a === b) { row.push("\u2014"); continue; }
      let wins = 0;
      for (let i = 0; i < n; i += 1) {
        const swap = i % 2 === 1;
        const p = PLANS[i % PLANS.length];
        const q = PLANS[(i + 2) % PLANS.length];
        const r = swap
          ? fullMatchD(q, b, p, a, 30011 + i * 7919)
          : fullMatchD(p, a, q, b, 30011 + i * 7919);
        const side = swap ? "guest" : "host";
        if (r.winner === side) wins += 1;
        else if (r.winner === "draw") wins += 0.5;
      }
      const rate = wins / n;
      row.push(`${pct(rate)} \u00b1${ciPct(rate, n).toFixed(1)}`);
    }
    rows.push(row);
  }
  table(["A \\ vs B", ...tiers.map(DIFFICULTY_LABEL)], rows);
  console.log(
    `\nRead a row left to right: how often that tier beats each other tier. Admiral\n` +
    `should beat Captain, and Captain should beat Cadet, by a clear margin.`,
  );
}
const DIFFICULTY_LABEL = (t) => t[0].toUpperCase() + t.slice(1);

/** A full match where each side has its own difficulty. */
function fullMatchD(planA, diffA, planB, diffB, seed) {
  setRng(makeRng(seed));
  const state = newMatch("sw", "0000", "A", "A", "versus");
  state.players.guest = newPlayer("B", "B", "ready");
  state.status = "active";
  state.players.host.phase = "ready";
  const brains = { host: newBrain(planA, diffA), guest: newBrain(planB, diffB) };
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
  return { winner: state.winner, rounds: Math.max(state.players.host.round, state.players.guest.round) };
}

/* ------------------------------------------------------------------ */

const mode = process.argv[2] ?? "final";
const n = Number(process.argv[3]) || 300;

console.log("Fleet Dice 3 — tuning sweeps");
console.log(
  `HP ${TUNING.hp} · prices ${JSON.stringify(TUNING.prices)} · cells +${TUNING.slotCostOffset} · ` +
  `flag ${JSON.stringify(TUNING.flagCost)} bonus ${JSON.stringify(TUNING.flagBonus)}`,
);

if (mode === "runtake") modeRunTake(n);
if (mode === "straight") modeStraightSweep(n);
if (mode === "flag") modeFlag(n);
if (mode === "slot") modeSlot(n);
if (mode === "lines") modeLines(n);
if (mode === "hp") modeHp(n);
if (mode === "marks") modeMarks(n);
if (mode === "hulls") modeHulls(n);
if (mode === "prices") modePrices(n);
if (mode === "start") modeStart(n);
if (mode === "escalate") modeEscalate(n);
if (mode === "rolls") modeRolls(n);
if (mode === "reactor") modeReactorSweep(n);
const startOverride = Number(process.env.START_SLOTS || 0);
if (startOverride) TUNING.startSlots = startOverride;
if (process.env.FLAG_COST) { const v = JSON.parse(process.env.FLAG_COST); TUNING.flagCost = { 1: v[0], 2: v[1] }; }
if (mode === "spread") modeSpread(n);
if (mode === "difficulty") modeDifficulty(n);
if (mode === "chaser") modeChaser(n);
if (mode === "live") modeLive(n);
if (mode === "flag2") modeFlag2(n);
if (mode === "final") modeFinal(n);
console.log("");
