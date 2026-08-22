import type { DieSize } from "@/lib/engine";

/**
 * The four hull silhouettes, the same shapes the dice have on the board: a d4
 * is a triangle, a d6 a square, a d8 a diamond, a d10 a pentagon. Recognising
 * the shape is most of how you read your own fleet at a glance.
 */
export function HullShape({ sides, tone }: { sides: DieSize; tone: "live" | "ghost" }) {
  const stroke = tone === "live" ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.3)";
  const fill =
    tone === "live"
      ? { 4: "#3b5a86", 6: "#3f6ba8", 8: "#5a5aa8", 10: "#7d51a0" }[sides]
      : "rgba(255,255,255,0.05)";
  const paths: Record<DieSize, string> = {
    4: "M32 8 L57 52 L7 52 Z",
    6: "M10 12 h44 a2 2 0 0 1 2 2 v36 a2 2 0 0 1 -2 2 h-44 a2 2 0 0 1 -2 -2 v-36 a2 2 0 0 1 2 -2 z",
    8: "M32 6 L56 32 L32 58 L8 32 Z",
    10: "M32 6 L57 24 L47 55 L17 55 L7 24 Z",
  };
  return (
    <svg viewBox="0 0 64 64" className="h-full w-full" aria-hidden="true">
      <path d={paths[sides]} fill={fill} stroke={stroke} strokeWidth="2.5" strokeLinejoin="round" />
    </svg>
  );
}
