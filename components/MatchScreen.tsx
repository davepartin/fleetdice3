"use client";

/**
 * A match, from the shipyard to the last volley.
 *
 * The 3D arena underneath owns the dice; this owns the decisions. It watches
 * the phase the player is in and shows exactly the one thing they can do next,
 * because the fastest way to lose someone in a dice game is two buttons that
 * both look important.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import {
  TUNING,
  activeShips,
  bestRun,
  cellForSlot,
  previewTally,
  type MatchAction,
  type PlayerState,
} from "@/lib/engine";
import { rollHint } from "@/lib/ai";
import { FLAGSHIP_FACES } from "@/lib/reference";
import type { MatchController } from "@/lib/useMatch";
import { createArena, type Arena, type Focus } from "@/lib/three/arena";
import { waitForFonts } from "@/lib/three/fonts";
import { audio } from "@/lib/audio";
import { Button, Chip, HealthBar, Notice, Stat, Ticker } from "./ui";
import { HowToPlaySheet } from "./HowToPlay";
import { Shipyard } from "./Shipyard";
import { RoundReportCard } from "./RoundReport";

type Props = {
  controller: MatchController;
  onExit(): void;
  title?: string;
  subtitle?: string;
};

export function MatchScreen({ controller, onExit, title, subtitle }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const arenaRef = useRef<Arena | null>(null);
  const [arenaReady, setArenaReady] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [helpOpen, setHelpOpen] = useState(false);
  const [muted, setMuted] = useState(false);
  const [shake, setShake] = useState(false);
  /**
   * A held beat with the dock out of the way, so the reveal and the volley
   * actually get watched. Without it the report panel slides up over the board
   * the instant both sides lock in, and the best moment in the game happens
   * behind a wall of text.
   */
  const [cinematic, setCinematic] = useState<null | "reveal" | "volley">(null);
  /** Dice the player just sent back, so they animate even on the same number. */
  const thrownRef = useRef<Set<string>>(new Set());

  const { state, you, them, act, busy, error, clearError, waitingOnEnemy } = controller;
  const phase = you?.phase ?? "waiting";

  /* --------------------------------------------------------------- */
  /* The arena                                                        */
  /* --------------------------------------------------------------- */

  const toggleDie = useCallback((shipId: string) => {
    if (shipId === "flag") return;
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(shipId)) {
        next.delete(shipId);
        audio.play("dice-deselect");
      } else {
        next.add(shipId);
        audio.play("dice-select");
      }
      return next;
    });
  }, []);

  const toggleRef = useRef(toggleDie);
  toggleRef.current = toggleDie;
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const braceRef = useRef<(id: string) => void>(() => {});

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;

    (async () => {
      await waitForFonts();
      if (cancelled || !canvasRef.current) return;
      // `?q=low` lets the screenshot harness and a slow phone skip the
      // expensive tiers outright instead of discovering they need to.
      const forced = new URLSearchParams(window.location.search).get("q");
      const arena = createArena(canvasRef.current, {
        quality:
          forced === "low" || forced === "medium" || forced === "high" ? forced : undefined,
        onTapDie: (shipId) => {
          if (phaseRef.current === "rolling") toggleRef.current(shipId);
          else if (phaseRef.current === "brace") braceRef.current(shipId);
        },
      });
      arenaRef.current = arena;
      setArenaReady(true);
    })();

    return () => {
      cancelled = true;
      arenaRef.current?.dispose();
      arenaRef.current = null;
    };
  }, []);

  /* Keep the board in step with the rules ---------------------------- */

  const firstSyncRef = useRef(true);
  useEffect(() => {
    const arena = arenaRef.current;
    if (!arena || !state) return;
    arena.sync(state, controller.side, {
      instant: firstSyncRef.current,
      selected,
      revealEnemy: phase === "brace" || phase === "report" || phase === "over",
      thrown: thrownRef.current,
    });
    thrownRef.current = new Set();
    firstSyncRef.current = false;
  }, [state, selected, phase, controller.side, arenaReady]);

  /* Point the camera at whatever matters right now ------------------- */

  useEffect(() => {
    const arena = arenaRef.current;
    if (!arena) return;
    const focus: Focus =
      phase === "shop"
        ? "fleet"
        : phase === "brace" || phase === "report"
          ? "both"
          : phase === "over"
            ? "wide"
            : phase === "submitted"
              ? "both"
              : "fleet";
    arena.setFocus(focus);
  }, [phase, arenaReady]);

  /* Sound ------------------------------------------------------------ */

  useEffect(() => {
    audio.unlock();
    setMuted(audio.muted);
    audio.ambient.start();
    return () => audio.ambient.stop();
  }, []);

  useEffect(() => {
    if (!you || !them) return;
    const worst = Math.min(you.hp, them.hp) / Math.max(1, you.maxHp);
    audio.ambient.setIntensity(1 - worst);
  }, [you, them]);

  /* Hold the board clear while the enemy's dice land ------------------ */

  const lastPhaseRef = useRef(phase);
  useEffect(() => {
    const previous = lastPhaseRef.current;
    lastPhaseRef.current = phase;
    if (previous === "submitted" && (phase === "brace" || phase === "report")) {
      setCinematic(phase === "report" ? "volley" : "reveal");
      const hold = phase === "report" ? 2400 : 1500;
      const timer = window.setTimeout(() => setCinematic(null), hold);
      return () => window.clearTimeout(timer);
    }
    if (phase !== "brace" && phase !== "report") setCinematic(null);
  }, [phase]);

  /* The volley — play it once per round, when the report appears ------ */

  const shownRoundRef = useRef(-1);
  useEffect(() => {
    const arena = arenaRef.current;
    if (!arena || !you?.report) return;
    const report = you.report;
    if (report.round === shownRoundRef.current) return;
    shownRoundRef.current = report.round;

    const enemyFlag = arena.flagshipWorld("enemy");
    const yourFlag = arena.flagshipWorld("you");

    // Your shot goes out first, then theirs comes back. Two beats, not one.
    const yourAttack = (you.tally?.attack ?? 0) + report.escalation;
    const yourDirect = you.tally?.direct ?? 0;

    audio.play("volley");
    void arena.vfx.volley({ from: yourFlag, to: enemyFlag, amount: yourAttack, kind: "attack" });
    if (yourDirect > 0) {
      window.setTimeout(() => {
        void arena.vfx.volley({ from: yourFlag, to: enemyFlag, amount: yourDirect, kind: "direct" });
      }, 260);
    }

    window.setTimeout(() => {
      const incoming = report.incoming;
      const direct = report.direct;
      audio.play("volley", { pitch: 0.92 });
      void arena.vfx
        .volley({ from: enemyFlag, to: yourFlag, amount: incoming, kind: "attack" })
        .then(() => {
          if (report.soaked > 0) arena.vfx.shieldBlock(yourFlag, report.soaked);
          if (report.damage > 0) {
            arena.vfx.impact(yourFlag, report.damage, "attack");
            audio.play(report.damage > 12 ? "impact-heavy" : "impact-light");
            setShake(true);
            window.setTimeout(() => setShake(false), 560);
          } else {
            audio.play("shield-block");
          }
          if (direct > 0) arena.vfx.impact(yourFlag, direct, "direct");
          if (report.repair > 0) {
            window.setTimeout(() => {
              arena.vfx.repair(yourFlag, report.repair);
              audio.play("repair");
            }, 420);
          }
        });
    }, 700);

    // Formations and straights get their own moment.
    for (const line of you.tally?.lines ?? []) {
      const points = line.idx.map((cell) => arena.cellWorld("you", cell));
      arena.vfx.formation(points, line.kind);
      audio.play(line.kind === "row" ? "formation-row" : "formation-column");
    }
    if (you.tally?.run) {
      const run = you.tally.run;
      const points = you.dice
        .filter((die) => die.value >= run.start && die.value <= run.top)
        .sort((a, b) => a.value - b.value)
        .map((die) =>
          arena.cellWorld("you", die.flag ? 4 : cellForSlot(die.slot ?? 0)),
        );
      arena.vfx.straightSweep(points, run.taken);
      audio.play("straight");
    }
  }, [you]);

  /* Victory / defeat -------------------------------------------------- */

  const finishedRef = useRef(false);
  useEffect(() => {
    if (state?.status !== "finished" || finishedRef.current) return;
    finishedRef.current = true;
    const arena = arenaRef.current;
    const won = state.winner === controller.side;
    audio.play(won ? "victory" : "defeat");
    if (arena) {
      const loser = won ? "enemy" : "you";
      void arena.vfx.flagshipBreak(arena.flagshipWorld(loser));
      arena.stage.shake(1.3);
      arena.stage.flash(won ? 0x45e08b : 0xff4d4d, 0.6);
    }
  }, [state?.status, state?.winner, controller.side]);

  /* --------------------------------------------------------------- */
  /* Actions                                                          */
  /* --------------------------------------------------------------- */

  const send = useCallback(
    (action: MatchAction) => {
      act(action);
    },
    [act],
  );

  const rollAll = () => {
    audio.play("dice-throw");
    thrownRef.current = new Set(you?.ships.map((ship) => ship.id) ?? []);
    thrownRef.current.add("flag");
    setSelected(new Set());
    send({ type: "roll", dice: [] });
  };

  const rerollSelected = () => {
    if (!selected.size) return;
    audio.play("reroll");
    const ids = [...selected];
    thrownRef.current = new Set(ids);
    setSelected(new Set());
    send({ type: "roll", dice: ids });
  };

  const [braceShips, setBraceShips] = useState<Set<string>>(new Set());
  braceRef.current = (shipId: string) => {
    setBraceShips((current) => {
      const next = new Set(current);
      if (next.has(shipId)) next.delete(shipId);
      else next.add(shipId);
      audio.play("dice-select");
      return next;
    });
  };
  useEffect(() => {
    if (phase !== "brace") setBraceShips(new Set());
  }, [phase]);

  /* --------------------------------------------------------------- */

  const tally = useMemo(
    () => (you && you.dice.length ? previewTally(you) : null),
    [you],
  );
  const hint = useMemo(
    () => (state && phase === "rolling" ? rollHint(state, controller.side) : null),
    [state, phase, controller.side],
  );

  // The canvas must exist on the very first paint. An earlier version returned
  // a loading screen before it, so the effect that builds the arena found no
  // canvas, bailed, and — with an empty dependency list — never tried again.
  // The board silently never appeared.
  if (!state || !you) {
    return (
      <>
        <canvas ref={canvasRef} className="stage-canvas" />
        <div className="hud items-center justify-center">
          <p className="c-dim">Setting up the battlefield…</p>
        </div>
      </>
    );
  }

  const enemyName = them?.name ?? "Enemy";
  const rollsLeft = TUNING.rollsPerRound - you.rolls;
  const rerollCost = you.rolls >= TUNING.rollsPerRound ? selected.size : 0;

  return (
    <>
      <canvas ref={canvasRef} className="stage-canvas" />

      <div className={`hud ${shake ? "anim-shake" : ""}`}>
        {/* ---------------- top ---------------- */}
        <header className="flex items-start gap-2 px-3 pt-3">
          <Button tone="ghost" size="sm" onClick={onExit} ariaLabel="Leave the match">
            ‹ Quit
          </Button>

          <div className="panel panel-enemy panel-flush min-w-0 flex-1 px-3 py-2">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-[0.8rem] font-semibold text-[--color-attack-glow]">
                {enemyName}
              </span>
              <span className="t-num text-[0.8rem] text-white">
                {them ? <Ticker value={them.hp} /> : 0}
                <span className="c-dim"> / {them?.maxHp ?? TUNING.hp}</span>
              </span>
            </div>
            <HealthBar className="mt-1.5" value={them?.hp ?? 0} max={them?.maxHp ?? TUNING.hp} />
          </div>

          <div className="flex flex-col gap-1.5">
            <Button tone="ghost" size="sm" onClick={() => setHelpOpen(true)} ariaLabel="How to play">
              ?
            </Button>
            <Button
              tone="ghost"
              size="sm"
              ariaLabel={muted ? "Turn sound on" : "Turn sound off"}
              onClick={() => {
                audio.unlock();
                setMuted(audio.toggleMuted());
              }}
            >
              {muted ? "🔇" : "🔊"}
            </Button>
          </div>
        </header>

        <div className="flex items-center justify-center gap-2 pt-2">
          <Chip>Round {you.round}</Chip>
          {you.round > TUNING.escalateAfterRound && (
            <Chip tone="attack">War escalating +{(you.round - TUNING.escalateAfterRound) * TUNING.escalateStep}</Chip>
          )}
          {controller.mode === "versus" && <Chip>Room {state.code}</Chip>}
        </div>

        {/* ---------------- middle: the board shows through ---------------- */}
        <div className="hud-pass-through min-h-0 flex-1" />

        {/* ---------------- bottom ---------------- */}
        <div className="mx-auto w-full max-w-[44rem] px-2 pb-2">
          {error && (
            <Notice tone="warn" className="mb-2">
              {error}{" "}
              <button type="button" className="underline underline-offset-2" onClick={clearError}>
                Got it
              </button>
            </Notice>
          )}

          {cinematic ? (
            <RevealBanner
              kind={cinematic}
              you={you}
              them={them}
              onSkip={() => setCinematic(null)}
            />
          ) : phase === "shop" ? (
            <div className="panel panel-you flex max-h-[74dvh] flex-col p-4">
              <Shipyard
                player={you}
                onAction={(action) => {
                  audio.play("shop-buy");
                  send(action);
                }}
                onDone={() => {
                  audio.play("button-major");
                  send({ type: "ready" });
                }}
                busy={busy}
              />
            </div>
          ) : phase === "report" && you.report ? (
            <div className="panel panel-you flex max-h-[74dvh] flex-col p-4">
              <RoundReportCard
                report={you.report}
                you={you}
                enemyName={enemyName}
                busy={busy}
                onContinue={() => {
                  audio.play("button-major");
                  send({ type: "continue" });
                }}
              />
            </div>
          ) : phase === "brace" ? (
            <BraceDock
              you={you}
              chosen={braceShips}
              onToggle={(id) => braceRef.current(id)}
              onConfirm={() => {
                audio.play("ship-lost");
                send({ type: "brace", ships: [...braceShips] });
              }}
              busy={busy}
            />
          ) : phase === "over" ? (
            <ResultDock
              won={state.winner === controller.side}
              draw={state.winner === "draw"}
              you={you}
              enemyName={enemyName}
              onExit={onExit}
              onRestart={controller.restart}
            />
          ) : (
            <RollDock
              you={you}
              tally={tally}
              hint={hint}
              selected={selected}
              rollsLeft={rollsLeft}
              rerollCost={rerollCost}
              waiting={waitingOnEnemy}
              busy={busy}
              onRollAll={rollAll}
              onReroll={rerollSelected}
              onSubmit={() => {
                audio.play("button-major");
                send({ type: "submit" });
              }}
              onTake={(take) => send({ type: "straight-take", take })}
              onToken={(direction) => {
                audio.play("flagship-ring");
                send({ type: "flag-token", direction });
              }}
              onClearSelection={() => setSelected(new Set())}
            />
          )}
        </div>
      </div>

      <HowToPlaySheet open={helpOpen} onClose={() => setHelpOpen(false)} />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* The dock, one per phase                                             */
/* ------------------------------------------------------------------ */

function TallyStrip({ you, tally }: { you: PlayerState; tally: ReturnType<typeof previewTally> | null }) {
  return (
    <div className="grid grid-cols-5 gap-1 py-1">
      <Stat kind="attack" value={tally?.attack ?? 0} label="Attack" size="sm" />
      <Stat kind="shield" value={tally?.defense ?? 0} label="Shields" size="sm" />
      <Stat kind="direct" value={tally?.direct ?? 0} label="Direct" size="sm" />
      <Stat kind="repair" value={tally?.heal ?? 0} label="Repair" size="sm" />
      <Stat kind="energy" value={you.energy} label="Bank" size="sm" />
    </div>
  );
}

function YourHealth({ you }: { you: PlayerState }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="t-eyebrow">{you.name}</span>
        <span className="t-num text-[0.82rem] text-white">
          <Ticker value={you.hp} />
          <span className="c-dim"> / {you.maxHp}</span>
        </span>
      </div>
      <HealthBar className="mt-1.5" value={you.hp} max={you.maxHp} />
    </div>
  );
}

function RollDock({
  you,
  tally,
  hint,
  selected,
  rollsLeft,
  rerollCost,
  waiting,
  busy,
  onRollAll,
  onReroll,
  onSubmit,
  onTake,
  onToken,
  onClearSelection,
}: {
  you: PlayerState;
  tally: ReturnType<typeof previewTally> | null;
  hint: ReturnType<typeof rollHint>;
  selected: Set<string>;
  rollsLeft: number;
  rerollCost: number;
  waiting: boolean;
  busy: boolean;
  onRollAll(): void;
  onReroll(): void;
  onSubmit(): void;
  onTake(take: number): void;
  onToken(direction: -1 | 1): void;
  onClearSelection(): void;
}) {
  const notRolled = you.phase === "ready";
  const run = you.dice.length ? bestRun(you.dice) : null;
  const tiers = run
    ? Array.from(
        { length: Math.min(run.length, TUNING.runMax) - TUNING.runMin + 1 },
        (_, index) => TUNING.runMin + index,
      )
    : [];
  const chosenTake = you.straightTake ?? (run ? Math.min(run.length, TUNING.runMax) : 0);
  const canAffordReroll = rerollCost === 0 || you.energy >= rerollCost;

  return (
    <div className="panel panel-you flex flex-col gap-2.5 p-3.5">
      <YourHealth you={you} />
      <TallyStrip you={you} tally={tally} />

      {tiers.length > 1 && (
        <div className="rounded-xl border border-[--color-run]/30 bg-[--color-run]/[0.08] p-2.5">
          <p className="t-eyebrow mb-1.5 text-[--color-run]">
            Straight — cash it as
          </p>
          <div className="flex flex-wrap gap-1.5">
            {tiers.map((take) => {
              const preview = previewTally(you, take);
              const reward = preview.run?.reward;
              return (
                <button
                  key={take}
                  type="button"
                  onClick={() => onTake(take)}
                  className={`rounded-lg border px-2.5 py-1.5 text-[0.72rem] font-semibold transition ${
                    take === chosenTake
                      ? "border-[--color-run] bg-[--color-run]/25 text-white"
                      : "border-white/12 text-[--color-hull-300] hover:bg-white/[0.06]"
                  }`}
                >
                  {take} in a row
                  <span className="ml-1.5 opacity-80">{reward?.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {hint && (
        <p
          className={`text-[0.8rem] leading-snug ${
            hint.tone === "good"
              ? "c-repair"
              : hint.tone === "warn"
                ? "c-attack"
                : "c-dim"
          }`}
        >
          {hint.text}
        </p>
      )}

      {you.dice.length > 0 && <FlagshipLine you={you} />}

      {you.flag.token && you.phase === "rolling" && (
        <div className="flex items-center gap-2">
          <span className="t-eyebrow flex-1">Flagship token</span>
          <Button tone="ghost" size="sm" onClick={() => onToken(-1)} disabled={busy}>
            −1
          </Button>
          <Button tone="ghost" size="sm" onClick={() => onToken(1)} disabled={busy}>
            +1
          </Button>
        </div>
      )}

      {waiting ? (
        <div className="flex items-center justify-center gap-3 py-2">
          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-white/80" />
          <span className="text-sm c-dim">Locked in. Waiting for the enemy…</span>
        </div>
      ) : notRolled ? (
        <Button tone="primary" size="lg" full onClick={onRollAll} disabled={busy}>
          Roll your fleet
        </Button>
      ) : (
        <div className="flex gap-2">
          {selected.size > 0 ? (
            <>
              <Button tone="ghost" size="lg" onClick={onClearSelection} disabled={busy}>
                Clear
              </Button>
              <Button
                tone={rerollCost ? "energy" : "primary"}
                size="lg"
                full
                onClick={onReroll}
                disabled={busy || !canAffordReroll}
              >
                Reroll {selected.size}
                {rerollCost ? ` · ${rerollCost}⚡` : rollsLeft > 0 ? " · free" : ""}
              </Button>
            </>
          ) : (
            <>
              <Button tone="confirm" size="lg" full onClick={onSubmit} disabled={busy}>
                Lock in
              </Button>
            </>
          )}
        </div>
      )}

      {you.phase === "rolling" && selected.size === 0 && (
        <p className="text-center text-[0.76rem] c-dim">
          Tap any die to send it back.{" "}
          {rollsLeft > 0
            ? `${rollsLeft} free ${rollsLeft === 1 ? "roll" : "rolls"} left.`
            : "Extra rolls cost 1 Energy a die."}
        </p>
      )}
    </div>
  );
}

function BraceDock({
  you,
  chosen,
  onToggle,
  onConfirm,
  busy,
}: {
  you: PlayerState;
  chosen: Set<string>;
  onToggle(id: string): void;
  onConfirm(): void;
  busy: boolean;
}) {
  const available = activeShips(you, you.round);
  const soak = available
    .filter((ship) => chosen.has(ship.id))
    .reduce((sum, ship) => sum + ship.sides, 0);
  const landing = Math.max(0, you.incoming - soak) + you.directIncoming;
  const after = you.hp - landing + (you.tally?.heal ?? 0);
  const fatal = after <= 0;

  return (
    <div className="panel panel-you flex flex-col gap-3 p-3.5">
      <div>
        <p className="t-eyebrow">Incoming</p>
        <h2 className="t-display text-2xl">
          <span className="c-attack">{you.incoming}</span>
          <span className="c-dim text-base"> blockable</span>
          {you.directIncoming > 0 && (
            <>
              {" "}
              <span className="c-direct">{you.directIncoming}</span>
              <span className="c-dim text-base"> direct</span>
            </>
          )}
        </h2>
        <p className="mt-1 text-[0.84rem] leading-snug c-dim">
          Throw ships in front of it. Each one soaks its own size and sits out the next round.
          Nothing stops Direct.
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {available.map((ship) => {
          const picked = chosen.has(ship.id);
          return (
            <button
              key={ship.id}
              type="button"
              onClick={() => onToggle(ship.id)}
              className={`t-num rounded-lg border px-3 py-2 text-sm transition ${
                picked
                  ? "border-[--color-shield] bg-[--color-shield]/20 text-white"
                  : "border-white/12 text-[--color-hull-300] hover:bg-white/[0.06]"
              }`}
            >
              d{ship.sides}
              <span className="ml-1 text-[0.66rem] opacity-70">cell {cellForSlot(ship.slot) + 1}</span>
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/30 px-3 py-2.5">
        <div className="text-[0.8rem] c-dim">
          Soaked <b className="c-shield t-num">{Math.min(soak, you.incoming)}</b> · landing{" "}
          <b className="c-attack t-num">{landing}</b>
        </div>
        <div className="t-num text-right text-sm">
          <span className={fatal ? "c-attack" : "text-white"}>{Math.max(0, after)}</span>
          <span className="c-dim"> / {you.maxHp}</span>
        </div>
      </div>

      {fatal && (
        <Notice tone="warn">
          This volley finishes your flagship even with everything in front of it.
        </Notice>
      )}

      <Button tone={fatal ? "primary" : "confirm"} size="lg" full onClick={onConfirm} disabled={busy}>
        {chosen.size === 0 ? "Take it on the flagship" : `Send ${chosen.size} in front`}
      </Button>
    </div>
  );
}

function ResultDock({
  won,
  draw,
  you,
  enemyName,
  onExit,
  onRestart,
}: {
  won: boolean;
  draw: boolean;
  you: PlayerState;
  enemyName: string;
  onExit(): void;
  onRestart?(): void;
}) {
  return (
    <div className="panel panel-you anim-rise flex flex-col gap-3 p-5">
      <div className="text-center">
        <p className="t-eyebrow">{draw ? "Both flagships fell" : won ? "Victory" : "Defeat"}</p>
        <h2 className={`t-display text-4xl ${won ? "c-repair" : draw ? "text-white" : "c-attack"}`}>
          {draw ? "A draw" : won ? `You beat ${enemyName}` : `${enemyName} wins`}
        </h2>
      </div>

      <div className="grid grid-cols-4 gap-1 border-y border-white/10 py-3">
        <Stat kind="attack" value={you.stats.damageDealt} label="Damage" size="sm" />
        <Stat kind="direct" value={you.stats.directDealt} label="Direct" size="sm" />
        <Stat kind="repair" value={you.stats.repaired} label="Repaired" size="sm" />
        <Stat kind="run" value={you.stats.straights} label="Straights" size="sm" />
      </div>

      <div className="flex gap-2">
        <Button tone="ghost" size="lg" full onClick={onExit}>
          Home
        </Button>
        {onRestart && (
          <Button tone="primary" size="lg" full onClick={onRestart}>
            Again
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * The held beat. Small enough to leave the board visible, loud enough to say
 * what just happened, and tappable so nobody has to sit through it twice.
 */
function RevealBanner({
  kind,
  you,
  them,
  onSkip,
}: {
  kind: "reveal" | "volley";
  you: PlayerState;
  them: PlayerState | null;
  onSkip(): void;
}) {
  const incoming = you.incoming + you.directIncoming;
  const outgoing = (you.tally?.attack ?? 0) + (you.tally?.direct ?? 0);

  return (
    <button type="button" onClick={onSkip} className="block w-full text-left">
      <div className="panel anim-slam flex items-center justify-between gap-4 px-4 py-3">
        <div>
          <p className="t-eyebrow">{kind === "reveal" ? "Both fleets are showing" : "Volley away"}</p>
          <p className="t-display text-xl text-white">
            You fired <span className="c-attack">{outgoing}</span>
            {them && <span className="c-dim text-base"> · {them.name} fired {incoming}</span>}
          </p>
        </div>
        <span className="t-eyebrow shrink-0 text-[0.58rem]">Tap to skip</span>
      </div>
    </button>
  );
}

/**
 * What the flagship is doing this round, in one line.
 *
 * The die in the middle of the board shows several of its faces at once, so
 * which one is actually counting is genuinely ambiguous from the art alone.
 * This says it in words.
 */
function FlagshipLine({ you }: { you: PlayerState }) {
  const face = FLAGSHIP_FACES.find((entry) => entry.face === you.flag.face);
  if (!face) return null;
  const level = face.levels[Math.min(2, Math.max(0, you.flag.level - 1))];
  return (
    <div className="flex items-center gap-2 rounded-xl border border-[--color-energy]/25 bg-[--color-energy]/[0.07] px-3 py-2">
      <span className="t-num shrink-0 rounded-md bg-[--color-energy]/20 px-2 py-0.5 text-sm c-energy">
        {face.face}
      </span>
      <span className="min-w-0 text-[0.8rem] leading-snug">
        <b className="c-energy">{face.name}</b>
        <span className="c-dim"> — {level?.text ?? face.short}</span>
      </span>
    </div>
  );
}
