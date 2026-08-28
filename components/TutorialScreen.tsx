"use client";

/**
 * Tutorial battle: real MatchScreen always visible, collapsible coach on top.
 */

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { MatchScreen } from "./MatchScreen";
import { TutorialCoach, TutorialTheme, awaitedAction } from "./TutorialCoach";
import { useTutorialMatch } from "@/lib/useTutorialMatch";
import { TUTORIAL_INTRO } from "@/lib/tutorial";
import type { MatchAction } from "@/lib/engine";
import type { MatchController } from "@/lib/useMatch";

export function TutorialScreen() {
  const router = useRouter();
  const goHome = () => router.push("/");
  const tutorial = useTutorialMatch(goHome);

  const controller: MatchController = useMemo(() => {
    const act = (action: MatchAction) => {
      tutorial.clearError();
      tutorial.act(action);
    };
    return {
      status: tutorial.status,
      state: tutorial.state,
      side: tutorial.side,
      you: tutorial.you,
      them: tutorial.them,
      busy: tutorial.busy,
      waitingOnEnemy: tutorial.waitingOnEnemy,
      error: null,
      clearError: tutorial.clearError,
      act,
      mode: "solo",
    };
  }, [tutorial]);

  if (tutorial.showTheme) {
    return (
      <TutorialTheme
        eyebrow={TUTORIAL_INTRO.eyebrow}
        title={TUTORIAL_INTRO.title}
        paragraphs={[...TUTORIAL_INTRO.paragraphs]}
        onStart={tutorial.dismissTheme}
        onSkip={goHome}
      />
    );
  }

  // What the player must tap for this step to advance. CSS reads this off the
  // shell to light up that exact control down in the dock — so "tap Roll Fleet"
  // is something you see, not just something you read.
  const awaiting = awaitedAction(tutorial.step);

  return (
    <div className="tutorial-shell" data-awaiting={awaiting ?? undefined}>
      {/* The board is never veiled. You are being taught about these dice —
          dimming them to make room for a text card defeats the whole point. */}
      {tutorial.status === "ready" && <MatchScreen controller={controller} onExit={goHome} />}
      <TutorialCoach
        step={tutorial.step}
        stepId={tutorial.stepId}
        stepNumber={tutorial.stepNumber}
        stepCount={tutorial.stepCount}
        error={tutorial.error}
        onNext={() => {
          if (tutorial.stepId === "finale") tutorial.finish();
          else tutorial.coachNext();
        }}
        onSkip={goHome}
      />
    </div>
  );
}
