/**
 * Two phones, one live Firebase room, the same board as solo.
 *
 *   node tools/versus-playtest.mjs
 *
 * Needs `next build` to have produced `out/` first. Talks to the real
 * `space-tribes` project, so this is the honest versus check: create, join,
 * roll, lock in, and wait for the other commander.
 */

import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { serve, settle } from "./shoot.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const OUT = resolve(root, "out");
const SHOTS = resolve(root, "shots");

const PHONE = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

function clickable(page, name) {
  const escaped = name.replace(/"/g, '\\"');
  return page.locator(`button:has-text("${escaped}"), a:has-text("${escaped}")`).first();
}

async function tap(page, name, timeout = 12000) {
  const button = clickable(page, name);
  await button.waitFor({ state: "visible", timeout });
  try {
    await button.click({ timeout: 5000 });
  } catch {
    await button.evaluate((element) => element.click());
  }
}

async function shot(page, label) {
  await mkdir(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${label}-versus.png`) });
  console.log("  shot", label);
}

async function openPhone(browser, name) {
  const context = await browser.newContext({
    viewport: PHONE,
    deviceScaleFactor: PHONE.deviceScaleFactor,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto("http://localhost:4321/", { waitUntil: "networkidle" });
  await settle(page, 800);
  await page.locator("#commander").fill(name);
  return { context, page, errors };
}

async function main() {
  const server = await serve(OUT, 4321);
  const browser = await chromium.launch({
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"],
  });
  const problems = [];

  try {
    const host = await openPhone(browser, "Host");
    const guest = await openPhone(browser, "Guest");

    await tap(host.page, "Play a friend");
    await settle(host.page, 600);
    await tap(host.page, "Create the room");
    await host.page.locator("[data-room-code]").waitFor({ state: "visible", timeout: 20000 });
    const code = await host.page.locator("[data-room-code]").getAttribute("data-room-code");
    if (!code || code.length !== 4) throw new Error("host never received a four-digit code");
    console.log("  room", code);
    await shot(host.page, "01-host-waiting");

    await guest.page.locator('input[aria-label="Four digit game code"]').fill(code);
    await tap(guest.page, "Join");
    await settle(guest.page, 800);
    await tap(guest.page, "Join the game");
    await guest.page.locator("text=Roll Fleet").waitFor({ state: "visible", timeout: 20000 });
    await host.page.locator("text=Roll Fleet").waitFor({ state: "visible", timeout: 20000 });
    await shot(host.page, "02-host-battle");
    await shot(guest.page, "03-guest-battle");

    await tap(host.page, "Roll Fleet");
    await tap(guest.page, "Roll Fleet");
    await settle(host.page, 2800);
    await settle(guest.page, 2800);
    await shot(host.page, "04-host-rolled");

    await tap(host.page, "Lock in");
    await host.page.locator("text=Waiting for").waitFor({ state: "visible", timeout: 8000 });
    await shot(host.page, "05-host-waiting-lock");
    await tap(guest.page, "Lock in");

    const report = host.page.locator("text=To the shipyard").or(host.page.locator("text=See the result"));
    await report.first().waitFor({ state: "visible", timeout: 15000 });
    await shot(host.page, "06-host-report");
    await shot(guest.page, "07-guest-report");

    problems.push(...host.errors.map((line) => `[host] ${line}`));
    problems.push(...guest.errors.map((line) => `[guest] ${line}`));
    await host.context.close();
    await guest.context.close();
  } catch (error) {
    problems.push(String(error?.message ?? error));
  }

  await browser.close();
  server.close();

  const unique = [...new Set(problems.filter((line) => !/firestore|ERR_TUNNEL|ERR_NAME_NOT_RESOLVED|net::ERR_/i.test(line)))];
  if (unique.length) {
    console.log("\nPROBLEMS:");
    for (const line of unique) console.log(" ", line);
    process.exitCode = 1;
  } else {
    console.log("\nclean versus playthrough — both phones reached the round report");
  }
}

await main();
