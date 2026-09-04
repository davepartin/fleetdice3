/**
 * Repair lands in the same breath as the damage, not after the funeral.
 *
 * `settlePlayer` computes `before - damage + repair` in one step, so a flagship
 * that the damage alone would have destroyed can be carried through by the
 * repair rolled in the same round. BALANCE.md measured that this turns a lethal
 * round survivable in 1.3% of rounds, and that 133 of 136 such saves happen in
 * round 5 or later — it is the entire late-game lifeline. Moving repair after a
 * death check would delete all of them and make matches end abruptly.
 *
 * It matters most against Direct. No Shield reduces Direct and no ship blocks
 * it, so repair is the only answer to it there is.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { bundlePath } from "../sim/bundle.mjs";

const G = await import(bundlePath);
const { applyAction, makeRng, newMatch, newPlayer, setRng, TUNING } = G;

/**
 * A commander standing in front of a volley, with the numbers forced.
 * `heal` is what they rolled; `incoming`/`direct` is what is arriving.
 */
function facing({ hp, incoming, direct, heal }) {
  setRng(makeRng(99));
  const s = newMatch("rep", "0000", "A", "A", "versus");
  s.players.guest = newPlayer("B", "B", "ready");
  s.status = "active";
  s.players.host.phase = "ready";
  s.players.guest.phase = "ready";
  applyAction(s, "host", { type: "roll", dice: [] });
  applyAction(s, "guest", { type: "roll", dice: [] });
  const p = s.players.host;
  p.hp = hp;
  p.incoming = incoming;
  p.directIncoming = direct;
  p.tally = { ...(p.tally ?? {}), attack: 0, defense: 0, energy: 0, direct: 0, heal, lines: [], run: null,
              face: 1, flagBonus: { attack: 0, defense: 0, energy: 0, heal: 0, direct: 0 } };
  p.phase = "brace";
  p.braceShips = [];
  return { s, p };
}

test("repair saves a flagship the damage alone would have destroyed", () => {
  // 5 health, 8 arriving, 5 repaired: dead on the damage, alive on the round.
  const { s, p } = facing({ hp: 5, incoming: 8, direct: 0, heal: 5 });
  applyAction(s, "host", { type: "brace", ships: [] });
  assert.equal(p.hp, 2, "5 - 8 + 5 = 2");
  assert.notEqual(p.phase, "over", "and the commander is still in the match");
  assert.equal(s.status, "active");
});

test("repair is the only answer to Direct, and it works", () => {
  // Direct ignores Shields and ignores blocking ships. Repair is all there is.
  const { s, p } = facing({ hp: 4, incoming: 0, direct: 9, heal: 8 });
  applyAction(s, "host", { type: "brace", ships: [] });
  assert.equal(p.hp, 3, "4 - 9 + 8 = 3, and every point of that 9 was unblockable");
  assert.equal(s.status, "active", "the match carries on");
});

test("a round that repair cannot cover still ends the match", () => {
  const { s, p } = facing({ hp: 5, incoming: 20, direct: 0, heal: 4 });
  applyAction(s, "host", { type: "brace", ships: [] });
  assert.ok(p.hp <= 0, "5 - 20 + 4 is still under water");
  assert.equal(s.status, "finished", "and that is the end of it");
});

test("exactly zero is dead, not alive", () => {
  // The boundary is worth pinning: a flagship on 0 is destroyed.
  const { s, p } = facing({ hp: 5, incoming: 9, direct: 0, heal: 4 });
  applyAction(s, "host", { type: "brace", ships: [] });
  assert.equal(p.hp, 0, "5 - 9 + 4 = 0");
  assert.equal(s.status, "finished", "zero is dead");
});

test("one more point of repair is the difference between dead and alive", () => {
  const dead = facing({ hp: 5, incoming: 9, direct: 0, heal: 4 });
  applyAction(dead.s, "host", { type: "brace", ships: [] });
  const alive = facing({ hp: 5, incoming: 9, direct: 0, heal: 5 });
  applyAction(alive.s, "host", { type: "brace", ships: [] });
  assert.equal(dead.s.status, "finished");
  assert.equal(alive.s.status, "active");
  assert.equal(alive.p.hp, 1, "one point of repair, one point of life");
});

test("healing past the starting maximum raises the maximum", () => {
  const { s, p } = facing({ hp: TUNING.hp, incoming: 0, direct: 0, heal: 6 });
  applyAction(s, "host", { type: "brace", ships: [] });
  assert.equal(p.hp, TUNING.hp + 6, "repair is not capped at the starting health");
  assert.equal(p.maxHp, TUNING.hp + 6, "and the ceiling moves up with it");
});

/* ------------------------------------------------------------------ */
/* Direct is outside blocking, on purpose                              */
/* ------------------------------------------------------------------ */

test("no ship can block Direct, however many stand in front of it", () => {
  // Measured both ways and decided deliberately: letting hulls block Direct is
  // safe on the numbers, but it leaves Repair with no job of its own. Shields
  // answer Attack, ships answer what gets past them, Repair answers Direct.
  const { s, p } = facing({ hp: 40, incoming: 0, direct: 7, heal: 0 });
  const everyShip = p.ships.map((ship) => ship.id);
  assert.ok(everyShip.length > 0, "there should be ships available to block with");
  applyAction(s, "host", { type: "brace", ships: everyShip });
  assert.equal(p.hp, 33, "40 - 7: the whole fleet stood in front and stopped none of it");
});

test("blocking still stops Attack, so the test above is not passing by accident", () => {
  const { s, p } = facing({ hp: 40, incoming: 7, direct: 0, heal: 0 });
  const one = p.ships[0];
  applyAction(s, "host", { type: "brace", ships: [one.id] });
  assert.equal(p.hp, 40 - Math.max(0, 7 - one.sides), "a hull blocks damage equal to its own size");
  assert.ok(p.hp > 33, "and that is strictly better than taking all seven");
});

test("the settle and the doomed-round check agree about what a round costs", () => {
  // `inescapableDeath` decides whether the block screen is even worth showing.
  // If it and `settlePlayer` ever disagree, a commander is either told they are
  // dead when repair would have saved them, or shown a choice that cannot.
  const { s, p } = facing({ hp: 6, incoming: 4, direct: 9, heal: 8 });
  applyAction(s, "host", { type: "brace", ships: p.ships.map((ship) => ship.id) });
  assert.equal(s.status, "active", "6 - 9 direct + 8 repair survives, whatever blocking did to the 4");
  assert.ok(p.hp > 0);
});
