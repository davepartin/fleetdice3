/**
 * A seat at a real Fleet Dice table, driven from Node.
 *
 * Chromium in this container cannot reach the internet; the Firebase SDK under
 * Node can. So this takes a seat the way a phone does, through the game's own
 * joinRoomById / playAction rather than a second copy of the rules that could
 * disagree with them.
 *
 * It runs as ONE long-lived process for a whole match. That is not a style
 * choice: anonymous sign-in mints a brand new player each time it runs, so a
 * process per move would arrive at the room as a different person every move
 * and be turned away as a third commander — after burning the seat.
 *
 *   node sim/bot.mjs serve <matchId> <name>     # holds the seat, watches
 *   echo '<json action>' >> /tmp/fd3-bot.cmd    # plays a move
 *   tail /tmp/fd3-bot.out                       # reads the board
 */
import { appendFileSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { botPath } from "./bot-bundle.mjs";

const G = await import(botPath);
const { joinRoomById, enterRoom, playAction, watchRoom, tally, bestRun, activeShips, fleetBlock, TUNING } = G;

const [, , cmd, matchId, name] = process.argv;
const CMD = "/tmp/fd3-bot.cmd";
const OUT = "/tmp/fd3-bot.out";
const say = (line) => { appendFileSync(OUT, line + "\n"); console.log(line); };

const face = (d) =>
  `${d.flag ? "FLAG" : `d${d.sides}`}:${d.value}${d.value % 2 === 0 ? `=atk${d.value}` : `=shd${d.value}`}`;

function show(room, why) {
  const s = room.state;
  const me = s.players[room.side];
  const foe = s.players[room.side === "host" ? "guest" : "host"];
  say(`\n----- ${why} | round ${me.round} | my phase ${me.phase} -----`);
  say(`me : ${me.name} ${me.hp}hp +${fleetBlock(me)}block  energy ${me.energy}  flag L${me.flag.level} face ${me.flag.face}  rolls ${me.rolls}/${TUNING.rollsPerRound}`);
  if (foe) say(`you: ${foe.name} ${foe.hp}hp +${fleetBlock(foe)}block  phase ${foe.phase}`);
  say(`dice: ${me.dice.length ? me.dice.map(face).join("  ") : "(unrolled)"}`);
  if (me.dice.length) {
    const t = tally(me.dice, me.flag.level, me.straightTake);
    say(`tally: attack ${t.attack} | shields ${t.defense} | direct ${t.direct} | repair ${t.heal} | energy ${t.energy}`);
    if (t.lines?.length) say(`lines: ${t.lines.map((l) => `${l.kind} of ${l.value}`).join(", ")}`);
    const run = bestRun(me.dice);
    if (run) say(`straight: ${run.length} long ${run.start}-${run.top} -> ${run.reward.label}`);
    say(`ids: ${me.dice.map((d) => `${d.id}=${d.value}`).join(" ")}`);
  }
  if (me.phase === "brace") {
    say(`INCOMING ${me.incoming} blockable + ${me.directIncoming} direct`);
    say(`blockers: ${activeShips(me, me.round).map((sh) => `${sh.id}=d${sh.sides}`).join(" ") || "(none)"}`);
  }
  if (me.report) {
    const r = me.report;
    say(`last round: ${r.hpBefore} -> ${r.hpAfter} (took ${r.damage}, repaired ${r.repair}, ships blocked ${r.blocked})`);
  }
  say(`status ${s.status}${s.winner ? ` WINNER:${s.winner}` : ""}`);
}

if (cmd !== "serve") { console.log("usage: node sim/bot.mjs serve <matchId> <name>"); process.exit(1); }

writeFileSync(OUT, "");
writeFileSync(CMD, "");

let room;
try {
  room = await joinRoomById(matchId, name || "Claude");
  say(`joined as ${room.side}`);
} catch (e) {
  say(`join failed (${String(e.message).slice(0, 80)}) — trying to resume an existing seat`);
  room = await enterRoom(matchId);
  say(`resumed as ${room.side}`);
}
show(room, "seated");

// Watch, so the other commander's moves appear without being asked for.
await watchRoom(
  matchId,
  (next) => { room = next; show(next, "update"); },
  (e) => say(`room says: ${e.message}`),
  () => say("(connection dropped, the app would retry here)"),
);

let done = 0;
setInterval(async () => {
  if (!existsSync(CMD)) return;
  const lines = readFileSync(CMD, "utf8").split("\n").filter((l) => l.trim());
  while (done < lines.length) {
    const line = lines[done];
    done += 1;
    try {
      const action = JSON.parse(line);
      say(`\n>>> playing ${JSON.stringify(action)}`);
      room = await playAction(matchId, action);
      show(room, "after my move");
    } catch (e) {
      say(`!!! ${String(e.message).slice(0, 160)}`);
    }
  }
}, 1200);
