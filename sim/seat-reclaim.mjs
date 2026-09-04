/**
 * Losing your seat by closing a tab, and getting it back.
 *
 * A seat belongs to an anonymous id in one browser's storage for one exact
 * address. Clearing that storage is what a private tab, a different domain, or
 * a cleared history all look like from the room's side: a stranger arrives and
 * the seat stays held by an id nothing can reach.
 *
 * The security-critical half is the FIRST check. A seat that is still being
 * used must not be takeable, or this becomes a way to shove someone out of a
 * live match.
 *
 *   pnpm emulators
 *   pnpm build:emulator && pnpm serve
 *   node sim/seat-reclaim.mjs
 */
import { chromium } from "playwright";

const APP = process.env.APP_URL || "http://localhost:4321";
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

console.log("\n=== taking a seat back after a tab is lost ===\n");

await host.page.goto(`${APP}/versus/`, { waitUntil: "networkidle" });
await host.page.fill("input", "Sam");
await host.page.getByRole("button", { name: /Create the room/i }).click();
await host.page.waitForSelector("[data-room-code]", { timeout: 40000 });
const code = await host.page.getAttribute("[data-room-code]", "data-room-code");

const link = `${APP}/join/?id=${await host.page.evaluate(() => new URLSearchParams(location.search).get("id") || "")}&code=${code}`;
await guest.page.goto(`${APP}/join/?code=${code}`, { waitUntil: "networkidle" });
await guest.page.waitForTimeout(2500);
await guest.page.fill("input", "Alex");
await guest.page.getByRole("button", { name: /Join the game/i }).click();
await guest.page.waitForTimeout(9000);
check("both commanders seated", (await inMatch(guest.page)) && (await inMatch(host.page)));
const matchUrl = guest.page.url();
const matchId = new URL(matchUrl).searchParams.get("id");
const joinLink = `${APP}/join/?id=${matchId}&code=${code}`;

// Become a stranger: exactly what a private tab or a different domain does.
await guest.ctx.clearCookies();
await guest.page.goto(`${APP}/`, { waitUntil: "domcontentloaded" });
await guest.page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
await guest.page.goto(joinLink, { waitUntil: "networkidle" });
await guest.page.waitForTimeout(3000);
await guest.page.fill("input", "Alex");
await guest.page.getByRole("button", { name: /Join the game/i }).click();
await guest.page.waitForTimeout(6000);

const refused = await text(guest.page);
check("a forgotten browser is refused the seat it already holds", /two commanders|already started/i.test(refused));
check("and is offered a way back", /Take my seat back/i.test(refused));
await guest.page.screenshot({ path: "/tmp/reclaim-offered.png" });

// THE IMPORTANT ONE: the seat was in use seconds ago, so it must not move.
await guest.page.getByRole("button", { name: /Take my seat back/i }).click();
await guest.page.waitForTimeout(6000);
const tooSoon = await text(guest.page);
check("a seat still in use CANNOT be taken", /still in use/i.test(tooSoon) && !(await inMatch(guest.page)));

console.log("\n  waiting out the quiet window (65s)…\n");
await guest.page.waitForTimeout(65000);

await guest.page.getByRole("button", { name: /Take my seat back/i }).click();
await guest.page.waitForTimeout(8000);
check("a seat gone quiet CAN be taken back", await inMatch(guest.page));
await guest.page.screenshot({ path: "/tmp/reclaim-done.png" });

// The match must be the same one, not a reset.
const hostStillIn = await inMatch(host.page);
check("the host is still in the same match", hostStillIn);

await browser.close();
const failed = checks.filter((c) => !c.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} passed\n`);
process.exit(failed.length ? 1 : 0);
