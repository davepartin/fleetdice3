/**
 * The home screen and both battle modes share one stylesheet.
 * If the root layout stops importing it, the dice still draw and every
 * menu falls below them — which is exactly how the live home page broke.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("the root layout still loads the design stylesheet", () => {
  const src = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
  assert.match(src, /import ["']\.\/globals\.css["']/);
});

test("the match shell cannot grow a dead page-scroll under the dock", () => {
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  const htmlBlock = css.match(/html,\s*body \{[^}]*\}/);
  const bodyBlock = css.match(/\nbody \{[^}]*\}/);
  const hudBlock = css.match(/^\.hud \{[^}]*\}/m);
  const canvasBlock = css.match(/^\.stage-canvas \{[^}]*\}/m);
  const shellBlock = css.match(/^\.tutorial-shell \{[^}]*\}/m);
  assert.ok(htmlBlock, "html, body need a sizing block");
  assert.ok(bodyBlock, "body needs its own lock-down block");
  assert.ok(hudBlock, "the HUD needs a sizing block");
  assert.ok(canvasBlock, "the canvas needs a sizing block");
  assert.ok(shellBlock, "the tutorial shell needs a sizing block");

  // --vv-height is the real visible screen. 100dvh alone is what let Safari
  // paint a taller page than the player can see, then scroll into black.
  for (const [name, block] of [
    ["html, body", htmlBlock[0]],
    ["body", bodyBlock[0]],
    ["hud", hudBlock[0]],
    ["canvas", canvasBlock[0]],
    ["tutorial-shell", shellBlock[0]],
  ]) {
    assert.match(block, /--vv-height/, `${name} must size to the visible viewport`);
    assert.match(block, /overflow:\s*hidden/, `${name} must not page-scroll`);
  }

  assert.doesNotMatch(
    shellBlock[0],
    /min-height:\s*100dvh/,
    "min-height: 100dvh on the shell is what left a black band under the dock",
  );
  assert.match(css, /\.match-bottom \{[^}]*margin-top:\s*auto/, "the dock stays at the bottom of the HUD");
});
