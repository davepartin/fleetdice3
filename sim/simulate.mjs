/**
 * The measuring stick.
 *
 * Nearly every design instinct in this project has been wrong at least once, so
 * nothing goes into Fleet Dice 3 on a hunch. This harness plays the real engine
 * — the exact code the browser runs — thousands of times and reports what
 * actually happens.
 *
 *   node sim/simulate.mjs              full report
 *   node sim/simulate.mjs matchups 400 head-to-head win rates, 400 per pairing
 *   node sim/simulate.mjs output       what a fleet of one size produces
 *   node sim/simulate.mjs rounds       match length and damage curve
 *   node sim/simulate.mjs faces        what each face is worth
 *   node sim/simulate.mjs ladder       is each upgrade worth its Energy?
 *
 * Deeper questions live next door:
 *   node sim/lab.mjs   fair | spend | arena | purchases | live   the economy
 *   node sim/sweep.mjs flag | slot | hp | live | chaser          what-ifs
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
  nextActions,
  setRng,
  tally,
  priceOf,
  valueOfTally,
} = G;

/* ------------------------------------------------------------------ */

/** Play one match to the end with both sides driven by the brain. */
export function playMatch(planA, planB, difficulty = "medium", seed = 0) {
  if (seed) setRng(makeRng(seed));
  const state = newMatch("sim", "0000", "A", "A", "versus");
  state.players.guest = G.newPlayer("B", "B", "ready");
  state.status = "active";
  state.players.host.phase = "ready";

  const brains = {
    host: newBrain(planA, difficulty),
    guest: newBrain(planB, difficulty),
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
          applyAction(state, side, action);
          moved = true;
        } catch {
          // An action that is no longer legal (the match ended under us) is fine.
        }
      }
    }
    if (!moved) break;
  }

  return {
    winner: state.winner,
    rounds: Math.max(state.players.host.round, state.players.guest.round),
    hostHp: state.players.host.hp,
    guestHp: state.players.guest.hp,
    hostShips: state.players.host.ships.length,
    guestShips: state.players.guest.ships.length,
    hostFleet: state.players.host.ships.map((s) => s.sides).sort((a, b) => a - b),
    guestFleet: state.players.guest.ships.map((s) => s.sides).sort((a, b) => a - b),
    hostFlag: state.players.host.flag.level,
    guestFlag: state.players.guest.flag.level,
    hostStats: state.players.host.stats,
    guestStats: state.players.guest.stats,
  };
}

/* ------------------------------------------------------------------ */

function pct(n) {
  return `${(n * 100).toFixed(1)}%`;
}
function pad(text, width, right = false) {
  const value = String(text);
  return right ? value.padStart(width) : value.padEnd(width);
}
function table(headers, rows) {
  const widths = headers.map((header, index) =>
    Math.max(String(header).length, ...rows.map((row) => String(row[index]).length)),
  );
  const line = (cells, right) =>
    cells.map((cell, index) => pad(cell, widths[index], right && index > 0)).join("  ");
  console.log(line(headers, false));
  console.log(widths.map((width) => "-".repeat(width)).join("  "));
  for (const row of rows) console.log(line(row, true));
}

/** 95% confidence half-width for a proportion. */
function ci(p, n) {
  return 1.96 * Math.sqrt((p * (1 - p)) / Math.max(1, n));
}

/* ------------------------------------------------------------------ */
/* Head to head                                                        */
/* ------------------------------------------------------------------ */

function matchups(perPair = 200, difficulty = "medium") {
  console.log(`\n=== HEAD TO HEAD — ${perPair} matches per pairing, ${difficulty} ===\n`);
  const wins = Object.fromEntries(PLANS.map((plan) => [plan, { w: 0, n: 0 }]));
  const roundLengths = [];
  let seed = 1;

  const rows = [];
  for (const a of PLANS) {
    const row = [PLAN_LABEL[a]];
    for (const b of PLANS) {
      if (a === b) {
        row.push("—");
        continue;
      }
      let aWins = 0;
      for (let i = 0; i < perPair; i += 1) {
        seed += 1;
        const result = playMatch(a, b, difficulty, seed);
        roundLengths.push(result.rounds);
        if (result.winner === "host") aWins += 1;
        else if (result.winner === "draw") aWins += 0.5;
      }
      wins[a].w += aWins;
      wins[a].n += perPair;
      wins[b].w += perPair - aWins;
      wins[b].n += perPair;
      row.push(pct(aWins / perPair));
    }
    rows.push(row);
  }
  table(["plan \\ vs", ...PLANS.map((plan) => PLAN_LABEL[plan])], rows);

  console.log("\nOverall win rate (each plan against the whole field):\n");
  const overall = PLANS.map((plan) => {
    const rate = wins[plan].w / wins[plan].n;
    return [PLAN_LABEL[plan], pct(rate), `±${(ci(rate, wins[plan].n) * 100).toFixed(1)}`, wins[plan].n];
  }).sort((a, b) => parseFloat(b[1]) - parseFloat(a[1]));
  table(["plan", "wins", "95% ci", "matches"], overall);

  const spread = parseFloat(overall[0][1]) - parseFloat(overall[overall.length - 1][1]);
  roundLengths.sort((a, b) => a - b);
  const mean = roundLengths.reduce((s, n) => s + n, 0) / roundLengths.length;
  console.log(
    `\nSpread best to worst: ${spread.toFixed(1)} points. ` +
      `Match length: mean ${mean.toFixed(1)} rounds, median ${roundLengths[Math.floor(roundLengths.length / 2)]}, ` +
      `range ${roundLengths[0]}–${roundLengths[roundLengths.length - 1]}.`,
  );
  const long = roundLengths.filter((r) => r >= TUNING.roundLimit).length;
  if (long) console.log(`WARNING: ${long} matches hit the ${TUNING.roundLimit}-round backstop.`);
  return { spread, mean };
}

/* ------------------------------------------------------------------ */
/* What a fleet produces                                               */
/* ------------------------------------------------------------------ */

function fleetOutput(rounds = 6000) {
  console.log(`\n=== WHAT A FLEET PRODUCES A ROUND — ${rounds} rounds each ===\n`);
  console.log("Eight ships of one size, three rolls, played by the Captain brain.\n");
  const rows = [];
  for (const sides of [4, 6, 8, 10]) {
    const totals = { attack: 0, defense: 0, energy: 0, heal: 0, direct: 0, run: 0, lines: 0, value: 0 };
    for (let i = 0; i < rounds; i += 1) {
      const player = G.newPlayer("x", "x", "ready");
      player.open = Array(8).fill(true);
      player.ships = Array.from({ length: 8 }, (_, slot) => ({
        id: `s${slot}`,
        sides,
        disabledRound: null,
        slot,
      }));
      const state = { status: "active", round: 1, players: { host: player, guest: null } };
      applyAction(state, "host", { type: "roll", dice: [] });
      const brain = newBrain("balanced", "medium");
      for (let r = 0; r < 2; r += 1) {
        const reroll = G.chooseReroll(player, { samples: 24, candidates: 8, greed: 1, pressure: 0.3 });
        if (reroll.length) applyAction(state, "host", { type: "roll", dice: reroll });
      }
      const take = G.chooseStraightTake(player, 0.3);
      const t = tally(player.dice, 1, take);
      totals.attack += t.attack;
      totals.defense += t.defense;
      totals.energy += t.energy;
      totals.heal += t.heal;
      totals.direct += t.direct;
      totals.run += t.run ? 1 : 0;
      totals.lines += t.lines.length ? 1 : 0;
      totals.value += valueOfTally(t);
      void brain;
    }
    rows.push([
      `8 × d${sides}`,
      `${priceOf(sides) * 8}`,
      (totals.attack / rounds).toFixed(1),
      (totals.defense / rounds).toFixed(1),
      (totals.energy / rounds).toFixed(1),
      (totals.heal / rounds).toFixed(1),
      (totals.direct / rounds).toFixed(2),
      pct(totals.run / rounds),
      pct(totals.lines / rounds),
      (totals.value / rounds).toFixed(1),
      (totals.value / rounds / (priceOf(sides) * 8)).toFixed(3),
    ]);
  }
  table(
    ["fleet", "cost", "attack", "shields", "energy", "repair", "direct", "straight", "formation", "value", "per ⚡"],
    rows,
  );
  console.log(
    "\nCareful with the last two columns. `value` is the AI's opinion of a roll, not\n" +
      "a win rate. It prices Energy at 1.45 a point, which flatters small ships,\n" +
      "because they roll the marks. It once made the d4 → d6 upgrade look like a trap.\n" +
      "It is not. Use `node sim/simulate.mjs ladder` for the version that fights.",
  );
}

/* ------------------------------------------------------------------ */
/* The upgrade ladder — measured by fighting, not by opinion           */
/* ------------------------------------------------------------------ */

/** One match with both fleets frozen and the shipyard shut. */
function arenaMatch(fleetA, fleetB, seed) {
  setRng(makeRng(seed));
  const build = (uid, fleet) => {
    const player = G.newPlayer(uid, uid, "ready");
    player.open = Array.from({ length: 8 }, (_, i) => i < fleet.length);
    player.ships = fleet.map((sides, slot) => ({ id: `${uid}${slot}`, sides, disabledRound: null, slot }));
    player.baseEnergy = 2; // enough for paid rerolls, never enough to change the fleet
    return player;
  };
  const state = newMatch("sim", "0000", "A", "A", "versus");
  state.players.host = build("A", fleetA);
  state.players.guest = build("B", fleetB);
  state.status = "active";
  state.players.host.phase = "ready";
  state.players.guest.phase = "ready";
  const brains = { host: newBrain("balanced", "medium"), guest: newBrain("balanced", "medium") };
  let guard = 0;
  while (state.status !== "finished" && guard < 4000) {
    guard += 1;
    let moved = false;
    for (const side of ["host", "guest"]) {
      const player = state.players[side];
      const actions = player.phase === "shop" ? [{ type: "ready" }] : nextActions(state, side, brains[side]);
      for (const action of actions) {
        if (state.status === "finished") break;
        try {
          applyAction(state, side, action);
          moved = true;
        } catch {
          // the match ended under us
        }
      }
    }
    if (!moved) break;
  }
  return state.winner;
}

/** Win rate of fleet A against fleet B, sides swapped every other match. */
function arena(fleetA, fleetB, n) {
  let wins = 0;
  for (let i = 0; i < n; i += 1) {
    const swap = i % 2 === 1;
    const winner = arenaMatch(swap ? fleetB : fleetA, swap ? fleetA : fleetB, 90001 + i * 7919);
    const side = swap ? "guest" : "host";
    if (winner === side) wins += 1;
    else if (winner === "draw") wins += 0.5;
  }
  const rate = wins / n;
  return { rate, ci: ci(rate, n) * 100 };
}

function ladder(n = 400) {
  console.log(`\n=== IS EACH UPGRADE WORTH ITS ENERGY? — ${n} matches a step ===\n`);
  console.log(
    "Eight ships of one size against the same eight, one size bigger. No shopping,\n" +
      "so the only thing being measured is what the hulls do in a fight.\n",
  );
  const rows = [];
  for (const [lo, hi] of [[4, 6], [6, 8], [8, 10]]) {
    const spend = (priceOf(hi) - priceOf(lo)) * 8;
    const r = arena(Array(8).fill(hi), Array(8).fill(lo), n);
    rows.push([
      `8 × d${lo} → 8 × d${hi}`,
      spend,
      priceOf(hi) - priceOf(lo),
      pct(r.rate),
      `±${r.ci.toFixed(1)}`,
      (((r.rate - 0.5) * 100) / spend).toFixed(2),
    ]);
  }
  table(["step", "⚡ for all 8", "⚡ each", "upgraded fleet wins", "95% ci", "win points per ⚡"], rows);
  console.log(
    "\nEvery step should be well above 50%, and the win points per Energy should not\n" +
      "collapse at any rung. If one rung is near 50% the game is asking players to\n" +
      "pay for nothing.\n\nFor the shop as a whole — cells, hulls, the flagship — run\n" +
      "  node sim/lab.mjs fair 800\n  node sim/lab.mjs spend 400",
  );
}

/* ------------------------------------------------------------------ */
/* Face economics                                                      */
/* ------------------------------------------------------------------ */

function faces() {
  console.log("\n=== WHAT EACH FACE IS WORTH ===\n");
  const rows = [];
  for (let value = 1; value <= 10; value += 1) {
    const attack = G.attackOf(value);
    const defense = G.defenseOf(value);
    const energy = G.energyOf(value);
    const heal = G.repairOf(value);
    const direct = G.directOf(value);
    const worth =
      attack * 1 + defense * 0.62 + energy * 1.45 + heal * 0.95 + direct * 1.75;
    rows.push([
      value,
      value % 2 === 0 ? "hits" : "blocks",
      value,
      energy || "",
      heal || "",
      direct || "",
      worth.toFixed(2),
    ]);
  }
  table(["face", "fights", "for", "energy", "repair", "direct", "worth"], rows);

  console.log("\nAverage worth of one roll of each ship size:\n");
  const sizeRows = [];
  for (const sides of [4, 6, 8, 10]) {
    let total = 0;
    for (let value = 1; value <= sides; value += 1) {
      total +=
        G.attackOf(value) * 1 +
        G.defenseOf(value) * 0.62 +
        G.energyOf(value) * 1.45 +
        G.repairOf(value) * 0.95 +
        G.directOf(value) * 1.75;
    }
    const avg = total / sides;
    sizeRows.push([`d${sides}`, priceOf(sides), avg.toFixed(2), (avg / priceOf(sides)).toFixed(3)]);
  }
  table(["ship", "cost", "avg worth", "per ⚡"], sizeRows);
}

/* ------------------------------------------------------------------ */
/* Match shape                                                         */
/* ------------------------------------------------------------------ */

function rounds(count = 300) {
  console.log(`\n=== MATCH SHAPE — ${count} matches ===\n`);
  const lengths = [];
  const fleets = [];
  const flagLevels = [];
  let seed = 5000;
  for (let i = 0; i < count; i += 1) {
    seed += 1;
    const plan = PLANS[i % PLANS.length];
    const other = PLANS[(i + 2) % PLANS.length];
    const result = playMatch(plan, other, "medium", seed);
    lengths.push(result.rounds);
    fleets.push(result.hostFleet.length, result.guestFleet.length);
    flagLevels.push(result.hostFlag, result.guestFlag);
  }
  lengths.sort((a, b) => a - b);
  const mean = lengths.reduce((s, n) => s + n, 0) / lengths.length;
  const buckets = new Map();
  for (const length of lengths) {
    const bucket = length <= 6 ? "≤6" : length <= 9 ? "7–9" : length <= 13 ? "10–13" : length <= 20 ? "14–20" : "21+";
    buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
  }
  table(
    ["length", "matches", "share"],
    ["≤6", "7–9", "10–13", "14–20", "21+"].map((bucket) => [
      bucket,
      buckets.get(bucket) ?? 0,
      pct((buckets.get(bucket) ?? 0) / lengths.length),
    ]),
  );
  console.log(
    `\nMean ${mean.toFixed(1)} rounds. Median ${lengths[Math.floor(lengths.length / 2)]}. ` +
      `Average final fleet ${(fleets.reduce((s, n) => s + n, 0) / fleets.length).toFixed(1)} ships, ` +
      `average flagship level ${(flagLevels.reduce((s, n) => s + n, 0) / flagLevels.length).toFixed(2)}.`,
  );
}

/* ------------------------------------------------------------------ */

if (process.env.START_SLOTS) TUNING.startSlots = Number(process.env.START_SLOTS);
if (process.env.FLAG_COST) { const v = JSON.parse(process.env.FLAG_COST); TUNING.flagCost = { 1: v[0], 2: v[1] }; } // BASE_TUNING
const mode = process.argv[2] ?? "all";
const size = Number(process.argv[3]) || 0;

console.log("Fleet Dice 3 — engine measurements");
console.log(
  `HP ${TUNING.hp} · straight needs ${TUNING.runMin} · across ${TUNING.lineAcrossEnergy}⚡ · down ${TUNING.lineDownAttack} attack · escalates after round ${TUNING.escalateAfterRound}`,
);

if (mode === "all" || mode === "faces") faces();
if (mode === "all" || mode === "output") fleetOutput(size || 4000);
if (mode === "all" || mode === "ladder") ladder(size || 400);
if (mode === "all" || mode === "matchups") matchups(size || 120);
if (mode === "all" || mode === "rounds") rounds(size || 200);
console.log("");
