/** Actual room/recovery functions against demo-fleetdice only. No production data. */
import { build } from "esbuild";
import { fork } from "node:child_process";
import { resolve } from "node:path";
import assert from "node:assert/strict";

if (process.argv[2] === "--worker") {
  const G = await import(process.argv[3]);
  process.on("message", async ({ id, op, args }) => {
    try {
      const db = G.firestore;
      let result;
      switch (op) {
        case "uid": result = (await G.ensurePlayerIdentity()).uid; break;
        case "create": result = await G.createRoom(args[0]); break;
        case "join": result = await G.joinRoomById(...args); break;
        case "play": result = await G.playAction(...args); break;
        case "request": result = await G.requestSeatReturn(...args); break;
        case "approve": result = await G.answerSeatRequest(...args); break;
        case "read": result = (await G.getDoc(G.doc(db, ...args))).data(); break;
        case "tamper": result = await G.updateDoc(G.doc(db, "fd3Matches", args[0]), args[1]); break;
        default: throw new Error("Unknown test operation");
      }
      process.send({ id, result });
    } catch (e) { process.send({ id, error: String(e.message) }); }
  });
} else {
  const outfile = resolve(".simbuild/recovery-api.mjs");
  await build({ stdin: { contents: `export * from './lib/rooms'; export * from './lib/seatRecovery'; export * from './lib/firebase'; export {doc,getDoc,updateDoc} from 'firebase/firestore';`, resolveDir: process.cwd() }, outfile, bundle: true, platform: "node", format: "esm", packages: "external", define: {
    "process.env.NEXT_PUBLIC_FIREBASE_EMULATOR": '"127.0.0.1:8080:9099"',
    "process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID": '"demo-fleetdice"',
  } });
  const children = [];
  const client = () => {
    const child = fork(new URL(import.meta.url), ["--worker", outfile], { silent: true });
    children.push(child);
    let seq = 0; const waits = new Map();
    child.on("message", m => {
      const callback = waits.get(m.id); waits.delete(m.id);
      if (callback) { clearTimeout(callback.timer); m.error ? callback.reject(new Error(m.error)) : callback.resolve(m.result); }
    });
    return (op, ...args) => new Promise((resolve, reject) => {
      const id = ++seq;
      const timer = setTimeout(() => { waits.delete(id); reject(new Error(`${op} timed out in emulator`)); }, 30000);
      waits.set(id, { resolve, reject, timer }); child.send({ id, op, args });
    });
  };
  try {
    const host = client(), guest = client(), returning = client(), stranger = client();
    const created = await host("create", "Test Host");
    const id = created.match.id;
    await guest("join", id, "Test Guest");
    const before = await host("read", "fd3Matches", id);
    const move = { id: "lost-response", sequence: 1, round: 1, phase: "ready", rolls: 0, createdAt: Date.now(), action: { type: "roll" } };
    const results = await Promise.all([host("play", id, move.action, move), host("play", id, move.action, move)]);
    assert.equal(results[0].state.players.host.rolls, 1);
    assert.equal(results[1].state.players.host.rolls, 1);
    let current = await host("read", "fd3Matches", id);
    assert.equal(current.version, before.version + 1);
    assert.equal(current.receipts.host.id, move.id);
    console.log("PASS duplicate concurrent command is applied exactly once");
    await assert.rejects(host("play", id, move.action, { ...move, id: "other-tab" }), /Another tab/);
    console.log("PASS conflicting tab is refused");
    const uid = await returning("uid");
    await returning("request", id, "", "Test Guest");
    await assert.rejects(returning("read", "fd3Matches", id));
    await assert.rejects(returning("tamper", id, { guestUid: uid, "state.players.guest.uid": uid }));
    await assert.rejects(stranger("approve", id, uid, true));
    console.log("PASS request alone grants no read or takeover access");
    await host("approve", id, uid, true);
    const recovered = await returning("read", "fd3Matches", id);
    const expected = structuredClone(current.state.players.guest); expected.uid = uid;
    assert.deepEqual(recovered.state.players.guest, expected);
    assert.deepEqual(recovered.state.players.host, current.state.players.host);
    for (const collection of ["fd3Codes", "fd3Live"]) {
      const row = await returning("read", collection, collection === "fd3Codes" ? current.code : id);
      assert.equal(row.guestUid, uid);
    }
    await assert.rejects(guest("read", "fd3Matches", id));
    console.log("PASS approved guest return preserves battle, updates all seats and revokes old browser");
    const newHost = client(); const hostUid = await newHost("uid");
    await newHost("request", id, "", "Test Host");
    await returning("approve", id, hostUid, true);
    const hostRecovered = await newHost("read", "fd3Matches", id);
    assert.equal(hostRecovered.hostUid, hostUid);
    assert.deepEqual(hostRecovered.state.players.host.dice, recovered.state.players.host.dice);
    await assert.rejects(host("read", "fd3Matches", id));
    console.log("PASS host return also preserves dice and revokes old browser");
    const second = { ...move, id: "after-recovery", sequence: 2, phase: "rolling", rolls: 1, action: { type: "roll", dice: [hostRecovered.state.players.host.dice[0].id] } };
    await newHost("play", id, second.action, second);
    current = await newHost("read", "fd3Matches", id);
    assert.equal(current.state.players.host.rolls, 2);
    console.log("PASS returned commander can continue the same battle");
  } finally { children.forEach(c => c.kill()); }
}
