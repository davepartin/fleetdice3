"use client";

/**
 * What just happened, in the order it happened.
 *
 * Two lines, one per commander. Yours is exact and ends where you actually
 * are: HP before, every real term the engine applied, HP after — the same
 * order the engine itself applies them in, so this is never just a summary
 * that happens to agree with the game, it's the game's own arithmetic.
 */

import type { RoundReport as Report } from "@/lib/engine";
import { Button, Notice } from "./ui";

type BoxKind = "attack" | "shield" | "direct" | "repair";

// Written literally (not built from a template string) so Tailwind's static
// scan can actually find these classes — a `${kind}`-interpolated class name
// would never make it into the compiled stylesheet.
const BOX_TONE: Record<BoxKind, string> = {
  attack: "border-[--color-attack]/40 bg-[--color-attack]/[0.16] c-attack",
  shield: "border-[--color-shield]/40 bg-[--color-shield]/[0.16] c-shield",
  direct: "border-[--color-direct]/40 bg-[--color-direct]/[0.16] c-direct",
  repair: "border-[--color-repair]/40 bg-[--color-repair]/[0.16] c-repair",
};

/** One boxed number in a battle line — colour carries the meaning (red
 *  attack, blue shield, purple direct, green repair), no glyph needed once
 *  every screen in the game already uses that same colour language. */
function Box({ kind, value, big }: { kind: BoxKind; value: number; big?: boolean }) {
  return (
    <span
      className={`t-num inline-flex items-center rounded-md border font-bold leading-none ${BOX_TONE[kind]} ${
        big ? "px-1.5 py-1 text-base" : "px-1 py-0.5 text-sm"
      }`}
    >
      {value}
    </span>
  );
}

/** Hit points, and only hit points, are ever this colour — hpBefore and
 *  hpAfter aren't damage terms, they're the anchors the line starts and
 *  ends on, so they get the one hue nothing else on screen uses. */
function HpBox({ value, big }: { value: number; big?: boolean }) {
  return (
    <span
      className={`t-num inline-flex items-center rounded-md border border-[--color-hp]/45 bg-[--color-hp]/[0.16] c-hp font-bold leading-none ${
        big ? "px-1.5 py-1 text-base" : "px-1 py-0.5 text-sm"
      }`}
    >
      {value}
    </span>
  );
}

/**
 * A ship blocking part of the hit, drawn as the same triangle hull every
 * d4 ship shows on the board — see HullShape's own note on why each hull
 * has its own silhouette. A white number on it, the same as a real die
 * face: the shape says "this is a ship," not a colour that would
 * otherwise collide with shields' blue.
 */
function ShipBlockBox({ value, big }: { value: number; big?: boolean }) {
  const size = big ? "1.9em" : "1.6em";
  return (
    <span
      className="relative inline-flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 64 64" className="absolute inset-0 h-full w-full" aria-hidden="true">
        <path
          d="M32 8 L57 52 L7 52 Z"
          fill="rgba(255,255,255,0.12)"
          stroke="rgba(255,255,255,0.6)"
          strokeWidth="3"
          strokeLinejoin="round"
        />
      </svg>
      <span
        className={`t-num relative translate-y-[0.12em] font-bold leading-none text-white ${big ? "text-sm" : "text-xs"}`}
      >
        {value}
      </span>
    </span>
  );
}

export function RoundReportCard({
  report,
  enemyName,
  enemyHp,
  waitingForOpponent = false,
  onContinue,
  busy,
}: {
  report: Report;
  enemyName: string;
  /**
   * Their HP as of right now — their starting point for this round if they
   * haven't resolved their own brace yet, already their result if they
   * have. Shown the same way yours is, for the same reason: a number is
   * easier to read next to another number than floating alone.
   */
  enemyHp: number;
  /** The other commander is still choosing which ships absorb their volley. */
  waitingForOpponent?: boolean;
  onContinue(): void;
  busy?: boolean;
}) {
  const t = report.tally;
  const enemy = report.enemyTally;
  const survived = report.hpAfter > 0;

  // Shields stopped this much of the raw attack, before ships or the war
  // even entered into it — see lib/engine.ts's settlePlayer for the real
  // sequence: attack minus shields, plus the war (shields can't touch that),
  // then ships subtract from *that* combined total, then direct is added on
  // completely separately — nothing, not shields or ships, blocks Direct.
  // Repair is the very last step, after all of that damage is applied.
  const shieldsStopped = Math.max(0, (enemy?.attack ?? 0) + report.escalation - report.incoming);

  // What you dealt them is only ever a ceiling — their own brace choice
  // (which ships stepped in front of it) isn't known from this side of the
  // match, so this assumes zero and says so, rather than guessing.
  const enemyShieldsStopped = Math.min(t.attack, enemy?.defense ?? 0);
  const enemyRepair = enemy?.heal ?? 0;
  const dealtCeiling = Math.max(0, t.attack - (enemy?.defense ?? 0)) + report.escalation + t.direct;

  return (
    <div className="round-report flex min-h-0 flex-1 flex-col gap-3">
      {/* Short now that Battle details is gone, but still its own scroll
       * region rather than trusting that — the confirm button below has
       * been clipped off screen by this exact class of bug twice already. */}
      <div className="round-report-top min-h-0 flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <p className="t-eyebrow">Round {report.round}</p>
        <span className="t-num c-energy text-sm">+{report.energyEarned} energy</span>
      </div>

      {/* The whole round, in the two lines each commander actually needs.
       * Yours is exact — hpBefore, every real term, hpAfter, in the order
       * the engine itself applies them. Theirs can only ever be a ceiling:
       * their own brace choice isn't visible from this side of the match. */}
      <div className="round-report-mobile-summary">
        <p className="t-eyebrow mb-1">Your fleet damage report</p>
        <p className="battle-line flex flex-wrap items-center gap-1">
          <HpBox value={report.hpBefore} />
          <span className="c-dim">−</span>
          <Box kind="attack" value={enemy?.attack ?? 0} />
          {shieldsStopped > 0 && (
            <>
              <span className="c-dim">+</span>
              <Box kind="shield" value={shieldsStopped} />
            </>
          )}
          {report.soaked > 0 && (
            <>
              <span className="c-dim">+</span>
              <ShipBlockBox value={report.soaked} />
            </>
          )}
          {report.escalation > 0 && (
            <>
              <span className="c-dim">−</span>
              <Box kind="attack" value={report.escalation} />
            </>
          )}
          {report.direct > 0 && (
            <>
              <span className="c-dim">−</span>
              <Box kind="direct" value={report.direct} />
            </>
          )}
          {report.repair > 0 && (
            <>
              <span className="c-dim">+</span>
              <Box kind="repair" value={report.repair} />
            </>
          )}
          <span className="c-dim">=</span>
          <HpBox value={report.hpAfter} big />
        </p>

        <p className="t-eyebrow mb-1 mt-2.5">{enemyName}</p>
        <p className="battle-line flex flex-wrap items-center gap-1">
          <HpBox value={enemyHp} />
          <span className="c-dim">−</span>
          <Box kind="attack" value={t.attack} />
          {enemyShieldsStopped > 0 && (
            <>
              <span className="c-dim">−</span>
              <Box kind="shield" value={enemyShieldsStopped} />
            </>
          )}
          {report.escalation > 0 && (
            <>
              <span className="c-dim">+</span>
              <Box kind="attack" value={report.escalation} />
            </>
          )}
          {t.direct > 0 && (
            <>
              <span className="c-dim">+</span>
              <Box kind="direct" value={t.direct} />
            </>
          )}
          <span className="c-dim">=</span>
          <Box kind="attack" value={dealtCeiling} big />
          {enemyRepair > 0 && (
            <>
              <span className="c-dim">+</span>
              <Box kind="repair" value={enemyRepair} />
            </>
          )}
          <span className="c-dim text-xs">· their blocks unknown</span>
        </p>
      </div>

      {!survived && (
        <Notice tone="warn">Your flagship is gone.</Notice>
      )}

      {waitingForOpponent && survived && (
        <p className="round-report-wait" role="status">
          {enemyName} is choosing ships to take the hit. Your shipyard will open when they finish.
        </p>
      )}
      </div>

      <Button tone="primary" size="lg" full onClick={onContinue} disabled={busy || waitingForOpponent}>
        {!survived ? "See the result" : waitingForOpponent ? `Waiting for ${enemyName}` : "To the shipyard"}
      </Button>
    </div>
  );
}
