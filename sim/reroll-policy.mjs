/**
 * Is paying to reroll too strong, and does an escalating price tame it?
 *
 * Two identical brains, same tier, same seed, all five plans. Side A is
 * forbidden every paid reroll and must submit once its free rolls are gone;
 * side B plays the shipped rule. 50% means paid rerolls are worth exactly what
 * they cost. Well under 50% means they are strong.
 *
 * 
 * PAID_ROLLS sets the cap; 99 is effectively the old uncapped rule.
 *
 * BANK adds starting Energy to both sides, to reach the "board full of d4s and
 * 30 spare Energy" situation the shipped rule is suspected of mishandling.
 *
 *   PAID_ROLLS=3 BANK=30 node sim/reroll-policy.mjs 400 expert
 */
import { bundlePath } from "./bundle.mjs";
const G = await import(bundlePath);
const { PLANS, TUNING, applyAction, applyDifficultyStart, makeRng, newBrain,
        newMatch, newPlayer, nextActions, setRng } = G;

if (process.env.PAID_ROLLS) TUNING.paidRollsPerRound = Number(process.env.PAID_ROLLS);
const N = Number(process.argv[2] ?? 400);
const TIER = process.argv[3] ?? "expert";
const BANK = Number(process.env.BANK ?? 0);

function match(seed, cappedSide, planIdx) {
  setRng(makeRng(seed));
  const s = newMatch("rp", "0000", "A", "A", "versus");
  s.players.guest = newPlayer("B", "B", "ready");
  applyDifficultyStart(s.players.host, TIER);
  applyDifficultyStart(s.players.guest, TIER);
  s.players.host.energy += BANK;
  s.players.guest.energy += BANK;
  s.status = "active";
  s.players.host.phase = "ready";
  const brains = { host: newBrain(PLANS[planIdx % 5], TIER), guest: newBrain(PLANS[planIdx % 5], TIER) };
  let guard = 0;
  while (s.status !== "finished" && guard < 6000) {
    guard += 1;
    let moved = false;
    for (const side of ["host", "guest"]) {
      const p = s.players[side];
      let actions = nextActions(s, side, brains[side]);
      if (side === cappedSide && p.phase === "rolling" && p.rolls >= TUNING.rollsPerRound) {
        // Strip the paid reroll; let everything else in the list stand.
        actions = actions.filter((a) => a.type !== "roll");
        if (!actions.some((a) => a.type === "submit")) actions = [...actions, { type: "submit" }];
      }
      for (const a of actions) {
        if (s.status === "finished") break;
        try { applyAction(s, side, a); moved = true; } catch {}
      }
    }
    if (!moved) break;
  }
  return { winner: s.winner,
           reroll: { host: s.players.host.stats.rerollEnergy, guest: s.players.guest.stats.rerollEnergy },
           rounds: Math.max(s.players.host.round, s.players.guest.round) };
}

let cappedWins = 0, rounds = 0, rerollFree = 0, rerollCapped = 0;
for (let i = 0; i < N; i += 1) {
  const cappedSide = i % 2 === 0 ? "host" : "guest";
  const freeSide = cappedSide === "host" ? "guest" : "host";
  const r = match(90001 + i * 7919, cappedSide, Math.floor(i / 2));
  if (r.winner === cappedSide) cappedWins += 1;
  else if (r.winner === "draw") cappedWins += 0.5;
  rerollFree += r.reroll[freeSide];
  rerollCapped += r.reroll[cappedSide];
  rounds += r.rounds;
}
const rate = cappedWins / N;
const ci = 1.96 * Math.sqrt((rate * (1 - rate)) / N) * 100;
console.log(`\n=== ${TIER}, ${N} matches | paid rerolls capped at ${TUNING.paidRollsPerRound} | bank +${BANK}⚡ ===\n`);
console.log(`  commander FORBIDDEN to pay for rerolls wins   ${(rate * 100).toFixed(1)}%  ±${ci.toFixed(1)}`);
console.log(`\n  Energy the free side burned on rerolls        ${(rerollFree / N).toFixed(1)} per match`);
console.log(`  (capped side, should be 0)                    ${(rerollCapped / N).toFixed(1)}`);
console.log(`  match length                                  ${(rounds / N).toFixed(1)} rounds`);
console.log(`\n  50% = paid rerolls are worth their price. Below 50% = they are strong.`);
