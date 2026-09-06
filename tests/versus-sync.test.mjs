/**
 * Versus must not rewind, and a double-tap must not fire twice.
 *
 * Found by camping play: the guest's screen said it was waiting on a host who
 * had already moved on, a roll walked backwards, and a bought die did not
 * stick. `playAction` and `watchRoom` were both writing the board with no
 * version check, and only Roll dropped a second tap while busy.
 *
 * The rule lives in `lib/versusSync.ts`, kept free of React and Firebase so
 * these tests run the same functions the hook uses.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { bundlePath } from "../sim/bundle.mjs";

const G = await import(bundlePath);
const {
  applyAction,
  emptyOpenSlots,
  makeRng,
  newMatch,
  newPlayer,
  newTapLock,
  pickLiveRoom,
  roomVersion,
  setRng,
} = G;

function versusMatch() {
  const state = newMatch("sync", "1234", "H", "Host", "versus");
  state.players.guest = newPlayer("G", "Luigi", "shop");
  state.players.host.phase = "shop";
  state.status = "active";
  return state;
}

function asRoom(state, side = "guest") {
  return {
    id: state.id,
    code: state.code,
    side,
    state: structuredClone(state),
    version: state.version,
  };
}

/** Same fold the versus hook uses: keep the room that is not older. */
function show(events) {
  let room = null;
  for (const incoming of events) room = pickLiveRoom(room, incoming);
  return room;
}

function waitingOnEnemy(room) {
  const you = room.state.players[room.side];
  const them = room.state.players[room.side === "host" ? "guest" : "host"];
  return you?.phase === "submitted" && them?.phase !== "submitted";
}

function buyADie(state, side = "guest") {
  const player = state.players[side];
  player.phase = "shop";
  player.energy = 40;
  const closed = player.open.findIndex((open) => !open);
  assert.ok(closed >= 0, "the opening fleet must leave a cell to buy into");
  applyAction(state, side, { type: "shop", operation: "slot", slotIndex: closed });
  const empties = emptyOpenSlots(player);
  assert.ok(empties.includes(closed), "opening a cell should leave it empty");
  applyAction(state, side, { type: "shop", operation: "buy", sides: 4, slotIndex: closed });
  return { slot: closed, ship: player.ships.find((ship) => ship.slot === closed) };
}

/* ------------------------------------------------------------------ */
/* An older snapshot must not wipe a successful move                   */
/* ------------------------------------------------------------------ */

test("an older snapshot after a successful buy does not rewind the board", () => {
  const before = versusMatch();
  const stale = asRoom(before);

  const after = structuredClone(before);
  const { slot, ship } = buyADie(after, "guest");
  assert.ok(ship, "the buy must have placed a hull");
  assert.ok(after.version > before.version, "the engine bumps version on a buy");

  const screen = show([asRoom(after), stale]);
  const guest = screen.state.players.guest;
  const kept = guest.ships.find((s) => s.slot === slot);
  assert.ok(kept, "the bought hull is still on the board");
  assert.equal(kept.sides, 4);
  assert.equal(screen.version, after.version);
  assert.equal(guest.energy, after.players.guest.energy);
});

test("an older snapshot after a successful reroll does not rewind the faces", () => {
  setRng(makeRng(17));
  const state = versusMatch();
  state.players.guest.phase = "ready";
  state.players.host.phase = "ready";
  applyAction(state, "guest", { type: "roll", dice: [] });
  const afterRoll = structuredClone(state);
  const die = state.players.guest.dice.find((d) => !d.flag);
  assert.ok(die, "the first roll must put fleet dice on the board");

  applyAction(state, "guest", { type: "roll", dice: [die.id] });
  assert.ok(state.version > afterRoll.version, "a reroll is a new version");

  const screen = show([asRoom(state), asRoom(afterRoll)]);
  assert.equal(screen.version, state.version);
  assert.deepEqual(
    screen.state.players.guest.dice,
    state.players.guest.dice,
    "the faces on screen stay the rerolled ones, not the earlier roll",
  );
});

test("a late snapshot cannot put the guest back to waiting on a host who has moved on", () => {
  setRng(makeRng(23));
  const state = versusMatch();
  state.players.host.phase = "ready";
  state.players.guest.phase = "ready";
  applyAction(state, "host", { type: "roll", dice: [] });
  applyAction(state, "guest", { type: "roll", dice: [] });
  applyAction(state, "guest", { type: "submit" });
  const guestWaiting = structuredClone(state);
  assert.equal(state.players.guest.phase, "submitted");
  assert.notEqual(state.players.host.phase, "submitted");

  applyAction(state, "host", { type: "submit" });
  assert.notEqual(state.players.guest.phase, "submitted", "the volley should have resolved");

  const screen = show([asRoom(state, "guest"), asRoom(guestWaiting, "guest")]);
  assert.equal(waitingOnEnemy(screen), false, "must not say waiting on the host");
  assert.equal(screen.state.players.guest.phase, state.players.guest.phase);
  assert.ok(roomVersion(screen) > roomVersion(asRoom(guestWaiting)));
});

test("a newer snapshot still lands — the other commander moving on is not stale", () => {
  const before = versusMatch();
  const after = structuredClone(before);
  buyADie(after, "host");
  const screen = show([asRoom(before, "guest"), asRoom(after, "guest")]);
  assert.equal(screen.version, after.version);
  assert.ok(screen.state.players.host.ships.length > before.players.host.ships.length);
});

test("while a buy is in flight, an older snapshot does not walk the board backwards", () => {
  const shop = versusMatch();
  shop.players.guest.phase = "shop";
  const current = asRoom(shop);

  const earlier = versusMatch();
  earlier.players.guest.phase = "ready";
  earlier.version = shop.version - 1;
  const stale = asRoom(earlier);
  stale.version = shop.version - 1;
  stale.state.version = shop.version - 1;

  const screen = show([current, stale]);
  assert.equal(screen.state.players.guest.phase, "shop", "still in the shipyard");
  assert.equal(screen.version, shop.version);
});

test("pickLiveRoom keeps the current object when the incoming one is older", () => {
  const current = asRoom(versusMatch());
  current.version = 8;
  const incoming = { ...structuredClone(current), version: 7 };
  incoming.state.version = 7;
  assert.equal(pickLiveRoom(current, incoming), current);
});

/* ------------------------------------------------------------------ */
/* A quick double-tap must not fire twice                              */
/* ------------------------------------------------------------------ */

test("a quick double-tap on buy does not fire twice", () => {
  const lock = newTapLock();
  const sent = [];
  const tap = (action) => {
    if (!lock.tryBegin()) return;
    sent.push(action);
  };

  const buy = { type: "shop", operation: "buy", sides: 4, slotIndex: 0 };
  tap(buy);
  tap(buy);
  tap({ type: "ready" });
  tap({ type: "submit" });
  tap({ type: "brace", ships: [] });
  tap({ type: "continue" });

  assert.deepEqual(sent, [buy], "only the first tap is sent while the lock is held");
  assert.equal(lock.busy, true);

  lock.release();
  tap({ type: "ready" });
  assert.equal(sent.length, 2, "after the first action lands, the next tap is allowed");
  assert.equal(sent[1].type, "ready");
});

test("the first tap takes the lock; a failed begin does not", () => {
  const lock = newTapLock();
  assert.equal(lock.busy, false);
  assert.equal(lock.tryBegin(), true);
  assert.equal(lock.tryBegin(), false);
  assert.equal(lock.busy, true);
  lock.release();
  assert.equal(lock.busy, false);
  assert.equal(lock.tryBegin(), true);
});

/* ------------------------------------------------------------------ */
/* The hook uses these rules, not a second copy                        */
/* ------------------------------------------------------------------ */

test("the versus hook applies the version guard to both live updates and local moves", () => {
  const src = readFileSync(new URL("../lib/useMatch.ts", import.meta.url), "utf8");
  assert.match(src, /pickLiveRoom/, "watchRoom and playAction must share pickLiveRoom");
  assert.match(src, /showRoom/, "one function should be the only way a room reaches the screen");
  assert.match(src, /newTapLock/, "the tap lock must be the one these tests cover");
  assert.doesNotMatch(
    src,
    /action\.type === ["']roll["'] && /,
    "every action shares the lock — Roll must not be special-cased again",
  );
  assert.match(
    src,
    /if \(!lockRef\.current\.tryBegin\(\)\) return;/,
    "a second tap is dropped before playAction is even queued",
  );
});

test("solo uses the same tap lock, so a double-tap cannot fire two actions there either", () => {
  const src = readFileSync(new URL("../lib/useMatch.ts", import.meta.url), "utf8");
  const solo = src.slice(src.indexOf("export function useSoloMatch"), src.indexOf("export function useRoomMatch"));
  assert.match(solo, /newTapLock/, "solo and versus share the lock");
  assert.match(solo, /tryBegin\(\)/);
  assert.doesNotMatch(solo, /rollLockRef/, "the roll-only lock is gone");
});
