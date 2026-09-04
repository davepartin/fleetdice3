/**
 * Does versus hold one commander up while the other dawdles?
 *
 * Two real browser clients in a real room against the local emulator. One
 * plays on; the other stops dead after locking in the first round. The one who
 * carries on must be able to answer the volley, read the report, shop, roll and
 * lock in for the next round without the screen ever stopping them.
 *
 * The engine guarantee is measured in sim/lockstep.mjs and tested in
 * tests/engine.test.mjs. This is the same guarantee through the network and
 * the UI, which is where it would actually be lost.
 *
 *   1. firebase emulators:start --only firestore,auth --project space-tribes
 *   2. BASE_PATH= NEXT_PUBLIC_FIREBASE_EMULATOR=127.0.0.1:8080:9099 pnpm build
 *   3. npx serve out -l 4321
 *   4. node sim/versus-flow-emulator.mjs
 */
import { chromium } from "playwright";

const APP = process.env.APP_URL || "http://localhost:4321";
const checks = [];
const check = (name, pass, detail = "") => {
  checks.push({ name, pass });
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

const browser = await chromium.launch({
  executablePath: process.env.CHROME || undefined,
  args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--disable-gpu-sandbox"],
});
const seat = async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  return { ctx, page: await ctx.newPage() };
};
const text = (p) => p.evaluate(() => document.body.innerText.replace(/\s+/g, " "));
const buttons = (p) => p.evaluate(() =>
  [...document.querySelectorAll("button")]
    .filter((b) => !b.disabled)
    .map((b) => (b.textContent || "").replace(/\s+/g, " ").trim()));
/** Click the first enabled button matching, and say whether it was there. */
const tap = async (p, re, wait = 1400) => {
  const b = p.getByRole("button", { name: re }).first();
  if (!(await b.count())) return false;
  if (await b.isDisabled().catch(() => true)) return false;
  await b.click({ force: true, timeout: 6000 }).catch(() => {});
  await p.waitForTimeout(wait);
  return true;
};

try {
  const host = await seat();
  const guest = await seat();
  console.log("\n=== one commander plays on while the other sits still ===\n");

  await host.page.goto(`${APP}/versus/`, { waitUntil: "networkidle" });
  await host.page.fill("input", "Sam");
  await host.page.getByRole("button", { name: /Create the room/i }).click();
  await host.page.waitForSelector("[data-room-code]", { timeout: 40000 });
  const code = await host.page.getAttribute("[data-room-code]", "data-room-code");

  await guest.page.goto(`${APP}/join/?code=${code}`, { waitUntil: "networkidle" });
  await guest.page.waitForTimeout(2500);
  await guest.page.fill("input", "Alex");
  await guest.page.getByRole("button", { name: /Join the game/i }).click();
  await guest.page.waitForTimeout(9000);
  check(`both commanders are seated (room ${code})`, /ROLL FLEET/i.test(await text(host.page)));

  // Round one: both roll and lock in, so a volley actually resolves.
  for (const p of [host.page, guest.page]) {
    await tap(p, /^Roll Fleet/, 2400);
    await tap(p, /^Lock in/, 2400);
  }
  await host.page.waitForTimeout(4000);

  // From here the GUEST does nothing at all. The HOST must be able to finish
  // the round and get all the way to locked-in on the next one.
  const reached = [];
  let stuckAt = null;
  for (let step = 0; step < 14; step += 1) {
    const t = await text(host.page);
    const bs = await buttons(host.page);
    const label = /CHOOSE YOUR BLOCKERS/i.test(t) ? "blocking"
      : /SHIPYARD/i.test(t) ? "shipyard"
      : /Round \d/i.test(t) && bs.some((b) => /shipyard|See the result/i.test(b)) ? "report"
      : bs.some((b) => /^Roll Fleet/.test(b)) ? "ready to roll"
      : bs.some((b) => /^Lock in|^Reroll/.test(b)) ? "rolling"
      : /Locked in/i.test(t) ? "locked in"
      : "unknown";
    if (reached[reached.length - 1] !== label) reached.push(label);
    if (label === "locked in") break;
    const moved =
      (await tap(host.page, /^Take it all on the flagship/, 2200)) ||
      (await tap(host.page, /^To the shipyard|^See the result/, 2000)) ||
      (await tap(host.page, /^Return to battle/, 2000)) ||
      (await tap(host.page, /^Roll Fleet/, 2400)) ||
      (await tap(host.page, /^Lock in/, 2400));
    if (!moved) { stuckAt = { label, buttons: bs, text: t.slice(0, 200) }; break; }
  }

  console.log(`\n  host's path while the guest sat still:\n    ${reached.join(" -> ")}\n`);
  check("the host answered the volley without waiting", reached.includes("blocking") || reached.includes("report"));
  check("the host reached the shipyard", reached.includes("shipyard"));
  check("the host rolled the next round", reached.includes("rolling") || reached.includes("ready to roll"));
  check("the host locked in a full round ahead", reached.includes("locked in"),
        stuckAt ? `stuck at "${stuckAt.label}"` : "");
  if (stuckAt) {
    console.log(`\n  STUCK: phase "${stuckAt.label}"`);
    console.log(`    enabled buttons: ${JSON.stringify(stuckAt.buttons)}`);
    console.log(`    screen: ${stuckAt.text}`);
  }

  // And the guest, untouched all this time, must still be playable.
  const guestButtons = await buttons(guest.page);
  check("the idle guest still has its own move available", guestButtons.length > 0,
        JSON.stringify(guestButtons.slice(0, 3)));
} finally {
  await browser.close();
}
const failed = checks.filter((c) => !c.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} passed\n`);
process.exit(failed.length ? 1 : 0);
