/**
 * Is `WEIGHTS.energy` too high?
 *
 * BALANCE.md finding 3 suspected it: "WEIGHTS.energy is 1.45 and it should
 * probably be nearer 1.0" — the note that explained why an all-d4 fleet looked
 * strong on paper. It was never tested, because a seeded run could not be
 * replayed until the RNG fix.
 *
 * Identical brains, identical seeds, same tier. One side rerolls using the
 * weight under test; the other uses the shipped 1.45.
 *
 *   ENERGY_WEIGHT=1.0 node sim/weights.mjs 400 hard
 */
import { bundlePath } from "./bundle.mjs";
const G = await import(bundlePath);
const { PLANS, DIFFICULTY, applyAction, applyDifficultyStart, makeRng, newBrain,
        newMatch, newPlayer, nextActions, setRng } = G;

const N = Number(process.argv[2] ?? 400);
const TIER = process.argv[3] ?? "hard";
const TEST = Number(process.env.ENERGY_WEIGHT ?? 1.0);
const SHIPPED = Number(process.env.BASE_WEIGHT ?? 1.45);

function match(seed, testSide, planIdx) {
  setRng(makeRng(seed));
  const s = newMatch("w", "0000", "A", "A", "versus");
  s.players.guest = newPlayer("B", "B", "ready");
  applyDifficultyStart(s.players.host, TIER);
  applyDifficultyStart(s.players.guest, TIER);
  s.status = "active";
  s.players.host.phase = "ready";
  const brains = { host: newBrain(PLANS[planIdx % 5], TIER), guest: newBrain(PLANS[planIdx % 5], TIER) };
  let guard = 0;
  while (s.status !== "finished" && guard < 4000) {
    guard += 1;
    let moved = false;
    for (const side of ["host", "guest"]) {
      // The weight now lives on the tier's knobs, so set it for the side
      // about to think and put it back afterwards. Overriding the module-level
      // WEIGHTS no longer does anything: `ctx.energyWeight` wins.
      DIFFICULTY[TIER].energyWeight = side === testSide ? TEST : SHIPPED;
      for (const a of nextActions(s, side, brains[side])) {
        if (s.status === "finished") break;
        try { applyAction(s, side, a); moved = true; } catch {}
      }
    }
    if (!moved) break;
  }
  DIFFICULTY[TIER].energyWeight = SHIPPED;
  return { winner: s.winner,
           straights: { host: s.players.host.stats.straights, guest: s.players.guest.stats.straights },
           lines: { host: s.players.host.stats.rows + s.players.host.stats.cols,
                    guest: s.players.guest.stats.rows + s.players.guest.stats.cols },
           rounds: Math.max(s.players.host.round, s.players.guest.round) };
}

let wins = 0, rounds = 0;
const st = { test: 0, base: 0 }, ln = { test: 0, base: 0 };
for (let i = 0; i < N; i += 1) {
  const testSide = i % 2 === 0 ? "host" : "guest";
  const other = testSide === "host" ? "guest" : "host";
  const r = match(90001 + i * 7919, testSide, Math.floor(i / 2));
  if (r.winner === testSide) wins += 1; else if (r.winner === "draw") wins += 0.5;
  st.test += r.straights[testSide]; st.base += r.straights[other];
  ln.test += r.lines[testSide]; ln.base += r.lines[other];
  rounds += r.rounds;
}
const rate = wins / N, ci = 1.96 * Math.sqrt((rate * (1 - rate)) / N) * 100;
console.log(`\n=== ${TIER}, ${N} matches | energy weight ${TEST} vs shipped ${SHIPPED} ===\n`);
console.log(`  the ${TEST} commander wins   ${(rate * 100).toFixed(1)}%  ±${ci.toFixed(1)}`);
console.log(`  straights   ${TEST}: ${(st.test / N).toFixed(2)}   ${SHIPPED}: ${(st.base / N).toFixed(2)}`);
console.log(`  lines       ${TEST}: ${(ln.test / N).toFixed(2)}   ${SHIPPED}: ${(ln.base / N).toFixed(2)}`);
console.log(`  rounds      ${(rounds / N).toFixed(1)}`);
