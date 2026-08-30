"use client";

/**
 * The shared vocabulary of the interface.
 *
 * Every screen in Fleet Dice 3 is built from these. If a button, panel or
 * number badge is needed twice, it belongs here — that is what stops the game
 * from drifting into five slightly different greys.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Tally } from "@/lib/engine";
import { STAT_LABEL, type StatKind } from "@/lib/reference";
import { StatIcon } from "./StatIcon";

/* ------------------------------------------------------------------ */
/* Buttons                                                             */
/* ------------------------------------------------------------------ */

type ButtonProps = {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  /** Exactly one filled style exists: "primary", bone white, one per screen.
   *  Everything else is "ghost" — outline-only. */
  tone?: "primary" | "ghost";
  size?: "sm" | "md" | "lg";
  full?: boolean;
  className?: string;
  title?: string;
  ariaLabel?: string;
};

export function Button({
  children,
  onClick,
  disabled,
  tone = "ghost",
  size = "md",
  full,
  className = "",
  title,
  ariaLabel,
}: ButtonProps) {
  return (
    <button
      type="button"
      title={title}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onClick}
      className={[
        "btn",
        `btn-${tone}`,
        size === "sm" ? "btn-sm" : size === "lg" ? "btn-lg" : "",
        full ? "w-full" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Panels                                                              */
/* ------------------------------------------------------------------ */

export function Panel({
  children,
  tone,
  className = "",
}: {
  children: ReactNode;
  tone?: "you" | "enemy";
  className?: string;
}) {
  return (
    <div
      className={[
        "panel",
        tone === "you" ? "panel-you" : tone === "enemy" ? "panel-enemy" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </div>
  );
}

export function Eyebrow({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <p className={`t-eyebrow ${className}`}>{children}</p>;
}

export function Rule({ className = "" }: { className?: string }) {
  return <div className={`rule ${className}`} />;
}

/* ------------------------------------------------------------------ */
/* Health                                                              */
/* ------------------------------------------------------------------ */

/**
 * The health bar with a ghost behind it. The bright bar snaps to the new value
 * immediately; the pale one behind drains a beat later, so you can see the size
 * of the hit rather than just its result.
 */
export function HealthBar({
  value,
  max,
  className = "",
}: {
  value: number;
  max: number;
  className?: string;
}) {
  const ratio = Math.max(0, Math.min(1, value / Math.max(1, max)));
  const [ghost, setGhost] = useState(ratio);

  useEffect(() => {
    if (ratio >= ghost) {
      setGhost(ratio);
      return;
    }
    const timer = window.setTimeout(() => setGhost(ratio), 40);
    return () => window.clearTimeout(timer);
  }, [ratio, ghost]);

  const state = ratio <= 0.25 ? "critical" : ratio <= 0.55 ? "hurt" : "healthy";

  return (
    <div className={`hpbar ${className}`} role="meter" aria-valuenow={value} aria-valuemax={max}>
      <div className="hpbar-ghost" style={{ width: `${Math.max(ratio, ghost) * 100}%` }} />
      <div className="hpbar-fill" data-state={state} style={{ width: `${ratio * 100}%` }} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Numbers                                                             */
/* ------------------------------------------------------------------ */

export type { StatKind };

/** A single score, coloured by what it means. Colours never change meaning. */
export function Stat({
  kind,
  value,
  label,
  size = "md",
  bare,
  showGlyph = true,
  colorLabel = false,
  animate = false,
}: {
  kind: StatKind;
  value: number | string;
  label?: string;
  size?: "sm" | "md" | "lg";
  bare?: boolean;
  showGlyph?: boolean;
  colorLabel?: boolean;
  /** Count up from zero on mount instead of appearing at its final value — a
   * match-end summary, not a round-by-round readout. Numeric values only. */
  animate?: boolean;
}) {
  const text = size === "lg" ? "text-xl" : size === "sm" ? "text-sm" : "text-base";
  const numClass = `c-${kind} glow-${kind} ${text} leading-none`;
  const body =
    animate && typeof value === "number" ? (
      <Ticker value={value} from={0} className={numClass} />
    ) : (
      <span className={`${numClass} t-num`}>{value}</span>
    );
  if (bare) return body;
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="flex w-full items-baseline justify-center gap-1 text-center">
        {showGlyph && (
          <span className={`c-${kind} inline-flex self-center opacity-90`}>
            <StatIcon kind={kind} size={13} />
          </span>
        )}
        {body}
      </div>
      {label !== "" && (
        <span
          className={`t-eyebrow text-xs tracking-[0.16em] ${
            colorLabel ? `c-${kind}` : ""
          }`}
        >
          {label ?? STAT_LABEL[kind]}
        </span>
      )}
    </div>
  );
}

/**
 * A fleet's whole roll, five numbers in one strip: Attack, Shields, Direct,
 * Repair, Energy. The roll screen uses it for your own dice; the round
 * report reuses this same component for the enemy's, so what they actually
 * rolled reads exactly the way yours does — no separate "what got through"
 * math standing in for numbers this side of the match never truly knows.
 */
export function TallyStrip({ tally }: { tally: Tally | null }) {
  return (
    <div className="tally-strip grid gap-1">
      <div className="tally-cell tally-cell-attack">
        <Stat
          kind="attack"
          value={tally?.attack ?? 0}
          label="Attack"
          size="lg"
          showGlyph={false}
          colorLabel
        />
      </div>
      <div className="tally-cell tally-cell-shield">
        <Stat
          kind="shield"
          value={tally?.defense ?? 0}
          label="Shields"
          size="lg"
          showGlyph={false}
          colorLabel
        />
      </div>
      <div className="tally-cell tally-cell-direct">
        <Stat
          kind="direct"
          value={tally?.direct ?? 0}
          label="Direct"
          showGlyph={false}
          colorLabel
        />
      </div>
      <div className="tally-cell tally-cell-repair">
        <Stat
          kind="repair"
          value={tally?.heal ?? 0}
          label="Repair"
          showGlyph={false}
          colorLabel
        />
      </div>
      <div className="tally-cell tally-cell-energy">
        <Stat
          kind="energy"
          value={tally?.energy ?? 0}
          label="Energy"
          showGlyph={false}
          colorLabel
        />
      </div>
    </div>
  );
}

/**
 * A number that counts up to its new value instead of jumping. Small thing,
 * but it is the difference between a scoreboard and a slot machine.
 */
export function Ticker({
  value,
  className = "",
  duration = 520,
  from,
}: {
  value: number;
  className?: string;
  duration?: number;
  /**
   * Start the count here instead of at `value`, so it visibly counts up the
   * moment it first mounts — a match-end summary, say — rather than only
   * animating on a later change to an already-mounted number.
   */
  from?: number;
}) {
  const [shown, setShown] = useState(from ?? value);
  const fromRef = useRef(shown);
  const startedRef = useRef(0);
  const rafRef = useRef(0);

  useEffect(() => {
    if (value === shown) return;
    fromRef.current = shown;
    startedRef.current = performance.now();
    const from = fromRef.current;
    const delta = value - from;

    const step = (now: number) => {
      const t = Math.min(1, (now - startedRef.current) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(Math.round(from + delta * eased));
      if (t < 1) rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
    // `shown` deliberately omitted — including it restarts the animation each frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, duration]);

  return <span className={`t-num ${className}`}>{shown}</span>;
}

/* ------------------------------------------------------------------ */
/* Hit points                                                          */
/* ------------------------------------------------------------------ */

/**
 * The one hit-point readout in the game — a plain number each, no bar.
 * Every screen that needs HP context (the match header, the shipyard, which
 * runs as its own full-screen overlay above that header) shows this same
 * rail instead of growing its own bar or number, so a decision never has to
 * compete with a tracker for room, and "how hurt am I" always looks the
 * same wherever it's asked.
 */
export function HpRail({
  yourHp,
  enemyName,
  enemyHp,
  round,
  yourFleet,
  enemyFleet,
  className = "",
}: {
  yourHp: number;
  enemyName: string;
  enemyHp: number;
  /** Omit on a screen that already states the round elsewhere. */
  round?: number;
  /**
   * How much your fleet could block right now, next to the flagship's own
   * health — a ship that blocked last round doesn't count until it's back.
   * Omit where that number isn't known (e.g. the enemy's fleet on a screen
   * that only carries their HP).
   */
  yourFleet?: number;
  enemyFleet?: number;
  className?: string;
}) {
  return (
    <div className={`hp-rail panel panel-flush px-3 py-2 ${className}`}>
      <div className="flex items-start justify-between gap-2">
        <span className="hp-rail-side min-w-0 text-sm font-semibold text-white">
          You <Ticker value={Math.max(0, yourHp)} className="hp-rail-number c-hp-glow" />
          {yourFleet !== undefined && (
            <>
              <span className="hp-rail-plus">+</span>
              <Ticker value={yourFleet} className="hp-rail-fleet" />
            </>
          )}
        </span>
        {round !== undefined && (
          <span className="t-eyebrow hp-rail-round shrink-0 text-xs">Round {round}</span>
        )}
        <span className="hp-rail-side hp-rail-side-enemy min-w-0 text-right text-sm font-semibold text-white">
          {enemyName} <Ticker value={Math.max(0, enemyHp)} className="hp-rail-number c-hp-glow" />
          {enemyFleet !== undefined && (
            <>
              <span className="hp-rail-plus">+</span>
              <Ticker value={enemyFleet} className="hp-rail-fleet" />
            </>
          )}
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Chips and pills                                                     */
/* ------------------------------------------------------------------ */

export function Chip({
  children,
  tone = "neutral",
  className = "",
}: {
  children: ReactNode;
  tone?: StatKind | "neutral";
  className?: string;
}) {
  const colour = tone === "neutral" ? "c-dim" : `c-${tone}`;
  const border =
    tone === "neutral"
      ? "border-white/12 bg-white/[0.05]"
      : "border-current/25 bg-current/[0.09]";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.1em] ${colour} ${border} ${className}`}
    >
      {children}
    </span>
  );
}

/** The four-digit room code, big enough to read across a room. */
export function RoomCode({ code }: { code: string }) {
  return (
    <div
      className="flex gap-2"
      aria-label={`Room code ${code.split("").join(" ")}`}
      data-room-code={code}
    >
      {code.split("").map((digit, index) => (
        <span
          key={index}
          className="panel panel-flush t-num flex h-16 w-13 min-w-[3.25rem] items-center justify-center text-3xl text-white"
        >
          {digit}
        </span>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Feedback                                                            */
/* ------------------------------------------------------------------ */

export function Notice({
  children,
  tone = "info",
  className = "",
}: {
  children: ReactNode;
  tone?: "info" | "warn" | "good";
  className?: string;
}) {
  const colour =
    tone === "warn"
      ? "border-[--color-attack]/35 bg-[--color-attack]/[0.09] c-attack-glow"
      : tone === "good"
        ? "border-[--color-repair]/35 bg-[--color-repair]/[0.09] c-repair-glow"
        : "border-white/12 bg-white/[0.04] c-dim-bright";
  return (
    <div className={`rounded-xl border px-3.5 py-2.5 text-sm leading-snug ${colour} ${className}`}>
      {children}
    </div>
  );
}

/** A full-screen sheet that slides up. Used for How to play and the shipyard. */
export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  /*
   * Lock the page behind the sheet while it is open.
   *
   * The sheet is position:fixed, but the document behind it was still
   * scrollable — so a drag that started anywhere non-scrolling (the footer
   * button, the header) panned the document instead, and iOS Safari moves
   * fixed elements with the visual viewport as it does. The result was that
   * holding the footer button let you drag the whole sheet up off screen.
   * Freezing the document underneath is what actually stops that; the
   * sheet's own scroll region keeps working because it is a real scroller.
   */
  useEffect(() => {
    if (!open) return;
    const { body } = document;
    const previous = body.style.overflow;
    body.style.overflow = "hidden";
    return () => {
      body.style.overflow = previous;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/72 backdrop-blur-sm"
      />
      <div className="anim-rise relative mt-auto flex max-h-[92dvh] flex-col">
        <div className="panel mx-2 mb-2 flex min-h-0 flex-col overflow-hidden rounded-[22px]">
          <div className="flex items-center justify-between gap-3 px-5 pb-3 pt-4">
            <h2 className="t-display text-xl">{title}</h2>
            <Button tone="ghost" size="sm" onClick={onClose} ariaLabel="Close">
              Close
            </Button>
          </div>
          <Rule />
          <div className="sheet-scroll scroll-y min-h-0 flex-1 px-5 py-4">{children}</div>
          {footer && (
            <>
              <Rule />
              <div className="sheet-foot px-5 py-3">{footer}</div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 text-sm c-dim">
      <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-white/80" />
      {label}
    </div>
  );
}
