import { chromium } from "playwright";
const browser = await chromium.launch({ args: ["--use-gl=swiftshader","--enable-webgl","--ignore-gpu-blocklist","--disable-gpu-sandbox"] });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto("http://localhost:3000/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000);
  const m = await page.evaluate(() => {
    const h = window.__fdHero;
    if (!h) return { error: "no hatch" };
    const p = h.positions();
    const ys = p.map((q) => q.y);
    const cardTop = (() => {
      const el = [...document.querySelectorAll("a,button")].find((e) => /tutorial/i.test(e.textContent || ""));
      return el ? Math.round(el.getBoundingClientRect().top) : null;
    })();
    const artBottom = (() => {
      const el = document.querySelector(".home-key-art");
      return el ? Math.round(el.getBoundingClientRect().bottom) : null;
    })();
    return { n: p.length, mean: Math.round(ys.reduce((a,b)=>a+b,0)/ys.length),
             min: Math.min(...ys), max: Math.max(...ys), artBottom, cardTop,
             viewport: window.innerHeight };
  });
  console.log("  " + JSON.stringify(m));
} finally { await browser.close(); }
