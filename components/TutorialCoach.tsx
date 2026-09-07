"use client";

/**
 * Tutorial coach — docked at the bottom so the board stays visible above.
 *
 * A centred or top-anchored card covered the dice the tip was pointing at.
 * The card sits just above Lock in / Roll Fleet and grows upward. Board-teach
 * steps (the ones that ring the 3×3) open as a slim strip — title, two lines,
 * Next — so the fleet is visible without tapping Minimize first.
 */

import { useEffect, useState } from "react";
import { Button } from "./ui";
import { HelpFlagFace, HelpShipFace } from "./HelpArt";
import { HullShape } from "./HullShape";
import { isBoardTeachStep, type TutorialStep, type TutorialStepId } from "@/lib/tutorial";

type Props = {
  step: TutorialStep;
  stepId: TutorialStepId;
  stepNumber: number;
  stepCount: number;
  error?: string | null;
  onNext(): void;
  onSkip(): void;
};

/**
 * What the player has to do on the board for this step to advance. The three
 * shipyard steps stay distinct because they point at different *kinds* of cell
 * — lighting all nine at once would be pointing at nothing.
 */
export function awaitedAction(step: TutorialStep): string | null {
  const a = step.allow;
  if (a.rollAll) return "roll";
  if (a.reroll) return "reroll";
  if (a.submit) return "submit";
  if (a.continue) return "continue";
  if (a.brace) return "brace";
  if (a.ready) return "ready";
  if (a.shopSlot) return "shopSlot";
  if (a.shopBuy) return "shopBuy";
  if (a.shopUpgrade) return "shopUpgrade";
  if (a.token?.length) return "token";
  return null;
}

/** The one-line nudge under the body, naming the target in the player's words. */
const AWAIT_HINT: Record<string, string> = {
  roll: "Tap Roll Fleet below",
  reroll: "Tap a die on the board, then Reroll",
  submit: "Tap Lock in below",
  continue: "Tap To the shipyard below",
  brace: "Tap a ship, then confirm below",
  ready: "Tap Return to battle below",
  shopSlot: "Tap a glowing locked bay",
  shopBuy: "Tap the glowing empty bay",
  shopUpgrade: "Tap a glowing d4 to upgrade",
  token: "Tap Flagship weapon, then +1 face",
};

function FaceStrip({ stepId }: { stepId: TutorialStepId }) {
  if (stepId === "intro" || stepId === "finale") {
    return (
      <div className="tutorial-face-strip" aria-hidden>
        {([4, 6, 8, 10] as const).map((sides) => (
          <span key={sides} className="tutorial-hull-chip">
            <span className="tutorial-hull-shape">
              <HullShape sides={sides} tone="live" />
            </span>
            <b>d{sides}</b>
          </span>
        ))}
      </div>
    );
  }
  if (stepId === "faces") {
    return (
      <div className="tutorial-face-strip" aria-hidden>
        <figure className="tutorial-face-card">
          <HelpShipFace value={6} size={68} />
          <figcaption className="c-attack">Even · Attack</figcaption>
        </figure>
        <figure className="tutorial-face-card">
          <HelpShipFace value={5} size={68} />
          <figcaption className="c-shield">Odd · Shields</figcaption>
        </figure>
      </div>
    );
  }
  if (stepId === "marks") {
    return (
      <div className="tutorial-face-strip" aria-hidden>
        <figure className="tutorial-face-card">
          <HelpShipFace value={1} size={60} />
          <figcaption className="c-energy">Energy</figcaption>
        </figure>
        <figure className="tutorial-face-card">
          <HelpShipFace value={2} size={60} />
          <figcaption className="c-direct">Direct</figcaption>
        </figure>
        <figure className="tutorial-face-card">
          <HelpShipFace value={3} size={60} />
          <figcaption className="c-repair">Repair</figcaption>
        </figure>
      </div>
    );
  }
  if (stepId === "token_teach" || stepId === "straight_done") {
    return (
      <div className="tutorial-face-strip" aria-hidden>
        <figure className="tutorial-face-card">
          <HelpFlagFace face={4} size={64} />
          <figcaption>Flagship</figcaption>
        </figure>
        <span className="tutorial-face-arrow c-energy" aria-hidden>
          →
        </span>
        <figure className="tutorial-face-card">
          <HelpFlagFace face={5} size={64} />
          <figcaption className="c-energy">+1 face</figcaption>
        </figure>
      </div>
    );
  }
  return null;
}

export function TutorialCoach({
  step,
  stepId,
  stepNumber,
  stepCount,
  error,
  onNext,
  onSkip,
}: Props) {
  const awaiting = awaitedAction(step);
  const showNext = !!step.allow.coachNext && !!step.nextLabel;
  const hint = awaiting ? (AWAIT_HINT[awaiting] ?? "Take your turn on the board") : null;
  const boardTeach = isBoardTeachStep(step);

  // Lesson and HUD tips open maximized so the copy gets read. Board-teach
  // steps open as the slim strip — a tall card here covers the 3×3 the
  // spotlight is pointing at. Show tip still expands it; Next stays on the bar.
  const [maximized, setMaximized] = useState(!boardTeach);
  useEffect(() => setMaximized(!boardTeach), [stepId, boardTeach]);

  /*
   * Bring whatever this step lit up into view. Mostly a no-op — the dock is
   * always on screen — but the shipyard's grid can scroll, and a glowing bay
   * the player has to go looking for is a step that reads as broken.
   */
  useEffect(() => {
    if (!awaiting) return;
    const timer = window.setTimeout(() => {
      const lit = document.querySelector<HTMLElement>(
        `.tutorial-shell[data-awaiting="${awaiting}"] .yard-cell[data-affordable]`,
      );
      lit?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [stepId, awaiting]);

  if (!maximized) {
    return (
      <div className="tutorial-coach" role="dialog" aria-label="Tutorial coach, minimized">
        <button
          type="button"
          className={`tutorial-coach-bar panel${boardTeach ? " tutorial-coach-bar-board" : ""}`}
          onClick={() => setMaximized(true)}
        >
          <span className="tutorial-coach-bar-text">
            <span className="tutorial-coach-bar-title">{step.title}</span>
            {error ? (
              <span className="tutorial-coach-bar-hint tutorial-coach-bar-error">{error}</span>
            ) : hint ? (
              <span className="tutorial-coach-bar-hint">↓ {hint}</span>
            ) : boardTeach ? (
              <span className="tutorial-coach-bar-hint tutorial-coach-bar-body">{step.body}</span>
            ) : null}
          </span>
          {showNext ? (
            <span
              className="tutorial-coach-bar-next-wrap"
              onClick={(event) => event.stopPropagation()}
            >
              <Button tone="primary" size="sm" onClick={onNext}>
                {step.nextLabel}
              </Button>
            </span>
          ) : null}
          <span className="tutorial-coach-bar-cta">Show tip</span>
        </button>
      </div>
    );
  }

  return (
    <div className="tutorial-coach" role="dialog" aria-label="Tutorial coach">
      <div className="tutorial-coach-card panel">
        <div className="tutorial-coach-scroll">
          <div className="tutorial-coach-top">
            <p className="t-eyebrow c-energy">{step.eyebrow}</p>
            <div className="tutorial-coach-top-right">
              <p className="tutorial-coach-progress t-num">
                {stepNumber}/{stepCount}
              </p>
              <button type="button" className="tutorial-coach-minimize" onClick={() => setMaximized(false)}>
                Minimize
              </button>
            </div>
          </div>

          <h2 className="t-display tutorial-coach-title">{step.title}</h2>
          {!boardTeach && <FaceStrip stepId={stepId} />}
          <p className="tutorial-coach-body">{step.body}</p>

          {error && (
            <p className="tutorial-coach-error" role="status">
              {error}
            </p>
          )}
        </div>

        {/* Outside the scroll area on purpose — this is the one thing on the
            card that must never require a scroll gesture to find. */}
        <div className="tutorial-coach-foot">
          {showNext ? (
            <Button tone="primary" full onClick={onNext}>
              {step.nextLabel}
            </Button>
          ) : hint ? (
            /* No button — the board is the button. Name the target and point
               at it; the real control is already lit up down in the dock. */
            <p className="tutorial-coach-await" role="status">
              <span className="tutorial-coach-caret" aria-hidden>
                ↓
              </span>
              {hint}
            </p>
          ) : (
            <span className="flex-1" />
          )}
          <button type="button" className="tutorial-coach-skip" onClick={onSkip}>
            Skip
          </button>
        </div>
      </div>
    </div>
  );
}

type ThemeProps = {
  eyebrow: string;
  title: string;
  paragraphs: string[];
  onStart(): void;
  onSkip(): void;
};

export function TutorialTheme({ eyebrow, title, paragraphs, onStart, onSkip }: ThemeProps) {
  return (
    <div className="tutorial-theme">
      <div className="tutorial-theme-art" aria-hidden>
        <div className="tutorial-theme-dice">
          <HelpShipFace value={4} size={56} />
          <HelpFlagFace face={1} size={68} />
          <HelpShipFace value={6} size={56} />
        </div>
        <div className="tutorial-theme-dice tutorial-theme-dice-row2">
          <HelpShipFace value={1} size={44} />
          <HelpShipFace value={2} size={44} />
          <HelpShipFace value={3} size={44} />
        </div>
      </div>
      <div className="tutorial-theme-card panel anim-rise">
        <div className="tutorial-theme-scroll">
          <p className="t-eyebrow c-energy">{eyebrow}</p>
          <h1 className="t-display mt-2 text-3xl text-white">{title}</h1>
          <div className="mt-4 flex flex-col gap-3">
            {paragraphs.map((text) => (
              <p key={text.slice(0, 24)} className="text-sm leading-relaxed text-[--color-hull-100]">
                {text}
              </p>
            ))}
          </div>
        </div>
        {/* Outside the scroll area — the whole point of this screen is to get
            the player tapping in, so that button can never hide inside it. */}
        <div className="tutorial-theme-actions">
          <Button tone="primary" full onClick={onStart}>
            Begin the flight
          </Button>
          <Button tone="ghost" full onClick={onSkip}>
            Skip tutorial
          </Button>
        </div>
      </div>
    </div>
  );
}
