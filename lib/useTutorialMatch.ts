/**
 * Tutorial match controller — a solo battle on rails.
 *
 * The rails live in tutorialFlow (pure). This hook is the React wrapper.
 */

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { publicMatchView, type MatchAction, type MatchState, type PlayerState } from "./engine";
import {
  stepById,
  TUTORIAL_STEPS,
  type TutorialAllow,
  type TutorialFaces,
  type TutorialStep,
  type TutorialStepId,
} from "./tutorial";
import {
  applyTutorialAction,
  applyTutorialCoachNext,
  applyTutorialFaces,
  startTutorialMatch,
  tutorialActionAllowed,
} from "./tutorialFlow";
import type { MatchController } from "./useMatch";

export type TutorialController = MatchController & {
  step: TutorialStep;
  stepId: TutorialStepId;
  stepNumber: number;
  stepCount: number;
  showTheme: boolean;
  dismissTheme(): void;
  coachNext(): void;
  finish(): void;
  allowed: TutorialAllow;
};

export function useTutorialMatch(onFinished?: () => void): TutorialController {
  const [state, setState] = useState<MatchState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stepId, setStepId] = useState<TutorialStepId>("intro");
  const [showTheme, setShowTheme] = useState(true);
  const stateRef = useRef<MatchState | null>(null);
  const stepRef = useRef<TutorialStepId>("intro");
  const finishedRef = useRef(onFinished);
  finishedRef.current = onFinished;

  const publish = useCallback((match: MatchState, nextStep: TutorialStepId) => {
    stepRef.current = nextStep;
    setStepId(nextStep);
    stateRef.current = match;
    setState(structuredClone(match));
  }, []);

  const start = useCallback(() => {
    const match = startTutorialMatch();
    stateRef.current = match;
    stepRef.current = "intro";
    setStepId("intro");
    setShowTheme(true);
    setError(null);
    setState(structuredClone(match));
  }, []);

  useEffect(() => {
    start();
  }, [start]);

  const coachNext = useCallback(() => {
    const match = stateRef.current;
    if (!match) return;
    const next = applyTutorialCoachNext(match, stepRef.current);
    if (next === "finished") {
      finishedRef.current?.();
      return;
    }
    if (!next) return;
    publish(match, next);
  }, [publish]);

  const finish = useCallback(() => {
    finishedRef.current?.();
  }, []);

  const dismissTheme = useCallback(() => setShowTheme(false), []);

  const act = useCallback(
    (action: MatchAction) => {
      const match = stateRef.current;
      if (!match) return;
      const result = applyTutorialAction(match, stepRef.current, action);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setError(null);
      publish(match, result.stepId);
    },
    [publish],
  );

  const view = useMemo(() => (state ? publicMatchView(state, "host") : null), [state]);
  const step = stepById(stepId);
  const stepNumber = TUTORIAL_STEPS.findIndex((entry) => entry.id === stepId) + 1;

  return {
    status: view ? "ready" : "loading",
    state: view,
    side: "host",
    you: view?.players.host ?? null,
    them: view?.players.guest ?? null,
    busy: false,
    waitingOnEnemy: false,
    error,
    clearError: () => setError(null),
    act,
    restart: start,
    mode: "solo",
    step,
    stepId,
    stepNumber,
    stepCount: TUTORIAL_STEPS.length,
    showTheme,
    dismissTheme,
    coachNext,
    finish,
    allowed: step.allow,
  };
}

export function __applyTutorialFaces(player: PlayerState, faces: TutorialFaces) {
  applyTutorialFaces(player, faces);
}

export function __tutorialActionAllowed(allow: TutorialAllow, action: MatchAction) {
  return tutorialActionAllowed(allow, action);
}
