import { chromium } from "playwright";
const browser = await chromium.launch({ args: ["--use-gl=swiftshader","--enable-webgl"] });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto("https://fleetdice.ministrybag.com/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6000);
  const r = await page.evaluate(async () => {
    const btn = [...document.querySelectorAll("button")].find((b) => /now on the field/i.test(b.textContent || ""));
    const label = btn ? btn.textContent.replace(/\s+/g, " ").trim() : "(not found)";
    if (btn) btn.click();
    await new Promise((r) => setTimeout(r, 900));
    const list = [...document.querySelectorAll("li")].map((li) => li.textContent.replace(/\s+/g," ").trim());
    return { label, rows: list.filter((t) => /round|waiting/i.test(t)) };
  });
  console.log("  header : " + r.label);
  console.log("  rows   : " + (r.rows.length ? JSON.stringify(r.rows) : "none"));
  console.log("\n  Sam vs Alex still listed? " + (r.rows.some((t) => /sam/i.test(t)) ? "YES — still broken" : "no — gone"));
} finally { await browser.close(); }
