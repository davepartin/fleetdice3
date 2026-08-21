/**
 * The art on a die face.
 *
 * Every face is drawn into one square of a texture atlas: the number big enough
 * to read on a phone, and beneath it the marks that face always pays. Two
 * atlases come out of here — the albedo you see lit, and an emissive copy for
 * marks only. Numbers stay non-emissive so their hard edges survive on phones.
 */

import * as THREE from "three";

export type MarkKind = "energy" | "repair" | "direct";

export const MARK_COLOR: Record<MarkKind, string> = {
  // These stay intentionally lighter than their matching HUD colours. Tiny
  // marks are viewed on a steeply projected face, so the symbol needs a bright
  // core and a dark keyline to survive at real iPhone size.
  energy: "#ffe45c",
  repair: "#77f2ad",
  direct: "#d7baff",
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
const BLOCK = { ink: "#ffffff", top: "#48b9ff", bottom: "#1268b5", glow: "#73caff", deep: "#062c58" };

/**
 * Fleet Dice 1's flagship language, rebuilt as polished 3D resin. Each face
 * has a semantic colour, so the die itself teaches which fleet dice it boosts.
 */
export const FLAG_FACE_PALETTE: Record<
  number,
  { fill: string; mid: string; deep: string; ink: string; ring: number }
> = {
  1: { fill: "#ffea31", mid: "#d7b91a", deep: "#302703", ink: "#211a02", ring: 0xffe81f },
  2: { fill: "#c49aff", mid: "#9870d8", deep: "#27143e", ink: "#1e1233", ring: 0xb98bff },
  3: { fill: "#79f0ac", mid: "#49bb79", deep: "#082b1b", ink: "#06291b", ring: 0x72efa6 },
  4: { fill: "#ffea31", mid: "#d7b91a", deep: "#302703", ink: "#211a02", ring: 0xffe81f },
  5: { fill: "#51bcff", mid: "#258bd1", deep: "#062f4e", ink: "#062a47", ring: 0x45b6ff },
  6: { fill: "#ff6578", mid: "#d03a50", deep: "#430a14", ink: "#3d0812", ring: 0xff5569 },
};

/* ------------------------------------------------------------------ */
/* Glyphs                                                              */
/* ------------------------------------------------------------------ */

function drawBolt(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
  const w = size * 0.58;
  const h = size;
  ctx.beginPath();
  ctx.moveTo(x + w * 0.28, y - h * 0.5);
  ctx.lineTo(x - w * 0.5, y + h * 0.08);
  ctx.lineTo(x - w * 0.02, y + h * 0.08);
  ctx.lineTo(x - w * 0.26, y + h * 0.5);
  ctx.lineTo(x + w * 0.5, y - h * 0.1);
  ctx.lineTo(x + w * 0.02, y - h * 0.1);
  ctx.closePath();
  ctx.fill();
}

function drawCross(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
  const arm = size * 0.5;
  const thick = size * 0.36;
  ctx.beginPath();
  ctx.roundRect(x - thick / 2, y - arm, thick, arm * 2, thick * 0.34);
  ctx.roundRect(x - arm, y - thick / 2, arm * 2, thick, thick * 0.34);
  ctx.fill();
}

function drawChevron(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
  // A bold forward chevron reads as an armor-piercing shot at a glance. The
  // previous upward outline became a pair of tiny carets after projection.
  const w = size * 0.58;
  const h = size * 0.7;
  const thick = size * 0.22;
  ctx.beginPath();
  ctx.moveTo(x - w / 2, y - h / 2);
  ctx.lineTo(x + w / 2, y);
  ctx.lineTo(x - w / 2, y + h / 2);
  ctx.lineTo(x - w / 2 + thick, y + h / 2);
  ctx.lineTo(x + w / 2 + thick * 0.08, y);
  ctx.lineTo(x - w / 2 + thick, y - h / 2);
  ctx.closePath();
  ctx.fill();
}

function drawMark(
  ctx: CanvasRenderingContext2D,
  kind: MarkKind,
  x: number,
  y: number,
  size: number,
) {
  if (kind === "energy") drawBolt(ctx, x, y, size);
  else if (kind === "repair") drawCross(ctx, x, y, size);
  else drawChevron(ctx, x, y, size);
}

/* ------------------------------------------------------------------ */
/* One face                                                            */
/* ------------------------------------------------------------------ */

function paintFace(
  ctx: CanvasRenderingContext2D,
  spec: FaceSpec,
  sides: number,
  size: number,
  mode: "albedo" | "emissive",
  numberFont: string,
) {
  const isFlag = spec.role === "flag";
  const flagPalette = FLAG_FACE_PALETTE[spec.value] ?? FLAG_FACE_PALETTE[1]!;
  const palette = isFlag
    ? { ink: flagPalette.ink, top: flagPalette.fill, bottom: flagPalette.mid, glow: flagPalette.fill, deep: flagPalette.deep }
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

    // One restrained resin highlight gives depth without touching the glyphs.
    ctx.save();
    const sheen = ctx.createLinearGradient(0, 0, size, size * 0.7);
    sheen.addColorStop(0, "rgba(255,255,255,0.22)");
    sheen.addColorStop(0.38, "rgba(255,255,255,0.07)");
    sheen.addColorStop(0.39, "rgba(255,255,255,0)");
    ctx.fillStyle = sheen;
    ctx.fillRect(0, 0, size, size * 0.62);
    ctx.restore();

    // A square inset belongs on the square d6 faces only. Painting it into
    // every atlas cell made the d4/d8 triangles and d10 kites look as though a
    // rectangular sticker had been pasted across the hull.
    if (sides === 6) {
      ctx.save();
      ctx.globalAlpha = isFlag ? 0.25 : 0.38;
      ctx.strokeStyle = isFlag ? flagPalette.ink : "#ffffff";
      ctx.lineWidth = size * 0.012;
      ctx.beginPath();
      ctx.roundRect(size * 0.09, size * 0.09, size * 0.82, size * 0.82, size * 0.16);
      ctx.stroke();
      ctx.restore();
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
  const numberY = hasMarks ? size * (isFlag ? 0.39 : 0.4) : size * 0.5;
  const numberSize = hasMarks ? size * (isFlag ? 0.58 : 0.62) : size * 0.69;

  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `900 ${numberSize}px ${numberFont}`;
  if (mode === "albedo") {
    ctx.shadowBlur = 0;
    ctx.strokeStyle = palette.deep;
    ctx.lineWidth = size * (isFlag ? 0.012 : 0.022);
    ctx.lineJoin = "round";
    ctx.strokeText(String(spec.value), cx, numberY);
    ctx.fillStyle = palette.ink;
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
    ctx.font = `900 ${size * 0.108}px ${numberFont}`;
    ctx.letterSpacing = `${size * 0.009}px`;
    ctx.fillStyle = mode === "albedo" ? palette.ink : "#000000";
    ctx.shadowBlur = 0;
    ctx.fillText(spec.caption.toUpperCase(), cx, size * 0.755);
    ctx.restore();
  }

  if (spec.marks.length) {
    const glyphs: MarkKind[] = [];
    for (const mark of spec.marks) {
      for (let i = 0; i < mark.count; i += 1) glyphs.push(mark.kind);
    }
    const markSize = size * (glyphs.length > 2 ? 0.225 : 0.265);
    const gap = markSize * 1.12;
    const startX = cx - ((glyphs.length - 1) * gap) / 2;
    const markY = size * 0.79;

    ctx.save();
    glyphs.forEach((kind, index) => {
      ctx.fillStyle = MARK_COLOR[kind];
      ctx.shadowBlur = 0;
      drawMark(ctx, kind, startX + index * gap, markY, markSize);
      if (mode === "albedo") {
        ctx.strokeStyle = "rgba(3,8,18,0.88)";
        ctx.lineWidth = size * 0.013;
        ctx.stroke();
      }
    });
    ctx.restore();
  }
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
  numberFont: string,
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
      paintFace(ctx, spec, sides, cell, mode, numberFont);
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
