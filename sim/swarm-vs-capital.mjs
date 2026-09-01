/**
 * Nine d4s chasing matching numbers, against big hulls chasing straights.
 *
 * Both sides are written out here rather than borrowed from lib/ai.ts, because
 * the question is about two strategies a person would actually commit to for a
 * whole match, not about what a general-purpose brain settles on.
 *
 *   SWARM   opens every bay, buys nothing but d4s, never upgrades, and spends
 *           its rerolls — free and paid — forcing the board onto one number.
 *   CAPITAL upgrades toward d8s and d10s, keeps a small fleet, chases straights
 *           and raw attack, and feeds hulls into volleys to stay alive.
 *
 *   node sim/swarm-vs-capital.mjs [matches]
 *
 * READ THE CONTROL BEFORE QUOTING THIS. The swarm wins here about 90% of the
 * time, and that number means very little on its own: CAPITAL below lands
 * roughly a quarter of a straight per match, so it almost never does the thing
 * it is built around. Run sim/swarm-vs-ai.mjs, where the same swarm meets the
 * game's Expert brain and loses about 73% — which is the answer to "is the
 * swarm too strong". This file measures how the two ideas trade, not how
 * strong either one is.
 */
import { bundlePath } from "./bundle.mjs";
const G = await import(bundlePath);
const {
  TUNING, applyAction, makeRng, newMatch, newPlayer, setRng,
  tally, bestRun, activeShips, emptyOpenSlots, nextSlotCost, priceOf,
  upgradeCost, upgradeTarget, flagshipUpgradeCost, shipInSlot,
} = G;

const N = Number(process.argv[2] ?? 400);

/* ---------------- shopping ---------------- */

function shopSwarm(player) {
  // Every bay open, every bay holding a d4. Nothing else, ever — the whole
  // plan is more dice showing the same number.
  const acts = [];
  const cash = { energy: player.energy };
  for (let step = 0; step < 10; step += 1) {
    const empty = emptyOpenSlots(player).filter(
      (slot) => !acts.some((a) => a.operation === "buy" && a.slotIndex === slot),
    );
    if (empty.length && cash.energy >= priceOf(4)) {
      acts.push({ type: "shop", operation: "buy", sides: 4, slotIndex: empty[0] });
      cash.energy -= priceOf(4);
      continue;
    }
    const slotCost = nextSlotCost(player);
    if (slotCost !== null && cash.energy >= slotCost + priceOf(4)) {
      const closed = [0, 1, 2, 3, 4, 5, 6, 7].find(
        (s) => !player.open[s] && !acts.some((a) => a.operation === "slot" && a.slotIndex === s),
      );
      if (closed === undefined) break;
      acts.push({ type: "shop", operation: "slot", slotIndex: closed });
      cash.energy -= slotCost;
      continue;
    }
    break;
  }
  return acts;
}

function shopCapital(player) {
  // Size over count: upgrade what is already there, and only open a bay when
  // there is nothing left worth upgrading.
  const acts = [];
  let energy = player.energy;
  for (let step = 0; step < 8; step += 1) {
    const up = player.ships
      .filter((sh) => upgradeTarget(sh.sides) !== null)
      .filter((sh) => !acts.some((a) => a.operation === "upgrade" && a.shipId === sh.id))
      .sort((a, b) => b.sides - a.sides)[0];
    const upCost = up ? upgradeCost(up.sides) : null;
    if (up && upCost !== null && energy >= upCost) {
      acts.push({ type: "shop", operation: "upgrade", shipId: up.id });
      energy -= upCost;
      continue;
    }
    const empty = emptyOpenSlots(player).filter(
      (slot) => !acts.some((a) => a.operation === "buy" && a.slotIndex === slot),
    );
    if (empty.length) {
      const afford = [10, 8, 6, 4].find((sides) => energy >= priceOf(sides));
      if (afford) {
        acts.push({ type: "shop", operation: "buy", sides: afford, slotIndex: empty[0] });
        energy -= priceOf(afford);
        continue;
      }
    }
    const slotCost = nextSlotCost(player);
    if (player.ships.length < 5 && slotCost !== null && energy >= slotCost + priceOf(6)) {
      const closed = [0, 1, 2, 3, 4, 5, 6, 7].find(
        (s) => !player.open[s] && !acts.some((a) => a.operation === "slot" && a.slotIndex === s),
      );
      if (closed !== undefined) {
        acts.push({ type: "shop", operation: "slot", slotIndex: closed });
        energy -= slotCost;
        continue;
      }
    }
    const flagCost = flagshipUpgradeCost(player.flag.level);
    if (flagCost !== null && energy >= flagCost) {
      acts.push({ type: "shop", operation: "flagship" });
      energy -= flagCost;
      continue;
    }
    break;
  }
  return acts;
}

/* ---------------- rerolling ---------------- */

function rerollSwarm(player) {
  // Keep whichever number appears most and send everything else back. The
  // flagship counts: it sits in the middle cell, so it is part of two lines.
  const counts = new Map();
  for (const die of player.dice) counts.set(die.value, (counts.get(die.value) ?? 0) + 1);
  let best = null;
  let bestCount = -1;
  for (const [value, count] of counts) {
    // Ties go to the number the most hulls can actually roll.
    if (count > bestCount || (count === bestCount && value < best)) { best = value; bestCount = count; }
  }
  return player.dice.filter((d) => d.value !== best).map((d) => d.id);
}

function rerollCapital(player) {
  // Hold the longest run and the biggest even face; send back the rest.
  const run = bestRun(player.dice);
  const keep = new Set();
  if (run) {
    const wanted = new Set();
    for (let v = run.start; v <= run.top; v += 1) wanted.add(v);
    for (const die of player.dice) if (wanted.has(die.value) && !keep.has(die.value)) keep.add(die.id);
  }
  for (const die of player.dice) {
    // A big even face is real damage; a big odd face is real shielding.
    if (die.value >= 6) keep.add(die.id);
  }
  return player.dice.filter((d) => !keep.has(d.id)).map((d) => d.id);
}

/* ---------------- blocking ---------------- */

function braceSwarm(player) {
  // Nine hulls is the plan; spending them costs the next round's matching.
  // Only pay when the volley would otherwise finish the flagship.
  const repair = player.tally?.heal ?? 0;
  if (player.hp + repair - (player.incoming + player.directIncoming) > 0) return [];
  const ships = activeShips(player, player.round).slice().sort((a, b) => a.sides - b.sides);
  const chosen = [];
  let blocked = 0;
  for (const ship of ships) {
    if (player.hp + repair - (Math.max(0, player.incoming - blocked) + player.directIncoming) > 0) break;
    chosen.push(ship.id);
    blocked += ship.sides;
  }
  return chosen;
}

function braceCapital(player) {
  // Hulls are armour here: spend them whenever the volley would cost more
  // health than the ship is worth sitting out a round.
  const repair = player.tally?.heal ?? 0;
  const ships = activeShips(player, player.round).slice().sort((a, b) => b.sides - a.sides);
  const chosen = [];
  let blocked = 0;
  for (const ship of ships) {
    const landing = Math.max(0, player.incoming - blocked) + player.directIncoming;
    if (landing <= 0) break;
    const fatal = player.hp + repair - landing <= 0;
    if (fatal || landing >= ship.sides) {
      chosen.push(ship.id);
      blocked += ship.sides;
    } else break;
  }
  return chosen;
}

const SIDES = {
  swarm: { shop: shopSwarm, reroll: rerollSwarm, brace: braceSwarm, paidRerolls: true },
  capital: { shop: shopCapital, reroll: rerollCapital, brace: braceCapital, paidRerolls: false },
};

/* ---------------- driving a match ---------------- */

function play(state, side, who) {
  const player = state.players[side];
  const style = SIDES[who];
  switch (player.phase) {
    case "shop": {
      for (const act of style.shop(player)) {
        try { applyAction(state, side, act); } catch { /* priced out mid-plan */ }
      }
      applyAction(state, side, { type: "ready" });
      return;
    }
    case "ready":
      applyAction(state, side, { type: "roll", dice: [] });
      return;
    case "rolling": {
      const free = player.rolls < TUNING.rollsPerRound;
      let ids = style.reroll(player);
      if (ids.length && !free && style.paidRerolls) ids = ids.slice(0, Math.max(0, player.energy));
      if (ids.length && (free || (style.paidRerolls && ids.length <= player.energy))) {
        applyAction(state, side, { type: "roll", dice: ids });
        return;
      }
      applyAction(state, side, { type: "submit" });
      return;
    }
    case "brace":
      applyAction(state, side, { type: "brace", ships: style.brace(player) });
      return;
    case "report":
      applyAction(state, side, { type: "continue" });
      return;
    default:
      return;
  }
}

const stat = { swarm: 0, capital: 0, draw: 0 };
const notes = {
  swarm: { rows: 0, cols: 0, straights: 0, ships: 0, dmg: 0 },
  capital: { rows: 0, cols: 0, straights: 0, ships: 0, dmg: 0 },
};
let rounds = 0;
let unfinished = 0;

for (let i = 0; i < N; i += 1) {
  setRng(makeRng(5150 + i * 7919));
  const state = newMatch("sc", "0000", "A", "A", "versus");
  state.players.guest = newPlayer("B", "B", "ready");
  state.status = "active";
  state.players.host.phase = "ready";
  // Alternate seats so nothing about going first leaks into the result.
  const seat = i % 2 === 0
    ? { host: "swarm", guest: "capital" }
    : { host: "capital", guest: "swarm" };

  let guard = 0;
  while (state.status !== "finished" && guard < 4000) {
    guard += 1;
    const before = JSON.stringify([
      state.players.host.phase, state.players.guest.phase,
      state.players.host.round, state.players.guest.round,
      state.players.host.rolls, state.players.guest.rolls,
      state.players.host.hp, state.players.guest.hp,
    ]);
    for (const side of ["host", "guest"]) {
      try { play(state, side, seat[side]); }
      catch (e) { if (process.env.TRACE) console.log(`  [${side} ${seat[side]} ${state.players[side].phase}] ${e.message}`); }
    }
    const after = JSON.stringify([
      state.players.host.phase, state.players.guest.phase,
      state.players.host.round, state.players.guest.round,
      state.players.host.rolls, state.players.guest.rolls,
      state.players.host.hp, state.players.guest.hp,
    ]);
    if (process.env.TRACE) console.log(before, "->", after);
    if (before === after) { if (process.env.TRACE) console.log("  STALLED"); break; }
  }

  rounds += Math.max(state.players.host.round, state.players.guest.round);
  for (const side of ["host", "guest"]) {
    const who = seat[side];
    const p = state.players[side];
    notes[who].rows += p.stats.rows;
    notes[who].cols += p.stats.cols;
    notes[who].straights += p.stats.straights;
    notes[who].ships += p.ships.length;
    notes[who].dmg += p.stats.damageDealt;
  }
  if (!state.winner) unfinished += 1;
  if (state.winner === "draw") stat.draw += 1;
  else if (state.winner)
   stat[seat[state.winner]] += 1;
}

const pc = (n) => `${((n / N) * 100).toFixed(1)}%`;
const ci = (n) => (1.96 * Math.sqrt(((n / N) * (1 - n / N)) / N) * 100).toFixed(1);
console.log(`\n=== ${N} matches, seats alternated ===\n`);
console.log(`  SWARM   nine d4s, reroll everything to match   ${String(stat.swarm).padStart(4)}  ${pc(stat.swarm)} ±${ci(stat.swarm)}`);
console.log(`  CAPITAL big hulls, straights, ships as armour  ${String(stat.capital).padStart(4)}  ${pc(stat.capital)} ±${ci(stat.capital)}`);
console.log(`  draws                                          ${String(stat.draw).padStart(4)}  ${pc(stat.draw)}`);
console.log(`  unfinished (a bug, not a result)          ${String(unfinished).padStart(4)}`);
console.log(`\n  average match length ${(rounds / N).toFixed(1)} rounds\n`);
console.log("  per match averages        rows   cols  straights  ships  damage dealt");
for (const who of ["swarm", "capital"]) {
  const n = notes[who];
  console.log(
    `  ${who.padEnd(22)} ${(n.rows / N).toFixed(2).padStart(5)}  ${(n.cols / N).toFixed(2).padStart(5)}` +
    `  ${(n.straights / N).toFixed(2).padStart(8)}  ${(n.ships / N).toFixed(2).padStart(5)}  ${(n.dmg / N).toFixed(0).padStart(11)}`,
  );
}
