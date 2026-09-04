/** Does each tier beat the one below it, and by how much? */
import { bundlePath } from "./bundle.mjs";
const G = await import(bundlePath);
const { PLANS, applyAction, applyDifficultyStart, makeRng, newBrain, newMatch,
        newPlayer, nextActions, setRng } = G;
const N = Number(process.argv[2] ?? 400);

function duel(strong, weak, n) {
  let wins = 0, rounds = 0;
  for (let i = 0; i < n; i += 1) {
    setRng(makeRng(4242 + i * 7919));
    const s = newMatch("l", "0000", "A", "A", "versus");
    s.players.guest = newPlayer("B", "B", "ready");
    const strongSide = i % 2 === 0 ? "host" : "guest";
    const weakSide = strongSide === "host" ? "guest" : "host";
    applyDifficultyStart(s.players[strongSide], strong);
    applyDifficultyStart(s.players[weakSide], weak);
    s.status = "active"; s.players.host.phase = "ready";
    const brains = { [strongSide]: newBrain(PLANS[i % 5], strong),
                     [weakSide]: newBrain(PLANS[(i + 2) % 5], weak) };
    let guard = 0;
    while (s.status !== "finished" && guard < 4000) {
      guard += 1; let moved = false;
      for (const side of ["host", "guest"])
        for (const a of nextActions(s, side, brains[side])) {
          if (s.status === "finished") break;
          try { applyAction(s, side, a); moved = true; } catch {}
        }
      if (!moved) break;
    }
    if (s.winner === strongSide) wins += 1; else if (s.winner === "draw") wins += 0.5;
    rounds += Math.max(s.players.host.round, s.players.guest.round);
  }
  const rate = wins / n;
  return { rate, ci: 1.96 * Math.sqrt((rate * (1 - rate)) / n) * 100, rounds: rounds / n };
}

console.log(`\n=== the ladder, ${N} matches a rung ===\n`);
for (const [a, b] of [["medium","low"],["hard","medium"],["expert","hard"],["expert","low"]]) {
  const r = duel(a, b, N);
  console.log(`  ${a.padEnd(7)} over ${b.padEnd(7)} ${(r.rate*100).toFixed(1)}%  ±${r.ci.toFixed(1)}   (${r.rounds.toFixed(1)} rounds)`);
}
