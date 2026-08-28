/**
 * Tutorial script checks — boards, gates, and a headless walk through the flight.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { bundlePath } from "../sim/bundle.mjs";

const G = await import(bundlePath);

// Tutorial modules are TS — bundle only ships engine/ai. Import via dynamic
// evaluation against the source is awkward, so we re-check the critical
// behaviours through a small inline copy of the face/apply helpers by loading
// the built game for engine pieces and reading the tutorial source as text for
// structure, plus a runtime harness that mirrors useTutorialMatch's helpers.

import { readFileSync } from "node:fs";
const { findLines, bestRun, newMatch, newPlayer, applyAction, tally, TUNING } = G;

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

test("the coach is a minimize/maximize overlay, not a card that relocates itself", () => {
  const coach = readFileSync(new URL("../components/TutorialCoach.tsx", import.meta.url), "utf8");
  const screen = readFileSync(new URL("../components/TutorialScreen.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

  // Two earlier designs tried to dodge the board (and, once, the flagship
  // weapon control) by repositioning the card based on which screen or
  // phase was live. The game's own layout has to stay put now, so the coach
  // is a single, stable, always-top-anchored overlay — no per-phase override.
  const block = css.match(/\.tutorial-coach \{[^}]*\}/);
  assert.ok(block, "the coach needs a positioning block");
  assert.match(block[0], /top:/, "the coach anchors to a fixed top position");
  assert.doesNotMatch(css, /data-phase/, "positioning must not depend on which phase is live");
  assert.doesNotMatch(coach, /tutorial-action-clear/, "no measured clearance — the anchor no longer moves");

  // The player decides whether to see the full tip or the board — a real
  // minimize/maximize toggle, not an automatic reposition.
  assert.match(coach, /useState/, "maximized/minimized needs real component state");
  assert.match(coach, /setMaximized\(true\)/, "a fresh step must open maximized so the tip gets read");
  assert.match(coach, /setMaximized\(false\)/, "there must be an explicit way to minimize");
  assert.match(coach, /tutorial-coach-bar/, "the minimized state renders as its own slim bar");
  assert.match(coach, /Minimize/, "the maximize->minimize control must be labeled, not just an icon");
  assert.match(coach, /Show tip/, "the minimize->maximize control must be labeled, not just an icon");

  // The bar has to be a real, small, fixed-height affordance — not another
  // measured-and-guessed height like the two designs before it.
  const barBlock = css.match(/\.tutorial-coach-bar \{[^}]*\}/);
  assert.ok(barBlock, "the minimized bar needs its own style block");
  assert.doesNotMatch(barBlock[0], /max-height|height:/, "the bar's height comes from its content, not a guess");

  // The shipyard still needs its grid pushed clear, but now against the
  // bar's fixed height, not a value read off the current card.
  const yardBlock = css.match(/\.tutorial-shell \.yard \{[^}]*\}/);
  assert.ok(yardBlock, "the shipyard needs its own push-down rule");
  assert.doesNotMatch(yardBlock[0], /var\(--tutorial/, "the push-down must be a fixed constant, not measured");

  // The board is never veiled — the dice are the subject of the lesson.
  assert.doesNotMatch(css, /\.tutorial-preface-scrim/);

  assert.match(coach, /HelpShipFace/, "tips still show real dice art");
});

test("the coach and theme buttons live outside their own scroll region", () => {
  const coach = readFileSync(new URL("../components/TutorialCoach.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

  // A long tip or a long theme paragraph must scroll *inside* the card, but
  // the button that actually advances the tutorial has to stay outside that
  // scrollable box — otherwise it can end up hidden behind a scroll gesture
  // the player never discovers, which is exactly what real-device testing
  // caught: the card's own overflow:auto region swallowed its footer.
  assert.match(coach, /tutorial-coach-scroll/, "coach body needs its own scroll wrapper");
  assert.match(coach, /tutorial-theme-scroll/, "theme paragraphs need their own scroll wrapper");

  const scrollBefore = coach.indexOf("tutorial-coach-scroll");
  const footBefore = coach.indexOf("tutorial-coach-foot");
  assert.ok(scrollBefore > 0 && footBefore > scrollBefore, "coach foot must render after (sibling to) the scroll wrapper");

  const themeScrollBefore = coach.indexOf("tutorial-theme-scroll");
  const actionsBefore = coach.indexOf("tutorial-theme-actions");
  assert.ok(themeScrollBefore > 0 && actionsBefore > themeScrollBefore, "theme actions must render after (sibling to) the scroll wrapper");

  // The overflow:auto must sit on the *-scroll class, never on the outer
  // card class — putting it on the card is what traps the footer inside it.
  const cardBlock = css.match(/\.tutorial-coach-card \{[^}]*\}/);
  const themeCardBlock = css.match(/\.tutorial-theme-card \{[^}]*\}/);
  assert.ok(cardBlock && !/overflow/.test(cardBlock[0]), "coach card itself must not scroll");
  assert.ok(themeCardBlock && !/overflow/.test(themeCardBlock[0]), "theme card itself must not scroll");

  const coachScrollBlock = css.match(/\.tutorial-coach-scroll \{[^}]*\}/);
  const themeScrollBlock = css.match(/\.tutorial-theme-scroll \{[^}]*\}/);
  assert.ok(coachScrollBlock && /overflow-y:\s*auto/.test(coachScrollBlock[0]));
  assert.ok(themeScrollBlock && /overflow-y:\s*auto/.test(themeScrollBlock[0]));
});

test("action steps spotlight the control they name", () => {
  const coach = readFileSync(new URL("../components/TutorialCoach.tsx", import.meta.url), "utf8");
  const screen = readFileSync(new URL("../components/TutorialScreen.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

  assert.match(screen, /MatchScreen controller=\{controller\}/);
  assert.match(screen, /data-awaiting/, "the shell publishes what the step wants");
  assert.match(coach, /export function awaitedAction/);

  // Each awaited action has to actually light something up, or the arrow in
  // the coach points at nothing.
  const keys = ["roll", "reroll", "submit", "continue", "brace", "ready", "token",
    "shopSlot", "shopBuy", "shopUpgrade"];
  for (const key of keys) {
    assert.match(
      css,
      new RegExp(`\\[data-awaiting="${key}"\\]`),
      `no spotlight rule for the "${key}" step`,
    );
  }
  assert.match(css, /@keyframes tutorial-spotlight/);
});
