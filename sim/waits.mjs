/** How often is one commander stuck waiting on the other, and at which step? */
import { bundlePath } from "./bundle.mjs";
const G = await import(bundlePath);
const { PLANS, applyAction, applyDifficultyStart, makeRng, newBrain, newMatch,
        newPlayer, nextActions, setRng } = G;
const N = Number(process.argv[2] ?? 300);
let rounds = 0, bothBrace = 0, oneBraceOneStuck = 0, neitherBrace = 0;

for (let i = 0; i < N; i += 1) {
  setRng(makeRng(4711 + i * 7919));
  const s = newMatch("w", "0000", "A", "A", "versus");
  s.players.guest = newPlayer("B", "B", "ready");
  applyDifficultyStart(s.players.host, "hard");
  applyDifficultyStart(s.players.guest, "hard");
  s.status = "active"; s.players.host.phase = "ready";
  const brains = { host: newBrain(PLANS[i % 5], "hard"), guest: newBrain(PLANS[(i + 2) % 5], "hard") };
  const seen = new Set();
  let guard = 0;
  while (s.status !== "finished" && guard < 4000) {
    guard += 1;
    const h = s.players.host, g = s.players.guest;
    // The instant after a volley resolves, before anyone has acted on it.
    const settled = (h.phase === "brace" || h.phase === "report") && (g.phase === "brace" || g.phase === "report");
    if (settled && !seen.has(h.round)) {
      seen.add(h.round);
      rounds += 1;
      const hb = h.phase === "brace", gb = g.phase === "brace";
      if (hb && gb) bothBrace += 1;
      else if (hb || gb) oneBraceOneStuck += 1;
      else neitherBrace += 1;
    }
    let moved = false;
    for (const side of ["host", "guest"]) {
      for (const a of nextActions(s, side, brains[side])) {
        if (s.status === "finished") break;
        try { applyAction(s, side, a); moved = true; } catch {}
      }
    }
    if (!moved) break;
  }
}
const pc = (v) => `${((v / Math.max(1, rounds)) * 100).toFixed(1)}%`.padStart(7);
console.log(`\n=== ${N} matches, ${rounds} resolved rounds ===\n`);
console.log(`  both choose blockers at once (no one waits) ${String(bothBrace).padStart(5)} ${pc(bothBrace)}`);
console.log(`  ONE blocks, the other is STUCK on report    ${String(oneBraceOneStuck).padStart(5)} ${pc(oneBraceOneStuck)}`);
console.log(`  neither blocks (both move on)               ${String(neitherBrace).padStart(5)} ${pc(neitherBrace)}`);
