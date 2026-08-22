import type { DieSize } from "@/lib/engine";

/**
 * The four hull silhouettes, the same shapes the dice have on the board: a d4
 * is a triangle, a d6 a square, a d8 a diamond, a d10 a pentagon. Recognising
 * the shape is most of how you read your own fleet at a glance.
 */
export const HULL_PATHS: Record<DieSize, string> = {
  4: "M32 8 L57 52 L7 52 Z",
  6: "M10 12 h44 a2 2 0 0 1 2 2 v36 a2 2 0 0 1 -2 2 h-44 a2 2 0 0 1 -2 -2 v-36 a2 2 0 0 1 2 -2 z",
  8: "M32 6 L56 32 L32 58 L8 32 Z",
  10: "M32 6 L57 24 L47 55 L17 55 L7 24 Z",
};

export function addHullPath(ctx: CanvasRenderingContext2D, sides: DieSize, size: number) {
  const x = (n: number) => (n / 64) * size;
  ctx.beginPath();
  if (sides === 4) {
    ctx.moveTo(x(32), x(8));
    ctx.lineTo(x(57), x(52));
    ctx.lineTo(x(7), x(52));
  } else if (sides === 6) {
    ctx.roundRect(x(10), x(12), x(44), x(40), x(2));
  } else if (sides === 8) {
    ctx.moveTo(x(32), x(6));
    ctx.lineTo(x(56), x(32));
    ctx.lineTo(x(32), x(58));
    ctx.lineTo(x(8), x(32));
  } else {
    ctx.moveTo(x(32), x(6));
    ctx.lineTo(x(57), x(24));
    ctx.lineTo(x(47), x(55));
    ctx.lineTo(x(17), x(55));
    ctx.lineTo(x(7), x(24));
  }
  ctx.closePath();
}

export function HullShape({ sides, tone }: { sides: DieSize; tone: "live" | "ghost" }) {
  const stroke = tone === "live" ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.3)";
  const fill =
    tone === "live"
      ? {
          4: "var(--color-hull-icon-d4)",
          6: "var(--color-hull-icon-d6)",
          8: "var(--color-hull-icon-d8)",
          10: "var(--color-hull-icon-d10)",
        }[sides]
      : "rgba(255,255,255,0.05)";
  return (
    <svg viewBox="0 0 64 64" className="h-full w-full" aria-hidden="true">
      <path d={HULL_PATHS[sides]} fill={fill} stroke={stroke} strokeWidth="2.5" strokeLinejoin="round" />
    </svg>
  );
}
