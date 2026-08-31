/**
 * Two phones, one room, and a database you are allowed to switch off.
 *
 * Versus was unfixable-by-inspection for one reason: the failure only appears
 * when the connection dies, and you cannot kill the real project's connection
 * without doing it to real players mid-match. The Firebase emulator can be
 * killed freely, so this drives two browser clients through a real room
 * against a local Firestore and blocks the database underneath one of them.
 *
 *   1. firebase emulators:start --only firestore,auth --project space-tribes
 *   2. BASE_PATH= NEXT_PUBLIC_FIREBASE_EMULATOR=127.0.0.1:8080:9099 pnpm build
 *   3. npx serve out -l 4321
 *   4. node sim/versus-emulator.mjs
 *
 * Exits non-zero if a client that lost the database fails to come back on its
 * own — the bug that had a player reloading four times in one match.
 */
import { chromium } from "playwright";

const APP = process.env.APP_URL || "http://localhost:4321";
const DB = /127\.0\.0\.1:(8080|9099)/;
const checks = [];
const check = (name, pass) => {
  checks.push({ name, pass });
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${name}`);
};

const browser = await chromium.launch({
  executablePath: process.env.CHROME || "/opt/pw-browsers/chromium",
  args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--disable-gpu-sandbox"],
});
const seat = async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  return { ctx, page: await ctx.newPage() };
};
const text = (p) => p.evaluate(() => document.body.innerText);
const inMatch = async (p) => /ROLL FLEET|LOCK IN|FLAGSHIP/i.test(await text(p));

const host = await seat();
const guest = await seat();

console.log("\n=== a real versus room, against the emulator ===\n");

await host.page.goto(`${APP}/versus/`, { waitUntil: "networkidle" });
await host.page.fill("input", "Sam");
await host.page.getByRole("button", { name: /Create the room/i }).click();
await host.page.waitForSelector("[data-room-code]", { timeout: 40000 });
const code = await host.page.getAttribute("[data-room-code]", "data-room-code");
check(`host opens a room (code ${code})`, Boolean(code));

await guest.page.goto(`${APP}/join/?code=${code}`, { waitUntil: "networkidle" });
await guest.page.waitForTimeout(2500);
await guest.page.fill("input", "Alex");
await guest.page.getByRole("button", { name: /Join the game/i }).click();
await guest.page.waitForTimeout(9000);
check("both commanders are seated", (await inMatch(guest.page)) && (await inMatch(host.page)));
const matchUrl = guest.page.url();

// Cut the database out from under the guest, leaving the web server up: the
// app still loads, it just cannot reach the room. That is a phone whose tab
// iOS killed and restored on a dead network.
let blocking = true;
await guest.ctx.route("**/*", (route) =>
  blocking && DB.test(route.request().url()) ? route.abort() : route.continue(),
);
await guest.page.goto(matchUrl, { waitUntil: "domcontentloaded" }).catch(() => {});
await guest.page.waitForTimeout(11000);

const stranded = await text(guest.page);
check("no dead-end error while the database is unreachable", !/looks offline/i.test(stranded));
check("says it is reconnecting", /Reconnecting/i.test(stranded));

blocking = false;
let recovered = false;
for (let i = 0; i < 50 && !recovered; i += 1) {
  recovered = await inMatch(guest.page);
  if (!recovered) await guest.page.waitForTimeout(1000);
}
check("comes back to the match with no manual reload", recovered);

await browser.close();
const failed = checks.filter((c) => !c.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} passed\n`);
process.exit(failed.length ? 1 : 0);
