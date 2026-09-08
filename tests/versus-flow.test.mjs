/**
 * Versus never holds a commander up before it has to.
 *
 * Both fleets roll at once. The only step that genuinely needs both players is
 * the volley — `resolveSubmissions` refuses to resolve until both have locked
 * in on the same round. Everything before it (answering a volley, reading the
 * report, shopping, rolling, locking in) is one commander's own business.
 *
 * `tests/engine.test.mjs` proves the rules allow that. These tests guard the
 * screen, which is where such a gate is most likely to be re-added by accident:
 * a `disabled` that mentions the other player, or a phase check that hides a
 * control while they are still deciding.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

test("the report's Continue button is never disabled by the other commander", () => {
  const src = read("../components/RoundReport.tsx");
  // The button exists and is gated on `busy` alone.
  const button = src.match(/<Button[^>]*onClick=\{onContinue\}[^>]*>/s);
  assert.ok(button, "the report should still have a Continue button");
  assert.match(button[0], /disabled=\{busy\}/,
    "Continue must be gated on `busy` only — never on the enemy's phase");
  assert.doesNotMatch(button[0], /waitingForOpponent/,
    "the enemy still choosing blockers must not disable Continue");
});

test("the waiting notice is information, not a barrier", () => {
  const src = read("../components/RoundReport.tsx");
  assert.match(src, /waitingForOpponent && survived/,
    "the notice should still appear while they are choosing");
  // It renders a <p>, not a control or an overlay that swallows the screen.
  // Just the notice's own JSX block, stopping at the `)}` that closes it —
  // reading past that runs into the Continue button underneath.
  const block = src.slice(src.indexOf("waitingForOpponent && survived"));
  const chunk = block.slice(0, block.indexOf(")}") + 2);
  assert.match(chunk, /<p /, "the notice should be a line of text");
  assert.doesNotMatch(chunk, /<Button|onClick|overlay|backdrop/i,
    "the notice must not become a gate");
});

test("the shipyard and the roll screen do not check the other commander", () => {
  const src = read("../components/MatchScreen.tsx");
  // `waitingOnEnemy` is allowed — it means "you locked in, they have not",
  // which is the one honest wait. Anything keyed to them *blocking* is not.
  const offenders = src
    .split("\n")
    .map((line, i) => ({ line: line.trim(), n: i + 1 }))
    .filter(({ line }) => !line.startsWith("//") && !line.startsWith("*") && !line.startsWith("/*"))
    .filter(({ line }) => /disabled=.*them|busy=.*them\b/.test(line));
  assert.deepEqual(offenders, [],
    `no control may be disabled because of the other commander's phase. ` +
    `Offending: ${offenders.map((o) => `${o.n}: ${o.line}`).join(" | ")}`);
});

test("only locking in waits on the enemy", () => {
  const src = read("../lib/useMatch.ts");
  assert.match(
    src,
    /waitingOnEnemy:\s*you\?\.phase === "submitted" && them\?\.phase !== "submitted"/,
    "waiting is defined as 'you have locked in and they have not', and nothing else",
  );
});

/* ------------------------------------------------------------------ */
/* The report survives the other commander walking off                 */
/* ------------------------------------------------------------------ */

import { bundlePath } from "../sim/bundle.mjs";
const G = await import(bundlePath);
const { applyAction, makeRng, newMatch, newPlayer, publicMatchView, setRng } = G;

/**
 * A volley that leaves the guest blocking and the host with nothing to answer.
 *
 * The faces are forced rather than rolled: a seed that happens not to produce
 * a blocking situation would let these tests pass without testing anything,
 * which is how the first version of this file fooled itself.
 */
function volleyLeavingGuestBlocking() {
  setRng(makeRng(23));
  const s = newMatch("rep", "0000", "A", "A", "versus");
  s.players.guest = newPlayer("B", "B", "ready");
  s.status = "active";
  s.players.host.phase = "ready";
  s.players.guest.phase = "ready";
  applyAction(s, "host", { type: "roll", dice: [] });
  applyAction(s, "guest", { type: "roll", dice: [] });
  // Host swings with everything; guest rolls only odd faces, alternating so no
  // three line up and hand it attack it never rolled.
  s.players.host.dice = s.players.host.dice.map((die) => ({
    ...die,
    value: die.sides % 2 === 0 ? die.sides : die.sides - 1,
  }));
  s.players.guest.dice = s.players.guest.dice.map((die, index) => ({
    ...die,
    value: index % 2 === 0 ? 1 : 3,
  }));
  applyAction(s, "host", { type: "submit" });
  applyAction(s, "guest", { type: "submit" });
  return s;
}

test("a report still says what the other fleet rolled after they move on", () => {
  // Found by playing a real versus match on two devices: the slower
  // commander's report showed "0 attack, 0 shields, 0 direct" and an equation
  // that did not add up, while the hit points were right. `settlePlayer` read
  // the opponent's live tally, and the opponent — settling first because they
  // had nothing to block — had already walked to the shipyard, where
  // `prepareRound` clears it.
  const s = volleyLeavingGuestBlocking();
  assert.equal(s.players.guest.phase, "brace", "the guest has a volley to answer");
  assert.equal(s.players.host.phase, "report", "the host has nothing to answer");
  const fired = { attack: s.players.host.tally.attack, direct: s.players.host.tally.direct };
  assert.ok(fired.attack > 0, "the host must actually have fired something");

  // The host walks on to its next roll, clearing the tally the guest's report
  // used to depend on.
  applyAction(s, "host", { type: "continue" });
  applyAction(s, "host", { type: "ready" });
  assert.equal(s.players.host.tally, null, "moving on clears their tally — that is the hazard");

  // Only now does the guest answer the volley.
  applyAction(s, "guest", { type: "brace", ships: [] });
  const report = s.players.guest.report;
  assert.ok(report, "the guest should have a report");
  assert.ok(report.enemyTally, "the report must still know what the enemy rolled");
  assert.equal(report.enemyTally.attack, fired.attack, "their Attack, as it was at the volley");
  assert.equal(report.enemyTally.direct, fired.direct, "their Direct, as it was at the volley");
  assert.ok(report.enemyDice.length > 0, "and which dice they rolled it on");
  assert.equal(
    report.hpBefore - report.damage + report.repair,
    report.hpAfter,
    "hpBefore - damage + repair must equal hpAfter",
  );
});

test("the volley copy is cleared when the next round is prepared", () => {
  const s = volleyLeavingGuestBlocking();
  applyAction(s, "guest", { type: "brace", ships: [] });
  for (const side of ["host", "guest"]) {
    if (s.players[side].phase === "report") applyAction(s, side, { type: "continue" });
    applyAction(s, side, { type: "ready" });
    assert.equal(s.players[side].incomingVolley, null, "a new round starts with no old volley");
  }
});

test("a slower commander on the report cannot watch the faster one shop", () => {
  const s = volleyLeavingGuestBlocking();
  applyAction(s, "guest", { type: "brace", ships: [] });
  assert.equal(s.players.guest.phase, "report");
  const volleySides = s.players.host.incomingVolley.ships.map((ship) => ship.sides);
  applyAction(s, "guest", { type: "continue" });
  s.players.guest.energy = 40;
  const shipId = s.players.guest.ships[0].id;
  const beforeSides = s.players.guest.ships[0].sides;
  applyAction(s, "guest", { type: "shop", operation: "upgrade", shipId });
  assert.ok(
    s.players.guest.ships.find((entry) => entry.id === shipId).sides > beforeSides,
    "the faster commander did actually buy a bigger hull",
  );

  const view = publicMatchView(s, "host");
  assert.equal(view.players.host.phase, "report", "the slower commander is still on the last attack");
  assert.deepEqual(
    view.players.guest.ships.map((entry) => entry.sides),
    volleySides,
    "their board must still be the volley fleet, not the shipyard",
  );
});

test("using the flagship weapon drops reroll selection so Lock in is next", () => {
  const src = read("../components/MatchScreen.tsx");
  assert.match(src, /selectionAfterFlagToken/,
    "the weapon must go through the helper that empties the reroll set");
  const onToken = src.match(/onToken=\{\(direction\) => \{[\s\S]*?\}\}/);
  assert.ok(onToken, "the roll dock should still send the flagship weapon");
  assert.match(onToken[0], /setSelected\(selectionAfterFlagToken/,
    "using the weapon must clear selection before the next primary tap");
  assert.match(onToken[0], /flag-token/,
    "clearing selection must happen on the weapon path, not a different action");
});

test("the weapon popover disables reroll and lock-in while it is open", () => {
  const src = read("../components/MatchScreen.tsx");
  assert.match(src, /disabled=\{busy \|\| !canReroll \|\| tokenOpen\}/,
    "Reroll must not fire while the player is aiming the weapon");
  assert.match(src, /disabled=\{busy \|\| tokenOpen\}/,
    "Lock in must not fire while the weapon popover is open");
});
