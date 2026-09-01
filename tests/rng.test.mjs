/**
 * One bag of dice, not two.
 *
 * The engine's randomness is injectable (`setRng`/`makeRng`) so a simulation
 * can be replayed exactly. That guarantee is only worth anything if *every*
 * roll of the dice in a match comes out of that one seeded bag — including the
 * coin flips inside the opponent's brain, which is how the weaker tiers are
 * made to take a worse line on purpose.
 *
 * `lib/ai.ts` used to call `Math.random()` in four places, so a seeded run of
 * Low or Medium did not reproduce itself: the dice repeated but the opponent's
 * mistakes did not. Hard and Expert were unaffected, because at `greed: 1` the
 * coin flip short-circuits and is never reached.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { bundlePath } from "../sim/bundle.mjs";

const G = await import(bundlePath);
const { PLANS, TUNING, applyAction, applyDifficultyStart, makeRng, newBrain, newMatch,
        newPlayer, nextActions, rollsLeft, setRng } = G;

test("the opponent brain never reaches for Math.random", () => {
  // Comment lines are skipped so the note above can name the thing it bans.
  const src = readFileSync(new URL("../lib/ai.ts", import.meta.url), "utf8");
  const offenders = src
    .split("\n")
    .map((line, i) => ({ line: line.trim(), n: i + 1 }))
    .filter(({ line }) => !line.startsWith("*") && !line.startsWith("//") && !line.startsWith("/*"))
    .filter(({ line }) => /Math\.random/.test(line));

  assert.deepEqual(
    offenders,
    [],
    `lib/ai.ts must draw from the engine's seeded RNG — import { random } from "./engine" ` +
      `instead. Offending line(s): ${offenders.map((o) => `${o.n}: ${o.line}`).join(" | ")}`,
  );
});

/** Play one whole match and return something that captures how it went. */
function fingerprint(tier, seed) {
  setRng(makeRng(seed));
  const s = newMatch("rng", "0000", "A", "A", "versus");
  s.players.guest = newPlayer("B", "B", "ready");
  applyDifficultyStart(s.players.host, tier);
  applyDifficultyStart(s.players.guest, tier);
  s.status = "active";
  s.players.host.phase = "ready";
  const brains = { host: newBrain(PLANS[0], tier), guest: newBrain(PLANS[2], tier) };
  let guard = 0;
  while (s.status !== "finished" && guard < 4000) {
    guard += 1;
    let moved = false;
    for (const side of ["host", "guest"]) {
      for (const a of nextActions(s, side, brains[side])) {
        if (s.status === "finished") break;
        try {
          applyAction(s, side, a);
          moved = true;
        } catch {}
      }
    }
    if (!moved) break;
  }
  return ["host", "guest"]
    .map((side) => {
      const p = s.players[side];
      return [p.health, p.energy, p.round, p.stats.straights, p.stats.rows, p.stats.cols,
              p.ships.map((sh) => sh.sides).join("/")].join(",");
    })
    .join(" | ");
}

// Low and Medium are the tiers that make deliberate mistakes (greed 0.5 and
// 0.85). They are the ones the old bug moved, so they are the ones worth
// pinning. Hard and Expert are in the list to prove the fix broke nothing.
for (const tier of ["low", "medium", "hard", "expert"]) {
  test(`a seeded ${tier} match replays exactly`, () => {
    const first = fingerprint(tier, 4242);
    const again = fingerprint(tier, 4242);
    assert.equal(again, first, `${tier} did not reproduce itself from the same seed`);
  });
}

test("a different seed really does play a different match", () => {
  // Guards the test above from passing for the wrong reason — if the match
  // were deterministic regardless of seed, replay would be trivially true.
  assert.notEqual(fingerprint("medium", 4242), fingerprint("medium", 99));
});

/* ------------------------------------------------------------------ */
/* The reroll cap                                                      */
/* ------------------------------------------------------------------ */

test("a round allows the free rolls and no more than the paid ones", () => {
  setRng(makeRng(31337));
  const s = newMatch("cap", "0000", "A", "A", "versus");
  s.players.guest = newPlayer("B", "B", "ready");
  s.status = "active";
  s.players.host.phase = "ready";
  const p = s.players.host;
  p.energy = 999; // never the binding constraint — the cap is the experiment

  applyAction(s, "host", { type: "roll", dice: [] }); // the opening roll
  assert.equal(p.rolls, 1);

  const all = () => p.dice.map((d) => d.id);
  let taken = 1;
  for (let i = 0; i < 20; i += 1) {
    try {
      applyAction(s, "host", { type: "roll", dice: all() });
      taken += 1;
    } catch {
      break;
    }
  }
  assert.equal(
    taken,
    TUNING.rollsPerRound + TUNING.paidRollsPerRound,
    "a round should allow exactly rollsPerRound + paidRollsPerRound rolls",
  );
  assert.equal(rollsLeft(p), 0);
  assert.throws(() => applyAction(s, "host", { type: "roll", dice: all() }), /out of rerolls/i);
});

test("a rich commander cannot buy past the cap", () => {
  // The whole point of the rule: Energy stops being the limit.
  setRng(makeRng(4242));
  const s = newMatch("cap2", "0000", "A", "A", "versus");
  s.players.guest = newPlayer("B", "B", "ready");
  s.status = "active";
  s.players.host.phase = "ready";
  const p = s.players.host;
  p.energy = 10000;
  applyAction(s, "host", { type: "roll", dice: [] });
  let taken = 1;
  for (let i = 0; i < 50; i += 1) {
    try {
      applyAction(s, "host", { type: "roll", dice: p.dice.map((d) => d.id) });
      taken += 1;
    } catch { break; }
  }
  assert.equal(taken, TUNING.rollsPerRound + TUNING.paidRollsPerRound);
  assert.ok(p.energy > 9000, "should still be rich — the cap bound, not the bank");
});

test("the free rolls really are free, and the paid ones really are charged", () => {
  setRng(makeRng(777));
  const s = newMatch("cap3", "0000", "A", "A", "versus");
  s.players.guest = newPlayer("B", "B", "ready");
  s.status = "active";
  s.players.host.phase = "ready";
  const p = s.players.host;
  p.energy = 500;
  applyAction(s, "host", { type: "roll", dice: [] });
  const before = p.energy;
  // Free rolls: the opening one counted as 1, so rollsPerRound - 1 remain free.
  for (let i = 1; i < TUNING.rollsPerRound; i += 1) {
    applyAction(s, "host", { type: "roll", dice: [p.dice[0].id] });
  }
  assert.equal(p.energy, before, "rolls inside rollsPerRound must cost nothing");
  const twoDice = p.dice.slice(0, 2).map((d) => d.id);
  applyAction(s, "host", { type: "roll", dice: twoDice });
  assert.equal(p.energy, before - 2, "a paid reroll costs 1 Energy per die sent back");
});

test("the help screen and the tutorial state the rule the engine enforces", () => {
  // The house rule: a balance change must not be able to leave a sentence on
  // screen lying. Both places must interpolate, not hardcode.
  for (const file of ["../components/HowToPlay.tsx", "../lib/tutorial.ts"]) {
    const src = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.match(src, /TUNING\.rollsPerRound/, `${file} must read rollsPerRound from TUNING`);
    assert.match(src, /TUNING\.paidRollsPerRound/, `${file} must read paidRollsPerRound from TUNING`);
    assert.doesNotMatch(
      src,
      /each die costs 1 Energy|spend 1 Energy per die/,
      `${file} still hardcodes the old reroll sentence`,
    );
  }
});
