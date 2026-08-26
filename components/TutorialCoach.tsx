"use client";

/**
 * Tutorial coach — a collapsible tip, never a wall over the board.
 *
 * When the player must tap the board (Roll, Lock in, shipyard…), the card
 * collapses to a one-line bar so the primary button stays free. Tap the bar to
 * re-read the tip. Preface steps and "Next" steps open expanded with dice art.
 */

import { useEffect, useState } from "react";
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

function needsBoardTap(step: TutorialStep): boolean {
  const a = step.allow;
  return !!(
    a.rollAll ||
    a.reroll ||
    a.submit ||
    a.continue ||
    a.brace ||
    a.ready ||
    a.shopSlot ||
    a.shopBuy ||
    a.shopUpgrade ||
    a.token?.length
  );
}

function FaceStrip({ stepId }: { stepId: TutorialStepId }) {
  if (stepId === "intro" || stepId === "finale") {
    return (
      <div className="tutorial-face-strip" aria-hidden>
        <span className="tutorial-hull-chip">
          <span className="tutorial-hull-shape">
            <HullShape sides={4} tone="live" />
          </span>
          <b>d4</b>
        </span>
        <span className="tutorial-hull-chip">
          <span className="tutorial-hull-shape">
            <HullShape sides={6} tone="live" />
          </span>
          <b>d6</b>
        </span>
        <span className="tutorial-hull-chip">
          <span className="tutorial-hull-shape">
            <HullShape sides={8} tone="live" />
          </span>
          <b>d8</b>
        </span>
        <span className="tutorial-hull-chip">
          <span className="tutorial-hull-shape">
            <HullShape sides={10} tone="live" />
          </span>
          <b>d10</b>
        </span>
      </div>
    );
  }
  if (stepId === "faces") {
    return (
      <div className="tutorial-face-strip" aria-hidden>
        <figure className="tutorial-face-card">
          <HelpShipFace value={6} size={64} />
          <figcaption className="c-attack">Even · hits</figcaption>
        </figure>
        <figure className="tutorial-face-card">
          <HelpShipFace value={5} size={64} />
          <figcaption className="c-shield">Odd · blocks</figcaption>
        </figure>
      </div>
    );
  }
  if (stepId === "marks") {
    return (
      <div className="tutorial-face-strip" aria-hidden>
        <figure className="tutorial-face-card">
          <HelpShipFace value={1} size={56} />
          <figcaption className="c-energy">Energy</figcaption>
        </figure>
        <figure className="tutorial-face-card">
          <HelpShipFace value={2} size={56} />
          <figcaption className="c-direct">Direct</figcaption>
        </figure>
        <figure className="tutorial-face-card">
          <HelpShipFace value={3} size={56} />
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
  const boardTap = needsBoardTap(step);
  const showNext = !!step.allow.coachNext && !!step.nextLabel;
  const [open, setOpen] = useState(!boardTap);

  // Action steps start collapsed so Roll / Lock in stay free. Tip steps open.
  useEffect(() => {
    setOpen(!boardTap);
  }, [stepId, boardTap]);

  return (
    <div
      className={`tutorial-coach ${open ? "is-open" : "is-collapsed"} ${
        boardTap ? "is-board-wait" : "is-tip"
      }`}
      role="dialog"
      aria-label="Tutorial coach"
      aria-expanded={open}
    >
      {!open && (
        <button
          type="button"
          className="tutorial-coach-bar"
          onClick={() => setOpen(true)}
        >
          <span className="min-w-0 flex-1 text-left">
            <span className="t-eyebrow c-energy block">{step.eyebrow}</span>
            <span className="t-display block truncate text-base text-white">{step.title}</span>
          </span>
          <span className="tutorial-coach-bar-meta">
            <span className="t-num text-xs c-dim">
              {stepNumber}/{stepCount}
            </span>
            <span className="tutorial-coach-chevron" aria-hidden>
              ▴
            </span>
          </span>
        </button>
      )}

      {open && (
        <div className="tutorial-coach-card panel">
          <div className="tutorial-coach-top">
            <p className="t-eyebrow c-energy">{step.eyebrow}</p>
            <div className="flex items-center gap-2">
              <p className="tutorial-coach-progress t-num">
                {stepNumber}/{stepCount}
              </p>
              {boardTap && (
                <button
                  type="button"
                  className="tutorial-coach-minimize"
                  onClick={() => setOpen(false)}
                  aria-label="Hide tip so you can tap the board"
                >
                  ▾ Hide
                </button>
              )}
            </div>
          </div>
          <h2 className="t-display mt-1 text-xl text-white">{step.title}</h2>
          <FaceStrip stepId={stepId} />
          <p className="mt-2 text-sm leading-snug text-[--color-hull-100]">{step.body}</p>
          {error && (
            <p className="mt-2 text-sm c-attack" role="status">
              {error}
            </p>
          )}
          {boardTap && (
            <p className="tutorial-coach-wait mt-3 text-xs font-bold uppercase tracking-wide c-energy">
              Hide this tip, then tap what it asks for on the board
            </p>
          )}
          <div className="mt-3 flex items-center gap-2">
            {showNext ? (
              <Button tone="primary" full onClick={onNext}>
                {step.nextLabel}
              </Button>
            ) : boardTap ? (
              <Button tone="primary" full onClick={() => setOpen(false)}>
                Got it — show the board
              </Button>
            ) : (
              <span className="flex-1" />
            )}
            <Button tone="ghost" size="sm" onClick={onSkip}>
              Skip
            </Button>
          </div>
        </div>
      )}
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
          <HelpShipFace value={4} size={72} />
          <HelpFlagFace face={1} size={88} />
          <HelpShipFace value={6} size={72} />
        </div>
        <div className="tutorial-theme-dice tutorial-theme-dice-row2">
          <HelpShipFace value={1} size={56} />
          <HelpShipFace value={2} size={56} />
          <HelpShipFace value={3} size={56} />
        </div>
      </div>
      <div className="tutorial-theme-card panel anim-rise">
        <p className="t-eyebrow c-energy">{eyebrow}</p>
        <h1 className="t-display mt-2 text-3xl text-white">{title}</h1>
        <div className="mt-4 flex flex-col gap-3">
          {paragraphs.map((text) => (
            <p key={text.slice(0, 24)} className="text-sm leading-relaxed text-[--color-hull-100]">
              {text}
            </p>
          ))}
        </div>
        <div className="mt-6 flex flex-col gap-2">
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
