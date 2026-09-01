/** Does the shipyard say which hulls are sitting the next round out? */
import { chromium } from "playwright";
const browser = await chromium.launch({ args: ["--use-gl=swiftshader","--enable-webgl","--ignore-gpu-blocklist","--disable-gpu-sandbox"] });
let found = null, blockedOnce = false;
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto("http://localhost:3000/fleetdice3/solo/?q=low", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2200);
  await page.getByRole("button", { name: /^Low/ }).first().click({ force: true }).catch(() => {});
  await page.waitForTimeout(1600);
  const tap = async (re, w = 1100) => {
    const b = page.getByRole("button", { name: re }).first();
    if (!(await b.count()) || (await b.isDisabled().catch(() => true))) return false;
    await b.click({ force: true, timeout: 6000 }).catch(() => {});
    await page.waitForTimeout(w); return true;
  };
  const FWD = [/^Lock in/, /^To the shipyard|^See the result/, /^Return to battle/, /^Continue|^Next/i, /^Roll Fleet/];
  for (let step = 0; step < 200 && !found; step += 1) {
    const t = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " "));
    // Always block when offered, so a hull gets benched.
    if (/CHOOSE YOUR BLOCKERS/i.test(t)) {
      await page.evaluate(() => {
        const fd = window.__fd3; const mine = fd?.debug()?.you ?? [];
        const ship = mine.find((d) => d.id !== "flag"); if (ship) fd.tap(ship.id);
      });
      await page.waitForTimeout(400);
      blockedOnce = (await tap(/^Block \d|^Block or be destroyed|^Confirm/, 1800)) || blockedOnce;
      continue;
    }
    if (/SHIPYARD/i.test(t) && /out this round/i.test(t)) {
      found = await page.evaluate(() => {
        const cells = [...document.querySelectorAll(".yard-cell-out")];
        return { marked: cells.length, hasCanvas: !!document.querySelector(".yard-cell-art canvas") };
      });
      await page.screenshot({ path: "shots/benched-yard.png" });
      break;
    }
    let moved = false;
    for (const re of FWD) { if (await tap(re, /Roll Fleet/.test(re.source) ? 1900 : 1000)) { moved = true; break; } }
    if (!moved) await page.waitForTimeout(400);
  }
} finally { await browser.close(); }
console.log(`\n  blocked at least once      : ${blockedOnce}`);
console.log(`  shipyard marks benched     : ${found ? JSON.stringify(found) : "NOT SEEN"}`);
console.log(`\n  ${found?.marked > 0 ? "PASS" : "FAIL"}\n`);
process.exit(found?.marked > 0 ? 0 : 1);
