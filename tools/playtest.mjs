/**
 * Play the real game in a real browser and take a picture of every screen.
 *
 * This is the only honest way to know whether the thing works. It clicks the
 * buttons a player clicks, in the order a player clicks them, and it fails
 * loudly on a console error or a button that never appears.
 *
 *   node tools/playtest.mjs            three rounds, phone and desktop
 *   node tools/playtest.mjs 8 phone    eight rounds, phone only
 */

import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { serve, settle } from "./shoot.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const OUT = resolve(root, "out");
const SHOTS = resolve(root, "shots");

const VIEWPORTS = {
  phone: { width: 402, height: 874, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  desktop: { width: 1440, height: 900, deviceScaleFactor: 2 },
};

const ROUNDS = Number(process.argv[2]) || 3;
const ONLY = process.argv[3];

/** Buttons and links both count — the home page uses links for the big cards. */
function clickable(page, name) {
  const escaped = name.replace(/"/g, '\\"');
  return page.locator(`button:has-text("${escaped}"), a:has-text("${escaped}")`).first();
}

async function tap(page, name, { optional = false, timeout = 9000 } = {}) {
  const button = clickable(page, name);
  try {
    await button.waitFor({ state: "visible", timeout });
  } catch {
    if (optional) return false;
    throw new Error(`button never appeared: ${name}`);
  }
  // A greyed-out button is a legitimate answer to "can I afford this?", so an
  // optional tap treats it as a no rather than hanging for thirty seconds.
  if (await button.isDisabled().catch(() => false)) {
    if (optional) return false;
    throw new Error(`button is disabled: ${name}`);
  }
  // A click that kicks off a heavy re-render (building the dice textures, say)
  // can outlast Playwright's own post-click check even though the click landed.
  // Fall back to dispatching it directly rather than failing the run.
  try {
    await button.click({ timeout: 5000 });
  } catch {
    await button.evaluate((element) => element.click()).catch(() => undefined);
  }
  return true;
}

async function visible(page, name, timeout = 1200) {
  try {
    await clickable(page, name).waitFor({ state: "visible", timeout });
    return true;
  } catch {
    return false;
  }
}

async function shot(page, label, viewport) {
  await mkdir(SHOTS, { recursive: true });
  const file = join(SHOTS, `${label}-${viewport}.png`);
  await page.screenshot({ path: file });
  console.log("  shot", label);
}

async function run(browser, viewport, label, errors) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: viewport.deviceScaleFactor });
  const page = await context.newPage();
  page.on("console", (message) => {
    const text = message.text();
    // Firestore cannot be reached from the build sandbox. That is the network,
    // not the game — and the game is supposed to keep working without it.
    const offline = /firestore|ERR_TUNNEL|ERR_NAME_NOT_RESOLVED|net::ERR_/i.test(text);
    if (message.type() === "error" && !offline) errors.push(`[${label}] ${text}`);
  });
  page.on("pageerror", (error) => errors.push(`[${label}] ${error.message}`));

  console.log(`\n== ${label} ==`);

  // Home
  await page.goto("http://localhost:4321/", { waitUntil: "networkidle" });
  await settle(page, 2600);
  await shot(page, "01-home", label);

  // How to play, so the help screen gets looked at too
  await tap(page, "How to play");
  await page.waitForTimeout(700);
  await shot(page, "02-help", label);
  await tap(page, "Back to the battle");
  await page.waitForTimeout(500);

  // Solo. Pinned to the cheapest tier: this sandbox renders in software at
  // about five frames a second, and a screenshot of a board mid-throw tells us
  // nothing about how the board looks.
  await tap(page, "Play solo");
  await settle(page, 1200);
  await page.goto("http://localhost:4321/solo/?q=low", { waitUntil: "networkidle" });
  await settle(page, 1200);
  await shot(page, "03-solo-setup", label);

  await tap(page, "Captain");
  await settle(page, 2800);
  await shot(page, "04-round-start", label);

  for (let round = 1; round <= ROUNDS; round += 1) {
    // Shipyard appears from round 2 onward.
    if (await visible(page, "Return to battle")) {
      await shot(page, `${pad(round)}a-shipyard`, label);

      // Spend something if we can, so later screens show a grown fleet.
      // The shipyard is tap-a-cell-then-confirm: anything the bank covers is
      // marked `data-affordable`, so the test can shop the way a player does.
      const affordable = page.locator(".yard-cell[data-affordable]");
      if (await affordable.count()) {
        await affordable.first().click({ timeout: 4000, force: true }).catch(() => undefined);
        await page.waitForTimeout(650);
        await shot(page, `${pad(round)}a2-yard-drawer`, label);
        const confirm = page
          .locator(".yard-drawer .btn:not(:disabled), .yard-drawer .yard-hull:not(:disabled)")
          .first();
        if (await confirm.count()) {
          await confirm.click({ timeout: 4000, force: true }).catch(() => undefined);
          await page.waitForTimeout(700);
        }
      }
      await tap(page, "Return to battle");
      await settle(page, 1400);
    }

    if (!(await visible(page, "Roll Fleet", 4000))) {
      errors.push(`[${label}] round ${round}: no Roll button`);
      break;
    }
    await tap(page, "Roll Fleet");
    await settle(page, 3200);
    await shot(page, `${pad(round)}b-rolled`, label);

    // Send a couple of dice back so the reroll path is exercised.
    await page.mouse.click(viewport.width * 0.3, viewport.height * 0.52);
    await page.waitForTimeout(320);
    if (await visible(page, "Reroll", 900)) {
      await shot(page, `${pad(round)}c-selected`, label);
      await tap(page, "Reroll");
      await settle(page, 2000);
    }

    if (!(await visible(page, "Lock in", 4000))) {
      errors.push(`[${label}] round ${round}: no Lock in button`);
      break;
    }
    await tap(page, "Lock in");
    await page.waitForTimeout(2600);

    // Brace, if anything got through.
    if (await visible(page, "Send", 2500)) {
      await shot(page, `${pad(round)}d-brace`, label);
      await tap(page, "Send");
      await page.waitForTimeout(1800);
    } else if (await visible(page, "Take it on the flagship", 900)) {
      await shot(page, `${pad(round)}d-brace`, label);
      await tap(page, "Take it on the flagship");
      await page.waitForTimeout(1800);
    }

    await settle(page, 1800);
    if (await visible(page, "To the shipyard", 4000)) {
      await shot(page, `${pad(round)}e-report`, label);
      if (viewport.isMobile && (await visible(page, "Battle details", 900))) {
        await tap(page, "Battle details");
        await page.waitForTimeout(500);
        const scrolling = await page.locator(".round-report-details-body").evaluate((element) => {
          const style = getComputedStyle(element);
          const overflowY = style.overflowY;
          const canScroll = element.scrollHeight - element.clientHeight > 8;
          if (canScroll) element.scrollTop = Math.min(80, element.scrollHeight);
          return {
            overflowY,
            canScroll,
            scrolled: element.scrollTop > 0,
            clientHeight: Math.round(element.clientHeight),
            scrollHeight: Math.round(element.scrollHeight),
          };
        });
        if (scrolling.overflowY !== "scroll" && scrolling.overflowY !== "auto") {
          errors.push(`[${label}] round ${round}: battle details overflow is ${scrolling.overflowY}`);
        }
        if (scrolling.canScroll && !scrolling.scrolled) {
          errors.push(`[${label}] round ${round}: battle details did not move when scrolled`);
        }
        await shot(page, `${pad(round)}e2-report-details`, label);
        await tap(page, "Battle details");
        await page.waitForTimeout(250);
      }
      await tap(page, "To the shipyard");
      await settle(page, 1200);
    } else if (await visible(page, "See the result", 1200)) {
      await shot(page, `${pad(round)}e-report`, label);
      await tap(page, "See the result");
      await settle(page, 2200);
      await shot(page, "99-result", label);
      break;
    } else if (await visible(page, "Again", 1200)) {
      // The match ended inside the volley — no report screen, straight to the
      // result. That is a legitimate ending, not a stuck screen.
      await shot(page, "99-result", label);
      break;
    } else {
      errors.push(`[${label}] round ${round}: stuck after locking in`);
      await shot(page, `${pad(round)}x-stuck`, label);
      break;
    }
  }

  await context.close();
}

function pad(n) {
  return String(n + 4).padStart(2, "0");
}

async function main() {
  const server = await serve(OUT, 4321);
  const browser = await chromium.launch({
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"],
  });
  const errors = [];

  for (const [label, viewport] of Object.entries(VIEWPORTS)) {
    if (ONLY && ONLY !== label) continue;
    try {
      await run(browser, viewport, label, errors);
    } catch (error) {
      errors.push(`[${label}] ${error.message}`);
    }
  }

  await browser.close();
  server.close();

  const unique = [...new Set(errors)];
  if (unique.length) {
    console.log("\nPROBLEMS:");
    for (const line of unique) console.log(" ", line);
    await writeFile(join(SHOTS, "playtest-errors.txt"), unique.join("\n"));
    process.exitCode = 1;
  } else {
    console.log("\nclean playthrough — no console errors, no stuck screens");
  }
}

await main();
