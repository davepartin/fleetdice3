/**
 * The 2x2: does valuing Energy highly only pay if you also save for a bay?
 *
 * Measured separately, each change is neutral. The first energy-weight sweep
 * was run with saving switched on, and read 74%; re-run with saving off it read
 * 48%. That is either a confound or a genuine interaction, and the difference
 * matters enough to test properly.
 *
 *   node sim/combo.mjs [n] [tier]
 */
import { bundlePath } from "./bundle.mjs";
const G = await import(bundlePath);
const { PLANS, DIFFICULTY, applyAction, applyDifficultyStart, makeRng, newBrain,
        newMatch, newPlayer, nextActions, planShopping, readOpponent, setRng, urgencyOf } = G;

const N = Number(process.argv[2] ?? 400);
const TIER = process.argv[3] ?? "hard";
const knobs = DIFFICULTY[TIER];
const OLD = { weight: 1.45, patience: 0 };

function play(seed, planIdx, aSide, a, b) {
  setRng(makeRng(seed));
  const s = newMatch("c", "0000", "A", "A", "versus");
  s.players.guest = newPlayer("B", "B", "ready");
  applyDifficultyStart(s.players.host, TIER);
  applyDifficultyStart(s.players.guest, TIER);
  s.status = "active"; s.players.host.phase = "ready";
  const brains = { host: newBrain(PLANS[planIdx % 5], TIER), guest: newBrain(PLANS[planIdx % 5], TIER) };
  let guard = 0;
  while (s.status !== "finished" && guard < 4000) {
    guard += 1; let moved = false;
    for (const side of ["host", "guest"]) {
      const cfg = side === aSide ? a : b;
      knobs.energyWeight = cfg.weight;
      const p = s.players[side];
      const read = knobs.readsOpponent ? readOpponent(s, side) : null;
      const acts = p.phase === "shop"
        ? [...planShopping(p, brains[side].plan, p.round, knobs.greed, knobs.rerollReserve,
                           urgencyOf(read), cfg.patience), { type: "ready" }]
        : nextActions(s, side, brains[side]);
      for (const act of acts) {
        if (s.status === "finished") break;
        try { applyAction(s, side, act); moved = true; } catch {}
      }
    }
    if (!moved) break;
  }
  knobs.energyWeight = OLD.weight;
  return s.winner;
}

function duel(a, b, label) {
  let wins = 0;
  for (let i = 0; i < N; i += 1) {
    const aSide = i % 2 === 0 ? "host" : "guest";
    const w = play(90001 + i * 7919, Math.floor(i / 2), aSide, a, b);
    if (w === aSide) wins += 1; else if (w === "draw") wins += 0.5;
  }
  const rate = wins / N, ci = 1.96 * Math.sqrt((rate * (1 - rate)) / N) * 100;
  console.log(`  ${label.padEnd(34)} ${(rate * 100).toFixed(1)}%  ±${ci.toFixed(1)}`);
}

const NEW_W = { weight: DIFFICULTY[TIER].energyWeight === 1.45 ? 3.4 : 4.2, patience: 0 };
const W = Number(process.env.W ?? 3.4), P = Number(process.env.P ?? 0.8);
console.log(`\n=== ${TIER}, ${N} matches each, against the old brain (1.45, no saving) ===\n`);
duel({ weight: W, patience: 0 },  OLD, `energy ${W} alone`);
duel({ weight: 1.45, patience: P }, OLD, `saving alone`);
duel({ weight: W, patience: P },  OLD, `energy ${W} AND saving`);
