/**
 * The d4 swarm against the game's own best opponent.
 *
 * The point is to tell a real balance problem from a strawman: if the swarm
 * only beats a hand-written "big dice" player, that says more about the player
 * than the game. If it also beats Expert — which samples 120 reroll shapes,
 * plays every line it sees and reads the other fleet — the strategy is
 * genuinely stronger than the game's own best answer to it.
 */
import { bundlePath } from "./bundle.mjs";
const G = await import(bundlePath);
const {
  TUNING, PLANS, applyAction, applyDifficultyStart, makeRng, newBrain, newMatch,
  newPlayer, nextActions, setRng, activeShips, emptyOpenSlots, nextSlotCost, priceOf,
} = G;

const N = Number(process.argv[2] ?? 300);
const TIER = process.argv[3] ?? "expert";

function shopSwarm(player) {
  const acts = [];
  let energy = player.energy;
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
function rerollSwarm(player) {
  const counts = new Map();
  for (const d of player.dice) counts.set(d.value, (counts.get(d.value) ?? 0) + 1);
  let best = null, bestCount = -1;
  for (const [v, c] of counts) if (c > bestCount || (c === bestCount && v < best)) { best = v; bestCount = c; }
  return player.dice.filter((d) => d.value !== best).map((d) => d.id);
}
function braceSwarm(player) {
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
function playSwarm(state, side) {
  const p = state.players[side];
  switch (p.phase) {
    case "shop":
      for (const a of shopSwarm(p)) { try { applyAction(state, side, a); } catch {} }
      applyAction(state, side, { type: "ready" }); return;
    case "ready": applyAction(state, side, { type: "roll", dice: [] }); return;
    case "rolling": {
      const free = p.rolls < TUNING.rollsPerRound;
      let ids = rerollSwarm(p);
      if (!free) ids = ids.slice(0, Math.max(0, p.energy));
      if (ids.length && (free || ids.length <= p.energy)) {
        applyAction(state, side, { type: "roll", dice: ids }); return;
      }
      applyAction(state, side, { type: "submit" }); return;
    }
    case "brace": applyAction(state, side, { type: "brace", ships: braceSwarm(p) }); return;
    case "report": applyAction(state, side, { type: "continue" }); return;
    default: return;
  }
}

let swarmWins = 0, aiWins = 0, draws = 0, unfinished = 0, rounds = 0;
let swarmLines = 0, aiLines = 0;

for (let i = 0; i < N; i += 1) {
  setRng(makeRng(8080 + i * 7919));
  const state = newMatch("sa", "0000", "A", "A", "versus");
  state.players.guest = newPlayer("B", "B", "ready");
  state.status = "active"; state.players.host.phase = "ready";
  const swarmSide = i % 2 === 0 ? "host" : "guest";
  const aiSide = swarmSide === "host" ? "guest" : "host";
  applyDifficultyStart(state.players[aiSide], TIER);
  const brain = newBrain(PLANS[i % PLANS.length], TIER);

  let guard = 0;
  while (state.status !== "finished" && guard < 6000) {
    guard += 1;
    const key = () => JSON.stringify(["host","guest"].map((s) =>
      [state.players[s].phase, state.players[s].round, state.players[s].rolls, state.players[s].hp]));
    const before = key();
    try { playSwarm(state, swarmSide); } catch {}
    for (const a of nextActions(state, aiSide, brain)) {
      if (state.status === "finished") break;
      try { applyAction(state, aiSide, a); } catch {}
    }
    if (before === key()) break;
  }
  rounds += Math.max(state.players.host.round, state.players.guest.round);
  swarmLines += state.players[swarmSide].stats.rows + state.players[swarmSide].stats.cols;
  aiLines += state.players[aiSide].stats.rows + state.players[aiSide].stats.cols;
  if (!state.winner) unfinished += 1;
  else if (state.winner === "draw") draws += 1;
  else if (state.winner === swarmSide) swarmWins += 1;
  else aiWins += 1;
}

const pc = (n) => `${((n / N) * 100).toFixed(1)}%`;
const ci = (n) => (1.96 * Math.sqrt(((n / N) * (1 - n / N)) / N) * 100).toFixed(1);
console.log(`\n=== d4 swarm vs the game's ${TIER.toUpperCase()} brain — ${N} matches, seats alternated ===\n`);
console.log(`  swarm      ${String(swarmWins).padStart(4)}  ${pc(swarmWins)} ±${ci(swarmWins)}`);
console.log(`  ${TIER.padEnd(9)}  ${String(aiWins).padStart(4)}  ${pc(aiWins)} ±${ci(aiWins)}`);
console.log(`  draws      ${String(draws).padStart(4)}   unfinished ${unfinished}`);
console.log(`\n  lines completed per match — swarm ${(swarmLines / N).toFixed(1)}, ${TIER} ${(aiLines / N).toFixed(1)}`);
console.log(`  average match length ${(rounds / N).toFixed(1)} rounds`);
