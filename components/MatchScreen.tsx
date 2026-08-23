"use client";

/**
 * A match, from the shipyard to the last volley.
 *
 * Solo and versus both render this screen. Board, HUD, dice throws, and phone
 * layout changes belong here (or in the engine) so both modes stay in step.
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
  escalationFor,
  flagBonusSize,
  previewTally,
  runMemberIds,
  straightPrizeTakes,
  type MatchAction,
  type PlayerState,
  type Straight,
} from "@/lib/engine";
import { rollHint } from "@/lib/ai";
import { FLAGSHIP_FACES, NOUN, STAT_LABEL } from "@/lib/reference";
import { isPhoneLayout } from "@/lib/viewport";
import type { MatchController } from "@/lib/useMatch";
import { pendingThrow, pendingThrowReady, type PendingThrow } from "@/lib/throwSync";
import { createArena, type Arena, type Focus } from "@/lib/three/arena";
import { waitForFonts } from "@/lib/three/fonts";
import { audio } from "@/lib/audio";
import { Button, Chip, HealthBar, Notice, Sheet, Stat, Ticker } from "./ui";
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
  const headerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const arenaRef = useRef<Arena | null>(null);
  const [arenaReady, setArenaReady] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [braceShips, setBraceShips] = useState<Set<string>>(new Set());
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
  const [leaveOpen, setLeaveOpen] = useState(false);
  /**
   * The straight's board lights stay off until the dice land, so the run
   * arriving is one 700ms beat instead of a glow that appears mid-throw.
   */
  const [runMarksOn, setRunMarksOn] = useState(false);
  const straightEventRef = useRef("");
  /**
   * Dice the player just sent back. Held until the new numbers actually
   * arrive — otherwise solo and versus both toss the old faces, then toss again.
   */
  const pendingThrowRef = useRef<PendingThrow | null>(null);

  const { state, you, them, act, busy, error, clearError, waitingOnEnemy, cancel } = controller;
  const youRef = useRef(you);
  youRef.current = you;
  const phase = you?.phase ?? "waiting";
  const tally = useMemo(
    () => (you && you.dice.length ? previewTally(you) : null),
    [you],
  );

  /* --------------------------------------------------------------- */
  /* The arena                                                        */
  /* --------------------------------------------------------------- */

  const toggleDie = useCallback((shipId: string) => {
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

  /* Frame the 3D fleet inside the phone pixels the HUD actually leaves free. */
  useEffect(() => {
    const arena = arenaRef.current;
    const header = headerRef.current;
    const bottom = bottomRef.current;
    if (!arena || !header || !bottom) return;

    const updateInsets = () => {
      if (!isPhoneLayout()) {
        arena.stage.setViewportInsets({ top: 0, right: 0, bottom: 0, left: 0 });
        return;
      }
      // offsetHeight is layout pixels, matching the canvas backing size. Visual
      // rectangles move when the address bar or a pinch-zoom shifts the screen.
      const top = Math.max(0, header.offsetHeight + 10);
      const bottomInset = Math.max(0, bottom.offsetHeight + 14);
      arena.stage.setViewportInsets({ top, right: 3, bottom: bottomInset, left: 3 });
    };

    const observer = new ResizeObserver(updateInsets);
    observer.observe(header);
    observer.observe(bottom);
    window.addEventListener("resize", updateInsets);
    window.addEventListener("fd3-viewport", updateInsets as EventListener);
    window.visualViewport?.addEventListener("resize", updateInsets);
    window.visualViewport?.addEventListener("scroll", updateInsets);
    updateInsets();

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateInsets);
      window.removeEventListener("fd3-viewport", updateInsets as EventListener);
      window.visualViewport?.removeEventListener("resize", updateInsets);
      window.visualViewport?.removeEventListener("scroll", updateInsets);
    };
  }, [arenaReady, controller.mode]);

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
        mode: controller.mode,
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
  }, [controller.mode]);

  /* Keep the board in step with the rules ---------------------------- */

  const firstSyncRef = useRef(true);
  useEffect(() => {
    const arena = arenaRef.current;
    if (!arena || !state) return;
    const pending = pendingThrowRef.current;
    const throwReady = pendingThrowReady(pending, you);
    arena.sync(state, controller.side, {
      instant: firstSyncRef.current,
      selected,
      damageSelected: phase === "brace" ? braceShips : undefined,
      previewTally: tally,
      revealEnemy: phase === "brace" || phase === "report" || phase === "over",
      thrown: throwReady ? pending?.ids : undefined,
      showRunMarks: phase !== "rolling" || runMarksOn,
    });
    if (throwReady) pendingThrowRef.current = null;
    firstSyncRef.current = false;
  }, [state, you, selected, braceShips, phase, controller.side, arenaReady, tally, runMarksOn]);

  /* The straight is an event — lights and prize cards after the dice land */

  const diceFingerprint = you?.dice.map((die) => `${die.id}:${die.value}`).join(",") ?? "";
  useEffect(() => {
    const current = youRef.current;
    if (!current) return;
    const run = current.dice.length ? bestRun(current.dice) : null;
    const key = run ? `${run.start}:${run.top}:${run.length}:${diceFingerprint}` : "";

    if (phase !== "rolling") {
      if (phase === "ready" || phase === "shop") {
        straightEventRef.current = "";
        setRunMarksOn(false);
      } else {
        setRunMarksOn(Boolean(run));
      }
      return;
    }

    if (!run) {
      straightEventRef.current = "";
      setRunMarksOn(false);
      return;
    }

    if (straightEventRef.current === key) {
      setRunMarksOn(true);
      return;
    }

    let cancelled = false;
    setRunMarksOn(false);
    const arena = arenaRef.current;
    void (async () => {
      if (arena) await arena.whenSettled("you");
      if (cancelled) return;
      const live = youRef.current;
      if (!live) return;
      const liveRun = live.dice.length ? bestRun(live.dice) : null;
      if (!liveRun) return;
      straightEventRef.current = key;
      setRunMarksOn(true);
      if (!arena) return;
      const points = runWorldPoints(arena, live, liveRun);
      arena.vfx.straightSweep(points, liveRun.taken, 0.7);
      audio.play("straight");
    })();

    return () => {
      cancelled = true;
    };
  }, [diceFingerprint, phase, arenaReady]);

  /* Point the camera at whatever matters right now ------------------- */

  useEffect(() => {
    const arena = arenaRef.current;
    if (!arena) return;
    const focus: Focus =
      phase === "shop"
        ? "fleet"
        : phase === "report"
          ? "both"
          : phase === "over"
            ? "wide"
            : phase === "submitted"
              ? "both"
              // Brace is a decision about your own ships, not a look at the
              // enemy's — the wider "both" framing only made the dice you can
              // actually tap smaller and harder to read.
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

    // A ship that braced against a volley reacts on its own cell — a guard
    // ring, a hard white spark, then the colour draining out of it — instead
    // of just turning up flattened and grey once the next round syncs.
    const reactShips = (side: "you" | "enemy", player: PlayerState, braced: { id: string }[]) => {
      braced.forEach((entry, index) => {
        const ship = player.ships.find((candidate) => candidate.id === entry.id);
        if (!ship) return;
        const point = arena.cellWorld(side, cellForSlot(ship.slot));
        window.setTimeout(() => {
          arena.vfx.shipSacrifice(point);
          arena.nudgeShip(side, entry.id, 1.1);
          audio.play("impact-light", { pitch: 1.05 + index * 0.05 });
        }, index * 90);
      });
    };

    audio.play("volley");
    void arena.vfx
      .volley({ from: yourFlag, to: enemyFlag, amount: yourAttack, kind: "attack" })
      .then(() => {
        if (them?.report && them.report.round === report.round) {
          reactShips("enemy", them, them.report.bracedShips);
        }
      });
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
          reactShips("you", you, report.bracedShips);
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
      const members = runMemberIds(you.dice, run);
      const points = you.dice
        .filter((die) => members.has(die.id))
        .sort((a, b) => a.value - b.value)
        .map((die) =>
          arena.cellWorld("you", die.flag ? 4 : cellForSlot(die.slot ?? 0)),
        );
      arena.vfx.straightSweep(points, run.taken, 0.7);
      audio.play("straight");
    }
  }, [you, them]);

  /* Victory / defeat -------------------------------------------------- */

  const finishedRef = useRef(false);
  useEffect(() => {
    if (state?.status !== "finished" || finishedRef.current) return;
    finishedRef.current = true;
    if (state.cancelledBy) return;
    const arena = arenaRef.current;
    const won = state.winner === controller.side;
    audio.play(won ? "victory" : "defeat");
    if (arena) {
      const loser = won ? "enemy" : "you";
      // The default "over" framing is a wide establishing shot of both decks
      // — fine for reading the result, wrong for watching a flagship break.
      // Hold on the loser's own deck for the break, then widen once the
      // dust has settled (~1.5s, per vfx.flagshipBreak's own timing).
      arena.setFocus(loser === "you" ? "fleet" : "enemy", true);
      void arena.vfx.flagshipBreak(arena.flagshipWorld(loser)).then(() => {
        arena.setFocus("wide");
      });
      arena.stage.shake(1.3);
      arena.stage.flash(won ? 0x45e08b : 0xff4d4d, 0.6);
    }
  }, [state?.status, state?.winner, state?.cancelledBy, controller.side]);

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
    if (!you || busy || you.phase !== "ready") return;
    const ids = new Set(you.ships.map((ship) => ship.id));
    ids.add("flag");
    pendingThrowRef.current = pendingThrow(you, ids);
    audio.play("dice-throw");
    setSelected(new Set());
    send({ type: "roll", dice: [] });
  };

  const rerollSelected = () => {
    if (!you || busy || !selected.size || you.phase !== "rolling") return;
    const ids = [...selected];
    pendingThrowRef.current = pendingThrow(you, ids);
    audio.play("reroll");
    setSelected(new Set());
    send({ type: "roll", dice: ids });
  };

  braceRef.current = (shipId: string) => {
    if (shipId === "flag") return;
    if (!you || !activeShips(you, you.round).some((ship) => ship.id === shipId)) {
      audio.play("dice-deselect");
      return;
    }
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

      <div
        className={`hud match-hud match-hud-solo match-hud-${controller.mode} ${shake ? "anim-shake" : ""}`}
      >
        {/* ---------------- top ---------------- */}
        <div ref={headerRef} className="match-top">
          <header className="match-header flex items-start gap-2 px-3 pt-3">
          <Button
            tone="ghost"
            size="sm"
            className="match-leave"
            ariaLabel={`Back to ${NOUN.home}`}
            onClick={() => {
              if (cancel && state.status !== "finished") {
                setLeaveOpen(true);
                return;
              }
              onExit();
            }}
          >
            <span className="leave-label-full">‹ Back to {NOUN.home}</span>
            <span className="leave-label-short">‹ {NOUN.home}</span>
          </Button>

          <div className="panel panel-enemy panel-flush min-w-0 flex-1 px-3 py-2">
            <div className="flex items-baseline justify-between gap-2">
              <span className="min-w-0 flex-1 truncate text-sm font-semibold c-attack-glow">
                {enemyName}
              </span>
              <span className="t-eyebrow shrink-0 text-xs">Round {you.round}</span>
              <span className="t-num text-sm text-white">
                {them ? <Ticker value={Math.max(0, them.hp)} /> : 0}
                <span className="c-dim"> / {them?.maxHp ?? TUNING.hp}</span>
              </span>
            </div>
            <HealthBar className="mt-1.5" value={them?.hp ?? 0} max={them?.maxHp ?? TUNING.hp} />
          </div>

          <div className="match-desktop-utilities flex flex-col gap-1.5">
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
              <SoundIcon muted={muted} />
            </Button>
          </div>

          <details className="match-mobile-menu">
            <summary className="btn btn-ghost btn-sm" aria-label="Game menu">•••</summary>
            <div className="match-mobile-menu-popover panel">
              <button type="button" onClick={() => setHelpOpen(true)}>How to play</button>
              <button
                type="button"
                onClick={() => {
                  audio.unlock();
                  setMuted(audio.toggleMuted());
                }}
              >
                <SoundIcon muted={muted} />
                {muted ? "Sound off" : "Sound on"}
              </button>
            </div>
          </details>
          </header>

          {(you.round > TUNING.escalateAfterRound || controller.mode === "versus") && (
            <div className="flex items-center justify-center gap-2 pt-2">
              {you.round > TUNING.escalateAfterRound && (
                <Chip tone="attack">
                  War +{(you.round - TUNING.escalateAfterRound) * TUNING.escalateStep} to flagships
                </Chip>
              )}
              {controller.mode === "versus" && <Chip>Room {state.code}</Chip>}
            </div>
          )}
        </div>

        {/* ---------------- middle: the board shows through ---------------- */}
        <div className="hud-pass-through min-h-0 flex-1" />

        {/* ---------------- bottom ---------------- */}
        <div ref={bottomRef} className="match-bottom mx-auto w-full max-w-[44rem] px-2 pb-2">
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
            // The shipyard takes the whole screen. It is the only moment in a
            // round where you are reading nine prices at once, and squeezing
            // that into a dock under the board is what made it unreadable.
            <div className="yard-portal">
              <Shipyard
                player={you}
                enemyName={enemyName}
                enemyHp={them?.hp ?? 0}
                enemyMaxHp={them?.maxHp ?? TUNING.hp}
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
            <div className="round-report-panel panel panel-you flex max-h-[74dvh] min-h-0 flex-col overflow-hidden p-4">
              <RoundReportCard
                report={you.report}
                you={you}
                enemyName={enemyName}
                waitingForOpponent={them?.phase === "brace"}
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
              cancelledBy={state.cancelledBy ?? null}
              youCancelled={Boolean(state.cancelledBy && you.name === state.cancelledBy)}
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
              waitingName={enemyName}
              busy={busy}
              showPrizes={runMarksOn}
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
      <Sheet
        open={leaveOpen}
        onClose={() => setLeaveOpen(false)}
        title={`Leave this ${NOUN.game}?`}
        footer={
          <div className="flex flex-col gap-2">
            <Button
              tone="ghost"
              full
              onClick={() => {
                setLeaveOpen(false);
                onExit();
              }}
            >
              Back to {NOUN.home}
            </Button>
            <Button
              tone="primary"
              full
              disabled={busy}
              onClick={() => {
                setLeaveOpen(false);
                cancel?.();
                onExit();
              }}
            >
              Cancel {NOUN.game}
            </Button>
          </div>
        }
      >
        <p className="text-base leading-relaxed c-dim-bright">
          <b className="text-white">Back to {NOUN.home}</b> leaves this screen. The {NOUN.game} stays open —
          open it again from Your {NOUN.games}.
        </p>
        <p className="mt-3 text-base leading-relaxed c-dim-bright">
          <b className="text-white">Cancel {NOUN.game}</b> ends it for both of you. The four-digit code
          dies, and neither of you can come back to this battle.
        </p>
      </Sheet>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* The dock, one per phase                                             */
/* ------------------------------------------------------------------ */

function TallyStrip({ tally }: { tally: ReturnType<typeof previewTally> | null }) {
  return (
    <div className="tally-strip grid gap-1">
      <div className="tally-cell tally-cell-attack">
        <Stat
          kind="attack"
          value={tally?.attack ?? 0}
          label="Attack"
          size="lg"
          showGlyph={false}
          colorLabel
        />
      </div>
      <div className="tally-cell tally-cell-shield">
        <Stat
          kind="shield"
          value={tally?.defense ?? 0}
          label="Shields"
          size="lg"
          showGlyph={false}
          colorLabel
        />
      </div>
      <div className="tally-cell tally-cell-direct">
        <Stat
          kind="direct"
          value={tally?.direct ?? 0}
          label="Direct"
          showGlyph={false}
          colorLabel
        />
      </div>
      <div className="tally-cell tally-cell-repair">
        <Stat
          kind="repair"
          value={tally?.heal ?? 0}
          label="Repair"
          showGlyph={false}
          colorLabel
        />
      </div>
      <div className="tally-cell tally-cell-energy">
        <Stat
          kind="energy"
          value={tally?.energy ?? 0}
          label="Energy"
          showGlyph={false}
          colorLabel
        />
      </div>
    </div>
  );
}

function runWorldPoints(arena: Arena, you: PlayerState, run: Straight) {
  const members = runMemberIds(you.dice, run);
  return you.dice
    .filter((die) => members.has(die.id))
    .sort((a, b) => a.value - b.value)
    .map((die) => arena.cellWorld("you", die.flag ? 4 : cellForSlot(die.slot ?? 0)));
}

function StraightPrizes({
  you,
  run,
  prizes,
  chosenTake,
  onTake,
}: {
  you: PlayerState;
  run: Straight;
  prizes: number[];
  chosenTake: number;
  onTake(take: number): void;
}) {
  const choosable = prizes.length > 1;
  return (
    <section className="straight-choice" aria-label="Straight reward">
      <div className="straight-choice-heading">
        <span className="t-eyebrow c-run">Straight {run.start}–{run.top}</span>
        <span className="text-xs c-dim">{run.length} numbers · best hull d{run.biggest}</span>
      </div>
      <p className="straight-choice-copy">
        {choosable
          ? "Choose quick Energy now or the strongest Attack payout."
          : "This run pays once, using its biggest ship."}
      </p>
      <div
        className={`straight-prizes${prizes.length === 1 ? " straight-prizes-one" : ""}`}
        role={choosable ? "group" : undefined}
        aria-label={choosable ? "Choose a straight prize" : "Straight prize"}
      >
      {prizes.map((take, index) => {
        const reward = previewTally(you, take).run?.reward ?? run.reward;
        const selected = take === chosenTake;
        const kind = reward.kind === "attack" ? "attack" : "energy";
        const amount = reward.kind === "attack" ? (reward.attack ?? 0) : (reward.energy ?? 0);
        return (
          <button
            key={take}
            type="button"
            onClick={choosable ? () => onTake(take) : undefined}
            className={`straight-prize straight-prize-${kind}${selected ? " straight-prize-on" : ""}`}
            aria-pressed={choosable ? selected : undefined}
            disabled={!choosable}
          >
            <span className="t-eyebrow straight-prize-length">
              {choosable ? (index === 0 ? "Quick cash" : "Full run") : "Straight"}
            </span>
            <span className="t-display text-xl straight-prize-value">{amount}</span>
            <span className="t-eyebrow straight-prize-kind">{STAT_LABEL[kind]} · {take} numbers</span>
          </button>
        );
      })}
      </div>
    </section>
  );
}

function YourHealth({ you }: { you: PlayerState }) {
  const reactorShowing = you.dice.some((die) => die.flag) && you.flag.face === 1;
  const projectedBase = reactorShowing
    ? Math.min(TUNING.reactorCap, you.baseEnergy + flagBonusSize(you.flag.level))
    : you.baseEnergy;
  const baseRising = projectedBase > you.baseEnergy;

  return (
    <div className="commander-rail flex items-center gap-2">
      <span className="commander-name t-eyebrow shrink-0">
        <span className="commander-name-full">{you.name}</span>
        <span className="commander-name-mobile">{NOUN.flagship}</span>
      </span>
      <HealthBar className="commander-hpbar min-w-0 flex-1" value={you.hp} max={you.maxHp} />
      <span className="t-num shrink-0 text-sm text-white">
        <Ticker value={Math.max(0, you.hp)} />
        <span className="c-dim">/{you.maxHp}</span>
      </span>
      <span className="commander-energy-cluster flex shrink-0 items-stretch gap-1">
        <span className="commander-bank t-num c-energy" aria-label={`${you.energy} Energy in bank`}>
          ⚡ {you.energy}
        </span>
        <span
          className={`commander-base ${baseRising ? "commander-base-rising" : ""}`}
          aria-label={
            baseRising
              ? `Base Energy income will rise from ${you.baseEnergy} to ${projectedBase}`
              : `Base Energy income is ${you.baseEnergy} each round`
          }
        >
          <span>Base</span>
          <b className="t-num">+{projectedBase}</b>
        </span>
      </span>
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
  waitingName,
  busy,
  onRollAll,
  onReroll,
  onSubmit,
  onTake,
  onToken,
  onClearSelection,
  showPrizes,
}: {
  you: PlayerState;
  tally: ReturnType<typeof previewTally> | null;
  hint: ReturnType<typeof rollHint>;
  selected: Set<string>;
  rollsLeft: number;
  rerollCost: number;
  waiting: boolean;
  waitingName?: string;
  busy: boolean;
  showPrizes: boolean;
  onRollAll(): void;
  onReroll(): void;
  onSubmit(): void;
  onTake(take: number): void;
  onToken(direction: -1 | 1): void;
  onClearSelection(): void;
}) {
  const [tokenOpen, setTokenOpen] = useState(false);
  const notRolled = you.phase === "ready";
  const run = you.dice.length ? bestRun(you.dice) : null;
  const prizes = run ? straightPrizeTakes(run) : [];
  const chosenTake = you.straightTake ?? (prizes.length ? prizes[prizes.length - 1]! : 0);
  const canAffordReroll = rerollCost === 0 || you.energy >= rerollCost;

  return (
    <div className="roll-dock panel panel-you relative flex flex-col gap-2.5 p-3.5">
      <div className="roll-dock-body flex min-h-0 flex-col gap-2.5">
        <YourHealth you={you} />
        <TallyStrip tally={tally} />

      {run && showPrizes && (
        <StraightPrizes
          you={you}
          run={run}
          prizes={prizes}
          chosenTake={chosenTake}
          onTake={onTake}
        />
      )}

      {hint && (
        <p
          className={`roll-hint text-sm leading-snug ${
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

      <div className="flagship-control-row flex items-center gap-2">
        <FlagshipLine you={you} />

        {you.flag.token && you.phase === "rolling" && (
          <Button
            tone="ghost"
            size="sm"
            onClick={() => setTokenOpen(true)}
            disabled={busy}
            ariaLabel="Use flagship weapon"
          >
            Flagship weapon
          </Button>
        )}
      </div>

      {tokenOpen && you.flag.token && you.phase === "rolling" && (
        <div className="flagship-token-popover panel" role="dialog" aria-label="Flagship weapon controls">
          <p className="t-eyebrow c-energy">Flagship weapon · once per {NOUN.game}</p>
          <p className="mt-1 text-sm text-white">Turn the flagship one face.</p>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <Button tone="ghost" size="lg" onClick={() => { onToken(-1); setTokenOpen(false); }} disabled={busy}>
              −1 face
            </Button>
            <Button tone="ghost" size="lg" onClick={() => setTokenOpen(false)}>
              Cancel
            </Button>
            <Button tone="ghost" size="lg" onClick={() => { onToken(1); setTokenOpen(false); }} disabled={busy}>
              +1 face
            </Button>
          </div>
        </div>
      )}
      </div>

      <div className="roll-dock-action">
      {waiting ? (
        <div className="flex items-center justify-center gap-3 py-2" aria-live="polite">
          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-white/80" />
          <span className="text-sm c-dim">
            Locked in. Waiting for {waitingName ?? "the enemy"}…
          </span>
        </div>
      ) : notRolled ? (
        <Button tone="primary" size="lg" full onClick={onRollAll} disabled={busy}>
          Roll Fleet · {TUNING.rollsPerRound} Rolls
        </Button>
      ) : (
        <div className="flex gap-2">
          {selected.size > 0 ? (
            <>
              <Button tone="ghost" size="lg" onClick={onClearSelection} disabled={busy}>
                Clear
              </Button>
              <Button
                tone="primary"
                size="lg"
                full
                onClick={onReroll}
                disabled={busy || !canAffordReroll}
                className={`reroll-action ${rerollCost && !canAffordReroll ? "reroll-unaffordable" : ""}`}
                ariaLabel={
                  rerollCost
                    ? canAffordReroll
                      ? `Reroll ${selected.size} dice for ${rerollCost} Energy`
                      : `Reroll unavailable. Need ${rerollCost} Energy`
                    : `Reroll ${selected.size} dice for free`
                }
              >
                <span>Reroll {selected.size}</span>
                {rerollCost ? (
                  <span className="reroll-cost">
                    {canAffordReroll ? "Cost" : "Need"}
                    <EnergyBolt />
                    {rerollCost} Energy
                  </span>
                ) : rollsLeft > 0 ? (
                  <span className="reroll-free">Free</span>
                ) : null}
              </Button>
            </>
          ) : (
            <>
              <Button tone="primary" size="lg" full onClick={onSubmit} disabled={busy}>
                Lock in
              </Button>
            </>
          )}
        </div>
      )}
      </div>

    </div>
  );
}

function EnergyBolt() {
  return (
    <svg
      className="reroll-energy-icon"
      viewBox="0 0 16 20"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M9.1 0 1.8 11.1h4.7L5.6 20l8.6-12.3H9.4L9.1 0Z" fill="currentColor" />
    </svg>
  );
}

/** One number in the brace screen's HP arithmetic — "Now − Damage = After". */
function EquationTerm({
  value,
  label,
  tone,
}: {
  value: number;
  label: string;
  tone?: "attack" | "repair";
}) {
  return (
    <div className="flex flex-col items-center leading-none">
      <span className={`t-num text-xl ${tone ? `c-${tone}` : "text-white"}`}>{value}</span>
      <span className="t-eyebrow mt-0.5 text-[0.6rem] c-dim">{label}</span>
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
  const blocked = available
    .filter((ship) => chosen.has(ship.id))
    .reduce((sum, ship) => sum + ship.sides, 0);
  const landing = Math.max(0, you.incoming - blocked) + you.directIncoming;
  const heal = you.tally?.heal ?? 0;
  const after = you.hp - landing + heal;
  const fatal = after <= 0;
  const war = you.round > TUNING.escalateAfterRound ? escalationFor(you.round) : 0;

  return (
    <div className="brace-dock panel panel-you flex flex-col gap-3 p-3.5">
      <div>
        <p className="t-eyebrow">Incoming</p>
        <h2 className="t-display text-xl">
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
        {war > 0 && (
          <p className="mt-1 text-sm font-semibold c-attack">
            Includes war +{war} — shields cannot stop that extra.
          </p>
        )}
        <p className="brace-explanation mt-1 text-sm leading-snug c-dim">
          Throw ships in front of it. Each one blocks its own size and sits out the next round.
          Nothing stops Direct.
        </p>
        <p className="brace-mobile-guide mt-1 text-sm font-semibold c-attack">
          Tap a ship die. A red damage target means it will take the hit.
        </p>
      </div>

      <div className="brace-ship-list flex flex-wrap gap-1.5">
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
                  : "border-white/12 c-dim hover:bg-white/[0.06]"
              }`}
            >
              d{ship.sides}
              <span className="ml-1 text-xs opacity-70">{NOUN.bay} {cellForSlot(ship.slot) + 1}</span>
            </button>
          );
        })}
      </div>

      <div className="brace-summary flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-black/30 px-2 py-2.5">
        <EquationTerm value={you.hp} label="Now" />
        <span className="t-num c-dim text-lg">−</span>
        <EquationTerm value={landing} label="Damage" tone="attack" />
        {heal > 0 && (
          <>
            <span className="t-num c-dim text-lg">+</span>
            <EquationTerm value={heal} label="Repair" tone="repair" />
          </>
        )}
        <span className="t-num c-dim text-lg">=</span>
        <EquationTerm value={Math.max(0, after)} label="After" tone={fatal ? "attack" : "repair"} />
      </div>

      {fatal && (
        <Notice tone="warn">
          This volley finishes your flagship even with everything in front of it.
        </Notice>
      )}

      <Button tone="primary" size="lg" full onClick={onConfirm} disabled={busy}>
        {chosen.size === 0 ? "Take it on the flagship" : `Send ${chosen.size} in front`}
      </Button>
    </div>
  );
}

function ResultDock({
  won,
  draw,
  cancelledBy,
  youCancelled,
  you,
  enemyName,
  onExit,
  onRestart,
}: {
  won: boolean;
  draw: boolean;
  cancelledBy?: string | null;
  youCancelled?: boolean;
  you: PlayerState;
  enemyName: string;
  onExit(): void;
  onRestart?(): void;
}) {
  const cancelled = Boolean(cancelledBy);
  return (
    <div className="panel panel-you anim-rise flex flex-col gap-3 p-5">
      <div className="text-center">
        <p className="t-eyebrow">
          {cancelled ? "Game cancelled" : draw ? "Both flagships fell" : won ? "Victory" : "Defeat"}
        </p>
        <h2 className={`t-display text-3xl ${cancelled ? "text-white" : won ? "c-repair" : draw ? "text-white" : "c-attack"}`}>
          {cancelled
            ? youCancelled
              ? `You ended the ${NOUN.game}`
              : `${cancelledBy} ended the ${NOUN.game}`
            : draw
              ? "A draw"
              : won
                ? `You beat ${enemyName}`
                : `${enemyName} wins`}
        </h2>
      </div>

      <div className="grid grid-cols-4 gap-1 border-y border-white/10 py-3">
        <Stat kind="attack" value={you.stats.damageDealt} label="Damage" size="sm" animate />
        <Stat kind="direct" value={you.stats.directDealt} label="Direct" size="sm" animate />
        <Stat kind="repair" value={you.stats.repaired} label="Repaired" size="sm" animate />
        <Stat kind="run" value={you.stats.straights} label="Straights" size="sm" animate />
      </div>

      <div className="flex gap-2">
        <Button tone="ghost" size="lg" full onClick={onExit}>
          Back to {NOUN.home}
        </Button>
        {onRestart && !cancelled && (
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
        <span className="t-eyebrow shrink-0 text-xs">Tap to skip</span>
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
  const tone =
    face.face === 2
      ? "direct"
      : face.face === 3
        ? "repair"
        : face.face === 5
          ? "shield"
          : face.face === 6
            ? "attack"
            : "energy";
  const compact =
    face.face === 1
      ? `+${level?.bonus ?? 0} Energy/round`
      : face.face === 2
        ? `+${level?.bonus ?? 0} Direct per 2`
        : face.face === 3
          ? `+${level?.bonus ?? 0} Repair per 3`
          : face.face === 4
            ? `+${level?.bonus ?? 0} Energy per 4`
            : face.face === 5
              ? `+${level?.bonus ?? 0} Shields per odd`
              : `+${level?.bonus ?? 0} Attack per even`;
  return (
    <div
      className={`flagship-line c-${tone} flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-current/25 bg-current/[0.07] px-3 py-2`}
      title={level?.text ?? face.short}
    >
      <span className="t-num shrink-0 rounded-md bg-current/20 px-2 py-0.5 text-sm">
        {face.face}
      </span>
      <span className="min-w-0 text-sm leading-snug">
        <b>{face.name}</b>
        <span className="flagship-long"> — {level?.text ?? face.short}</span>
        <span className="flagship-compact"> · {compact}</span>
      </span>
    </div>
  );
}

function SoundIcon({ muted }: { muted: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4 9v6h4l5 4V5L8 9H4Z" />
      {muted ? (
        <>
          <path d="m17 9 4 6" />
          <path d="m21 9-4 6" />
        </>
      ) : (
        <>
          <path d="M16 9.2a4 4 0 0 1 0 5.6" />
          <path d="M18.8 6.5a7.6 7.6 0 0 1 0 11" />
        </>
      )}
    </svg>
  );
}
