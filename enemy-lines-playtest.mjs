/**
 * Does a formation on the ENEMY's board draw its rail?
 *
 * A row or a column is where a big number on the damage report comes from — a
 * column is +10 Attack. The rails are WebGL and unreachable from the DOM, so
 * this reads them back through the `window.__fd3` hatch rather than looking at
 * a screenshot.
 *
 *   node enemy-lines-playtest.mjs      (needs pnpm dev on :3000)
 */
import { chromium } from "playwright";

const browser = await chromium.launch({
  args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--disable-gpu-sandbox"],
});
let sawEnemyLine = null;
let sawYourLine = null;
let roundsPlayed = 0;
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

  await page.goto("http://localhost:3000/solo/?q=low", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2200);
  await page.getByRole("button", { name: /^Low/ }).first().click({ force: true }).catch(() => {});
  await page.waitForTimeout(1600);

  const tap = async (re, wait = 1500) => {
    const b = page.getByRole("button", { name: re }).first();
    if (!(await b.count())) return false;
    if (await b.isDisabled().catch(() => true)) return false;
    await b.click({ force: true, timeout: 6000 }).catch(() => {});
    await page.waitForTimeout(wait);
    return true;
  };
  const formations = () => page.evaluate(() => window.__fd3?.debug()?.formations ?? null);

  // Play rounds until both a friendly and an enemy formation have been seen.
  const FORWARD = [/^Lock in/, /^Take it all on the flagship/, /^To the shipyard|^See the result/,
                   /^Return to battle/, /^Continue|^Next/i, /^Roll Fleet/];
  let shot = false;
  for (let step = 0; step < 220 && !(sawEnemyLine && sawYourLine && shot); step += 1) {
    const f = await formations();
    if (f) {
      if (!sawEnemyLine && f.enemy?.length) sawEnemyLine = f.enemy;
      if (!sawYourLine && f.you?.length) sawYourLine = f.you;
    }
    // Catch the report screen with an enemy rail on it — both decks visible,
    // which is the view the owner asked about.
    if (f?.enemy?.length) {
      const t = await page.evaluate(() => document.body.innerText);
      if (/ENEMY ROLLED/i.test(t) && !shot) {
        await page.screenshot({ path: "shots/enemy-line-report.png" });
        shot = true;
      }
    }
    let moved = false;
    for (const re of FORWARD) {
      if (re.source.includes("Roll Fleet")) roundsPlayed += (await tap(re, 2100)) ? 1 : 0;
      else if (await tap(re)) { moved = true; break; }
      else continue;
      moved = true; break;
    }
    if (!moved) break;
    if (/You win|Defeat|Victory|BATTLE/i.test(await page.evaluate(() => document.body.innerText))) {
      // Match over — start another so we keep sampling.
      await page.goto("http://localhost:3000/solo/?q=low", { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2000);
      await page.getByRole("button", { name: /^Low/ }).first().click({ force: true }).catch(() => {});
      await page.waitForTimeout(1600);
    }
  }
  await page.screenshot({ path: "shots/enemy-lines.png" });
} finally {
  await browser.close();
}

console.log(`\n=== formation rails, read back from WebGL (${roundsPlayed} rolls) ===\n`);
console.log(`  your deck  : ${sawYourLine ? JSON.stringify(sawYourLine) : "none seen"}`);
console.log(`  enemy deck : ${sawEnemyLine ? JSON.stringify(sawEnemyLine) : "none seen"}`);
console.log(`\n  console errors: ${errors.length}`);
for (const e of errors.slice(0, 3)) console.log(`    ${e.slice(0, 140)}`);
const ok = Boolean(sawEnemyLine);
console.log(`\n  ${ok ? "PASS" : "FAIL"} — the enemy's formation ${ok ? "draws its rail" : "drew nothing"}\n`);
process.exit(ok ? 0 : 1);
