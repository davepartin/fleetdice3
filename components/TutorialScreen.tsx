"use client";

/**
 * Tutorial battle: real MatchScreen always visible, collapsible coach on top.
 */

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { MatchScreen } from "./MatchScreen";
import { TutorialCoach, TutorialTheme } from "./TutorialCoach";
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

  const preface =
    tutorial.stepId === "intro" || tutorial.stepId === "faces" || tutorial.stepId === "marks";

  return (
    <div className={`tutorial-shell ${preface ? "is-preface" : ""}`}>
      {/* Board stays up from the first tip so the fleet is never a black void. */}
      {tutorial.status === "ready" && <MatchScreen controller={controller} onExit={goHome} />}
      {preface && <div className="tutorial-preface-scrim" aria-hidden />}
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
