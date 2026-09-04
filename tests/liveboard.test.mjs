/**
 * "Now on the field" has to mean now.
 *
 * Found by the owner: a versus match showing "Round 3 · Sam vs Alex" had been
 * on the public board for eleven days. Waiting rooms were dropped after 45
 * minutes of silence, but a match already in progress was kept whatever its
 * age — so any match somebody walked away from stayed on the board for ever.
 *
 * The rule lives in `lib/liveboard.ts`, kept free of the Firebase SDK so it can
 * be tested directly — and so there is only ever one copy of it.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { bundlePath } from "../sim/bundle.mjs";

const G = await import(bundlePath);
const { ACTIVE_STALE_MS, WAITING_STALE_MS, isOnTheField } = G;

// The real function `watchLiveBattles` filters with, not a copy of it. The
// first version of this file re-implemented the rule, which would have gone on
// passing after the rule itself changed.
const NOW = Date.UTC(2026, 8, 2, 12, 0, 0);
const shown = (status, idleMs) =>
  isOnTheField(status, idleMs === null ? null : new Date(NOW - idleMs), NOW);

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

test("a match being played right now is on the board", () => {
  assert.equal(shown("active", 5 * MINUTE), true);
  assert.equal(shown("waiting", 5 * MINUTE), true);
});

test("the eleven-day match that started this is gone", () => {
  assert.equal(shown("active", 11 * DAY), false, "Sam vs Alex, Round 3, eleven days idle");
});

test("a match can pause for a meal without vanishing", () => {
  // The window is generous on purpose: nothing is lost by keeping a paused
  // match listed, and the row returns the moment anyone acts.
  assert.equal(shown("active", 90 * MINUTE), true);
});

test("an empty room goes quiet sooner than a match in progress", () => {
  assert.ok(WAITING_STALE_MS < ACTIVE_STALE_MS,
    "a room with nobody in it has less to show for itself than a game underway");
  assert.equal(shown("waiting", 2 * HOUR), false);
  assert.equal(shown("active", 2 * HOUR), true, "same age, different answer");
});

test("a row with no timestamp is not shown", () => {
  assert.equal(shown("active", null), false);
  assert.equal(shown("waiting", null), false);
});

test("the windows are sane numbers, not typos", () => {
  assert.equal(WAITING_STALE_MS, 45 * MINUTE);
  assert.equal(ACTIVE_STALE_MS, 3 * HOUR);
  assert.ok(ACTIVE_STALE_MS < DAY, "a day-old match is not 'now on the field'");
});
