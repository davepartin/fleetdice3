/**
 * How far can one commander get while the other does nothing?
 *
 * The rule this project wants: a versus match never holds a player up except
 * where it genuinely must. Both fleets roll at once, so the only thing that
 * truly needs both is the volley — `resolveSubmissions` refuses to resolve
 * until both sides have locked in on the same round.
 *
 * This freezes one commander at a chosen phase and lets the other play as fast
 * as it can, recording every phase it reaches and where it finally stalls.
 * Anything short of "shop -> rolling -> submitted" is the game stopping someone
 * before it has to.
 *
 *   node sim/lockstep.mjs [n]
 */
import { bundlePath } from "./bundle.mjs";
const G = await import(bundlePath);
const { PLANS, applyAction, applyDifficultyStart, makeRng, newBrain, newMatch,
        newPlayer, nextActions, setRng } = G;

const N = Number(process.argv[2] ?? 200);

/** Play until the given side is sitting in `phase`, with the match still live. */
function playUntil(seed, phase) {
  setRng(makeRng(seed));
  const s = newMatch("ls", "0000", "A", "A", "versus");
  s.players.guest = newPlayer("B", "B", "ready");
  applyDifficultyStart(s.players.host, "hard");
  applyDifficultyStart(s.players.guest, "hard");
  s.status = "active";
  s.players.host.phase = "ready";
  const brains = { host: newBrain(PLANS[0], "hard"), guest: newBrain(PLANS[2], "hard") };
  let guard = 0;
  while (s.status !== "finished" && guard < 4000) {
    guard += 1;
    if (s.players.guest.phase === phase && s.players.host.phase !== "over") {
      return { s, brains };
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
  return null;
}

/** With guest frozen, how far does host get? Returns the phases it passed. */
function raceAhead(s, brains) {
  const seen = [];
  let guard = 0;
  while (guard < 400) {
    guard += 1;
    const p = s.players.host;
    if (!seen.length || seen[seen.length - 1] !== p.phase) seen.push(p.phase);
    if (s.status === "finished") break;
    let moved = false;
    // Only the host acts. The guest is frozen exactly where it stood.
    for (const a of nextActions(s, "host", brains.host)) {
      if (s.status === "finished") break;
      try { applyAction(s, "host", a); moved = true; } catch {}
    }
    if (!moved) break;
  }
  return seen;
}

const results = new Map();
for (const frozenAt of ["brace", "report", "shop", "rolling"]) {
  const tally = new Map();
  let samples = 0;
  for (let i = 0; i < N; i += 1) {
    const got = playUntil(4711 + i * 7919, frozenAt);
    if (!got) continue;
    samples += 1;
    const startRound = got.s.players.host.round;
    const path = raceAhead(got.s, got.brains);
    const end = path[path.length - 1];
    const gained = got.s.players.host.round - startRound;
    const key = `${path.join(" -> ")}  |  rounds gained: ${gained}`;
    tally.set(key, (tally.get(key) ?? 0) + 1);
  }
  results.set(frozenAt, { tally, samples });
}

console.log(`\n=== One commander frozen; how far does the other get? (${N} attempts each) ===\n`);
for (const [frozenAt, { tally, samples }] of results) {
  console.log(`  While the enemy sits in "${frozenAt}"  (${samples} matches reached this)`);
  if (!samples) { console.log("      never reached\n"); continue; }
  const sorted = [...tally.entries()].sort((a, b) => b[1] - a[1]);
  for (const [path, count] of sorted.slice(0, 4)) {
    console.log(`      ${String(count).padStart(4)}  ${path}`);
  }
  console.log("");
}
console.log("  Reaching \"submitted\" means the player did everything they could:");
console.log("  blocked, read the report, shopped, rolled and locked in. Stalling");
console.log("  there is correct — the volley is the one step that needs both.");
