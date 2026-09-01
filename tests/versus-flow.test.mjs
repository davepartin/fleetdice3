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
