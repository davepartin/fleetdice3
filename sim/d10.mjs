/**
 * Why does the worst tier finish with the most d10s?
 *
 * The open question in BALANCE.md is "d10 looks mispriced at 13": Expert ends
 * ~6% d10 and Low ends ~39%. Before touching the price, rule out the confounds.
 * A tier could finish with more d10s because it *prefers* them, or merely
 * because its matches run longer and it therefore banks more Energy.
 *
 *   node sim/d10.mjs [n]
 */
import { bundlePath } from "./bundle.mjs";
const G = await import(bundlePath);
const { PLANS, TUNING, applyAction, applyDifficultyStart, makeRng, newBrain,
        newMatch, newPlayer, nextActions, priceOf, setRng } = G;

const N = Number(process.argv[2] ?? 200);
const TIERS = ["low", "medium", "hard", "expert"];

function playTier(tier, n) {
  const s0 = { rounds: 0, energyEarned: 0, energySpent: 0,
               boughtFresh: { 4: 0, 6: 0, 8: 0, 10: 0 },
               upgradesTo: { 6: 0, 8: 0, 10: 0 },
               slots: 0, flagship: 0,
               finalMix: { 4: 0, 6: 0, 8: 0, 10: 0 },
               d10Round: [], ships: 0, cmdrs: 0 };
  for (let i = 0; i < n; i += 1) {
    setRng(makeRng(313 + i * 7919));
    const s = newMatch("d10", "0000", "A", "A", "versus");
    s.players.guest = newPlayer("B", "B", "ready");
    applyDifficultyStart(s.players.host, tier);
    applyDifficultyStart(s.players.guest, tier);
    s.status = "active";
    s.players.host.phase = "ready";
    const brains = { host: newBrain(PLANS[i % 5], tier), guest: newBrain(PLANS[(i + 2) % 5], tier) };
    const before = { host: s.players.host.energy, guest: s.players.guest.energy };
    let guard = 0;
    while (s.status !== "finished" && guard < 4000) {
      guard += 1;
      let moved = false;
      for (const side of ["host", "guest"]) {
        for (const a of nextActions(s, side, brains[side])) {
          if (s.status === "finished") break;
          const p = s.players[side];
          // Record the shop action before applying it, and only if it lands.
          const energyBefore = p.energy;
          let ok = true;
          try { applyAction(s, side, a); moved = true; } catch { ok = false; }
          if (!ok || a.type !== "shop") continue;
          s0.energySpent += energyBefore - p.energy;
          if (a.operation === "buy") {
            s0.boughtFresh[a.sides] += 1;
            if (a.sides === 10) s0.d10Round.push(p.round);
          } else if (a.operation === "upgrade") {
            const ship = p.ships.find((sh) => sh.id === a.shipId);
            if (ship) {
              s0.upgradesTo[ship.sides] += 1;
              if (ship.sides === 10) s0.d10Round.push(p.round);
            }
          } else if (a.operation === "slot") s0.slots += 1;
          else if (a.operation === "flagship") s0.flagship += 1;
        }
      }
      if (!moved) break;
    }
    for (const side of ["host", "guest"]) {
      const p = s.players[side];
      s0.cmdrs += 1;
      s0.ships += p.ships.length;
      for (const sh of p.ships) s0.finalMix[sh.sides] += 1;
      s0.energyEarned += p.stats.energyEarned ?? 0;
    }
    s0.rounds += Math.max(s.players.host.round, s.players.guest.round);
  }
  return s0;
}

const fmt = (v, d = 2) => v.toFixed(d);
const rows = [];
for (const tier of TIERS) {
  const r = playTier(tier, N);
  const c = r.cmdrs;
  const totalShips = Object.values(r.finalMix).reduce((a, b) => a + b, 0);
  const d10Acquired = r.boughtFresh[10] + r.upgradesTo[10];
  rows.push({
    tier,
    rounds: fmt(r.rounds / N, 1),
    spent: fmt(r.energySpent / c, 1),
    d10pct: `${((r.finalMix[10] / totalShips) * 100).toFixed(0)}%`,
    d10each: fmt(d10Acquired / c),
    fresh: fmt(r.boughtFresh[10] / c),
    upg: fmt(r.upgradesTo[10] / c),
    when: r.d10Round.length ? fmt(r.d10Round.reduce((a, b) => a + b, 0) / r.d10Round.length, 1) : "-",
    slots: fmt(r.slots / c),
    ships: fmt(r.ships / c),
  });
}

console.log(`\n=== ${N} matches per tier, both sides same tier, seeded ===\n`);
console.log("tier      rounds  spent/cmdr  final d10%  d10s/cmdr   fresh   upgrade   avg round  cells  ships");
for (const r of rows) {
  console.log(
    r.tier.padEnd(9) + r.rounds.padStart(6) + r.spent.padStart(12) +
    r.d10pct.padStart(12) + r.d10each.padStart(11) + r.fresh.padStart(8) +
    r.upg.padStart(10) + r.when.padStart(11) + r.slots.padStart(7) + r.ships.padStart(7));
}
console.log("\nfresh = bought straight into an empty cell for 13; upgrade = paid 4 to step a d8 up.");
