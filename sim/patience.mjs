/**
 * Does saving for a bay actually win matches?
 *
 * Identical brains, identical seeds, same tier, all five plans. One side is
 * given the tier's patience; the other is given none, which is how the brain
 * shopped before. 50% means saving changes nothing.
 *
 *   node sim/patience.mjs [n] [tier]
 */
import { bundlePath } from "./bundle.mjs";
const G = await import(bundlePath);
const { PLANS, DIFFICULTY, applyAction, applyDifficultyStart, makeRng, newBrain,
        newMatch, newPlayer, nextActions, planShopping, setRng, urgencyOf,
        readOpponent, racePressure } = G;

const N = Number(process.argv[2] ?? 400);
const TIER = process.argv[3] ?? "hard";
const knobs = DIFFICULTY[TIER];

/** Shop for one side with an explicit patience, bypassing the brain's own. */
function shopWith(state, side, brain, patience) {
  const p = state.players[side];
  const read = knobs.readsOpponent ? readOpponent(state, side) : null;
  return [
    ...planShopping(p, brain.plan, p.round, knobs.greed, knobs.rerollReserve,
                    urgencyOf(read), patience),
    { type: "ready" },
  ];
}

function match(seed, patientSide, planIdx) {
  setRng(makeRng(seed));
  const s = newMatch("pat", "0000", "A", "A", "versus");
  s.players.guest = newPlayer("B", "B", "ready");
  applyDifficultyStart(s.players.host, TIER);
  applyDifficultyStart(s.players.guest, TIER);
  s.status = "active";
  s.players.host.phase = "ready";
  const brains = { host: newBrain(PLANS[planIdx % 5], TIER), guest: newBrain(PLANS[planIdx % 5], TIER) };
  const bays = { host: 0, guest: 0 };
  let guard = 0;
  while (s.status !== "finished" && guard < 4000) {
    guard += 1;
    let moved = false;
    for (const side of ["host", "guest"]) {
      const p = s.players[side];
      const acts = p.phase === "shop"
        ? shopWith(s, side, brains[side], side === patientSide ? knobs.patience : 0)
        : nextActions(s, side, brains[side]);
      for (const a of acts) {
        if (s.status === "finished") break;
        if (a.type === "shop" && a.operation === "slot") bays[side] += 1;
        try { applyAction(s, side, a); moved = true; } catch {}
      }
    }
    if (!moved) break;
  }
  return { winner: s.winner, bays,
           ships: { host: s.players.host.ships.length, guest: s.players.guest.ships.length },
           rounds: Math.max(s.players.host.round, s.players.guest.round) };
}

let wins = 0, rounds = 0;
const bays = { patient: 0, spendy: 0 }, ships = { patient: 0, spendy: 0 };
for (let i = 0; i < N; i += 1) {
  const patientSide = i % 2 === 0 ? "host" : "guest";
  const other = patientSide === "host" ? "guest" : "host";
  const r = match(90001 + i * 7919, patientSide, Math.floor(i / 2));
  if (r.winner === patientSide) wins += 1;
  else if (r.winner === "draw") wins += 0.5;
  bays.patient += r.bays[patientSide]; bays.spendy += r.bays[other];
  ships.patient += r.ships[patientSide]; ships.spendy += r.ships[other];
  rounds += r.rounds;
}
const rate = wins / N, ci = 1.96 * Math.sqrt((rate * (1 - rate)) / N) * 100;
console.log(`\n=== ${TIER}, ${N} matches, paired seeds (patience ${knobs.patience}) ===\n`);
console.log(`  the SAVING commander wins   ${(rate * 100).toFixed(1)}%  ±${ci.toFixed(1)}`);
console.log(`\n  bays bought   saving ${(bays.patient / N).toFixed(2)}   spending ${(bays.spendy / N).toFixed(2)}`);
console.log(`  final ships   saving ${(ships.patient / N).toFixed(2)}   spending ${(ships.spendy / N).toFixed(2)}`);
console.log(`  match length  ${(rounds / N).toFixed(1)} rounds`);
console.log(`\n  50% = saving changes nothing.`);
