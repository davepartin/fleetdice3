import test from "node:test";
import assert from "node:assert/strict";
import { bundlePath } from "../sim/bundle.mjs";
const { newMatch, newPlayer, newBrain, applyAction, checkMove, parseSoloSave, saveSoloBattle, loadSoloSave, SOLO_SAVE_KEY } = await import(bundlePath);

function battle(mode = "versus") {
  const s = newMatch("recovery", "1234", "H", "Host", mode);
  s.players.guest = newPlayer("G", "Guest", "ready");
  s.players.host.phase = "ready"; s.status = "active";
  return s;
}
const envelope = s => ({ id: "one-tap", sequence: 1, round: 1, phase: "ready", rolls: 0, createdAt: Date.now(), action: { type: "roll" } });

test("a lost reply followed by retries rolls and charges only once", () => {
  const s = battle(); const m = envelope(s); const receipts = {};
  assert.equal(checkMove(s, "host", receipts, m), "apply");
  applyAction(s, "host", m.action);
  receipts.host = { id: m.id, sequence: 1 };
  const after = structuredClone(s);
  for (let i = 0; i < 100; i++) assert.equal(checkMove(s, "host", receipts, m), "acknowledged");
  assert.deepEqual(s, after);
});
test("another tab cannot reuse an already consumed sequence", () => {
  const s = battle(); const m = envelope(s);
  assert.throws(() => checkMove(s, "host", { host: { sequence: 1, id: "other-tab" } }, m), /Another tab/);
});
test("a delayed tap cannot roll a new round or roll count", () => {
  const s = battle(); const m = envelope(s);
  s.players.host.round++;
  assert.throws(() => checkMove(s, "host", {}, m), /moved on/);
  s.players.host.round--; s.players.host.rolls++;
  assert.throws(() => checkMove(s, "host", {}, m), /moved on/);
});
test("the other commander can move without invalidating your independent command", () => {
  const s = battle(); const m = envelope(s);
  applyAction(s, "guest", { type: "roll" });
  assert.equal(checkMove(s, "host", {}, m), "apply");
});
test("an expired unsent tap is refused but an old committed tap is acknowledged", () => {
  const s = battle(); const m = { ...envelope(s), createdAt: Date.now() - 700000 };
  assert.throws(() => checkMove(s, "host", {}, m), /expired/);
  assert.equal(checkMove(s, "host", { host: { id: m.id, sequence: 1 } }, m), "acknowledged");
});
test("solo save preserves the real fleet, rolls and opponent plan", () => {
  const s = battle("solo"); applyAction(s, "host", { type: "roll" });
  const save = { schema: 1, savedAt: Date.now(), state: s, brain: newBrain("capital", "hard") };
  assert.deepEqual(parseSoloSave(JSON.stringify(save)), save);
  assert.equal(parseSoloSave("{broken"), null);
  assert.equal(parseSoloSave(JSON.stringify({ ...save, schema: 2 })), null);
  assert.equal(parseSoloSave(JSON.stringify({ ...save, state: { ...s, players: {} } })), null);
});
test("storage failure never throws or destroys an existing saved battle", () => {
  globalThis.localStorage = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("quota"); } };
  assert.equal(loadSoloSave(), null);
  assert.equal(saveSoloBattle(battle("solo"), newBrain()), false);
  const data = new Map();
  globalThis.localStorage = { getItem: k => data.get(k) ?? null, setItem: (k,v) => data.set(k,v), removeItem: k => data.delete(k) };
  const s = battle("solo"); const brain = newBrain();
  assert.equal(saveSoloBattle(s, brain), true);
  const old = { ...s, id: "other", status: "finished" };
  saveSoloBattle(old, brain);
  assert.ok(data.has(SOLO_SAVE_KEY));
  s.status = "finished"; saveSoloBattle(s, brain);
  assert.equal(data.has(SOLO_SAVE_KEY), false);
  delete globalThis.localStorage;
});
