"use client";

/**
 * Tutorial coach — a card at the TOP of the screen, never over the controls.
 *
 * Every action in this game lives in the bottom dock. So the coach lives at the
 * top, in the empty band where the board shows through. That one decision is
 * what makes it work: the coach and the button it points at can never occupy
 * the same pixels, so there is no accordion to open, nothing to hide, and no
 * moment where the tip covers the thing it just told you to tap. You read at
 * the top, you act at the bottom.
 */

import { useEffect, useRef } from "react";
import { Button } from "./ui";
import { HelpFlagFace, HelpShipFace } from "./HelpArt";
import { HullShape } from "./HullShape";
import type { TutorialStep, TutorialStepId } from "@/lib/tutorial";

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
  continue: "Tap the button below to continue",
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
          <figcaption className="c-attack">Even · hits</figcaption>
        </figure>
        <figure className="tutorial-face-card">
          <HelpShipFace value={5} size={68} />
          <figcaption className="c-shield">Odd · blocks</figcaption>
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
  const cardRef = useRef<HTMLDivElement>(null);

  /*
   * Publish how tall the card actually is, as --tutorial-coach-h on the shell.
   * The match screen doesn't need this (its controls are all at the bottom),
   * but the shipyard is a full-screen overlay whose grid starts at the very
   * top — it has to be pushed clear of however much room this card is taking,
   * which changes with the step's copy and the viewport. Measured, not guessed.
   */
  useEffect(() => {
    const card = cardRef.current;
    const shell = card?.closest(".tutorial-shell") as HTMLElement | null;
    if (!card || !shell) return;
    const publish = () => {
      shell.style.setProperty("--tutorial-coach-h", `${Math.round(card.getBoundingClientRect().height)}px`);
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(card);
    window.addEventListener("resize", publish);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", publish);
    };
  }, [stepId]);

  /*
   * On every screen except the shipyard, the coach docks at the BOTTOM —
   * right above whichever action button is live — instead of the top. The
   * board sits in the middle of the real match screen; anchoring the card
   * to the top parks it right over the board, which is the one thing a
   * lesson about dice can't afford to hide. Anchored to the bottom, it
   * covers the dock's own totals instead — those are redundant with what
   * the card itself is teaching. Measured, not guessed, same as the height
   * above: the action row's own padding differs slightly panel to panel.
   */
  useEffect(() => {
    const shell = document.querySelector<HTMLElement>(".tutorial-shell");
    if (!shell) return;
    const publish = () => {
      const action = document.querySelector<HTMLElement>(".match-bottom .btn-primary");
      if (!action) return;
      const clear = Math.max(0, Math.round(window.innerHeight - action.getBoundingClientRect().top));
      shell.style.setProperty("--tutorial-action-clear", `${clear}px`);
    };
    publish();
    const raf = requestAnimationFrame(publish);
    const bottom = document.querySelector<HTMLElement>(".match-bottom");
    const observer = bottom ? new ResizeObserver(publish) : null;
    observer?.observe(bottom!);
    window.addEventListener("resize", publish);
    return () => {
      cancelAnimationFrame(raf);
      observer?.disconnect();
      window.removeEventListener("resize", publish);
    };
  }, [stepId, awaiting]);

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

  return (
    <div className="tutorial-coach" role="dialog" aria-label="Tutorial coach">
      <div ref={cardRef} className="tutorial-coach-card panel">
        <div className="tutorial-coach-scroll">
          <div className="tutorial-coach-top">
            <p className="t-eyebrow c-energy">{step.eyebrow}</p>
            <p className="tutorial-coach-progress t-num">
              {stepNumber}/{stepCount}
            </p>
          </div>

          <h2 className="t-display tutorial-coach-title">{step.title}</h2>
          <FaceStrip stepId={stepId} />
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
          ) : awaiting ? (
            /* No button — the board is the button. Name the target and point
               at it; the real control is already lit up down in the dock. */
            <p className="tutorial-coach-await" role="status">
              <span className="tutorial-coach-caret" aria-hidden>
                ↓
              </span>
              {AWAIT_HINT[awaiting] ?? "Take your turn on the board"}
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
