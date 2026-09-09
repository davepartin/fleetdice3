"use client";

/**
 * Solo: pick how hard the Enemy plays, then fight it.
 *
 * The difficulty screen is one tap deep rather than buried in settings, because
 * "the computer is too hard" is the single most common reason a good dice game
 * gets closed after one match.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MatchScreen } from "@/components/MatchScreen";
import { Button, Panel } from "@/components/ui";
import { HowToPlaySheet } from "@/components/HowToPlay";
import { useSoloMatch } from "@/lib/useMatch";
import { DIFFICULTIES, DIFFICULTY, PLAN_BLURB, PLAN_LABEL, PLANS, type Difficulty, type Plan } from "@/lib/ai";
import { loadSoloSave, type SoloSave } from "@/lib/soloSave";
import { NOUN } from "@/lib/reference";
import {
  emptyRecord,
  loadRecord,
  played,
  recordSoloResult,
  suggestStepUp,
  winRate,
  type SoloRecord,
} from "@/lib/record";

export default function SoloPage() {
  const router = useRouter();
  const [difficulty, setDifficulty] = useState<Difficulty | null>(null);
  const [plan, setPlan] = useState<Plan | "surprise">("surprise");
  const [helpOpen, setHelpOpen] = useState(false);
  const [resume, setResume] = useState<SoloSave | null>(null);
  const [resuming, setResuming] = useState(false);
  const [loaded, setLoaded] = useState(false);
  // A saved battle is offered, never forced. Jumping straight back into the old
  // match meant tapping Solo could not reach the tier list at all — the one
  // screen this page exists for.
  useEffect(() => {
    setResume(loadSoloSave());
    setLoaded(true);
  }, []);
  if (!loaded) return <div className="recovery-screen">Checking for your saved battle…</div>;

  if (!difficulty) {
    return (
      <SoloSetup
        plan={plan}
        onPlan={setPlan}
        resume={resume}
        onResume={() => {
          if (!resume) return;
          setPlan(resume.brain.plan);
          setResuming(true);
          setDifficulty(resume.brain.difficulty);
        }}
        onStart={(picked) => {
          setResuming(false);
          setDifficulty(picked);
        }}
        onHelp={() => setHelpOpen(true)}
        onBack={() => router.push("/")}
        helpOpen={helpOpen}
        onCloseHelp={() => setHelpOpen(false)}
      />
    );
  }

  return (
    <SoloMatch
      difficulty={difficulty}
      resume={resuming ? resume : null}
      plan={plan === "surprise" ? undefined : plan}
      onExit={() => router.push("/")}
    />
  );
}

function SoloMatch({
  difficulty,
  resume,
  plan,
  onExit,
}: {
  difficulty: Difficulty;
  resume?: SoloSave | null;
  plan?: Plan;
  onExit(): void;
}) {
  const controller = useSoloMatch({ difficulty, plan, resume });
  const state = controller.state;
  // Restart reuses this component with a new match id, so the guard is keyed by
  // id rather than a bare "already done" flag.
  const recorded = useRef<string | null>(null);

  useEffect(() => {
    if (!state || state.status !== "finished" || !state.winner) return;
    if (recorded.current === state.id) return;
    recorded.current = state.id;
    const you = state.players[controller.side];
    recordSoloResult({
      matchId: state.id,
      difficulty,
      outcome:
        state.winner === "draw" ? "draw" : state.winner === controller.side ? "win" : "loss",
      rounds: state.round,
      hpLeft: Math.max(0, you?.hp ?? 0),
    });
  }, [state, controller.side, difficulty]);

  return <MatchScreen key={state?.id ?? "loading"} controller={controller} onExit={onExit} />;
}

function SoloSetup({
  plan,
  onPlan,
  resume,
  onResume,
  onStart,
  onHelp,
  onBack,
  helpOpen,
  onCloseHelp,
}: {
  plan: Plan | "surprise";
  onPlan(plan: Plan | "surprise"): void;
  resume: SoloSave | null;
  onResume(): void;
  onStart(difficulty: Difficulty): void;
  onHelp(): void;
  onBack(): void;
  helpOpen: boolean;
  onCloseHelp(): void;
}) {
  // Read after mount, never during render: this page is prerendered to static
  // HTML, and localStorage does not exist when that HTML is built.
  const [record, setRecord] = useState<SoloRecord>(emptyRecord);
  useEffect(() => setRecord(loadRecord()), []);

  // Nudge from the highest tier you are clearly winning, so a good player is
  // pointed at Expert rather than back at Medium.
  const nudge = (() => {
    for (let i = DIFFICULTIES.length - 1; i >= 0; i -= 1) {
      const from = DIFFICULTIES[i];
      const to = suggestStepUp(record, from);
      if (to) return { from, to };
    }
    return null;
  })();

  return (
    <>
      <div className="hud">
        <div className="scroll-y fade-edges flex-1">
          <div className="mx-auto flex w-full max-w-[30rem] flex-col gap-4 px-4 pb-10 pt-6">
            <div className="flex items-center gap-2">
              <Button tone="ghost" size="sm" onClick={onBack}>
                ‹ Back to {NOUN.home}
              </Button>
              <span className="flex-1" />
              <Button tone="ghost" size="sm" onClick={onHelp}>
                How to play
              </Button>
            </div>

            <header>
              <p className="t-eyebrow">Solo</p>
              <h1 className="t-display text-3xl">How hard?</h1>
            </header>

            {resume ? (
              <button type="button" onClick={onResume} className="w-full text-left">
                <Panel className="flex items-center gap-4 p-4 transition hover:border-white/25">
                  <span className="min-w-0 flex-1">
                    <span className="t-display block text-xl text-white">Carry on</span>
                    <span className="mt-0.5 block text-sm leading-snug c-dim">
                      Your saved battle — round {resume.state.round} on{" "}
                      {DIFFICULTY[resume.brain.difficulty].label} against{" "}
                      {PLAN_LABEL[resume.brain.plan]}. Or pick a level below to start fresh.
                    </span>
                  </span>
                  <span className="c-dim" aria-hidden>
                    ›
                  </span>
                </Panel>
              </button>
            ) : null}

            {nudge ? (
              <p className="solo-nudge">
                You are winning on {DIFFICULTY[nudge.from].label}. Try{" "}
                <strong>{DIFFICULTY[nudge.to].label}</strong>?
              </p>
            ) : null}

            <div className="flex flex-col gap-2.5">
              {DIFFICULTIES.map((key) => {
                const entry = DIFFICULTY[key];
                return (
                  <button key={key} type="button" onClick={() => onStart(key)} className="w-full text-left">
                    <Panel className="flex items-center gap-4 p-4 transition hover:border-white/25">
                      <span className="min-w-0 flex-1">
                        <span className="t-display block text-xl text-white">{entry.label}</span>
                        <span className="mt-0.5 block text-sm leading-snug c-dim">
                          {entry.blurb}
                        </span>
                      </span>
                      <TierRecord tier={record.tiers[key]} />
                      <span className="c-dim" aria-hidden>
                        ›
                      </span>
                    </Panel>
                  </button>
                );
              })}
            </div>

            <header className="pt-2">
              <p className="t-eyebrow">How it fights — optional</p>
            </header>

            <div className="flex flex-col gap-2.5">
              <PlanRow
                active={plan === "surprise"}
                title="Surprise me"
                blurb="A different plan every game. You will not know what it is building until you see it."
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
            </div>
          </div>
        </div>
      </div>
      <HowToPlaySheet open={helpOpen} onClose={onCloseHelp} />
    </>
  );
}

/** Your win-loss on one tier. Silent until you have actually played it. */
function TierRecord({ tier }: { tier?: import("@/lib/record").TierRecord }) {
  if (played(tier) === 0 || !tier) return null;
  const rate = winRate(tier);
  return (
    <span
      className="solo-record"
      aria-label={`Your record: ${tier.wins} won, ${tier.losses} lost`}
    >
      <span className="solo-record-wl">
        {tier.wins}–{tier.losses}
      </span>
      {rate === null ? null : (
        <span className="solo-record-rate">{Math.round(rate * 100)}%</span>
      )}
    </span>
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
    <button type="button" onClick={onClick} className="w-full text-left">
      <Panel
        className={`flex items-center gap-4 p-4 transition ${
          active ? "border-[--color-energy]/45 bg-[--color-energy]/[0.08]" : "hover:border-white/25"
        }`}
      >
        <span className="min-w-0 flex-1">
          <span className="t-display block text-xl text-white">{title}</span>
          <span className="mt-0.5 block text-sm leading-snug c-dim">{blurb}</span>
        </span>
        <span
          className={`t-eyebrow shrink-0 text-xs ${active ? "c-energy" : "c-dim"}`}
          aria-hidden
        >
          {active ? "On" : "Pick"}
        </span>
      </Panel>
    </button>
  );
}
