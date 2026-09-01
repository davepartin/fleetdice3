/** How often does anyone actually land a straight? */
import { bundlePath } from "./bundle.mjs";
const G = await import(bundlePath);
const { PLANS, TUNING, applyAction, applyDifficultyStart, makeRng, newBrain,
        newMatch, newPlayer, nextActions, setRng } = G;
const N = Number(process.argv[2] ?? 200);
const rows = [];
for (const tier of ["low", "medium", "hard", "expert"]) {
  let straights = 0, lines = 0, rounds = 0, ships = 0, hulls = { 4:0, 6:0, 8:0, 10:0 };
  for (let i = 0; i < N; i += 1) {
    setRng(makeRng(313 + i * 7919));
    const s = newMatch("st", "0000", "A", "A", "versus");
    s.players.guest = newPlayer("B", "B", "ready");
    applyDifficultyStart(s.players.host, tier);
    applyDifficultyStart(s.players.guest, tier);
    s.status = "active"; s.players.host.phase = "ready";
    const brains = { host: newBrain(PLANS[i % 5], tier), guest: newBrain(PLANS[(i + 2) % 5], tier) };
    let guard = 0;
    while (s.status !== "finished" && guard < 4000) {
      guard += 1; let moved = false;
      for (const side of ["host", "guest"]) {
        for (const a of nextActions(s, side, brains[side])) {
          if (s.status === "finished") break;
          try { applyAction(s, side, a); moved = true; } catch {}
        }
      }
      if (!moved) break;
    }
    for (const side of ["host", "guest"]) {
      const p = s.players[side];
      straights += p.stats.straights;
      lines += p.stats.rows + p.stats.cols;
      ships += p.ships.length;
      for (const sh of p.ships) hulls[sh.sides] += 1;
    }
    rounds += Math.max(s.players.host.round, s.players.guest.round);
  }
  const per = (v) => (v / (N * 2)).toFixed(2);
  const total = hulls[4] + hulls[6] + hulls[8] + hulls[10];
  rows.push({ tier, straights: per(straights), lines: per(lines), ships: per(ships),
    rounds: (rounds / N).toFixed(1),
    mix: [4,6,8,10].map((k) => `d${k} ${((hulls[k]/total)*100).toFixed(0)}%`).join("  ") });
}
console.log(`\n=== ${N} matches per tier, both sides the same tier ===\n`);
console.log("tier      straights/cmdr  lines/cmdr  ships  rounds   final fleet mix");
for (const r of rows) {
  console.log(`${r.tier.padEnd(9)} ${r.straights.padStart(12)} ${r.lines.padStart(11)} ${r.ships.padStart(6)} ${r.rounds.padStart(7)}   ${r.mix}`);
}
console.log(`\n(a straight needs ${TUNING.runMin} consecutive numbers)`);
