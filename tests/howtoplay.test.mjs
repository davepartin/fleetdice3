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
  // The prizes are shown as symbol + number, not spelled out in words.
  assert.match(src, /StatIcon/);
  assert.doesNotMatch(src, /setOpenId/);
  assert.doesNotMatch(src, /aria-expanded/);
});

test("the game never says brace, soak or absorb — only shields and blocking", () => {
  // Shields are what the blue odd faces roll; blocking is what a ship does
  // when it steps in front of damage. Those two words carry the whole idea,
  // so no screen is allowed to reach for a third.
  const files = [
    "../components/HowToPlay.tsx",
    "../components/MatchScreen.tsx",
    "../components/RoundReport.tsx",
    "../components/BattleRecap.tsx",
    "../components/ui.tsx",
    "../lib/reference.ts",
    "../lib/tutorial.ts",
  ];
  // Comment lines are skipped: this is about words a player can read, and
  // the note explaining the rule has to be able to name the words it bans.
  // Code identifiers keep their original names too — renaming the engine's
  // `brace` action is a far bigger change than the words on screen.
  const banned = /\b(soak(s|ed|ing)?|absorb(s|ed|ing)?)\b/i;
  const isComment = (line) => /^\s*(\/\/|\/\*|\*)/.test(line);
  for (const file of files) {
    const src = readFileSync(new URL(file, import.meta.url), "utf8");
    for (const line of src.split("\n")) {
      if (isComment(line)) continue;
      assert.doesNotMatch(line, banned, `${file}: ${line.trim()}`);
    }
  }
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
