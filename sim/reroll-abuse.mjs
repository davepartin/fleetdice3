/**
 * The endless-reroll exploit, measured.
 *
 * The claim: a board full of d4s and a big bank lets you reroll until nearly
 * every die shows 2, and a 2 pays 2 *direct* damage — which `settlePlayer` adds
 * after blocking, so no amount of blocking touches it. Add a level-3 flagship
 * matching the same face for +4 and it is ~22 unblockable a round against 60 HP.
 *
 * This bot plays exactly that: buy cells and d4s as wide as possible, take the
 * flagship to 3, then reroll every die that is not a 2, paying for it, until
 * the bank is empty. Measured against the game's own best brain, per the house
 * rule that a hand-written opponent is not a control.
 *
 *   node sim/reroll-abuse.mjs [n] [tier]
 */
import { bundlePath } from "./bundle.mjs";
const G = await import(bundlePath);
const {
  TUNING, PLANS, applyAction, applyDifficultyStart, makeRng, newBrain, newMatch,
  newPlayer, nextActions, setRng, activeShips, emptyOpenSlots, nextSlotCost,
  priceOf, flagshipUpgradeCost, rollCostFor,
} = G;

if (process.env.PAID_ROLLS) TUNING.paidRollsPerRound = Number(process.env.PAID_ROLLS);
const N = Number(process.argv[2] ?? 300);
const TIER = process.argv[3] ?? "expert";
const TARGET = 2; // the face that pays direct damage on every hull

function shopChaser(player) {
  const acts = [];
  let energy = player.energy;
  let level = player.flag.level;
  // Flagship first: it multiplies the chased face.
  for (let i = 0; i < 2; i += 1) {
    const cost = flagshipUpgradeCost(level);
    if (cost === null || energy < cost) break;
    acts.push({ type: "shop", operation: "flagship" });
    energy -= cost; level += 1;
  }
  for (let step = 0; step < 10; step += 1) {
    const empty = emptyOpenSlots(player).filter(
      (s) => !acts.some((a) => a.operation === "buy" && a.slotIndex === s));
    if (empty.length && energy >= priceOf(4)) {
      acts.push({ type: "shop", operation: "buy", sides: 4, slotIndex: empty[0] });
      energy -= priceOf(4); continue;
    }
    const cost = nextSlotCost(player);
    if (cost !== null && energy >= cost + priceOf(4)) {
      const closed = [0,1,2,3,4,5,6,7].find(
        (s) => !player.open[s] && !acts.some((a) => a.operation === "slot" && a.slotIndex === s));
      if (closed === undefined) break;
      acts.push({ type: "shop", operation: "slot", slotIndex: closed });
      energy -= cost; continue;
    }
    break;
  }
  return acts;
}

function braceChaser(player) {
  const repair = player.tally?.heal ?? 0;
  if (player.hp + repair - (player.incoming + player.directIncoming) > 0) return [];
  const ships = activeShips(player, player.round).slice().sort((a, b) => a.sides - b.sides);
  const chosen = []; let blocked = 0;
  for (const ship of ships) {
    if (player.hp + repair - (Math.max(0, player.incoming - blocked) + player.directIncoming) > 0) break;
    chosen.push(ship.id); blocked += ship.sides;
  }
  return chosen;
}

let spentOnRerolls = 0, paidRolls = 0;

function playChaser(state, side) {
  const p = state.players[side];
  switch (p.phase) {
    case "shop":
      for (const a of shopChaser(p)) { try { applyAction(state, side, a); } catch {} }
      applyAction(state, side, { type: "ready" }); return;
    case "ready": applyAction(state, side, { type: "roll", dice: [] }); return;
    case "rolling": {
      const ids = p.dice.filter((d) => d.value !== TARGET).map((d) => d.id);
      if (!ids.length) { applyAction(state, side, { type: "submit" }); return; }
      const free = p.rolls < TUNING.rollsPerRound;
      if (free) { applyAction(state, side, { type: "roll", dice: ids }); return; }
      // Pay for as much of the chase as the bank allows.
      const cost = rollCostFor(p, ids.length);
      if (cost <= p.energy) {
        spentOnRerolls += cost; paidRolls += 1;
        applyAction(state, side, { type: "roll", dice: ids }); return;
      }
      // Cannot afford the whole set — take the biggest slice we can.
      for (let take = ids.length - 1; take >= 1; take -= 1) {
        if (rollCostFor(p, take) <= p.energy) {
          spentOnRerolls += rollCostFor(p, take); paidRolls += 1;
          applyAction(state, side, { type: "roll", dice: ids.slice(0, take) }); return;
        }
      }
      applyAction(state, side, { type: "submit" }); return;
    }
    case "brace": applyAction(state, side, { type: "brace", ships: braceChaser(p) }); return;
    case "report": applyAction(state, side, { type: "continue" }); return;
    default: return;
  }
}

let chaserWins = 0, aiWins = 0, draws = 0, unfinished = 0, rounds = 0;
for (let i = 0; i < N; i += 1) {
  setRng(makeRng(8080 + i * 7919));
  const state = newMatch("ra", "0000", "A", "A", "versus");
  state.players.guest = newPlayer("B", "B", "ready");
  state.status = "active"; state.players.host.phase = "ready";
  const mySide = i % 2 === 0 ? "host" : "guest";
  const aiSide = mySide === "host" ? "guest" : "host";
  applyDifficultyStart(state.players[aiSide], TIER);
  const brain = newBrain(PLANS[i % PLANS.length], TIER);
  let guard = 0;
  while (state.status !== "finished" && guard < 6000) {
    guard += 1;
    const key = () => JSON.stringify(["host","guest"].map((s) =>
      [state.players[s].phase, state.players[s].round, state.players[s].rolls, state.players[s].hp]));
    const before = key();
    try { playChaser(state, mySide); } catch {}
    for (const a of nextActions(state, aiSide, brain)) {
      if (state.status === "finished") break;
      try { applyAction(state, aiSide, a); } catch {}
    }
    if (before === key()) break;
  }
  rounds += Math.max(state.players.host.round, state.players.guest.round);
  if (!state.winner) unfinished += 1;
  else if (state.winner === "draw") draws += 1;
  else if (state.winner === mySide) chaserWins += 1;
  else aiWins += 1;
}
const pc = (n) => `${((n / N) * 100).toFixed(1)}%`;
const ci = (n) => (1.96 * Math.sqrt(((n / N) * (1 - n / N)) / N) * 100).toFixed(1);
console.log(`\n=== 2-chaser (wide d4s + level-3 flag + pay to reroll) vs ${TIER.toUpperCase()} ===`);
console.log(`    ${N} matches, seats alternated, paid rerolls capped at ${TUNING.paidRollsPerRound}\n`);
console.log(`  chaser     ${String(chaserWins).padStart(4)}  ${pc(chaserWins)} ±${ci(chaserWins)}`);
console.log(`  ${TIER.padEnd(9)}  ${String(aiWins).padStart(4)}  ${pc(aiWins)} ±${ci(aiWins)}`);
console.log(`  draws ${draws}   unfinished ${unfinished}`);
console.log(`\n  paid rerolls per match      ${(paidRolls / N).toFixed(1)}`);
console.log(`  Energy burned on rerolls    ${(spentOnRerolls / N).toFixed(1)} per match`);
console.log(`  average match length        ${(rounds / N).toFixed(1)} rounds`);
