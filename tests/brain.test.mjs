/**
 * The opponent's eye for Energy, which is what separates the tiers.
 *
 * `WEIGHTS.energy` was 1.45 for every tier, and `nearFormation` used it to
 * decide which line to hunt: a row pays `lineAcrossEnergy` (5) Energy, a column
 * pays `lineDownAttack` (10) Attack. At 1.45 a row scored 7.25 against a
 * column's 10, so every brain on every tier chased columns and only columns,
 * whatever the board looked like.
 *
 * Measured on paired seeds, moving that one number is worth about 72% against
 * the old brain, and it widened every rung of the difficulty ladder. Valuing
 * Energy properly is the actual skill in this game — it compounds into hulls
 * and bays — so it is the right thing to separate the tiers on.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { bundlePath } from "../sim/bundle.mjs";

const G = await import(bundlePath);
const { DIFFICULTIES, DIFFICULTY, TUNING, WEIGHTS, nearFormation, valueOfTally } = G;

test("each tier values Energy more highly than the one below it", () => {
  const weights = DIFFICULTIES.map((d) => DIFFICULTY[d].energyWeight);
  for (let i = 1; i < weights.length; i += 1) {
    assert.ok(
      weights[i] > weights[i - 1],
      `${DIFFICULTIES[i]} (${weights[i]}) should out-value ${DIFFICULTIES[i - 1]} (${weights[i - 1]})`,
    );
  }
});

test("the easiest tier still plays the way it always did", () => {
  // A beginner's first game should not have changed. 1.45 is the number every
  // tier used before this was measured.
  assert.equal(DIFFICULTY.low.energyWeight, WEIGHTS.energy);
});

test("a low weight hunts the column, a high weight hunts the row", () => {
  // Two 3s down the middle column and two 5s across the middle row, each with
  // one odd die left to chase. Which one the brain goes after is the whole
  // behaviour this fixes.
  // slot -> cell is 0,1,2,3 then 5,6,7,8; the flagship holds cell 4 and so sits
  // in both the middle row (3,4,5) and the middle column (1,4,7).
  const dice = [
    { id: "a", sides: 6, value: 3, slot: 1 },        // cell 1 — column
    { id: "flag", sides: 6, value: 3, flag: true },  // cell 4 — both lines
    { id: "e", sides: 6, value: 1, slot: 6 },        // cell 7 — column, the odd one
    { id: "b", sides: 6, value: 5, slot: 3 },        // cell 3 — row
    { id: "d", sides: 6, value: 5, slot: 4 },        // cell 5 — row
  ];
  // The column is two 3s (cells 1 and 4) with a 1 at cell 7; the row is two 5s
  // (cells 3 and 5) with the flagship's 3 in the middle. Both are one die away.
  const low = nearFormation(dice, 1.0);
  const high = nearFormation(dice, 4.0);
  assert.ok(low && high, "both should find something to chase");
  assert.equal(low.kind, "col", "cheap Energy makes the column's 10 Attack the bigger prize");
  assert.equal(high.kind, "row", "dear Energy makes the row worth more than the column");
});

test("the row overtakes the column exactly where the arithmetic says", () => {
  // A row is worth lineAcrossEnergy x weight; a column is a flat lineDownAttack.
  const tipping = TUNING.lineDownAttack / TUNING.lineAcrossEnergy;
  assert.ok(DIFFICULTY.low.energyWeight < tipping, "Low sits below the tipping point");
  assert.ok(DIFFICULTY.expert.energyWeight > tipping, "Expert sits above it");
});

test("valuing Energy higher raises what a roll is worth", () => {
  const t = {
    attack: 4, defense: 2, energy: 5, heal: 0, direct: 0, lines: [], run: null,
    face: 1, flagBonus: { attack: 0, defense: 0, energy: 0, heal: 0, direct: 0 },
  };
  const cheap = valueOfTally(t, { hpRatio: 1, pressure: 0, energyWeight: 1.45 });
  const dear = valueOfTally(t, { hpRatio: 1, pressure: 0, energyWeight: 4.2 });
  assert.ok(dear > cheap, "the same roll is worth more to a commander who wants Energy");
});
