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
const {
  findLines,
  bestRun,
  newMatch,
  newPlayer,
  applyAction,
  tally,
  TUNING,
  TUTORIAL_STEPS,
  walkFirstFlight,
  tutorialActionAllowed,
  applyTutorialAction,
  startTutorialMatch,
  applyTutorialCoachNext,
  energyOf,
  repairOf,
  directOf,
  attackOf,
  defenseOf,
} = G;

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
  assert.equal(
    [...script.matchAll(/spotlight:\s*"board"/g)].length,
    4,
    "tour + both formations + the straight must ring the board, not a floating card",
  );
  assert.match(script, /Flagship weapon/);
  assert.match(script, /Happy fleet battles/);
  // The game keeps two words strictly apart: Shields are what odd faces
  // roll, blocking is what a ship does. Never "hits", never "brace".
  assert.match(script, /Even attacks\. Odd shields/);
  assert.doesNotMatch(script, /\bsoak|\babsorb/i);
  // The button on the yard is "Return to battle". "Leave shipyard" was a
  // ghost label — a player on a phone would hunt for a button that is not there.
  assert.match(script, /Tap Return to battle/);
  assert.doesNotMatch(script, /Leave shipyard/);
});

test("player-facing tutorial copy never says brace, hits, soak or absorb", () => {
  const coach = readFileSync(new URL("../components/TutorialCoach.tsx", import.meta.url), "utf8");
  for (const step of TUTORIAL_STEPS) {
    for (const text of [step.eyebrow, step.title, step.body, step.nextLabel ?? ""]) {
      assert.doesNotMatch(text, /\bbrac(e|ing|ed)\b/i, `${step.id}: ${text}`);
      assert.doesNotMatch(text, /\bhits\b/i, `${step.id}: ${text}`);
      assert.doesNotMatch(text, /\b(soak|absorb)/i, `${step.id}: ${text}`);
    }
  }
  assert.match(coach, /Even · Attack/);
  assert.match(coach, /Odd · Shields/);
  assert.doesNotMatch(coach, /Even · hits/);
  assert.doesNotMatch(coach, /Odd · blocks/);
});

test("face and mark tips interpolate from the engine", () => {
  const faces = TUTORIAL_STEPS.find((step) => step.id === "faces");
  const marks = TUTORIAL_STEPS.find((step) => step.id === "marks");
  assert.match(faces.body, new RegExp(`a 6 rolls ${attackOf(6)} Attack`));
  assert.match(faces.body, new RegExp(`a 5 rolls ${defenseOf(5)} Shields`));
  assert.match(marks.body, new RegExp(`a 1 pays ${energyOf(1)}`));
  assert.match(marks.body, new RegExp(`a 2 fires ${directOf(2)}`));
  assert.match(marks.body, new RegExp(`a 3 repairs ${repairOf(3)}`));
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

  // The board stays above the tip. A top-anchored or centred card covered
  // the dice the player was told to tap. One bottom anchor, always — no
  // per-phase hopping.
  const block = css.match(/\.tutorial-coach \{[^}]*\}/);
  assert.ok(block, "the coach needs a positioning block");
  assert.match(block[0], /bottom:/, "the coach docks at the bottom so the board stays above");
  assert.doesNotMatch(block[0], /^\s*top:\s*calc/m, "do not pin the card to the top of the phone");
  const matchShelf = css.match(/\.tutorial-shell:not\(\[data-shop\]\) \.tutorial-coach \{[^}]*\}/);
  assert.ok(matchShelf, "the match coach needs a bottom shelf");
  assert.match(matchShelf[0], /8\.6rem/, "the default shelf sits just above Lock in / Roll Fleet");
  assert.doesNotMatch(matchShelf[0], /16\.4rem/, "do not park the default tip above the whole dock — that covers the dice");
  assert.match(
    css,
    /\[data-spotlight="tally"\] \.tutorial-coach/,
    "the five-totals tip is the one that sits above the dock",
  );
  assert.doesNotMatch(css, /data-phase/, "positioning must not depend on which phase is live");
  assert.doesNotMatch(coach, /tutorial-action-clear/, "no measured clearance — the anchor no longer moves");

  assert.match(coach, /useState/, "maximized/minimized needs real component state");
  assert.match(coach, /isBoardTeachStep/, "board-teach steps come from the spotlight, not a parallel list");
  assert.match(coach, /setMaximized\(!compact\)/, "board-teach and the yard open as the slim strip");
  assert.match(coach, /inShop/, "the yard tells the coach it is covering Return to battle");
  assert.match(coach, /setMaximized\(false\)/, "there must be an explicit way to minimize");
  assert.match(coach, /tutorial-coach-bar-next-wrap/, "a minimized coach still offers Next");
  assert.match(coach, /tutorial-coach-bar/, "the minimized state renders as its own slim bar");
  assert.match(coach, /tutorial-coach-bar-error/, "a refused tap must still be readable when the tip is tucked away");
  assert.match(coach, /tutorial-coach-bar-body/, "the board strip still carries two lines of the tip");
  assert.match(coach, /tutorial-coach-bar-board/, "the board strip has its own class so it can stay short");
  assert.match(coach, /Minimize/, "the maximize->minimize control must be labeled, not just an icon");
  assert.match(coach, /Show tip/, "the minimize->maximize control must be labeled, not just an icon");

  const minBlock = css.match(/\.tutorial-coach-minimize \{[^}]*\}/);
  assert.ok(minBlock, "Minimize needs its own style");
  assert.match(minBlock[0], /background:\s*var\(--color-energy\)/, "Minimize is a solid Energy yellow fill");
  assert.match(minBlock[0], /color:\s*var\(--color-primary-ink\)/, "Minimize words are black on that yellow");
  assert.doesNotMatch(minBlock[0], /transparent/, "Minimize is not a ghost outline");

  // The bar has to be a real, small, fixed-height affordance — not another
  // measured-and-guessed height like the two designs before it.
  const barBlock = css.match(/\.tutorial-coach-bar \{[^}]*\}/);
  assert.ok(barBlock, "the minimized bar needs its own style block");
  assert.doesNotMatch(barBlock[0], /max-height|height:/, "the bar's height comes from its content, not a guess");

  // The shipyard still needs its grid pushed clear, but now against the
  // slim dock, not a tall-card guess. 8.5rem left a black band under
  // Return to battle once the tip tucked itself away.
  const yardBlock = css.match(/\.tutorial-shell \.yard \{[^}]*\}/);
  assert.ok(yardBlock, "the shipyard needs its own push-down rule");
  assert.doesNotMatch(yardBlock[0], /var\(--tutorial/, "the push-down must be a fixed constant, not measured");
  assert.match(yardBlock[0], /4\.8rem/, "yard padding matches the slim dock");
  assert.doesNotMatch(yardBlock[0], /8\.5rem/, "8.5rem is the reservation that left the black gap");

  // The board is never veiled — the dice are the subject of the lesson.
  assert.doesNotMatch(css, /\.tutorial-preface-scrim/);

  assert.match(coach, /HelpShipFace/, "tips still show real dice art");
});

test("the coach and theme buttons live outside their own scroll region", () => {
  const coach = readFileSync(new URL("../components/TutorialCoach.tsx", import.meta.url), "utf8");
  const screen = readFileSync(new URL("../components/TutorialScreen.tsx", import.meta.url), "utf8");
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

  // Faces/Marks may grow taller (still from the bottom). Spotlight tips stay
  // shorter so HP / board / totals are not eaten. Neither fills the phone.
  assert.doesNotMatch(
    cardBlock[0],
    /height:\s*calc\(var\(--vv-height/,
    "the card grows up from the bottom — it is not a full-screen sheet",
  );
  assert.match(cardBlock[0], /max-height:\s*min\(/, "the default tip has a cap so the board stays above");
  const lessonCard = css.match(/\.tutorial-shell\[data-lesson\] \.tutorial-coach-card \{[^}]*\}/);
  const spotCard = css.match(/\.tutorial-shell\[data-spotlight\] \.tutorial-coach-card \{[^}]*\}/);
  const boardCard = css.match(/\.tutorial-shell\[data-spotlight="board"\] \.tutorial-coach-card \{[^}]*\}/);
  assert.ok(lessonCard, "Faces/Marks need a taller-card rule");
  assert.ok(spotCard, "spotlight tips need a compact-card rule");
  assert.ok(boardCard, "board-teach tips need a still-shorter card than other spotlights");
  assert.match(lessonCard[0], /max-height:\s*min\(/, "lesson tips grow up, they do not fill the screen");
  assert.match(spotCard[0], /max-height:\s*min\(/, "spotlight tips stay short");
  assert.match(boardCard[0], /max-height:\s*min\(20dvh,\s*8\.5rem\)/, "Show tip on a board lesson must stay a strip, not half the phone");
  assert.match(screen, /data-lesson/, "the shell publishes which tips may grow taller");
  assert.match(screen, /data-board-teach/, "the shell publishes which tips must leave the 3×3 open");
  assert.match(css, /tutorial-coach-bar-body/, "the board strip clamps the tip to two lines");
  assert.match(css, /-webkit-line-clamp:\s*2/, "two lines of the tip, not the whole paragraph");

  const boardSteps = TUTORIAL_STEPS.filter((step) => step.spotlight === "board");
  assert.equal(boardSteps.length, 4, "tour + both formations + the straight ring the board");
  for (const step of boardSteps) {
    assert.equal(!!step.allow.coachNext, true, `${step.id} keeps Next on the slim bar`);
    assert.ok(step.nextLabel, `${step.id} names the Next button`);
  }

  // The old pulse faded the ring to nothing, which is why Dave could not
  // see the five-totals highlight. The ring has to stay a real yellow line.
  assert.doesNotMatch(
    css,
    /0 0 0 6px rgb\(255 210 61 \/ 0\)/,
    "the spotlight ring must not vanish mid-pulse",
  );
  assert.match(css, /@keyframes tutorial-spotlight[^}]*var\(--color-energy\)/);

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

test("the blocking lesson refuses an empty confirm, and the yard asks for a d4", () => {
  const brace = TUTORIAL_STEPS.find((step) => step.id === "brace_teach");
  assert.equal(tutorialActionAllowed(brace.allow, { type: "brace", ships: [] }), false);
  assert.equal(tutorialActionAllowed(brace.allow, { type: "brace", ships: ["s0"] }), true);

  const buy = TUTORIAL_STEPS.find((step) => step.id === "shop_buy");
  assert.equal(
    tutorialActionAllowed(buy.allow, { type: "shop", operation: "buy", sides: 6, slotIndex: 0 }),
    false,
  );
  assert.equal(
    tutorialActionAllowed(buy.allow, { type: "shop", operation: "buy", sides: 4, slotIndex: 0 }),
    true,
  );
});

test("the column tip does not name its Next button Lock in", () => {
  // The dock's own button is "Lock in". If the coach uses the same words,
  // a player taps the glowing dock control and the gate refuses them.
  const col = TUTORIAL_STEPS.find((step) => step.id === "col_done");
  assert.notEqual(col.nextLabel, "Lock in");
  assert.match(col.nextLabel, /volley/i);
});

test("a commander who follows the coach finishes the flight", () => {
  const { stepId, match } = walkFirstFlight();
  assert.equal(stepId, "finale");
  assert.ok(match.players.host.ships.some((ship) => ship.sides === 6), "the upgrade lesson bought a d6");
  assert.ok(
    match.players.host.open.filter(Boolean).length > TUNING.startSlots,
    "the bay lesson opened a cell",
  );
  assert.equal(match.players.host.flag.token, false, "the token lesson spent the nudge");
});

test("wrong taps on a gated step do not advance the flight", () => {
  const match = startTutorialMatch();
  let stepId = "intro";
  const next = applyTutorialCoachNext(match, stepId);
  assert.equal(next, "faces");
  stepId = next;
  const refused = applyTutorialAction(match, stepId, { type: "roll", dice: [] });
  assert.equal(refused.ok, false);
  assert.equal(stepId, "faces");
});
