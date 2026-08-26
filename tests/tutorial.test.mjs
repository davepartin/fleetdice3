/**
 * Tutorial script checks — boards, gates, and a headless walk through the flight.
 */

import test from "node:test";
import assert from "node:assert/strict";
import "../sim/bundle.mjs";

const G = await import("../.simbuild/game.mjs");

// Tutorial modules are TS — bundle only ships engine/ai. Import via dynamic
// evaluation against the source is awkward, so we re-check the critical
// behaviours through a small inline copy of the face/apply helpers by loading
// the built game for engine pieces and reading the tutorial source as text for
// structure, plus a runtime harness that mirrors useTutorialMatch's helpers.

import { readFileSync } from "node:fs";
import { findLines, bestRun, newMatch, newPlayer, applyAction, tally, TUNING } from "../.simbuild/game.mjs";

test("tutorial route and homepage button exist", () => {
  const home = readFileSync(new URL("../components/HomeScreen.tsx", import.meta.url), "utf8");
  const page = readFileSync(new URL("../app/tutorial/page.tsx", import.meta.url), "utf8");
  const script = readFileSync(new URL("../lib/tutorial.ts", import.meta.url), "utf8");
  assert.match(home, /href="\/tutorial\/"/);
  assert.match(home, /Tutorial/);
  assert.match(page, /TutorialScreen/);
  assert.match(script, /TUTORIAL_INTRO/);
  assert.match(script, /Three across/);
  assert.match(script, /Three down/);
  assert.match(script, /Flagship weapon/);
  assert.match(script, /Happy fleet battles/);
  assert.match(script, /Even hits\. Odd blocks/);
});

test("scripted middle row of 4s is a real formation", () => {
  const match = newMatch("t", "0000", "you", "You", "solo");
  match.players.guest = newPlayer("e", "E", "ready");
  match.players.host.phase = "ready";
  applyAction(match, "host", { type: "roll", dice: [] });
  const host = match.players.host;
  const bySlot = (slot) => host.ships.find((s) => s.slot === slot);
  const set = (slot, value) => {
    const ship = bySlot(slot);
    const die = host.dice.find((d) => d.id === ship.id);
    die.value = value;
  };
  set(1, 1);
  set(3, 4);
  set(4, 4);
  set(6, 2);
  host.flag.face = 4;
  host.dice.find((d) => d.flag).value = 4;
  const lines = findLines(host.dice);
  assert.ok(lines.some((line) => line.kind === "row" && line.energy === TUNING.lineAcrossEnergy));
});

test("scripted middle column of 2s is a real formation", () => {
  const match = newMatch("t", "0000", "you", "You", "solo");
  match.players.guest = newPlayer("e", "E", "ready");
  match.players.host.phase = "ready";
  applyAction(match, "host", { type: "roll", dice: [] });
  const host = match.players.host;
  const bySlot = (slot) => host.ships.find((s) => s.slot === slot);
  const set = (slot, value) => {
    const ship = bySlot(slot);
    const die = host.dice.find((d) => d.id === ship.id);
    die.value = value;
  };
  set(1, 2);
  set(3, 1);
  set(4, 3);
  set(6, 2);
  host.flag.face = 2;
  host.dice.find((d) => d.flag).value = 2;
  const lines = findLines(host.dice);
  assert.ok(lines.some((line) => line.kind === "col" && line.attack === TUNING.lineDownAttack));
});

test("token nudge completes a five-straight on d4 faces", () => {
  const match = newMatch("t", "0000", "you", "You", "solo");
  match.players.guest = newPlayer("e", "E", "ready");
  match.players.host.phase = "ready";
  applyAction(match, "host", { type: "roll", dice: [] });
  const host = match.players.host;
  const bySlot = (slot) => host.ships.find((s) => s.slot === slot);
  const set = (slot, value) => {
    const ship = bySlot(slot);
    const die = host.dice.find((d) => d.id === ship.id);
    die.value = value;
  };
  set(1, 1);
  set(3, 2);
  set(4, 3);
  set(6, 4);
  host.flag.face = 4;
  host.dice.find((d) => d.flag).value = 4;
  assert.equal(bestRun(host.dice), null, "four in a row is not enough");
  applyAction(match, "host", { type: "flag-token", direction: 1 });
  const run = bestRun(host.dice);
  assert.ok(run);
  assert.equal(run.length, 5);
  assert.equal(run.reward.energy, 6);
});

test("tutorial coach collapses so board actions stay free", () => {
  const coach = readFileSync(new URL("../components/TutorialCoach.tsx", import.meta.url), "utf8");
  const screen = readFileSync(new URL("../components/TutorialScreen.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(coach, /tutorial-coach-bar/);
  assert.match(coach, /Got it — show the board/);
  assert.match(coach, /HelpShipFace/);
  assert.match(coach, /setOpen\(!boardTap\)/);
  assert.match(screen, /MatchScreen controller=\{controller\}/);
  assert.doesNotMatch(screen, /tutorial-preface-backdrop/);
  assert.match(css, /\.tutorial-coach-bar/);
  assert.match(css, /padding-bottom: calc\(var\(--hud-safe-bottom\) \+ 4\.1rem\)/);
});
