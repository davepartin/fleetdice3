/**
 * Your solo record, checked for the ways a counter quietly goes wrong.
 *
 * This store is the only evidence of how a real person does against each tier,
 * so a double-count or a lost match is not a cosmetic bug — it is a balance
 * decision made on bad data.
 *
 *   node --test tests/
 */

import test from "node:test";
import assert from "node:assert/strict";
import { bundlePath } from "../sim/bundle.mjs";

const G = await import(bundlePath);
const { applyResult, emptyRecord, played, suggestStepUp, winRate } = G;

const result = (over = {}) => ({
  matchId: "m1",
  difficulty: "medium",
  outcome: "win",
  rounds: 7,
  hpLeft: 24,
  ...over,
});

test("a finished match lands on the tier it was played on", () => {
  const store = applyResult(emptyRecord(), result());
  assert.equal(store.tiers.medium.wins, 1);
  assert.equal(store.tiers.medium.losses, 0);
  assert.equal(store.tiers.medium.roundsTotal, 7);
  assert.equal(store.tiers.medium.hpLeftTotal, 24);
  assert.equal(store.tiers.hard, undefined, "no other tier is touched");
});

test("the same match folded twice is counted once", () => {
  const once = applyResult(emptyRecord(), result());
  const twice = applyResult(once, result());
  assert.equal(twice, once, "an already-recorded id returns the very same store");
  assert.equal(twice.tiers.medium.wins, 1);
});

test("a different match on the same tier does count", () => {
  let store = applyResult(emptyRecord(), result());
  store = applyResult(store, result({ matchId: "m2", outcome: "loss" }));
  assert.equal(played(store.tiers.medium), 2);
  assert.equal(store.tiers.medium.wins, 1);
  assert.equal(store.tiers.medium.losses, 1);
});

test("a draw is half a win, not a loss", () => {
  let store = emptyRecord();
  store = applyResult(store, result({ matchId: "a", outcome: "draw" }));
  store = applyResult(store, result({ matchId: "b", outcome: "draw" }));
  store = applyResult(store, result({ matchId: "c", outcome: "loss" }));
  assert.equal(store.tiers.medium.draws, 2);
  assert.equal(winRate(store.tiers.medium), 1 / 3);
});

test("a win rate stays hidden until it means anything", () => {
  let store = emptyRecord();
  store = applyResult(store, result({ matchId: "a" }));
  assert.equal(winRate(store.tiers.medium), null, "one match is not a win rate");
  store = applyResult(store, result({ matchId: "b" }));
  assert.equal(winRate(store.tiers.medium), null);
  store = applyResult(store, result({ matchId: "c" }));
  assert.equal(winRate(store.tiers.medium), 1, "three is enough to say something");
});

test("the step-up suggestion needs evidence, and only ever points upward", () => {
  let store = emptyRecord();
  assert.equal(suggestStepUp(store, "medium"), null, "no games, no opinion");

  // 2 of 3 on Medium is 66%, over the bar.
  store = applyResult(store, result({ matchId: "a", outcome: "win" }));
  store = applyResult(store, result({ matchId: "b", outcome: "win" }));
  store = applyResult(store, result({ matchId: "c", outcome: "loss" }));
  assert.equal(suggestStepUp(store, "medium"), "hard");

  // Losing on a tier is never met with a suggestion to drop down.
  let losing = emptyRecord();
  for (const id of ["a", "b", "c", "d"]) {
    losing = applyResult(losing, result({ matchId: id, difficulty: "hard", outcome: "loss" }));
  }
  assert.equal(suggestStepUp(losing, "hard"), null);
  assert.equal(suggestStepUp(losing, "low"), null);
});

test("there is nothing above the top tier to suggest", () => {
  let store = emptyRecord();
  for (const id of ["a", "b", "c"]) {
    store = applyResult(store, result({ matchId: id, difficulty: "expert", outcome: "win" }));
  }
  assert.equal(suggestStepUp(store, "expert"), null);
});
