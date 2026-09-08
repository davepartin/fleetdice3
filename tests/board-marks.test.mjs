/**
 * A formation explains itself on whichever board it landed on.
 *
 * A column is +10 Attack — often half a volley. When the rail was drawn only
 * on your own deck, the only way to understand a big enemy number was to count
 * their dice and know the rules by heart. The rail is already the one mark for
 * that meaning, in the same two colours, so it runs on both decks.
 *
 * The run marker stays yours alone: it is orange, and on the opponent's board
 * it was mistaken for a damage symbol.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const arena = readFileSync(new URL("../lib/three/arena.ts", import.meta.url), "utf8");

test("formation rails are drawn on both decks, not just your own", () => {
  // The old shape gated the lines on `playerDeck`; the guard is that no
  // formation lookup is conditional on which deck it is.
  assert.doesNotMatch(
    arena,
    /playerDeck \? \(tally\?\.lines/,
    "formation lines must not be gated on the deck being yours",
  );
  assert.match(
    arena,
    /const lines = tally\?\.lines \?\? \[\];/,
    "both decks should read the same tally lines",
  );
  assert.match(
    arena,
    /deck\.board\.setFormations\(\s*drawn\s*\)/,
    "whatever was collected should be what gets drawn",
  );
});

test("the run marker is still yours alone", () => {
  assert.match(
    arena,
    /const run = showRun && playerDeck \?/,
    "the orange run marker stays on your own deck — it reads as damage on theirs",
  );
});

test("nothing is drawn on the enemy deck until their dice are revealed", () => {
  // `show` for the enemy deck is the reveal flag, and applyScoreMarks clears
  // everything when show is false. That is what stops a rail leaking a
  // formation before the volley.
  assert.match(arena, /syncDeck\("enemy", them, reveal, opts\)/,
    "the enemy deck's `show` must remain the reveal flag");
  assert.match(arena, /if \(!show\) \{[\s\S]{0,240}setFormations\(\[\]\)/,
    "applyScoreMarks must clear formations when the deck is not revealed");
});

test("the flagship weapon turns the centre die in place instead of throwing it", () => {
  assert.match(
    arena,
    /tokenTurn/,
    "a flagship-weapon face change must be named, not treated as a roll",
  );
  assert.match(
    arena,
    /id === "flag" && changed && !asked/,
    "only your flag, and only when it was not sent back as a reroll",
  );
  assert.match(
    arena,
    /if \(opts\.instant \|\| tokenTurn\)/,
    "the weapon must set the face, not throwTo",
  );
});
