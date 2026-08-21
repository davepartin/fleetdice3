/**
 * The deck plate, painted.
 *
 * An additive glow-plane reads as a screensaver. A painted steel plate with
 * panel seams, stencils and bolt heads — lit properly, catching the dice's
 * shadows — reads as a place. Two canvases come out: the paint, and an
 * emissive copy carrying only the lines that should glow.
 */

export type DeckPalette = {
  plate: string;
  plateDark: string;
  seam: string;
  rim: string;
  stencil: string;
};

export const DECK_PALETTE: Record<"you" | "enemy", DeckPalette> = {
  you: {
    plate: "#1b2436",
    plateDark: "#0b111e",
    seam: "#060a13",
    rim: "#4db4ff",
    stencil: "#6d84ad",
  },
  enemy: {
    plate: "#2c1c24",
    plateDark: "#140b11",
    seam: "#0b0508",
    rim: "#ff5c5c",
    stencil: "#a4707a",
  },
};

const SIZE = 1024;
/** The 3×3 play area occupies this fraction of the plate. */
const PLAY = 0.78;

function cellRect(cell: number) {
  const column = cell % 3;
  const row = Math.floor(cell / 3);
  const play = SIZE * PLAY;
  const origin = (SIZE - play) / 2;
  const step = play / 3;
  const pad = step * 0.06;
  return {
    x: origin + column * step + pad,
    y: origin + row * step + pad,
    w: step - pad * 2,
    h: step - pad * 2,
  };
}

function noise(ctx: CanvasRenderingContext2D, amount: number) {
  const image = ctx.getImageData(0, 0, SIZE, SIZE);
  const data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    const grain = (Math.random() - 0.5) * amount;
    data[i] = Math.max(0, Math.min(255, data[i]! + grain));
    data[i + 1] = Math.max(0, Math.min(255, data[i + 1]! + grain));
    data[i + 2] = Math.max(0, Math.min(255, data[i + 2]! + grain));
  }
  ctx.putImageData(image, 0, 0);
}

function corners(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  arm: number,
  thickness: number,
) {
  ctx.lineWidth = thickness;
  ctx.lineCap = "square";
  const segments: [number, number, number, number][] = [
    [x, y + arm, x, y],
    [x, y, x + arm, y],
    [x + w - arm, y, x + w, y],
    [x + w, y, x + w, y + arm],
    [x + w, y + h - arm, x + w, y + h],
    [x + w, y + h, x + w - arm, y + h],
    [x + arm, y + h, x, y + h],
    [x, y + h, x, y + h - arm],
  ];
  ctx.beginPath();
  for (const [x1, y1, x2, y2] of segments) {
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
  }
  ctx.stroke();
}

/* ------------------------------------------------------------------ */

export function paintDeck(
  palette: DeckPalette,
  mode: "albedo" | "emissive",
  font: string,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext("2d")!;
  const emissive = mode === "emissive";

  if (emissive) {
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, SIZE, SIZE);
  } else {
    const base = ctx.createLinearGradient(0, 0, SIZE * 0.6, SIZE);
    base.addColorStop(0, palette.plate);
    base.addColorStop(0.55, palette.plateDark);
    base.addColorStop(1, palette.seam);
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, SIZE, SIZE);

    // Big structural panels, so the plate is built rather than printed.
    ctx.strokeStyle = palette.seam;
    ctx.lineWidth = 5;
    ctx.globalAlpha = 0.85;
    for (const t of [0.14, 0.5, 0.86]) {
      ctx.beginPath();
      ctx.moveTo(0, SIZE * t);
      ctx.lineTo(SIZE, SIZE * t);
      ctx.moveTo(SIZE * t, 0);
      ctx.lineTo(SIZE * t, SIZE);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // A highlight along the top of every seam, like light catching an edge.
    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    ctx.lineWidth = 2;
    for (const t of [0.14, 0.5, 0.86]) {
      ctx.beginPath();
      ctx.moveTo(0, SIZE * t + 3);
      ctx.lineTo(SIZE, SIZE * t + 3);
      ctx.stroke();
    }

    // Bolt heads at the panel intersections.
    for (const tx of [0.14, 0.5, 0.86]) {
      for (const ty of [0.14, 0.5, 0.86]) {
        const x = SIZE * tx;
        const y = SIZE * ty;
        const bolt = ctx.createRadialGradient(x - 2, y - 2, 0, x, y, 9);
        bolt.addColorStop(0, "rgba(255,255,255,0.24)");
        bolt.addColorStop(0.6, "rgba(255,255,255,0.06)");
        bolt.addColorStop(1, "rgba(0,0,0,0.45)");
        ctx.fillStyle = bolt;
        ctx.beginPath();
        ctx.arc(x, y, 9, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    noise(ctx, 12);
  }

  // The nine cells.
  for (let cell = 0; cell < 9; cell += 1) {
    const rect = cellRect(cell);
    if (!emissive) {
      const wash = ctx.createLinearGradient(rect.x, rect.y, rect.x, rect.y + rect.h);
      wash.addColorStop(0, "rgba(255,255,255,0.05)");
      wash.addColorStop(1, "rgba(0,0,0,0.22)");
      ctx.fillStyle = wash;
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    }
    ctx.strokeStyle = emissive ? palette.rim : "rgba(255,255,255,0.14)";
    ctx.globalAlpha = emissive ? 0.5 : 1;
    if (emissive) {
      ctx.shadowColor = palette.rim;
      ctx.shadowBlur = 14;
    }
    corners(ctx, rect.x, rect.y, rect.w, rect.h, rect.w * 0.2, emissive ? 5 : 3);
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  }

  // A subtle physical seam around the play area. The emissive version used to
  // draw a second bright cyan rectangle around the entire mat; at phone crop
  // it dominated the left, right and bottom edges instead of framing the dice.
  const play = SIZE * PLAY;
  const origin = (SIZE - play) / 2;
  if (!emissive) {
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.globalAlpha = 1;
    ctx.lineWidth = 2;
    ctx.strokeRect(origin - 22, origin - 22, play + 44, play + 44);
  }

  // Stencilled markings around the edge.
  ctx.save();
  ctx.font = `700 21px ${font}`;
  ctx.letterSpacing = "7px";
  ctx.fillStyle = emissive ? palette.rim : palette.stencil;
  ctx.globalAlpha = emissive ? 0.34 : 0.5;
  ctx.textBaseline = "middle";
  ctx.fillText("FLEET DICE III", origin - 20, origin - 46);
  ctx.textAlign = "right";
  ctx.fillText("SECTOR 03", origin + play + 20, origin - 46);
  ctx.restore();

  // Hazard stripes in the two spare corners.
  if (!emissive) {
    ctx.save();
    ctx.globalAlpha = 0.14;
    for (const [cx, cy] of [
      [26, 26],
      [SIZE - 118, SIZE - 44],
    ]) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(cx, cy, 92, 18);
      ctx.clip();
      for (let i = -20; i < 120; i += 14) {
        ctx.strokeStyle = i % 28 === 0 ? "#ffd23d" : "#0a0d16";
        ctx.lineWidth = 8;
        ctx.beginPath();
        ctx.moveTo(cx + i, cy + 26);
        ctx.lineTo(cx + i + 26, cy - 8);
        ctx.stroke();
      }
      ctx.restore();
    }
    ctx.restore();
  }

  return canvas;
}

/** Where a cell sits on the plate, as a fraction from the centre (−0.5…0.5). */
export function cellOffset(cell: number): { x: number; z: number } {
  const column = cell % 3;
  const row = Math.floor(cell / 3);
  const step = PLAY / 3;
  return { x: (column - 1) * step, z: (row - 1) * step };
}

export const PLAY_FRACTION = PLAY;
