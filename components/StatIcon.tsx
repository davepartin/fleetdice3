/**
 * The five symbols the game actually pays in, drawn once.
 *
 * Three of these — the bolt, the cross, the chevron — are the same marks
 * lib/three/faceArt.ts paints onto the real dice, redrawn here as flat SVG
 * so help text can name a symbol the player will meet on a face. The other
 * two name the fight itself: a shield for the blue odd numbers, a spiked
 * star for the red even ones, the same shorthand a board game prints on its
 * player aid.
 *
 * Colour is never the only signal — each shape reads on its own — but the
 * colours here are the game's, straight off the same custom properties every
 * other screen uses.
 */

import type { StatKind } from "@/lib/reference";

type Props = {
  kind: StatKind;
  size?: number;
  className?: string;
};

/** A seven-point star — the attack mark, and never used for anything else. */
function starPoints(cx: number, cy: number, outer: number, inner: number): string {
  const points: string[] = [];
  for (let i = 0; i < 14; i += 1) {
    const radius = i % 2 === 0 ? outer : inner;
    // Start at the top and walk round; 14 stops gives seven points.
    const angle = (Math.PI * 2 * i) / 14 - Math.PI / 2;
    points.push(`${(cx + Math.cos(angle) * radius).toFixed(2)},${(cy + Math.sin(angle) * radius).toFixed(2)}`);
  }
  return points.join(" ");
}

export function StatIcon({ kind, size = 18, className = "" }: Props) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    "aria-hidden": true as const,
    className: `stat-icon stat-icon-${kind} ${className}`.trim(),
  };

  if (kind === "attack") {
    return (
      <svg {...common}>
        <polygon points={starPoints(12, 12, 10.5, 4.6)} fill="currentColor" />
      </svg>
    );
  }

  if (kind === "shield") {
    return (
      <svg {...common}>
        {/* A heater shield: flat shoulders, straight flanks, a point at the
            base. Reads as a shield at 14px, which a crest-shaped one does not. */}
        <path
          d="M12 2.2 3.6 4.9v7.2c0 4.3 3.4 7.7 8.4 9.7 5-2 8.4-5.4 8.4-9.7V4.9Z"
          fill="currentColor"
        />
      </svg>
    );
  }

  if (kind === "energy") {
    return (
      <svg {...common}>
        {/* The same wide bolt the dice carry — a narrow zigzag collapses to a
            line once it is small. */}
        <polygon points="14.6,1.8 3.8,13.2 10.4,13.2 8.2,22.2 20.2,9.9 13.4,9.9" fill="currentColor" />
      </svg>
    );
  }

  if (kind === "repair") {
    return (
      <svg {...common}>
        <path
          d="M9.6 2.4h4.8v7.2h7.2v4.8h-7.2v7.2H9.6v-7.2H2.4V9.6h7.2Z"
          fill="currentColor"
        />
      </svg>
    );
  }

  if (kind === "direct") {
    return (
      <svg {...common}>
        {/* A chevron — the bent bar off a sleeve, not an arrow. Stroked, so it
            keeps its shape at any size. */}
        <polyline
          points="3.6,16.2 12,7.8 20.4,16.2"
          fill="none"
          stroke="currentColor"
          strokeWidth="4.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  // run — a straight, drawn as the run of ascending numbers it actually is.
  return (
    <svg {...common}>
      <g fill="currentColor">
        <rect x="2" y="16.4" width="4" height="5.2" rx="1" />
        <rect x="7.4" y="12.6" width="4" height="9" rx="1" />
        <rect x="12.8" y="8.8" width="4" height="12.8" rx="1" />
        <rect x="18.2" y="5" width="4" height="16.6" rx="1" />
      </g>
    </svg>
  );
}
