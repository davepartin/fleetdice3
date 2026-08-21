/**
 * The art on a die face.
 *
 * Every face is drawn into one square of a texture atlas: the number big enough
 * to read on a phone, and beneath it the marks that face always pays. Two
 * atlases come out of here — the albedo you see lit, and an emissive copy where
 * only the glyphs are bright, so the numbers actually glow through the bloom.
 */

import * as THREE from "three";

export type MarkKind = "energy" | "repair" | "direct";

export const MARK_COLOR: Record<MarkKind, string> = {
  energy: "#ffd23d",
  repair: "#45e08b",
  direct: "#b07dff",
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

const HIT = { ink: "#fff6f4", glow: "#ff7a6a", deep: "#63101c" };
const BLOCK = { ink: "#f4fbff", glow: "#8ed2ff", deep: "#0b3a6b" };
const FLAG = { ink: "#fff9df", glow: "#f6c84d", deep: "#2a1902" };

/* ------------------------------------------------------------------ */
/* Glyphs                                                              */
/* ------------------------------------------------------------------ */

function drawBolt(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
  const w = size * 0.46;
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
  const thick = size * 0.3;
  ctx.beginPath();
  ctx.roundRect(x - thick / 2, y - arm, thick, arm * 2, thick * 0.34);
  ctx.roundRect(x - arm, y - thick / 2, arm * 2, thick, thick * 0.34);
  ctx.fill();
}

function drawChevron(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
  const w = size * 0.62;
  const h = size * 0.5;
  const thick = size * 0.26;
  ctx.beginPath();
  ctx.moveTo(x - w / 2, y + h / 2);
  ctx.lineTo(x, y - h / 2);
  ctx.lineTo(x + w / 2, y + h / 2);
  ctx.lineTo(x + w / 2 - thick * 0.7, y + h / 2 + thick * 0.62);
  ctx.lineTo(x, y + thick * 0.05);
  ctx.lineTo(x - w / 2 + thick * 0.7, y + h / 2 + thick * 0.62);
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
  const palette = isFlag ? FLAG : spec.fights === "hits" ? HIT : BLOCK;
  const glow = palette.glow;
  const cx = size / 2;

  if (mode === "albedo") {
    // Brushed plate with a hint of the face's colour bleeding from the centre.
    const plate = ctx.createRadialGradient(cx, size * 0.42, size * 0.04, cx, cx, size * 0.72);
    plate.addColorStop(0, isFlag ? "#d29a28" : spec.fights === "hits" ? "#d4354a" : "#2b7fca");
    plate.addColorStop(0.62, isFlag ? "#785116" : spec.fights === "hits" ? "#7b192c" : "#173f70");
    plate.addColorStop(1, isFlag ? "#271805" : spec.fights === "hits" ? "#310a15" : "#091c36");
    ctx.fillStyle = plate;
    ctx.fillRect(0, 0, size, size);

    // Fine machined lines, so a big flat face is not a dead colour field.
    ctx.save();
    ctx.globalAlpha = 0.07;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = Math.max(1, size * 0.004);
    for (let y = 0; y < size; y += size * 0.055) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(size, y + size * 0.03);
      ctx.stroke();
    }
    ctx.restore();

    // A square inset belongs on the square d6 faces only. Painting it into
    // every atlas cell made the d4/d8 triangles and d10 kites look as though a
    // rectangular sticker had been pasted across the hull.
    if (sides === 6) {
      ctx.save();
      ctx.globalAlpha = isFlag ? 0.5 : 0.34;
      ctx.strokeStyle = glow;
      ctx.lineWidth = size * 0.016;
      ctx.beginPath();
      ctx.roundRect(size * 0.09, size * 0.09, size * 0.82, size * 0.82, size * 0.16);
      ctx.stroke();
      ctx.restore();
    }
  } else {
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, size, size);
    if (sides === 6) {
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
  const numberY = hasMarks ? size * 0.43 : size * 0.5;
  const numberSize = hasMarks ? size * 0.5 : size * 0.58;

  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `900 ${numberSize}px ${numberFont}`;
  if (mode === "albedo") {
    ctx.shadowColor = palette.deep;
    ctx.shadowBlur = size * 0.035;
    ctx.strokeStyle = palette.deep;
    ctx.lineWidth = size * 0.032;
    ctx.lineJoin = "round";
    ctx.strokeText(String(spec.value), cx, numberY);
    ctx.fillStyle = palette.ink;
  } else {
    ctx.shadowColor = "#000000";
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#aebed1";
  }
  ctx.fillText(String(spec.value), cx, numberY);
  ctx.restore();

  if (spec.caption) {
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `800 ${size * 0.135}px ${numberFont}`;
    ctx.letterSpacing = `${size * 0.018}px`;
    ctx.fillStyle = mode === "albedo" ? palette.ink : "#aebed1";
    ctx.shadowColor = mode === "albedo" ? palette.deep : "#000000";
    ctx.shadowBlur = mode === "albedo" ? size * 0.025 : 0;
    if (mode === "albedo") {
      ctx.strokeStyle = palette.deep;
      ctx.lineWidth = size * 0.018;
      ctx.lineJoin = "round";
      ctx.strokeText(spec.caption.toUpperCase(), cx, size * 0.785);
    }
    ctx.fillText(spec.caption.toUpperCase(), cx, size * 0.785);
    ctx.restore();
  }

  if (spec.marks.length) {
    const glyphs: MarkKind[] = [];
    for (const mark of spec.marks) {
      for (let i = 0; i < mark.count; i += 1) glyphs.push(mark.kind);
    }
    const markSize = size * (glyphs.length > 2 ? 0.15 : 0.175);
    const gap = markSize * 1.24;
    const startX = cx - ((glyphs.length - 1) * gap) / 2;
    const markY = size * 0.775;

    ctx.save();
    glyphs.forEach((kind, index) => {
      ctx.fillStyle = MARK_COLOR[kind];
      ctx.shadowColor = MARK_COLOR[kind];
      ctx.shadowBlur = mode === "emissive" ? size * 0.025 : size * 0.025;
      drawMark(ctx, kind, startX + index * gap, markY, markSize);
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
    texture.anisotropy = 8;
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

/** The six flagship faces. It never fights, so its art is gold, not red/blue. */
export function flagFaceSpec(value: number): FaceSpec {
  return {
    value,
    fights: value % 2 === 0 ? "hits" : "blocks",
    marks: [],
    role: "flag",
    caption: FLAG_CAPTION[value] ?? "",
  };
}
