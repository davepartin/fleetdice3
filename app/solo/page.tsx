"use client";

/**
 * Solo: pick how hard the Enemy plays, then fight it.
 *
 * The difficulty screen is one tap deep rather than buried in settings, because
 * "the computer is too hard" is the single most common reason a good dice game
 * gets closed after one match.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MatchScreen } from "@/components/MatchScreen";
import { Button, Panel } from "@/components/ui";
import { HowToPlaySheet } from "@/components/HowToPlay";
import { useSoloMatch } from "@/lib/useMatch";
import { DIFFICULTY, PLAN_BLURB, PLAN_LABEL, PLANS, type Difficulty, type Plan } from "@/lib/ai";
import { basePath } from "@/lib/paths";

export default function SoloPage() {
  const router = useRouter();
  const [difficulty, setDifficulty] = useState<Difficulty | null>(null);
  const [plan, setPlan] = useState<Plan | "surprise">("surprise");
  const [helpOpen, setHelpOpen] = useState(false);

  if (!difficulty) {
    return (
      <SoloSetup
        plan={plan}
        onPlan={setPlan}
        onStart={setDifficulty}
        onHelp={() => setHelpOpen(true)}
        onBack={() => router.push(`${basePath}/`)}
        helpOpen={helpOpen}
        onCloseHelp={() => setHelpOpen(false)}
      />
    );
  }

  return (
    <SoloMatch
      difficulty={difficulty}
      plan={plan === "surprise" ? undefined : plan}
      onExit={() => router.push(`${basePath}/`)}
    />
  );
}

function SoloMatch({
  difficulty,
  plan,
  onExit,
}: {
  difficulty: Difficulty;
  plan?: Plan;
  onExit(): void;
}) {
  const controller = useSoloMatch({ difficulty, plan });
  return <MatchScreen controller={controller} onExit={onExit} />;
}

function SoloSetup({
  plan,
  onPlan,
  onStart,
  onHelp,
  onBack,
  helpOpen,
  onCloseHelp,
}: {
  plan: Plan | "surprise";
  onPlan(plan: Plan | "surprise"): void;
  onStart(difficulty: Difficulty): void;
  onHelp(): void;
  onBack(): void;
  helpOpen: boolean;
  onCloseHelp(): void;
}) {
  const [showPlans, setShowPlans] = useState(false);

  return (
    <>
      <div className="hud">
        <div className="scroll-y fade-edges flex-1">
          <div className="mx-auto flex w-full max-w-[30rem] flex-col gap-4 px-4 pb-10 pt-6">
            <div className="flex items-center gap-2">
              <Button tone="ghost" size="sm" onClick={onBack}>
                ‹ Home
              </Button>
              <span className="flex-1" />
              <Button tone="ghost" size="sm" onClick={onHelp}>
                How to play
              </Button>
            </div>

            <header>
              <p className="t-eyebrow">Solo</p>
              <h1 className="t-display text-4xl">How hard should it play?</h1>
            </header>

            <div className="flex flex-col gap-2.5">
              {(Object.keys(DIFFICULTY) as Difficulty[]).map((key) => {
                const entry = DIFFICULTY[key];
                return (
                  <button key={key} type="button" onClick={() => onStart(key)} className="text-left">
                    <Panel className="flex items-center gap-4 p-4 transition hover:border-white/25">
                      <span className="min-w-0 flex-1">
                        <span className="t-display block text-xl text-white">{entry.label}</span>
                        <span className="mt-0.5 block text-[0.84rem] leading-snug c-dim">
                          {entry.blurb}
                        </span>
                      </span>
                      <span className="c-dim" aria-hidden>
                        ›
                      </span>
                    </Panel>
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={() => setShowPlans((value) => !value)}
              className="flex items-center justify-between gap-2 px-1 py-2"
            >
              <span className="t-eyebrow">
                Enemy plan · {plan === "surprise" ? "Surprise me" : PLAN_LABEL[plan]}
              </span>
              <span className={`c-dim transition-transform ${showPlans ? "rotate-180" : ""}`} aria-hidden>
                ▾
              </span>
            </button>

            {showPlans && (
              <Panel className="flex flex-col gap-1.5 p-3">
                <PlanRow
                  active={plan === "surprise"}
                  title="Surprise me"
                  blurb="A different plan every match. You will not know what it is building until you see it."
                  onClick={() => onPlan("surprise")}
                />
                {PLANS.map((entry) => (
                  <PlanRow
                    key={entry}
                    active={plan === entry}
                    title={PLAN_LABEL[entry]}
                    blurb={PLAN_BLURB[entry]}
                    onClick={() => onPlan(entry)}
                  />
                ))}
              </Panel>
            )}
          </div>
        </div>
      </div>
      <HowToPlaySheet open={helpOpen} onClose={onCloseHelp} />
    </>
  );
}

function PlanRow({
  active,
  title,
  blurb,
  onClick,
}: {
  active: boolean;
  title: string;
  blurb: string;
  onClick(): void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl border px-3 py-2.5 text-left transition ${
        active
          ? "border-[--color-energy]/50 bg-[--color-energy]/[0.09]"
          : "border-white/10 hover:bg-white/[0.05]"
      }`}
    >
      <span className="block text-[0.92rem] font-semibold text-white">{title}</span>
      <span className="mt-0.5 block text-[0.78rem] leading-snug c-dim">{blurb}</span>
    </button>
  );
}
