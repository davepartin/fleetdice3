/**
 * The art on a die face.
 *
 * Every face is drawn into one square of a texture atlas: the number big enough
 * to read on a phone, and beneath it the marks that face always pays. Two
 * atlases come out of here — the albedo you see lit, and an emissive copy for
 * marks only. Numbers stay non-emissive so their hard edges survive on phones.
 */

import * as THREE from "three";
import { addHullPath } from "@/components/HullShape";
import type { DieSize } from "@/lib/engine";

export type MarkKind = "energy" | "repair" | "direct";

// Every colour in this file — MARK_COLOR, HIT, FLAG_SHELL, BLOCK,
// FLAG_FACE_PALETTE, and the keylines/shadows/highlights painted in
// paintGlyph and paintFace below — is the die-face art's own bespoke
// palette (plate gradients, per-value flagship insets, mark glyphs, ink and
// shine passes), not the UI's --color-* tokens. None has a 1:1 token match
// in app/globals.css, so none is named against one, except where a value is
// literally reused — e.g. "#ffffff" below is always --color-white.
export const MARK_COLOR: Record<MarkKind, string> = {
  // These stay intentionally lighter than their matching HUD colours. Tiny
  // marks are viewed on a steeply projected face, so the symbol needs a bright
  // core and a dark keyline to survive at real iPhone size.
  energy: "#fff06a",
  repair: "#8dffc0",
  direct: "#b875ff",
};

export type FaceSpec = {
  value: number;
  /** Even faces hit, odd faces block. Drives the colour of the whole face. */
  fights: "hits" | "blocks";
  marks: { kind: MarkKind; count: number }[];
  /** The flagship never fights, so its faces are gold and carry a word. */
  role?: "ship" | "flag";
  caption?: string;
};

const HIT = { ink: "#ffffff", top: "#ff6075", bottom: "#c92342", glow: "#ff7182", deep: "#5e0b1b" };
/**
 * The flagship's outer resin shell — a black rim. Bronze crowded the cube
 * and hid the reroll outline; black reads as the hull and leaves the
 * coloured inset to say which bonus is showing.
 */
const FLAG_SHELL = { top: "#1a1a20", bottom: "#08080c", deep: "#000000" };

/** A cheap repeatable hash, so the resin speckle is identical on every build. */
function pseudo(n: number): number {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}
const BLOCK = { ink: "#ffffff", top: "#48b9ff", bottom: "#1268b5", glow: "#73caff", deep: "#062c58" };

/**
 * Fleet Dice 1's flagship language, rebuilt as polished 3D resin. Each face
 * has a semantic colour, so the die itself teaches which fleet dice it boosts.
 */
export const FLAG_FACE_PALETTE: Record<
  number,
  { fill: string; mid: string; deep: string; ink: string; ring: number }
> = {
  1: { fill: "#ffe94a", mid: "#e0bf1c", deep: "#302703", ink: "#241c02", ring: 0xffe81f },
  2: { fill: "#c49aff", mid: "#9870d8", deep: "#27143e", ink: "#1e1233", ring: 0xb98bff },
  3: { fill: "#79f0ac", mid: "#49bb79", deep: "#082b1b", ink: "#06291b", ring: 0x72efa6 },
  4: { fill: "#ffe94a", mid: "#e0bf1c", deep: "#302703", ink: "#241c02", ring: 0xffe81f },
  5: { fill: "#51bcff", mid: "#258bd1", deep: "#062f4e", ink: "#062a47", ring: 0x45b6ff },
  6: { fill: "#ff6578", mid: "#d03a50", deep: "#430a14", ink: "#3d0812", ring: 0xff5569 },
};

/* ------------------------------------------------------------------ */
/* Glyphs                                                              */
/* ------------------------------------------------------------------ */

/**
 * Marks are drawn twice: a dark keyline first, then the bright core on top.
 * At the size these end up on a phone — a few dozen pixels on a face turned
 * away from the lens — a single flat shape dissolves into its background.
 * The keyline is what keeps the symbol a symbol.
 */
function paintGlyph(
  ctx: CanvasRenderingContext2D,
  path: () => void,
  colour: string,
  size: number,
  mode: "fill" | "stroke",
  strokeWidth = 0,
  highlight = "#ffffff",
) {
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  // Keyline
  ctx.strokeStyle = "rgba(4,9,20,0.9)";
  ctx.lineWidth = mode === "stroke" ? strokeWidth + size * 0.085 : size * 0.075;
  path();
  ctx.stroke();
  if (mode === "fill") {
    ctx.fillStyle = "rgba(4,9,20,0.9)";
    ctx.fill();
  }

  // Core, with its own top-lit gradient so the mark has a little form.
  const shine = ctx.createLinearGradient(0, -size * 0.5, 0, size * 0.5);
  shine.addColorStop(0, highlight);
  shine.addColorStop(0.45, colour);
  shine.addColorStop(1, colour);
  ctx.strokeStyle = shine;
  ctx.fillStyle = shine;
  ctx.lineWidth = mode === "stroke" ? strokeWidth : 0;
  path();
  if (mode === "stroke") ctx.stroke();
  else ctx.fill();
  ctx.restore();
}

function drawBolt(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, colour: string) {
  // Wide enough to remain a lightning bolt after the face is reduced to a
  // handful of phone pixels. A narrow zigzag collapses to a line.
  const w = size * 0.78;
  const h = size;
  const path = () => {
    ctx.beginPath();
    ctx.moveTo(x + w * 0.3, y - h * 0.5);
    ctx.lineTo(x - w * 0.5, y + h * 0.1);
    ctx.lineTo(x - w * 0.04, y + h * 0.1);
    ctx.lineTo(x - w * 0.28, y + h * 0.5);
    ctx.lineTo(x + w * 0.5, y - h * 0.12);
    ctx.lineTo(x + w * 0.02, y - h * 0.12);
    ctx.closePath();
  };
  paintGlyph(ctx, path, colour, size, "fill");
}

function drawCross(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, colour: string) {
  const arm = size * 0.46;
  const thick = size * 0.34;
  const path = () => {
    ctx.beginPath();
    ctx.roundRect(x - thick / 2, y - arm, thick, arm * 2, thick * 0.3);
    ctx.roundRect(x - arm, y - thick / 2, arm * 2, thick, thick * 0.3);
  };
  paintGlyph(ctx, path, colour, size, "fill");
}

/**
 * A chevron: the bent bar off a sergeant's sleeve, not an arrow.
 *
 * It was drawn as a solid forward dart for a while, which read as "→" and had
 * every player thinking Direct pushed something sideways. Stroking a two-leg
 * polyline with a round join gives a true chevron and holds its shape at any
 * size, which a hand-built outline does not.
 */
function drawChevron(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, colour: string) {
  const w = size * 0.8;
  const h = size * 0.4;
  const thick = size * 0.22;
  const path = () => {
    ctx.beginPath();
    ctx.moveTo(x - w / 2, y + h * 0.5);
    ctx.lineTo(x, y - h * 0.5);
    ctx.lineTo(x + w / 2, y + h * 0.5);
  };
  paintGlyph(ctx, path, colour, size, "stroke", thick, "#d7b5ff");
}

function drawMark(
  ctx: CanvasRenderingContext2D,
  kind: MarkKind,
  x: number,
  y: number,
  size: number,
  colour: string,
) {
  if (kind === "energy") drawBolt(ctx, x, y, size, colour);
  else if (kind === "repair") drawCross(ctx, x, y, size, colour);
  else drawChevron(ctx, x, y, size, colour);
}

/* ------------------------------------------------------------------ */
/* One face                                                            */
/* ------------------------------------------------------------------ */

type FaceLayout = {
  numberY: number;
  markY: number;
  numberSize?: number;
  /** Caption centre, as a fraction of the face. */
  captionY?: number;
  /** Half-width of the caption plate, as a fraction of the face. */
  captionHalfWidth?: number;
};

function paintFace(
  ctx: CanvasRenderingContext2D,
  spec: FaceSpec,
  sides: number,
  size: number,
  mode: "albedo" | "emissive",
  numeralFont: string,
  captionFont: string,
  layout?: FaceLayout,
) {
  const isFlag = spec.role === "flag";
  const flagPalette = FLAG_FACE_PALETTE[spec.value] ?? FLAG_FACE_PALETTE[1]!;
  // The flagship's face colour lives in an inset panel rather than washing the
  // whole hull. The black shell frames every bonus colour consistently and
  // keeps the flagship visually separate from the fleet dice around it.
  const palette = isFlag
    ? {
        ink: "#fffdf2",
        top: FLAG_SHELL.top,
        bottom: FLAG_SHELL.bottom,
        glow: flagPalette.fill,
        deep: FLAG_SHELL.deep,
      }
    : spec.fights === "hits" ? HIT : BLOCK;
  const glow = palette.glow;
  const cx = size / 2;

  if (mode === "albedo") {
    // Clean colour first. Lighting supplies the 3D form; black radial shading
    // inside the texture only turns a readable die into a dirty one on iPhone.
    const plate = ctx.createLinearGradient(0, 0, 0, size);
    plate.addColorStop(0, palette.top);
    plate.addColorStop(0.68, palette.top);
    plate.addColorStop(1, palette.bottom);
    ctx.fillStyle = plate;
    ctx.fillRect(0, 0, size, size);

    // Resin speckle. Barely visible on its own; without it a face this flat
    // reads as printed vinyl rather than a cast, polished die.
    ctx.save();
    ctx.globalAlpha = 0.05;
    for (let i = 0; i < 340; i += 1) {
      const px = pseudo(spec.value * 31 + i) * size;
      const py = pseudo(spec.value * 77 + i * 3) * size;
      const r = 0.4 + pseudo(i * 13) * size * 0.004;
      ctx.fillStyle = pseudo(i * 7) > 0.5 ? "#ffffff" : "#000000";
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // Fleet dice keep a restrained resin highlight. The flagship does not:
    // its inset panel and black surround already provide the depth cues, and
    // the diagonal sheen made its top-left corner look misshapen on phones.
    if (!isFlag) {
      ctx.save();
      const sheen = ctx.createLinearGradient(0, 0, size, size * 0.7);
      sheen.addColorStop(0, "rgba(255,255,255,0.4)");
      sheen.addColorStop(0.3, "rgba(255,255,255,0.14)");
      sheen.addColorStop(0.42, "rgba(255,255,255,0.03)");
      sheen.addColorStop(0.43, "rgba(255,255,255,0)");
      ctx.fillStyle = sheen;
      ctx.fillRect(0, 0, size, size * 0.62);
      ctx.restore();
    }

    // A square inset belongs on the square d6 faces only. Painting it into
    // every atlas cell made the d4/d8 triangles and d10 kites look as though a
    // rectangular sticker had been pasted across the hull.
    if (sides === 6) {
      if (isFlag) {
        // The coloured panel: this is what tells you what the flagship boosts.
        // It very nearly fills the face — the black shell only shows through
        // at the rounded corners, which is what reads as "rounded edges"
        // rather than a frame around the colour.
        ctx.save();
        const inset = size * 0.032;
        const panel = ctx.createLinearGradient(0, inset, 0, size - inset);
        panel.addColorStop(0, flagPalette.fill);
        panel.addColorStop(1, flagPalette.mid);
        ctx.fillStyle = panel;
        ctx.beginPath();
        ctx.roundRect(inset, inset, size - inset * 2, size - inset * 2, size * 0.17);
        ctx.fill();
        // A hairline dark seat, just enough to separate the panel from the
        // black corner it is set into — not a border around the whole face.
        ctx.strokeStyle = "rgba(0,0,0,0.85)";
        ctx.lineWidth = size * 0.012;
        ctx.stroke();
        ctx.restore();
      } else {
        ctx.save();
        ctx.globalAlpha = 0.38;
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = size * 0.012;
        ctx.beginPath();
        ctx.roundRect(size * 0.09, size * 0.09, size * 0.82, size * 0.82, size * 0.16);
        ctx.stroke();
        ctx.restore();
      }
    }
  } else {
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, size, size);
    if (sides === 6 && !isFlag) {
      // The d6 bevel ring glows faintly too.
      ctx.save();
      ctx.globalAlpha = 0.2;
      ctx.strokeStyle = glow;
      ctx.lineWidth = size * 0.014;
      ctx.beginPath();
      ctx.roundRect(size * 0.09, size * 0.09, size * 0.82, size * 0.82, size * 0.16);
      ctx.stroke();
      ctx.restore();
    }
  }

  const hasMarks = spec.marks.length > 0 || Boolean(spec.caption);
  // Fleet numerals sit lower and leave more air around the triangle tip. Keep
  // the payoff marks anchored so their spacing does not change with the type.
  const numberY = size * (
    layout?.numberY ?? (hasMarks ? (isFlag ? 0.39 : 0.445) : isFlag ? 0.5 : 0.54)
  );
  const numberSize = size * (
    layout?.numberSize ?? (hasMarks ? (isFlag ? 0.58 : 0.5) : isFlag ? 0.69 : 0.56)
  );

  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `900 ${numberSize}px ${numeralFont}`;
  if (mode === "albedo") {
    ctx.shadowBlur = 0;
    ctx.lineJoin = "round";

    // The numeral is built up in passes so it reads as struck into the face
    // rather than printed on it. A single flat fill — which is what was here —
    // gives you a legible number and a die that looks like a sticker.
    const n = String(spec.value);
    const drop = size * 0.026;

    // 1. Keyline, so the glyph survives against any hull colour.
    ctx.strokeStyle = isFlag ? "rgba(28,18,0,0.85)" : palette.deep;
    ctx.lineWidth = size * 0.038;
    ctx.strokeText(n, cx, numberY);

    // 2. Cast shadow down and right, in two passes so it has a falloff.
    ctx.fillStyle = isFlag ? "rgba(26,16,0,0.34)" : "rgba(3,8,18,0.38)";
    ctx.fillText(n, cx + drop, numberY + drop);
    ctx.fillStyle = isFlag ? "rgba(26,16,0,0.4)" : "rgba(3,8,18,0.44)";
    ctx.fillText(n, cx + drop * 0.5, numberY + drop * 0.5);

    // 3. A lit edge up and left, where the key light falls.
    ctx.fillStyle = isFlag ? "rgba(255,246,214,0.9)" : "rgba(255,255,255,0.95)";
    ctx.fillText(n, cx - drop * 0.34, numberY - drop * 0.34);

    // 4. The face of the glyph, top-lit so it has its own form.
    const face = ctx.createLinearGradient(0, numberY - numberSize * 0.52, 0, numberY + numberSize * 0.5);
    if (isFlag) {
      // Dark on a bright panel: the flagship's number is struck, not painted.
      face.addColorStop(0, "#4a3908");
      face.addColorStop(0.55, "#20180b");
      face.addColorStop(1, "#100c04");
    } else {
      face.addColorStop(0, "#ffffff");
      face.addColorStop(0.52, "#f2f6ff");
      face.addColorStop(1, "#aabfdd");
    }
    ctx.fillStyle = face;
  } else {
    ctx.shadowColor = "#000000";
    ctx.shadowBlur = 0;
    // Bloom is reserved for payoff marks. The main number is a hard albedo
    // glyph, which is why it stays sharp at a real phone's render resolution.
    ctx.fillStyle = "#000000";
  }
  ctx.fillText(String(spec.value), cx, numberY);
  ctx.restore();

  if (spec.caption) {
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const capY = size * (layout?.captionY ?? 0.775);
    const capHalf = size * (layout?.captionHalfWidth ?? 0.345);
    if (mode === "albedo") {
      // A dark plate under the word. Small caps on a bright panel are the
      // first thing to disappear when the die tilts away from the camera.
      ctx.fillStyle = "rgba(18,11,0,0.62)";
      ctx.beginPath();
      ctx.roundRect(cx - capHalf, capY - size * 0.082, capHalf * 2, size * 0.164, size * 0.05);
      ctx.fill();
    }
    ctx.font = `900 ${size * 0.105}px ${captionFont}`;
    ctx.letterSpacing = `${size * 0.012}px`;
    ctx.fillStyle = mode === "albedo" ? "#fff6dd" : "#000000";
    ctx.shadowBlur = 0;
    ctx.fillText(spec.caption.toUpperCase(), cx, capY);
    ctx.restore();
  }

  if (spec.marks.length) {
    const glyphs: MarkKind[] = [];
    for (const mark of spec.marks) {
      for (let i = 0; i < mark.count; i += 1) glyphs.push(mark.kind);
    }
    const markSize = size * (glyphs.length === 1 ? 0.26 : glyphs.length === 2 ? 0.23 : 0.175);
    const gap = markSize * (glyphs.length > 2 ? 1.22 : 1.16);
    const startX = cx - ((glyphs.length - 1) * gap) / 2;
    const markY = size * (layout?.markY ?? 0.785);

    ctx.save();
    glyphs.forEach((kind, index) => {
      ctx.shadowBlur = 0;
      drawMark(
        ctx,
        kind,
        startX + index * gap,
        markY,
        markSize,
        mode === "albedo"
          ? MARK_COLOR[kind]
          : kind === "direct"
            ? MARK_COLOR.direct
            : "#ffffff",
      );
    });
    ctx.restore();
  }
}

/** Sit the numeral inside the hull silhouette How to play clips to. */
/**
 * Where the number, marks and caption sit on a *help* face.
 *
 * The 3D dice paint onto a full square texture, so the stock layout can push
 * marks down to 0.785 and the caption to 0.775 — on a cube face there is
 * nothing below to fall off. Help art is clipped to the hull silhouette
 * instead, and every silhouette is narrower than its square: a d6 square runs
 * 0.172–0.828, a d4 triangle pinches to nothing at the top, a d8 diamond and
 * d10 pentagon both taper. Reusing the stock numbers cut the bottom off every
 * mark on a d6 and clipped the flagship's caption plate at both ends.
 *
 * Every value below is chosen so the ink stays inside its own outline.
 */
const HELP_HULL_LAYOUT: Partial<Record<number, FaceLayout>> = {
  // Triangle: widest at the base, so the number rides low and the marks
  // sit just above the base line where there is finally room for three.
  4: { numberY: 0.5, markY: 0.695, numberSize: 0.4 },
  // Square, 0.172–0.828. Marks at 0.785 fell 0.09 outside the bottom edge.
  6: { numberY: 0.44, markY: 0.675, numberSize: 0.46, captionY: 0.7, captionHalfWidth: 0.28 },
  8: { numberY: 0.47, markY: 0.665, numberSize: 0.4 },
  10: { numberY: 0.46, markY: 0.67, numberSize: 0.39 },
};

/** Same plates and marks as the 3D dice, for How to play illustrations. */
export function paintHelpFace(
  ctx: CanvasRenderingContext2D,
  spec: FaceSpec,
  sides: number,
  size: number,
  numeralFont: string,
  captionFont: string,
) {
  paintFace(ctx, spec, sides, size, "albedo", numeralFont, captionFont, HELP_HULL_LAYOUT[sides]);
}

/* ------------------------------------------------------------------ */
/* The atlas                                                           */
/* ------------------------------------------------------------------ */

export type Atlas = {
  map: THREE.CanvasTexture;
  emissive: THREE.CanvasTexture;
  columns: number;
  rows: number;
  dispose(): void;
};

const ATLAS_LAYOUT: Record<number, { columns: number; rows: number }> = {
  4: { columns: 2, rows: 2 },
  6: { columns: 3, rows: 2 },
  8: { columns: 4, rows: 2 },
  10: { columns: 5, rows: 2 },
};

export function atlasLayout(sides: number) {
  return ATLAS_LAYOUT[sides] ?? { columns: sides, rows: 1 };
}

export function buildAtlas(
  specs: FaceSpec[],
  sides: number,
  cell: number,
  numeralFont: string,
  captionFont: string,
): Atlas {
  const { columns, rows } = atlasLayout(sides);
  const width = columns * cell;
  const height = rows * cell;

  const make = (mode: "albedo" | "emissive") => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = mode === "albedo" ? "#0a0f1c" : "#000000";
    ctx.fillRect(0, 0, width, height);
    specs.forEach((spec, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      ctx.save();
      ctx.translate(column * cell, row * cell);
      ctx.beginPath();
      ctx.rect(0, 0, cell, cell);
      ctx.clip();
      paintFace(ctx, spec, sides, cell, mode, numeralFont, captionFont);
      ctx.restore();
    });
    const texture = new THREE.CanvasTexture(canvas);
    texture.anisotropy = 16;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  };

  const map = make("albedo");
  const emissive = make("emissive");

  return {
    map,
    emissive,
    columns,
    rows,
    dispose() {
      map.dispose();
      emissive.dispose();
    },
  };
}

/**
 * A hull's facedown face: no roll to show yet, so instead of a blank plate
 * every face carries the hull's own size — "D8", not a number — so a fleet
 * sitting unrolled still tells you which bay holds which die. The fill is
 * baked into the texture (not left to the material's own colour) so this can
 * sit on the same near-black hull tint the game already used before this
 * carried any text.
 */
export function buildFacedownAtlas(sides: number, cell: number, numeralFont: string): THREE.CanvasTexture {
  const { columns, rows } = atlasLayout(sides);
  const canvas = document.createElement("canvas");
  canvas.width = columns * cell;
  canvas.height = rows * cell;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#2b3450"; // the facedown-hull blue-grey; no matching token — 3D-only
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const label = `D${sides}`;
  for (let index = 0; index < sides; index += 1) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const cx = column * cell + cell / 2;
    const cy = row * cell + cell / 2;
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `700 ${cell * 0.2}px ${numeralFont}`;
    // A dark keyline first, same reasoning as every other face: without it
    // the label loses its edge against a hull this flat and this dark.
    ctx.strokeStyle = "rgba(4,9,20,0.7)";
    ctx.lineWidth = cell * 0.05;
    ctx.lineJoin = "round";
    ctx.strokeText(label, cx, cy);
    ctx.fillStyle = "rgba(182,193,220,0.55)"; // --color-hull-200, dimmed for the idle hull
    ctx.fillText(label, cx, cy);
    ctx.restore();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/* ------------------------------------------------------------------ */
/* What each face pays — mirrors lib/engine.ts                         */
/* ------------------------------------------------------------------ */

export function faceSpec(value: number): FaceSpec {
  const marks: FaceSpec["marks"] = [];
  const energy = value === 1 ? 2 : value === 4 ? 1 : 0;
  const repair = value === 3 ? 3 : ({ 5: 1, 7: 2, 9: 3 } as Record<number, number>)[value] ?? 0;
  const direct = value === 2 ? 2 : ({ 6: 1, 8: 2, 10: 3 } as Record<number, number>)[value] ?? 0;
  if (energy) marks.push({ kind: "energy", count: energy });
  if (repair) marks.push({ kind: "repair", count: repair });
  if (direct) marks.push({ kind: "direct", count: direct });
  return {
    value,
    fights: value % 2 === 0 ? "hits" : "blocks",
    marks,
  };
}

const FLAG_CAPTION: Record<number, string> = {
  1: "Reactor",
  2: "Direct",
  3: "Repair",
  4: "Energy",
  5: "Shields",
  6: "Attack",
};

/** The six flagship faces use the same semantic colours players learned in Fleet Dice 1. */
export function flagFaceSpec(value: number): FaceSpec {
  return {
    value,
    fights: value % 2 === 0 ? "hits" : "blocks",
    marks: [],
    role: "flag",
    caption: FLAG_CAPTION[value] ?? "",
  };
}


/**
 * A hull drawn as its shape, flat and head-on.
 *
 * A die that has not rolled has no number to show, and its real 3D silhouette
 * is no help: a d8 seen from the board's angle is a facetted lump, not the
 * diamond the rest of the game uses for it. So an unrolled hull — and one out
 * for the round — is drawn as the set shape instead: a d4 triangle, a d6
 * square, a d8 diamond, a d10 pentagon, the same silhouettes the fleet icons
 * and the help screen use.
 *
 * `spent` adds the red tint and the bar through it. Either way the size is
 * written on the hull, because that is the thing a player needs and cannot
 * recall: which ship this is, and when it comes back.
 */
export function paintHullPlate(
  sides: DieSize,
  size: number,
  numeralFont: string,
  variant: "idle" | "spent" = "spent",
): HTMLCanvasElement {
  const spent = variant === "spent";
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;

  ctx.save();
  addHullPath(ctx, sides, size);
  ctx.fillStyle = spent ? "rgba(74,26,34,0.86)" : "rgba(43,52,80,0.92)";
  ctx.fill();
  ctx.strokeStyle = spent
    ? "rgba(255,77,77,0.95)" // --color-attack
    : "rgba(182,193,220,0.75)"; // --color-hull-200
  ctx.lineWidth = size * 0.038;
  ctx.lineJoin = "round";
  ctx.stroke();
  ctx.restore();

  // The size, sitting inside the hull rather than on the deck beside it.
  const cy = sides === 4 ? size * 0.6 : size * 0.5;
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `700 ${size * 0.24}px ${numeralFont}`;
  ctx.strokeStyle = "rgba(10,4,8,0.8)";
  ctx.lineWidth = size * 0.05;
  ctx.lineJoin = "round";
  ctx.strokeText(`D${sides}`, size / 2, cy);
  ctx.fillStyle = spent ? "rgba(255,226,229,0.94)" : "rgba(214,223,244,0.9)";
  ctx.fillText(`D${sides}`, size / 2, cy);
  ctx.restore();

  if (!spent) return canvas;

  // Struck through, clipped to the hull so the bar never floats outside it.
  ctx.save();
  addHullPath(ctx, sides, size);
  ctx.clip();
  ctx.strokeStyle = "rgba(255,77,77,0.98)";
  ctx.lineWidth = size * 0.062;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(size * 0.12, size * 0.82);
  ctx.lineTo(size * 0.88, size * 0.2);
  ctx.stroke();
  ctx.restore();

  return canvas;
}
