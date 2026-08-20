/**
 * Does the column prize actually fire?
 *
 * The owner is right that a column was never impossible: cell 1 and the
 * flagship are there from the start, and buying the cell at 8 completes the
 * middle column. It is a purchase away, not a dead end.
 *
 * The earlier "it never fired once" measurement was taken against an opponent
 * whose shopping logic almost never bought a cell, so it was really measuring
 * a broken brain rather than a broken rule. This re-measures with the fixed
 * brain, at four starting cells and at six, and reports what a commander
 * actually sees during a match.
 *
 *   node sim/columns.mjs        200 matches a setting
 *   node sim/columns.mjs 600    slower and more certain
 */

import "./bundle.mjs";
const G = await import("../.simbuild/game.mjs");

const { PLANS, TUNING, applyAction, makeRng, newBrain, newMatch, newPlayer, nextActions, setRng } = G;

const MATCHES = Number(process.argv[2]) || 200;

function run(startSlots) {
  TUNING.startSlots = startSlots;

  let rounds = 0;
  let rowRounds = 0;
  let colRounds = 0;
  let runRounds = 0;
  let cellsOpened = 0;
  let commanders = 0;
  let matchesWithColumn = 0;
  let matchLength = 0;
  const firstColumnRound = [];
  const openedByEnd = [];

  for (let match = 0; match < MATCHES; match += 1) {
    setRng(makeRng(90210 + match * 13));
    const state = newMatch("sim", "0000", "A", "A", "versus");
    state.players.guest = newPlayer("B", "B", "ready");
    state.status = "active";
    state.players.host.phase = "ready";
    const plan = process.env.FD3_PLAN;
    const brains = plan
      ? { host: newBrain(plan, "captain"), guest: newBrain(plan, "captain") }
      : {
          host: newBrain(PLANS[match % PLANS.length], "captain"),
          guest: newBrain(PLANS[(match + 2) % PLANS.length], "captain"),
        };

    const seenColumn = { host: 0, guest: 0 };
    const counted = new Set();
    let guard = 0;

    while (state.status !== "finished" && guard < 4000) {
      guard += 1;
      let moved = false;
      for (const side of ["host", "guest"]) {
        const before = state.players[side].open.filter(Boolean).length;
        for (const action of nextActions(state, side, brains[side])) {
          if (state.status === "finished") break;
          try {
            applyAction(state, side, action);
            moved = true;
          } catch {
            /* no longer legal */
          }
        }
        cellsOpened += state.players[side].open.filter(Boolean).length - before;

        // Count each commander's round once, when they lock it in.
        const player = state.players[side];
        const key = `${side}:${player.round}`;
        if (player.tally && !counted.has(key)) {
          counted.add(key);
          rounds += 1;
          const lines = player.tally.lines ?? [];
          if (lines.some((line) => line.kind === "row")) rowRounds += 1;
          if (lines.some((line) => line.kind === "col")) {
            colRounds += 1;
            if (!seenColumn[side]) seenColumn[side] = player.round;
          }
          if (player.tally.run) runRounds += 1;
        }
      }
      if (!moved) break;
    }

    for (const side of ["host", "guest"]) {
      commanders += 1;
      openedByEnd.push(state.players[side].open.filter(Boolean).length);
      if (seenColumn[side]) {
        matchesWithColumn += 1;
        firstColumnRound.push(seenColumn[side]);
      }
    }
    matchLength += Math.max(state.players.host.round, state.players.guest.round);
  }

  const mean = (list) => (list.length ? list.reduce((s, n) => s + n, 0) / list.length : 0);

  return {
    startSlots,
    rounds,
    row: rowRounds / rounds,
    col: colRounds / rounds,
    run: runRounds / rounds,
    cellsPerCommander: cellsOpened / commanders,
    openAtEnd: mean(openedByEnd),
    commandersWhoSawAColumn: matchesWithColumn / commanders,
    firstColumnRound: mean(firstColumnRound),
    matchLength: matchLength / MATCHES,
  };
}

const before = TUNING.startSlots;
const results = [run(4), run(6)];
TUNING.startSlots = before;

const pct = (n) => `${(n * 100).toFixed(1)}%`;

console.log(`\nDoes the column prize fire? ${MATCHES} matches at each setting, fixed brain.\n`);

const head = [
  "start cells",
  "rounds",
  "row fires",
  "column fires",
  "straight",
  "cells bought",
  "open at end",
  "saw a column",
  "first one",
  "length",
];
const rows = results.map((r) => [
  String(r.startSlots),
  String(r.rounds),
  pct(r.row),
  pct(r.col),
  pct(r.run),
  r.cellsPerCommander.toFixed(2),
  r.openAtEnd.toFixed(1),
  pct(r.commandersWhoSawAColumn),
  r.firstColumnRound ? `round ${r.firstColumnRound.toFixed(1)}` : "never",
  r.matchLength.toFixed(1),
]);
const widths = head.map((h, i) => Math.max(h.length, ...rows.map((row) => row[i].length)));
console.log(head.map((h, i) => h.padEnd(widths[i])).join("  "));
console.log(widths.map((w) => "-".repeat(w)).join("  "));
for (const row of rows) console.log(row.map((cell, i) => cell.padEnd(widths[i])).join("  "));

console.log(`
"column fires" is the share of all rounds in which at least one column of three
matching numbers paid out. "saw a column" is the share of commanders who got at
least one in a whole match — that is the number that says whether a player will
ever meet this rule.
`);
