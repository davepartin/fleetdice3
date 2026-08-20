/**
 * Screenshot the built game so the art can be judged instead of imagined.
 *
 *   node tools/shoot.mjs                       every shot, phone + desktop
 *   node tools/shoot.mjs /lab/ lab             one route
 *   node tools/shoot.mjs --script solo         run a scripted playthrough
 *
 * Needs `next build` to have produced `out/` first.
 */

import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const OUT = resolve(root, "out");
const SHOTS = resolve(root, "shots");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

export function serve(dir, port = 4321) {
  const server = createServer(async (request, response) => {
    try {
      let path = decodeURIComponent(new URL(request.url, "http://x").pathname);
      let file = join(dir, path);
      if (path.endsWith("/")) file = join(file, "index.html");
      if (!existsSync(file) && existsSync(`${file}.html`)) file = `${file}.html`;
      if (!existsSync(file) && existsSync(join(file, "index.html"))) file = join(file, "index.html");
      if (!existsSync(file)) {
        response.writeHead(404, { "content-type": "text/plain" });
        response.end("not found: " + path);
        return;
      }
      const body = await readFile(file);
      response.writeHead(200, {
        "content-type": MIME[extname(file)] ?? "application/octet-stream",
        "cache-control": "no-store",
      });
      response.end(body);
    } catch (error) {
      response.writeHead(500, { "content-type": "text/plain" });
      response.end(String(error));
    }
  });
  return new Promise((done) => server.listen(port, () => done(server)));
}

const VIEWPORTS = {
  phone: { width: 402, height: 874, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  desktop: { width: 1440, height: 900, deviceScaleFactor: 2 },
};

export async function shoot(page, name, viewport = "phone") {
  await mkdir(SHOTS, { recursive: true });
  const file = join(SHOTS, `${name}-${viewport}.png`);
  await page.screenshot({ path: file });
  return file;
}

/** Let the WebGL scene settle: several animation frames plus a fixed wait. */
export async function settle(page, ms = 1400) {
  await page.waitForTimeout(ms);
  await page.evaluate(
    () =>
      new Promise((done) => {
        let frames = 0;
        const tick = () => (frames++ < 8 ? requestAnimationFrame(tick) : done(null));
        requestAnimationFrame(tick);
      }),
  );
}

async function main() {
  const args = process.argv.slice(2);
  const routes =
    args.length && !args[0].startsWith("--")
      ? [[args[0], args[1] ?? "shot"]]
      : [
          ["/", "home"],
          ["/lab/", "lab"],
        ];

  const server = await serve(OUT, 4321);
  const browser = await chromium.launch({
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"],
  });

  const errors = [];
  for (const [route, name] of routes) {
    for (const [label, viewport] of Object.entries(VIEWPORTS)) {
      const context = await browser.newContext({ viewport, deviceScaleFactor: viewport.deviceScaleFactor });
      const page = await context.newPage();
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(`[${name}/${label}] ${message.text()}`);
      });
      page.on("pageerror", (error) => errors.push(`[${name}/${label}] ${error.message}`));
      await page.goto(`http://localhost:4321${route}`, { waitUntil: "networkidle" });
      await settle(page, 2600);
      const file = await shoot(page, name, label);
      console.log("wrote", file);
      await context.close();
    }
  }

  await browser.close();
  server.close();

  if (errors.length) {
    console.log("\nconsole errors:");
    for (const error of [...new Set(errors)]) console.log(" ", error);
    await writeFile(join(SHOTS, "errors.txt"), [...new Set(errors)].join("\n"));
  } else {
    console.log("\nno console errors");
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
