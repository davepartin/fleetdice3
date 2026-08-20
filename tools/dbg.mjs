import { chromium } from "playwright";
import { serve, settle } from "./shoot.mjs";
const server = await serve("/home/claude/fleetdice3/out", 4322);
const browser = await chromium.launch({args:["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--no-sandbox"]});
const page = await browser.newPage({viewport:{width:402,height:874}});
page.on("pageerror", e => console.log("[pageerror]", e.message.slice(0,300)));
await page.goto("http://localhost:4322/solo/", {waitUntil:"networkidle"});
await page.locator('button:has-text("Captain")').first().click();
await settle(page, 2500);
await page.locator('button:has-text("Roll your fleet")').first().click();

for (const wait of [1500, 3000, 6000]) {
  await page.waitForTimeout(wait === 1500 ? 1500 : 1500);
  const info = await page.evaluate(() => {
    const a = window.__fd3;
    if (!a) return "no debug hook";
    return a.debug();
  });
  console.log("at", wait, JSON.stringify(info));
}
await page.screenshot({path:"/home/claude/fleetdice3/shots/dbg-settled.png"});
await browser.close(); server.close();
