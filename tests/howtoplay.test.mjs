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
  assert.match(src, /help-shop-row/);
  assert.doesNotMatch(src, /setOpenId/);
  assert.doesNotMatch(src, /aria-expanded/);
  assert.doesNotMatch(src, /help-data/);
  assert.doesNotMatch(src, /shopTable/);
});

test("help faces are painted with the same plates as the 3D dice", () => {
  const src = readFileSync(new URL("../lib/three/faceArt.ts", import.meta.url), "utf8");
  assert.match(src, /export function paintHelpFace/);
  assert.match(src, /paintFace\(ctx, spec, sides, size, "albedo", numberFont\)/);
});
