/** What the reroll button says at each step of a round. */
import { chromium } from "playwright";
const BASE = "http://localhost:3000";
const browser = await chromium.launch({
  args: ["--use-gl=swiftshader","--enable-webgl","--ignore-gpu-blocklist","--disable-gpu-sandbox"],
});
const rows = [];
try {
  const W = Number(process.env.W ?? 390), H = Number(process.env.H ?? 844);
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e)));
  await page.goto(`${BASE}/solo/`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  await page.getByRole("button", { name: /^Low/ }).first().click({ force: true }).catch(() => {});
  await page.waitForTimeout(1800);

  const tap = async (re, w = 1500) => {
    const b = page.getByRole("button", { name: re }).first();
    if (!(await b.count()) || (await b.isDisabled().catch(() => true))) return false;
    await b.click({ force: true, timeout: 6000 }).catch(() => {}); await page.waitForTimeout(w); return true;
  };
  const FWD = [/^Lock in/, /^Take it all on the flagship/, /^To the shipyard|^See the result/,
               /^Return to battle/, /^Continue|^Next/i, /^Roll Fleet/];
  // Round one, explicitly, so round two starts with Energy in the bank. The
  // free rolls are free whatever happens; the paid ones need something to spend.
  for (const step of [/^Roll Fleet/, /^Lock in/, /^Take it all on the flagship|^Block or be destroyed/,
                      /^To the shipyard|^See the result/, /^Return to battle/, /^Roll Fleet/]) {
    await tap(step, 2200);
  }

  const readBtn = () => page.evaluate(() => {
    const b = [...document.querySelectorAll("button")]
      .find((x) => /reroll/i.test(x.textContent || "") && !/^Clear/i.test(x.textContent || ""));
    if (!b) return null;
    const el = b.querySelector(".reroll-label");
    const cost = b.querySelector(".reroll-cost, .reroll-free");
    return {
      whole: (b.textContent || "").replace(/\s+/g, " ").trim(),
      left: el ? el.innerText.replace(/\s+/g, " ").trim() : null,
      right: cost ? cost.innerText.replace(/\s+/g, " ").trim() : null,
      disabled: b.disabled,
      overflows: b.scrollWidth > b.clientWidth + 1,
      aria: b.getAttribute("aria-label"),
    };
  });

  for (let attempt = 1; attempt <= 8; attempt += 1) {
    const picked = await page.evaluate(() => {
      const fd = window.__fd3; const mine = fd?.debug()?.you ?? [];
      if (!mine.length) return null; fd.tap(mine[0].id); return mine[0].id;
    });
    if (!picked) break;
    await page.waitForTimeout(450);
    const st = await readBtn();
    if (!st) break;
    rows.push({ attempt, ...st });
    if (attempt === 3) await page.screenshot({ path: `shots/reroll-paid-${W}x${H}.png` });
    if (st.disabled) { await page.screenshot({ path: `shots/reroll-out-${W}x${H}.png` }); break; }
    await page.getByRole("button", { name: /reroll/i }).first().click({ force: true }).catch(() => {});
    await page.waitForTimeout(1600);
  }
  console.log(`\n  console errors: ${errs.length}`);
} finally { await browser.close(); }
console.log(`\n=== the reroll button at ${process.env.W ?? 390}x${process.env.H ?? 844} ===\n`);
for (const r of rows) {
  console.log(`  ${r.disabled ? "OFF" : "ON "}  left="${r.left}"  right="${r.right}"${r.overflows ? "  ⚠ OVERFLOWS" : ""}`);
}
