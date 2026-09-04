/**
 * What does the brain see when it walks into the shipyard?
 *
 * The received explanation is that `buyScore` divides by cost, so cheap
 * upgrades always beat expensive bays. The arithmetic does not support that: a
 * bay scores 7.5/11 = 0.68 and a d4->d6 upgrade 1.3/2 = 0.65. So before
 * changing anything, measure what the brain can actually afford when it shops.
 *
 *   node sim/shop.mjs [n] [tier]
 */
import { bundlePath } from "./bundle.mjs";
const G = await import(bundlePath);
const { PLANS, TUNING, applyAction, applyDifficultyStart, makeRng, newBrain, newMatch,
        newPlayer, nextActions, nextSlotCost, priceOf, setRng } = G;

const N = Number(process.argv[2] ?? 150);
const TIER = process.argv[3] ?? "hard";

let visits = 0, couldAffordBay = 0, couldAffordBayAndHull = 0, boughtBay = 0;
let energyAtShop = 0, spentAtShop = 0, leftOver = 0;
const histogram = new Map();

for (let i = 0; i < N; i += 1) {
  setRng(makeRng(313 + i * 7919));
  const s = newMatch("shop", "0000", "A", "A", "versus");
  s.players.guest = newPlayer("B", "B", "ready");
  applyDifficultyStart(s.players.host, TIER);
  applyDifficultyStart(s.players.guest, TIER);
  s.status = "active";
  s.players.host.phase = "ready";
  const brains = { host: newBrain(PLANS[i % 5], TIER), guest: newBrain(PLANS[(i + 2) % 5], TIER) };
  let guard = 0;
  const seen = new Set();
  while (s.status !== "finished" && guard < 4000) {
    guard += 1;
    let moved = false;
    for (const side of ["host", "guest"]) {
      const p = s.players[side];
      // Snapshot the moment the shipyard opens, once per round per commander.
      const key = `${side}:${p.round}`;
      if (p.phase === "shop" && !seen.has(key)) {
        seen.add(key);
        visits += 1;
        energyAtShop += p.energy;
        const bay = nextSlotCost(p);
        if (bay !== null && bay <= p.energy) couldAffordBay += 1;
        if (bay !== null && bay + priceOf(4) <= p.energy) couldAffordBayAndHull += 1;
        const bucket = Math.min(20, Math.floor(p.energy / 2) * 2);
        histogram.set(bucket, (histogram.get(bucket) ?? 0) + 1);
        const before = p.energy;
        for (const a of nextActions(s, side, brains[side])) {
          if (s.status === "finished") break;
          if (a.type === "shop" && a.operation === "slot") boughtBay += 1;
          try { applyAction(s, side, a); moved = true; } catch {}
        }
        spentAtShop += before - p.energy;
        leftOver += p.energy;
        continue;
      }
      for (const a of nextActions(s, side, brains[side])) {
        if (s.status === "finished") break;
        try { applyAction(s, side, a); moved = true; } catch {}
      }
    }
    if (!moved) break;
  }
}

const pc = (v) => `${((v / visits) * 100).toFixed(1)}%`;
console.log(`\n=== ${TIER}, ${N} matches, ${visits} shipyard visits ===\n`);
console.log(`  Energy in hand on arriving      ${(energyAtShop / visits).toFixed(1)}`);
console.log(`  Energy spent                    ${(spentAtShop / visits).toFixed(1)}`);
console.log(`  Energy left behind              ${(leftOver / visits).toFixed(1)}`);
console.log();
console.log(`  could afford a bay              ${pc(couldAffordBay)}`);
console.log(`  could afford a bay AND a hull   ${pc(couldAffordBayAndHull)}`);
console.log(`  actually bought a bay           ${pc(boughtBay)}`);
console.log(`\n  Energy on arrival, distribution:`);
for (const k of [...histogram.keys()].sort((a, b) => a - b)) {
  const n = histogram.get(k);
  console.log(`    ${String(k).padStart(2)}+  ${"█".repeat(Math.round((n / visits) * 60))} ${pc(n)}`);
}
