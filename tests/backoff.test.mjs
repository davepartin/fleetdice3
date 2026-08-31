/**
 * The reconnect schedule.
 *
 * A versus client whose listener dies is deaf until it resubscribes, so this
 * curve decides how long a player stares at a frozen board — and, on a phone
 * with no signal, how hard the radio gets hammered for nothing.
 *
 *   node --test tests/
 */

import test from "node:test";
import assert from "node:assert/strict";
import { bundlePath } from "../sim/bundle.mjs";

const G = await import(bundlePath);
const { reconnectDelay, RECONNECT_FIRST_MS, RECONNECT_MAX_MS } = G;

test("the first retry is quick enough to feel like nothing happened", () => {
  assert.equal(reconnectDelay(0), RECONNECT_FIRST_MS);
  assert.ok(RECONNECT_FIRST_MS <= 1000, "a whole second of frozen board is already a lot");
});

test("each retry backs off, so a dead network is not hammered", () => {
  const waits = [0, 1, 2, 3, 4].map((n) => reconnectDelay(n));
  for (let i = 1; i < waits.length; i += 1) {
    assert.ok(waits[i] > waits[i - 1], `retry ${i} (${waits[i]}) should wait longer than ${waits[i - 1]}`);
  }
});

test("the wait is capped, so a match is never more than that from rejoining", () => {
  assert.equal(reconnectDelay(99), RECONNECT_MAX_MS);
  assert.ok(reconnectDelay(7) <= RECONNECT_MAX_MS);
  assert.ok(RECONNECT_MAX_MS <= 15_000, "longer than this and a player has given up and refreshed");
});

test("a huge attempt count cannot overflow into an infinite wait", () => {
  // 2 ** 1024 is Infinity, and Math.min(max, Infinity) would be max — but
  // Math.min(max, NaN) is NaN, and setTimeout(NaN) fires immediately, which is
  // the hammering this exists to prevent.
  for (const attempt of [31, 1024, Number.MAX_SAFE_INTEGER]) {
    const wait = reconnectDelay(attempt);
    assert.ok(Number.isFinite(wait), `attempt ${attempt} gave ${wait}`);
    assert.equal(wait, RECONNECT_MAX_MS);
  }
});

test("a nonsense attempt still yields a sane wait", () => {
  assert.equal(reconnectDelay(-5), RECONNECT_FIRST_MS);
  assert.ok(Number.isFinite(reconnectDelay(1.7)));
});
