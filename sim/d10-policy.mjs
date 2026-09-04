/**
 * Is the d8 -> d10 step a trap?
 *
 * Every d10 in the game arrives as a 4-Energy upgrade from a d8; in 960
 * commanders nobody ever bought one fresh for 13 (see sim/d10.mjs). So the
 * question "is the d10 mispriced" is really "is that 4-Energy step worth it".
 *
 * Two identical brains, same tier, same seed. Side A is forbidden to take the
 * step and must spend that Energy on something else. Side B plays normally.
 * If the d10 were a trap, A would win.
 *
 *   node sim/d10-policy.mjs [n] [tier]
 */
import { bundlePath } from "./bundle.mjs";
const G = await import(bundlePath);
const { PLANS, TUNING, applyAction, applyDifficultyStart, makeRng, newBrain, newMatch,
        newPlayer, nextActions, setRng } = G;

// Price of a d10 is also the price of the step: upgradeCost = price(10) - price(8).
if (process.env.D10_PRICE) TUNING.prices[10] = Number(process.env.D10_PRICE);
const STEP = TUNING.prices[10] - TUNING.prices[8];

const N = Number(process.argv[2] ?? 400);
const TIER = process.argv[3] ?? "hard";

/** Drop any action that upgrades a d8 (i.e. steps it up to a d10). */
function filterCapped(actions, player) {
  return actions.filter((a) => {
    if (a.type !== "shop" || a.operation !== "upgrade") return true;
    const ship = player.ships.find((sh) => sh.id === a.shipId);
    return !ship || ship.sides !== 8;
  });
}

function match(seed, cappedSide, planIdx) {
  setRng(makeRng(seed));
  const s = newMatch("p", "0000", "A", "A", "versus");
  s.players.guest = newPlayer("B", "B", "ready");
  applyDifficultyStart(s.players.host, TIER);
  applyDifficultyStart(s.players.guest, TIER);
  s.status = "active";
  s.players.host.phase = "ready";
  const brains = { host: newBrain(PLANS[planIdx % 5], TIER), guest: newBrain(PLANS[planIdx % 5], TIER) };
  const spent = { host: 0, guest: 0 };
  const d10 = { host: 0, guest: 0 };
  let guard = 0;
  while (s.status !== "finished" && guard < 4000) {
    guard += 1;
    let moved = false;
    for (const side of ["host", "guest"]) {
      const p = s.players[side];
      let actions = nextActions(s, side, brains[side]);
      if (side === cappedSide) actions = filterCapped(actions, p);
      for (const a of actions) {
        if (s.status === "finished") break;
        const before = p.energy;
        try {
          applyAction(s, side, a);
          moved = true;
          if (a.type === "shop") spent[side] += before - p.energy;
        } catch {}
      }
    }
    if (!moved) break;
  }
  for (const side of ["host", "guest"]) {
    d10[side] = s.players[side].ships.filter((sh) => sh.sides === 10).length;
  }
  return { winner: s.winner, spent, d10,
           rounds: Math.max(s.players.host.round, s.players.guest.round) };
}

let cappedWins = 0, rounds = 0;
const spent = { capped: 0, free: 0 };
const d10s = { capped: 0, free: 0 };
for (let i = 0; i < N; i += 1) {
  // Swap which seat is capped every other match so seat order cancels.
  const cappedSide = i % 2 === 0 ? "host" : "guest";
  const freeSide = cappedSide === "host" ? "guest" : "host";
  const r = match(90001 + i * 7919, cappedSide, Math.floor(i / 2));
  if (r.winner === cappedSide) cappedWins += 1;
  else if (r.winner === "draw") cappedWins += 0.5;
  spent.capped += r.spent[cappedSide];
  spent.free += r.spent[freeSide];
  d10s.capped += r.d10[cappedSide];
  d10s.free += r.d10[freeSide];
  rounds += r.rounds;
}
const rate = cappedWins / N;
const ci = 1.96 * Math.sqrt((rate * (1 - rate)) / N) * 100;
console.log(`\n=== ${TIER}, ${N} matches | d10 price ${TUNING.prices[10]}, so the step costs ${STEP} ===\n`);
console.log(`the commander FORBIDDEN to step d8 -> d10 wins  ${(rate * 100).toFixed(1)}%  ±${ci.toFixed(1)}`);
console.log(`\n  Energy spent   capped ${(spent.capped / N).toFixed(1)}   free ${(spent.free / N).toFixed(1)}`);
console.log(`  d10s owned     capped ${(d10s.capped / N).toFixed(2)}   free ${(d10s.free / N).toFixed(2)}`);
console.log(`  match length   ${(rounds / N).toFixed(1)} rounds`);
console.log(`\n50% = the step is worth exactly its price. Above 50% = the d10 is a trap.`);
