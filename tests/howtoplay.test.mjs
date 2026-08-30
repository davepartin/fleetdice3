/**
 * How to play must stay one long illustrated scroll, using the same dice
 * art as the match and the same numbers as the engine.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("how to play is one illustrated scroll, not an accordion", () => {
  const src = readFileSync(new URL("../components/HowToPlay.tsx", import.meta.url), "utf8");
  assert.match(src, /HowToPlaySheet/);
  assert.match(src, /HowToPlayBody/);
  assert.match(src, /HelpShipFace/);
  assert.match(src, /HelpFlagFace/);
  assert.match(src, /HullShape/);
  assert.match(src, /from "@\/lib\/reference"/);
  // Exhaustive listings (every face, every flagship face, every straight,
  // every shop price) render as compact data tables rather than one
  // illustrated card per row — the tables reuse the same head/rows data
  // reference.ts already builds, not a hand-rolled shop-specific one.
  assert.match(src, /help-data/);
  assert.doesNotMatch(src, /setOpenId/);
  assert.doesNotMatch(src, /aria-expanded/);
});

test("help faces are painted with the same plates as the 3D dice", () => {
  const src = readFileSync(new URL("../lib/three/faceArt.ts", import.meta.url), "utf8");
  assert.match(src, /export function paintHelpFace/);
  assert.match(src, /paintFace\(ctx, spec, sides, size, "albedo", numeralFont, captionFont/);
  assert.match(src, /HELP_HULL_LAYOUT/);
});

test("each help face is clipped to the hull that first shows that number", () => {
  const help = readFileSync(new URL("../components/HelpArt.tsx", import.meta.url), "utf8");
  const reference = readFileSync(new URL("../lib/reference.ts", import.meta.url), "utf8");
  assert.match(help, /hullForFace/);
  assert.match(help, /addHullPath/);
  assert.match(help, /ctx\.clip\(\)/);
  assert.match(reference, /export function hullForFace/);
  assert.match(reference, /HULLS\.find\(\(sides\) => sides >= value\)/);
});
