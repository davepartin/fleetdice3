/**
 * Does the last volley actually get watched?
 *
 * The flagship break and the dice scatter were always there; the recap just
 * covered them. This plays a whole solo match and measures the gap between the
 * match ending and the recap appearing, and checks the board is on screen for
 * that whole time.
 *
 *   node finish-playtest.mjs      (needs pnpm dev on :3000)
 */
import { chromium } from "playwright";

const browser = await chromium.launch({
  args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--disable-gpu-sandbox"],
});
const errors = [];
let bannerFit = null, recapFaces = null;
let held = null, sawHold = false, sawRecap = false, canvasDuringHold = null, rounds = 0;
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

  await page.goto("http://localhost:3000/fleetdice3/solo/?q=low", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2200);
  await page.getByRole("button", { name: /^Low/ }).first().click({ force: true }).catch(() => {});
  await page.waitForTimeout(1600);

  const txt = () => page.evaluate(() => document.body.innerText.replace(/\s+/g, " "));
  const tap = async (re, wait = 900) => {
    const b = page.getByRole("button", { name: re }).first();
    if (!(await b.count())) return false;
    if (await b.isDisabled().catch(() => true)) return false;
    await b.click({ force: true, timeout: 6000 }).catch(() => {});
    await page.waitForTimeout(wait);
    return true;
  };

  const FORWARD = [/^Lock in/, /^Take it all on the flagship/, /^To the shipyard|^See the result/,
                   /^Return to battle/, /^Continue|^Next/i, /^Roll Fleet/];

  let stuck = 0;
  for (let step = 0; step < 400; step += 1) {
    const t = await txt();
    if (/BATTLE RECAP/i.test(t)) { sawRecap = true; break; }
    if (/The final volley/i.test(t)) {
      if (!sawHold) {
        sawHold = true;
        held = Date.now();
        // Is the 3D board actually on screen while we hold?
        canvasDuringHold = await page.evaluate(() => {
          const c = document.querySelector("canvas");
          if (!c) return null;
          const r = c.getBoundingClientRect();
          return { w: Math.round(r.width), h: Math.round(r.height), visible: r.width > 0 && r.height > 0 };
        });
        // Measure the banner rather than trust a screenshot taken mid-shake:
        // the shake is a transform on the container, so it moves everything.
        bannerFit = await page.evaluate(() => {
          const el = [...document.querySelectorAll("p")]
            .find((p) => /final volley/i.test(p.textContent || ""))?.closest(".panel");
          if (!el) return null;
          const line = el.querySelector("p.t-display");
          const r = el.getBoundingClientRect();
          return {
            overflowsX: el.scrollWidth > el.clientWidth + 1,
            overflowsY: el.scrollHeight > el.clientHeight + 1,
            lineClipped: line ? line.scrollWidth > line.clientWidth + 1 : null,
            insideViewport: r.left >= -1 && r.right <= window.innerWidth + 1,
            box: { l: Math.round(r.left), r: Math.round(r.right), w: Math.round(r.width) },
            vw: window.innerWidth,
          };
        });
        await page.screenshot({ path: "shots/finish-hold.png" });
      }
      await page.waitForTimeout(200);
      continue;   // deliberately do NOT tap to skip; we are timing the hold
    }
    // Blocking: when the volley would kill, the game insists on blockers, and
    // the "take it on the flagship" way out is not offered. Tap ships first.
    if (/CHOOSE YOUR BLOCKERS/i.test(t) && /Block or be destroyed/i.test(t)) {
      await page.evaluate(() => {
        const fd = window.__fd3;
        const mine = fd?.debug()?.you ?? [];
        for (const d of mine) if (d.id !== "flag") fd.tap(d.id);
      });
      await page.waitForTimeout(500);
    }
    let moved = false;
    for (const re of FORWARD) { if (await tap(re, /Roll Fleet/.test(re.source) ? 1800 : 900)) { moved = true; if (/Roll Fleet/.test(re.source)) rounds += 1; break; } }
    if (!moved) moved = await tap(/^Block or be destroyed|^Confirm|^Block \d/, 1600);
    if (!moved) {
      stuck += 1;
      if (stuck === 6) {
        const bs = await page.evaluate(() => [...document.querySelectorAll("button")]
          .map((b) => ({ t: (b.textContent||"").replace(/\s+/g," ").trim().slice(0,30), off: b.disabled })));
        console.log("STUCK at step", step, JSON.stringify(bs.slice(0, 8)));
        console.log("  screen:", (await txt()).slice(0, 220));
        break;
      }
      await page.waitForTimeout(400);
    } else stuck = 0;
  }
  const recapAt = Date.now();
  if (sawRecap && held) held = recapAt - held;
  if (sawRecap) {
    await page.waitForTimeout(1200);   // let the face canvases paint
    await page.screenshot({ path: "shots/finish-recap.png", fullPage: true });
    recapFaces = await page.evaluate(() => {
      const boards = [...document.querySelectorAll(".recap-board")];
      return boards.map((b) => ({
        faces: b.querySelectorAll(".recap-cell-face").length,
        silhouettes: b.querySelectorAll(".recap-cell-hull").length,
        overflowsX: b.scrollWidth > b.clientWidth + 1,
      }));
    });
  }
} finally {
  await browser.close();
}

console.log(`\n=== the end of a match (${rounds} rolls) ===\n`);
console.log(`  held the recap back for the final volley : ${sawHold ? "YES" : "NO"}`);
console.log(`  board on screen during the hold          : ${canvasDuringHold ? `${canvasDuringHold.w}x${canvasDuringHold.h}` : "no canvas"}`);
console.log(`  hold lasted                              : ${sawHold && sawRecap ? `${held}ms` : "n/a"}`);
console.log(`  recap arrived on its own                 : ${sawRecap ? "YES" : "NO"}`);
console.log(`  banner fit                               : ${JSON.stringify(bannerFit)}`);
console.log(`  recap boards (faces/silhouettes)         : ${JSON.stringify(recapFaces)}`);
console.log(`  console errors                           : ${errors.length}`);
for (const e of errors.slice(0, 3)) console.log(`    ${e.slice(0, 140)}`);
const ok = sawHold && sawRecap && canvasDuringHold?.visible;
console.log(`\n  ${ok ? "PASS" : "FAIL"}\n`);
process.exit(ok ? 0 : 1);
