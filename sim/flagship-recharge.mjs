/** Exploration only. Does NOT change the shipped engine or offer a live purchase.
 * Policy: once per shipyard visit, replenish an empty weapon if affordable,
 * before ordinary shopping. Real engine + existing Hard brains do the rest.
 * This measures this simple policy, not the optimum value of a recharge.
 */
import { bundlePath } from "./bundle.mjs";
const G = await import(bundlePath);
const N = Number(process.argv[2] || 250);
for (const cost of [4, 6, 8, 10]) {
  let wins = 0, purchases = 0, uses = 0, rounds = 0, rejected = 0;
  for (let i = 0; i < N; i++) {
    G.setRng(G.makeRng(8321 + i * 7919));
    const s = G.newMatch("recharge-lab", "0000", "H", "H", "versus");
    s.players.guest = G.newPlayer("G", "G", "ready");
    s.players.host.phase = "ready"; s.status = "active";
    const buyer = i % 2 ? "guest" : "host";
    const brains = { host: G.newBrain(G.PLANS[i % 5], "hard"), guest: G.newBrain(G.PLANS[i % 5], "hard") };
    let lastShop = -1;
    for (let guard = 0; s.status !== "finished" && guard < 4000; guard++) {
      let moved = false;
      for (const side of ["host", "guest"]) {
        const p = s.players[side];
        if (side === buyer && p.phase === "shop" && p.round !== lastShop) {
          lastShop = p.round;
          if (!p.flag.token && p.energy >= cost) { p.energy -= cost; p.flag.token = true; purchases++; }
        }
        for (const action of G.nextActions(s, side, brains[side])) {
          if (s.status === "finished") break;
          // Match the shipped solo driver's handling of stale batched AI actions.
          // Count every rejection so the experiment does not hide this limitation.
          try { G.applyAction(s, side, action); } catch { rejected++; continue; }
          moved = true;
          if (side === buyer && action.type === "flag-token") uses++;
        }
      }
      if (!moved && s.status !== "finished") throw new Error("Recharge simulation stalled");
    }
    if (s.status !== "finished") throw new Error("Recharge simulation hit its backstop");
    wins += s.winner === buyer ? 1 : s.winner === "draw" ? 0.5 : 0;
    rounds += Math.max(s.players.host.round, s.players.guest.round);
  }
  const p = wins / N, ci = 1.96 * Math.sqrt(p * (1 - p) / N) * 100;
  console.log(`${cost} Energy: buyer wins ${(p*100).toFixed(1)}% ±${ci.toFixed(1)}; ${(purchases/N).toFixed(2)} recharges, ${(uses/N).toFixed(2)} weapon uses, ${(rounds/N).toFixed(1)} rounds (${N} matches; ${rejected} rejected AI batch actions)`);
}
