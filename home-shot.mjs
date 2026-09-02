import { chromium } from "playwright";
const browser = await chromium.launch({ args: ["--use-gl=swiftshader","--enable-webgl","--ignore-gpu-blocklist","--disable-gpu-sandbox"] });
try {
  for (const [w, h, tag] of [[390, 844, "390x844"], [390, 620, "390x620"]]) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    const errs = [];
    page.on("pageerror", (e) => errs.push(String(e)));
    await page.goto("http://localhost:3000/fleetdice3/", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3500);
    await page.screenshot({ path: `shots/home-${tag}.png` });
    const m = await page.evaluate(() => {
      const art = document.querySelector(".home-key-art");
      const canvas = document.querySelector(".stage-canvas");
      const doc = document.documentElement;
      const firstBtn = [...document.querySelectorAll("a,button")].find((e) => /Tutorial|Play solo/.test(e.textContent || ""));
      return {
        artBottom: art ? Math.round(art.getBoundingClientRect().bottom) : null,
        canvasVisible: canvas ? canvas.getBoundingClientRect().height > 0 : false,
        firstActionTop: firstBtn ? Math.round(firstBtn.getBoundingClientRect().top) : null,
        pageScrollHeight: doc.scrollHeight,
        viewport: window.innerHeight,
        overflowsX: doc.scrollWidth > doc.clientWidth + 1,
        words: (document.body.innerText.match(/\S+/g) || []).length,
      };
    });
    console.log(`  ${tag}: ${JSON.stringify(m)}  errors:${errs.length}`);
    await page.close();
  }
} finally { await browser.close(); }
