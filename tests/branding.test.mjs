/**
 * Fleet Dice 1 and 2 are retired. The rules in this repo are Fleet Dice only.
 * The game players see is called Fleet Dice, not Fleet Dice 3.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");

test("firestore.rules is Fleet Dice only — fd3 collections and reclaim, no FD1/2", () => {
  assert.match(rules, /^rules_version = '2';/m);
  assert.match(rules, /match \/fd3Codes\/\{code\}/);
  assert.match(rules, /match \/fd3Matches\/\{matchId\}/);
  assert.match(rules, /match \/fd3Live\/\{matchId\}/);
  assert.match(rules, /match \/fd3Results\/\{matchId\}/);
  assert.match(rules, /function reclaimingQuietGuestSeat\(\)/);

  assert.doesNotMatch(rules, /FLEET DICE 1 AND 2/);
  assert.doesNotMatch(rules, /COPIED VERBATIM/);
  assert.doesNotMatch(rules, /match \/codes\/\{/);
  assert.doesNotMatch(rules, /match \/matches\/\{/);
  assert.doesNotMatch(rules, /match \/liveBattles\/\{/);
  assert.doesNotMatch(rules, /match \/battleResults\/\{/);
});

test("players are not shown the name Fleet Dice 3", () => {
  // Comments can still mention the development name. Strings a player can
  // read — titles, help, error messages, the share sheet — must not.
  const files = [
    "../app/layout.tsx",
    "../components/HomeScreen.tsx",
    "../components/HowToPlay.tsx",
    "../lib/reference.ts",
    "../lib/rooms.ts",
    "../lib/tutorial.ts",
  ];
  const isComment = (line) => /^\s*(\/\/|\/\*|\*)/.test(line);
  for (const file of files) {
    const src = readFileSync(new URL(file, import.meta.url), "utf8");
    for (const line of src.split("\n")) {
      if (isComment(line)) continue;
      assert.doesNotMatch(line, /Fleet Dice 3/, `${file}: ${line.trim()}`);
    }
  }
});
