/**
 * Play the reroll cap in a real browser, at phone size.
 *
 * The engine tests prove the rule. This proves the *screen* obeys it: that the
 * Reroll button stops offering a move the engine would refuse, and says why.
 * A live button that throws an error is worse than no cap at all.
 *
 *   node cap-playtest.mjs        (needs pnpm dev on :3000)
 */
import { chromium } from "playwright";

const BASE = "http://localhost:3000";  // the game serves from the root now
const browser = await chromium.launch({
  args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--disable-gpu-sandbox"],
});
const errors = [];
let failed = false;
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.goto(`${BASE}/solo/?q=low`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2200);
  await page.getByRole("button", { name: /^Low/ }).first().click({ force: true }).catch(() => {});
  await page.waitForTimeout(1600);

  const btn = (re) => page.getByRole("button", { name: re }).first();
  const tap = async (re, wait = 1700) => {
    const b = btn(re);
    if (await b.count()) { await b.click({ force: true, timeout: 5000 }).catch(() => {}); await page.waitForTimeout(wait); return true; }
    return false;
  };

  // Play forward until we are in the roll phase of a later round with a bank.
  // Button names differ by screen, so follow whatever "next" button is present
  // rather than hardcoding the sequence.
  const FORWARD = [/^Lock in/, /^Take it all on the flagship/, /^To the shipyard/,
                   /^Continue|^Next|^Play on/i, /^Return to battle/i,
                   /^Ready|^Done|^Set sail|^Launch/i, /^Roll Fleet/];
  let bank = 0, lastBank = 0;
  for (let step = 0; step < 24; step += 1) {
    // "3 IN THE BANK" on the shipyard screen is the Energy readout. The
    // "+16" beside each flagship is not Energy — both sides show it.
    bank = await page.evaluate(() => {
      const m = document.body.innerText.match(/(\d+)\s+IN THE BANK/i);
      return m ? Number(m[1]) : window.__fd3Bank ?? 0;
    });
    if (bank) lastBank = bank;
    const inRoll = await page.evaluate(() =>
      [...document.querySelectorAll("button")].some((b) => /^Roll Fleet/.test((b.textContent || "").trim())));
    // Once there is money in the bank, take the roll and start the experiment.
    if (inRoll && lastBank >= 3) { await tap(/^Roll Fleet/, 2300); break; }
    let moved = false;
    for (const re of FORWARD) { if (await tap(re, 1700)) { moved = true; break; } }
    if (!moved) break;
  }
  const energy = lastBank;

  const readButton = () => page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => /^Reroll\s*\d/.test((x.textContent || "").trim()));
    return b ? { text: (b.textContent || "").replace(/\s+/g, " ").trim(), disabled: b.disabled,
                 label: b.getAttribute("aria-label") } : null;
  });

  console.log("  buttons before reroll loop:", JSON.stringify(await page.evaluate(() =>
    [...document.querySelectorAll("button")].map(b => (b.textContent||"").replace(/\s+/g," ").trim().slice(0,28)).slice(0,8))));
  const rows = [];
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    const picked = await page.evaluate(() => {
      const fd = window.__fd3;
      if (!fd?.debug) return null;
      const decks = fd.debug();
      const mine = decks.you ?? [];
      if (!mine.length) return null;
      fd.tap(mine[0].id);
      return mine[0].id;
    });
    if (!picked) { rows.push({ attempt, note: "could not select a die" }); break; }
    await page.waitForTimeout(450);
    const st = await readButton();
    if (!st) { rows.push({ attempt, note: "no Reroll button" }); break; }
    rows.push({ attempt, ...st });
    if (st.disabled) break;
    await btn(/^Reroll \d/).click({ force: true, timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(1700);
  }

  console.log(`\n=== Reroll button, tap by tap, 390x844, bank ${energy}⚡ ===\n`);
  for (const r of rows) {
    if (r.note) { console.log(`  attempt ${r.attempt}: ${r.note}`); continue; }
    console.log(`  attempt ${r.attempt}: ${r.disabled ? "DISABLED" : "enabled "}  "${r.text}"`);
  }

  const last = rows[rows.length - 1];
  const capped = last && last.disabled && /No rerolls left/i.test(last.text);
  const paidTaken = rows.filter((r) => /Cost/.test(r.text || "")).length;
  console.log(`\n  paid rerolls offered before the stop: ${paidTaken}`);
  console.log(`  stopped by the cap with a clear label: ${capped ? "YES" : "NO"}`);
  console.log(`  console errors: ${errors.length}`);
  for (const e of errors.slice(0, 4)) console.log(`    ${e.slice(0, 150)}`);
  await page.screenshot({ path: "shots/cap-final.png" });
  if (!capped || errors.length) failed = true;
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
