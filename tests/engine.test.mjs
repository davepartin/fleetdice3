/**
 * The rules, checked against themselves.
 *
 * The house rule on this project is that every ledger row has to sum to its
 * total. These tests exist so a number on screen can never quietly stop meaning
 * what the help screen says it means.
 *
 *   node --test tests/
 */

import test from "node:test";
import assert from "node:assert/strict";
import "../sim/bundle.mjs";

const G = await import("../.simbuild/game.mjs");

const {
  PLANS,
  TUNING,
  applyAction,
  attackOf,
  bestRun,
  cellForSlot,
  defenseOf,
  directOf,
  energyOf,
  escalationFor,
  faceTable,
  findLines,
  flagBonusSize,
  makeRng,
  newBrain,
  newMatch,
  newPlayer,
  nextActions,
  pendingThrow,
  pendingThrowReady,
  publicMatchView,
  repairOf,
  runMemberIds,
  setRng,
  slotForCell,
  straightPrizeTakes,
  straightReward,
  tally,
} = G;

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Build a roll from `{ cell: value }`, with the flagship on cell 4. */
function board(spec, sides = {}) {
  const dice = [];
  for (const [cellText, value] of Object.entries(spec)) {
    const cell = Number(cellText);
    if (cell === 4) {
      dice.push({ id: "flag", sides: 6, value, flag: true });
      continue;
    }
    const slot = slotForCell(cell);
    dice.push({ id: `s${slot}`, sides: sides[cell] ?? 10, value, slot });
  }
  return dice;
}

/* ------------------------------------------------------------------ */
/* The face table                                                      */
/* ------------------------------------------------------------------ */

test("even faces hit, odd faces block, and nothing does both", () => {
  for (let value = 1; value <= 10; value += 1) {
    const hits = attackOf(value);
    const blocks = defenseOf(value);
    assert.equal(hits > 0 && blocks > 0, false, `face ${value} both hits and blocks`);
    if (value % 2 === 0) assert.equal(hits, value, `face ${value} should hit for ${value}`);
    else assert.equal(blocks, value, `face ${value} should block for ${value}`);
  }
});

test("the printed marks are exactly what How to play claims", () => {
  const expected = {
    1: { energy: 2, repair: 0, direct: 0 },
    2: { energy: 0, repair: 0, direct: 2 },
    3: { energy: 0, repair: 3, direct: 0 },
    4: { energy: 1, repair: 0, direct: 0 },
    5: { energy: 0, repair: 1, direct: 0 },
    6: { energy: 0, repair: 0, direct: 1 },
    7: { energy: 0, repair: 2, direct: 0 },
    8: { energy: 0, repair: 0, direct: 2 },
    9: { energy: 0, repair: 3, direct: 0 },
    10: { energy: 0, repair: 0, direct: 3 },
  };
  for (const [value, marks] of Object.entries(expected)) {
    assert.equal(energyOf(+value), marks.energy, `energy on ${value}`);
    assert.equal(repairOf(+value), marks.repair, `repair on ${value}`);
    assert.equal(directOf(+value), marks.direct, `direct on ${value}`);
  }
  assert.equal(faceTable().length, 10);
});

/* ------------------------------------------------------------------ */
/* Scoring                                                             */
/* ------------------------------------------------------------------ */

test("a plain roll totals exactly the sum of its faces", () => {
  // Cells 0, 1 and 3 deliberately avoid making a row or a column, so this
  // measures the faces alone with no prize mixed in.
  const dice = board({ 0: 4, 1: 4, 3: 4, 2: 3, 4: 1 });
  const t = tally(dice, 1);
  assert.equal(t.lines.length, 0, "this board must not contain a formation");
  assert.equal(t.attack, 12, "three 4s hit for 12");
  assert.equal(t.defense, 3, "one 3 blocks for 3");
  assert.equal(t.energy, 3, "three 4s pay 1 Energy each");
  assert.equal(t.heal, 3, "one 3 repairs 3");
  assert.equal(
    t.direct,
    0,
    "no face here carries a Direct mark, so Direct must be zero",
  );
});

test("the flagship never fights and never scores itself", () => {
  // A flagship showing 6 is not a red die. This has been got wrong before.
  const dice = board({ 0: 3, 4: 6 });
  const t = tally(dice, 1);
  assert.equal(t.attack, 0, "the flagship's own 6 must not hit");
  assert.equal(t.defense, 3, "only the ship blocks");
  assert.equal(t.direct, 0, "the flagship's own 6 must not fire Direct");
});

test("each flagship face boosts only what it says it boosts", () => {
  const bonus = flagBonusSize(1);

  // 2 Direct: every 2 in the fleet fires extra.
  let t = tally(board({ 0: 2, 1: 2, 2: 4, 4: 2 }), 1);
  assert.equal(t.direct, 2 * 2 + 2 * bonus, "two 2s: printed Direct plus the bonus");
  assert.equal(t.flagBonus.direct, 2 * bonus);

  // 3 Repair.
  t = tally(board({ 0: 3, 1: 3, 2: 4, 4: 3 }), 1);
  assert.equal(t.heal, 3 * 2 + 2 * bonus);

  // 4 Energy.
  t = tally(board({ 0: 4, 1: 4, 2: 3, 4: 4 }), 1);
  assert.equal(t.energy, 1 * 2 + 2 * bonus);

  // 5 Shields boosts every odd die, not only the 5s.
  t = tally(board({ 0: 1, 1: 3, 2: 4, 4: 5 }), 1);
  assert.equal(t.defense, 1 + 3 + 2 * bonus, "both odd ships get the shield bonus");

  // 6 Attack boosts every even die, not only the 6s.
  t = tally(board({ 0: 2, 1: 4, 2: 3, 4: 6 }), 1);
  assert.equal(t.attack, 2 + 4 + 2 * bonus, "both even ships get the attack bonus");

  // 1 Reactor rings nothing on the board — it pays out when the round settles.
  t = tally(board({ 0: 1, 1: 1, 2: 4, 4: 1 }), 1);
  assert.equal(t.flagBonus.energy, 0, "the Reactor face adds no immediate Energy");
});

test("the flagship bonus grows with its level", () => {
  for (const level of [1, 2, 3]) {
    const t = tally(board({ 0: 2, 1: 2, 4: 2 }), level);
    assert.equal(t.flagBonus.direct, 2 * flagBonusSize(level), `level ${level}`);
  }
  assert.deepEqual([flagBonusSize(1), flagBonusSize(2), flagBonusSize(3)], [2, 3, 4]);
});

/* ------------------------------------------------------------------ */
/* Straights                                                           */
/* ------------------------------------------------------------------ */

test("a straight needs the minimum run and the flagship may bridge it", () => {
  // 1,2,3,5,6 with the flagship on 4 makes five in a row.
  const dice = board({ 0: 1, 1: 2, 2: 3, 3: 5, 5: 6, 4: 4 });
  const run = bestRun(dice);
  assert.ok(run, "that should be a straight");
  assert.equal(run.start, 1);
  assert.equal(run.length, 6);

  // Take the flagship away and the run breaks.
  const broken = board({ 0: 1, 1: 2, 2: 3, 3: 5, 5: 6 });
  assert.equal(bestRun(broken), null, "a gap at 4 is not a run");
});

test("the flagship never decides how big a straight prize is", () => {
  // Five d4s cannot show a 5, so the flagship is the only die on it. The
  // biggest *ship* in the line is a d4, so the prize must be a d4 prize.
  const dice = board(
    { 0: 1, 1: 2, 2: 3, 3: 4, 4: 5 },
    { 0: 4, 1: 4, 2: 4, 3: 4 },
  );
  const run = bestRun(dice);
  assert.ok(run);
  assert.equal(run.biggest, 4, "a d4 line pays a d4 prize even with the flagship in it");
});

test("a longer straight may be cashed short, and the ladder is monotonic", () => {
  const dice = board({ 0: 1, 1: 2, 2: 3, 3: 4, 5: 5, 6: 6, 7: 7 });
  const full = bestRun(dice);
  assert.equal(full.length, 7);
  assert.equal(full.taken, Math.min(7, TUNING.runMax));

  const short = bestRun(dice, 5);
  assert.equal(short.taken, 5);
  assert.notEqual(short.reward.label, full.reward.label);

  for (const biggest of [4, 6, 8, 10]) {
    const five = straightReward(5, biggest);
    const six = straightReward(6, biggest);
    const seven = straightReward(7, biggest);
    assert.equal(five.kind, "energy");
    assert.equal(six.kind, "attack");
    assert.ok(seven.attack > six.attack, `d${biggest}: seven must beat six`);
  }
});

test("the board offers at most two straight prizes — short cash vs long cash", () => {
  assert.deepEqual(straightPrizeTakes({ length: 5 }), [5]);
  assert.deepEqual(straightPrizeTakes({ length: 6 }), [5, 6]);
  assert.deepEqual(straightPrizeTakes({ length: 7 }), [5, 7]);
  assert.deepEqual(straightPrizeTakes({ length: 9 }), [5, 7]);
});

test("a straight highlights one largest hull for each number, not every duplicate", () => {
  const dice = [
    { id: "small-2", sides: 4, value: 2, slot: 0 },
    { id: "big-2", sides: 10, value: 2, slot: 1 },
    { id: "three", sides: 6, value: 3, slot: 2 },
    { id: "four", sides: 8, value: 4, slot: 3 },
    { id: "five", sides: 10, value: 5, slot: 4 },
    { id: "flag", sides: 6, value: 6, flag: true },
  ];
  const run = bestRun(dice);
  assert.ok(run);
  assert.deepEqual([...runMemberIds(dice, run)].sort(), ["big-2", "flag", "five", "four", "three"].sort());
});

/* ------------------------------------------------------------------ */
/* Formations — the rule the owner cares most about                    */
/* ------------------------------------------------------------------ */

test("three matching across a row pays Energy, three down a column pays Attack", () => {
  const across = findLines(board({ 0: 5, 1: 5, 2: 5 }));
  assert.equal(across.length, 1);
  assert.equal(across[0].kind, "row");
  assert.equal(across[0].energy, TUNING.lineAcrossEnergy);
  assert.equal(across[0].attack, 0);

  const down = findLines(board({ 0: 5, 3: 5, 6: 5 }));
  assert.equal(down.length, 1);
  assert.equal(down[0].kind, "col");
  assert.equal(down[0].attack, TUNING.lineDownAttack);
  assert.equal(down[0].energy, 0);
});

test("the flagship counts toward a formation through the middle", () => {
  const middleRow = findLines(board({ 3: 2, 4: 2, 5: 2 }));
  assert.equal(middleRow.length, 1, "flagship completes the middle row");
  const middleCol = findLines(board({ 1: 2, 4: 2, 7: 2 }));
  assert.equal(middleCol.length, 1, "flagship completes the middle column");
});

test("the starting board can make a row AND a column", () => {
  // The bug that hid in Fleet Dice 2: the four opening cells were the top-left
  // corner of the board, which can form a row but geometrically cannot form a
  // column. The 10 Attack prize was uncollectable from the shape alone.
  const fresh = newPlayer("x", "x", "ready");
  const openCells = new Set([4]);
  fresh.open.forEach((open, slot) => {
    if (open) openCells.add(cellForSlot(slot));
  });
  const columns = [
    [0, 3, 6],
    [1, 4, 7],
    [2, 5, 8],
  ];
  const rows = [
    [0, 1, 2],
    [3, 4, 5],
    [6, 7, 8],
  ];
  assert.ok(
    columns.some((line) => line.every((cell) => openCells.has(cell))),
    `no column can be formed with ${TUNING.startSlots} cells open`,
  );
  assert.ok(
    rows.some((line) => line.every((cell) => openCells.has(cell))),
    `no row can be formed with ${TUNING.startSlots} cells open`,
  );
});

test("formations and straights stack into the totals rather than replacing them", () => {
  const dice = board({ 0: 4, 1: 4, 2: 4 });
  const t = tally(dice, 1);
  assert.equal(t.attack, 12, "the faces still hit");
  assert.equal(t.energy, 3 + TUNING.lineAcrossEnergy, "plus the row prize");
});

/* ------------------------------------------------------------------ */
/* A whole round                                                       */
/* ------------------------------------------------------------------ */

function freshMatch(seed = 7) {
  setRng(makeRng(seed));
  const state = newMatch("t", "0000", "A", "A", "versus");
  state.players.guest = newPlayer("B", "B", "ready");
  state.players.host.phase = "ready";
  state.status = "active";
  return state;
}

test("the Solo Enemy waits for To the Shipyard before starting its next round", () => {
  const state = newMatch("solo-test", "0000", "you", "You", "solo");
  state.players.guest = newPlayer("enemy", "Enemy", "report");
  state.players.host.phase = "report";
  state.status = "active";
  const brain = newBrain("balanced", "captain");

  assert.deepEqual(
    nextActions(state, "guest", brain),
    [],
    "Enemy must remain on its report while the human is still watching theirs",
  );

  state.players.host.phase = "shop";
  assert.deepEqual(
    nextActions(state, "guest", brain),
    [{ type: "continue" }],
    "entering the Shipyard hands the next turn back to the Enemy",
  );
});

test("the round report adds up, every round, in a real match", () => {
  const state = freshMatch(11);
  const brains = { host: newBrain("balanced", "captain"), guest: newBrain("width", "captain") };
  let guard = 0;

  while (state.status !== "finished" && guard < 3000) {
    guard += 1;
    for (const side of ["host", "guest"]) {
      for (const action of nextActions(state, side, brains[side])) {
        if (state.status === "finished") break;
        try {
          applyAction(state, side, action);
        } catch {
          /* an action that stopped being legal */
        }
      }
      const report = state.players[side].report;
      if (!report) continue;

      const expected = Math.max(0, report.incoming - report.soaked) + report.direct;
      assert.equal(report.damage, expected, "damage must equal what got past the soak");

      const settled = report.hpBefore - report.damage + report.repair;
      assert.equal(report.hpAfter, settled, "health must equal before minus damage plus repair");
      if (settled > 0) {
        assert.ok(
          state.players[side].maxHp >= settled,
          "overflow repair must raise the maximum instead of being thrown away",
        );
      }
      assert.ok(report.soaked <= report.incoming, "you cannot soak more than arrived");
    }
  }
  assert.equal(state.status, "finished", "the match must end");
});

test("a match always ends, and never on the backstop", () => {
  for (let seed = 1; seed <= 25; seed += 1) {
    const state = freshMatch(seed * 31);
    const brains = { host: newBrain(undefined, "captain"), guest: newBrain(undefined, "captain") };
    let guard = 0;
    while (state.status !== "finished" && guard < 4000) {
      guard += 1;
      let moved = false;
      for (const side of ["host", "guest"]) {
        for (const action of nextActions(state, side, brains[side])) {
          if (state.status === "finished") break;
          try {
            applyAction(state, side, action);
            moved = true;
          } catch {
            /* skip */
          }
        }
      }
      if (!moved) break;
    }
    assert.equal(state.status, "finished", `seed ${seed}: the match froze`);
    const rounds = Math.max(state.players.host.round, state.players.guest.round);
    assert.ok(rounds < TUNING.roundLimit, `seed ${seed}: hit the ${TUNING.roundLimit}-round backstop`);
  }
});

test("nothing rolls outside its own hull", () => {
  setRng(makeRng(99));
  const state = freshMatch(99);
  for (let round = 0; round < 40; round += 1) {
    applyAction(state, "host", { type: "roll", dice: [] });
    for (const die of state.players.host.dice) {
      assert.ok(die.value >= 1 && die.value <= die.sides, `d${die.sides} showed ${die.value}`);
    }
    state.players.host.phase = "ready";
  }
});

test("the war escalates on schedule and not before", () => {
  assert.equal(escalationFor(TUNING.escalateAfterRound), 0);
  assert.equal(escalationFor(TUNING.escalateAfterRound + 1), TUNING.escalateStep);
  assert.equal(escalationFor(TUNING.escalateAfterRound + 3), TUNING.escalateStep * 3);
});

test("a commander cannot see the other fleet's dice until the volley starts", () => {
  const state = freshMatch(3);
  applyAction(state, "host", { type: "roll", dice: [] });
  applyAction(state, "guest", { type: "roll", dice: [] });
  const hostView = publicMatchView(state, "host");
  assert.equal(hostView.players.guest.dice.length, 0, "host must not see guest dice while rolling");
  assert.equal(hostView.players.host.dice.length > 0, true, "host still sees their own dice");

  applyAction(state, "host", { type: "submit" });
  state.players.host.phase = "shop";
  state.players.host.round = 2;
  const shopView = publicMatchView(state, "host");
  assert.equal(
    shopView.players.guest.dice.length,
    0,
    "shopping while the other commander still has a live roll must not leak it",
  );

  const resolved = freshMatch(4);
  resolved.players.host.phase = "report";
  resolved.players.guest.dice = [{ id: "flag", sides: 6, value: 6, flag: true }];
  const reportView = publicMatchView(resolved, "host");
  assert.equal(reportView.players.guest.dice.length, 1, "the report is allowed to show what hit you");
});

function lockFleets(state, hostSpec, guestSpec, round = 1) {
  for (const [side, spec] of [
    ["host", hostSpec],
    ["guest", guestSpec],
  ]) {
    const player = state.players[side];
    player.round = round;
    player.phase = "rolling";
    player.rolls = TUNING.rollsPerRound;
    player.dice = board(spec);
  }
  applyAction(state, "host", { type: "submit" });
  applyAction(state, "guest", { type: "submit" });
}

test("repair that would pass 60 grows the flagship instead of being thrown away", () => {
  const state = freshMatch(21);
  lockFleets(
    state,
    { 4: 3, 1: 3, 3: 3, 5: 3, 7: 3 },
    { 4: 1, 1: 1, 3: 1, 5: 1, 7: 1 },
  );
  const host = state.players.host;
  assert.ok(host.hp > TUNING.hp, `expected health above ${TUNING.hp}, got ${host.hp}`);
  assert.equal(host.maxHp, host.hp, "the maximum must rise with the overflow repair");
  assert.equal(host.hp, host.report.hpAfter);
  assert.ok(host.stats.repaired > 0);
});

/** What every health readout on screen does with the raw engine number. */
function displayHp(hp) {
  return Math.max(0, hp);
}

test("health never displays negative, and the maximum never disagrees with itself, across full matches", () => {
  let sawNegativeHp = false;
  let sawMaxGrowth = false;

  for (let seed = 1; seed <= 12; seed += 1) {
    const state = freshMatch(seed * 17);
    const brains = {
      host: newBrain(PLANS[seed % PLANS.length], "captain"),
      guest: newBrain(PLANS[(seed + 1) % PLANS.length], "captain"),
    };
    const lastMaxHp = { host: TUNING.hp, guest: TUNING.hp };
    let guard = 0;

    while (state.status !== "finished" && guard < 3000) {
      guard += 1;
      for (const side of ["host", "guest"]) {
        for (const action of nextActions(state, side, brains[side])) {
          if (state.status === "finished") break;
          try {
            applyAction(state, side, action);
          } catch {
            /* an action that stopped being legal */
          }
        }
        const player = state.players[side];

        // A lethal blow can send the raw number below zero — that's the real
        // "how far past dead" figure the engine needs. Every screen that shows
        // it to a player must clamp it, never print the negative.
        if (player.hp < 0) sawNegativeHp = true;
        assert.ok(displayHp(player.hp) >= 0, `${side} seed ${seed}: displayed health went negative`);

        // The ceiling only ever moves one way (overflow repair growing it),
        // so every screen reading player.maxHp at any moment sees the same,
        // already-current number — never a stale, lower max from before a
        // growth round.
        assert.ok(
          player.maxHp >= lastMaxHp[side],
          `${side} seed ${seed}: the maximum dropped, so an earlier screen's number would now disagree`,
        );
        if (player.maxHp > lastMaxHp[side]) sawMaxGrowth = true;
        lastMaxHp[side] = player.maxHp;

        // The ceiling must already cover the current health the instant it
        // changes — otherwise one screen could still show the old, lower max
        // while another shows health above it.
        assert.ok(
          player.hp <= player.maxHp,
          `${side} seed ${seed}: health exceeds the maximum shown for it`,
        );
      }
    }
    assert.equal(state.status, "finished", `seed ${seed}: the match must end`);
  }

  assert.ok(sawNegativeHp, "test setup: no match produced a lethal, below-zero blow to check");
  assert.ok(sawMaxGrowth, "test setup: no match produced an overflow-repair maximum to check");
});

test("war escalation still hits the flagship after shields eat the dice", () => {
  const state = freshMatch(22);
  const round = TUNING.escalateAfterRound + 1;
  lockFleets(
    state,
    { 4: 1, 1: 2, 3: 2, 5: 2, 7: 2 },
    { 4: 1, 1: 5, 3: 5, 5: 5, 7: 5 },
    round,
  );
  const war = escalationFor(round);
  assert.equal(war, TUNING.escalateStep);
  const guest = state.players.guest;
  assert.equal(guest.phase, "brace");
  assert.equal(
    guest.incoming,
    war,
    "shields may eat the dice, but the war still arrives as extra incoming",
  );
  applyAction(state, "host", { type: "brace", ships: [] });
  applyAction(state, "guest", { type: "brace", ships: [] });
  assert.equal(guest.report.escalation, war);
  assert.ok(
    guest.report.damage >= war,
    `flagship damage ${guest.report.damage} must include the war extra of ${war}`,
  );
});

test("a roll throw waits for the new faces, not the tap", () => {
  const state = freshMatch(8);
  const before = state.players.host;
  const pending = pendingThrow(before, ["flag"]);
  assert.equal(pendingThrowReady(pending, before), false, "the old board is not the roll");

  applyAction(state, "host", { type: "roll", dice: [] });
  assert.equal(pendingThrowReady(pending, state.players.host), true, "new faces release the throw");

  const again = pendingThrow(state.players.host, ["flag"]);
  assert.equal(pendingThrowReady(again, state.players.host), false, "the same faces must not throw twice");
});
