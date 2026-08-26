"use client";

/**
 * The coach card that sits over a tutorial battle.
 *
 * One job: say what to do next, and (when the step is coach-driven) offer Next.
 * It never replaces the board — the real MatchScreen stays underneath.
 */

import { Button } from "./ui";
import type { TutorialStep } from "@/lib/tutorial";

type Props = {
  step: TutorialStep;
  stepNumber: number;
  stepCount: number;
  error?: string | null;
  onNext(): void;
  onSkip(): void;
};

export function TutorialCoach({ step, stepNumber, stepCount, error, onNext, onSkip }: Props) {
  const waitingOnBoard = !step.allow.coachNext || (step.nextLabel == null && step.id !== "finale");
  const showNext = !!step.allow.coachNext && !!step.nextLabel;

  return (
    <div className="tutorial-coach" role="dialog" aria-label="Tutorial coach">
      <div className="tutorial-coach-card panel">
        <div className="tutorial-coach-top">
          <p className="t-eyebrow c-energy">{step.eyebrow}</p>
          <p className="tutorial-coach-progress t-num">
            {stepNumber}/{stepCount}
          </p>
        </div>
        <h2 className="t-display mt-1 text-xl text-white">{step.title}</h2>
        <p className="mt-2 text-sm leading-snug text-[--color-hull-100]">{step.body}</p>
        {error && (
          <p className="mt-2 text-sm c-attack" role="status">
            {error}
          </p>
        )}
        {waitingOnBoard && !showNext && (
          <p className="tutorial-coach-wait mt-3 text-xs font-bold uppercase tracking-wide c-energy">
            Waiting for your tap on the board…
          </p>
        )}
        <div className="mt-3 flex items-center gap-2">
          {showNext ? (
            <Button tone="primary" full onClick={onNext}>
              {step.nextLabel}
            </Button>
          ) : (
            <span className="flex-1" />
          )}
          <Button tone="ghost" size="sm" onClick={onSkip}>
            Skip
          </Button>
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
