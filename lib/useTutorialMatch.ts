/**
 * Tutorial match controller — a solo battle on rails.
 *
 * Uses the real engine so dice, tallies, and the shipyard behave exactly as in
 * a real fight. Scripts force the teaching boards; the coach decides which
 * actions are legal.
 */

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applyAction,
  newMatch,
  newPlayer,
  publicMatchView,
  tally,
  type MatchAction,
  type MatchState,
  type PlayerState,
} from "./engine";
import {
  nextStepId,
  stepById,
  TUTORIAL_STEPS,
  type TutorialAllow,
  type TutorialFaces,
  type TutorialStep,
  type TutorialStepId,
} from "./tutorial";
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

function shipBySlot(player: PlayerState, slot: number) {
  return player.ships.find((ship) => ship.slot === slot);
}

/** Opening cross slots: N=1, W=3, E=4, S=6. */
function applyFaces(player: PlayerState, faces: TutorialFaces) {
  const map: { slot: number; value: number }[] = [
    { slot: 1, value: faces.north },
    { slot: 3, value: faces.west },
    { slot: 4, value: faces.east },
    { slot: 6, value: faces.south },
  ];
  for (const entry of map) {
    const ship = shipBySlot(player, entry.slot);
    if (!ship) continue;
    const die = player.dice.find((candidate) => candidate.id === ship.id);
    if (die) die.value = Math.min(Math.max(1, entry.value), die.sides);
  }
  for (const die of player.dice) {
    if (die.flag) continue;
    const ship = player.ships.find((candidate) => candidate.id === die.id);
    if (!ship) continue;
    if (![1, 3, 4, 6].includes(ship.slot)) {
      die.value = 1;
    }
  }
  player.flag.face = faces.flag;
  const flag = player.dice.find((die) => die.flag);
  if (flag) {
    flag.value = faces.flag;
    flag.sides = 6;
  }
  player.tally = null;
  player.straightTake = null;
}

function ensureRollingDice(player: PlayerState) {
  // Tutorial boards need the full cross visible — clear stun from braces.
  for (const ship of player.ships) ship.disabledRound = null;
  player.dice = player.ships.map((ship) => ({
    id: ship.id,
    sides: ship.sides,
    value: 1,
    slot: ship.slot,
  }));
  player.dice.push({ id: "flag", sides: 6, value: player.flag.face || 1, flag: true });
  player.phase = "rolling";
  player.rolls = Math.max(1, player.rolls || 1);
}

function forceGuestVolley(guest: PlayerState, hard: boolean) {
  ensureRollingDice(guest);
  for (const die of guest.dice) {
    if (die.flag) {
      die.value = hard ? 6 : 1;
      guest.flag.face = die.value;
    } else {
      // Max even face the hull can show — a readable Attack total.
      const topEven = die.sides >= 4 ? (hard ? die.sides - (die.sides % 2) : 2) : 1;
      die.value = Math.max(1, topEven);
    }
  }
  guest.tally = tally(guest.dice, guest.flag.level, null);
  guest.phase = "submitted";
}

function prepareGuestForSubmit(match: MatchState, hard: boolean) {
  const guest = match.players.guest;
  if (!guest) return;
  if (guest.phase === "shop") guest.phase = "ready";
  if (guest.phase === "ready") {
    applyAction(match, "guest", { type: "roll", dice: [] });
  }
  if (guest.phase === "rolling" || guest.phase === "submitted") {
    forceGuestVolley(guest, hard);
  }
}

function applyStepScript(match: MatchState, step: TutorialStep) {
  const script = step.script;
  if (!script) return;
  const host = match.players.host;

  if (script.kind === "seedEnergy") {
    host.energy = Math.max(host.energy, script.amount);
    return;
  }
  if (script.kind === "board") {
    ensureRollingDice(host);
    applyFaces(host, script.faces);
  }
}

function actionAllowed(allow: TutorialAllow, action: MatchAction): boolean {
  switch (action.type) {
    case "roll":
      return action.dice.length === 0 ? !!allow.rollAll : !!allow.reroll;
    case "submit":
      return !!allow.submit;
    case "continue":
      return !!allow.continue;
    case "brace":
      return !!allow.brace;
    case "ready":
      return !!allow.ready;
    case "flag-token":
      return !!allow.token?.includes(action.direction);
    case "straight-take":
      return !!allow.straightTake;
    case "shop":
      if (action.operation === "slot") return !!allow.shopSlot;
      if (action.operation === "buy") return !!allow.shopBuy;
      if (action.operation === "upgrade") return !!allow.shopUpgrade;
      return false;
    default:
      return false;
  }
}

function advanceAfterAct(stepId: TutorialStepId, action: MatchAction): TutorialStepId | null {
  const step = stepById(stepId);
  if (!actionAllowed(step.allow, action)) return null;

  if (stepId === "roll2" && action.type === "roll" && action.dice.length === 0) {
    return "col_done";
  }
  if (stepId === "roll3" && action.type === "roll" && action.dice.length === 0) {
    return "token_teach";
  }
  if (stepId === "token_teach" && action.type === "flag-token") {
    return "straight_done";
  }
  if (stepId === "reroll1" && action.type === "roll") {
    return "row_done";
  }
  if (stepId === "roll1" && action.type === "roll") {
    return "tour_hp";
  }
  if (
    (stepId === "lock1" || stepId === "lock2" || stepId === "lock3") &&
    action.type === "submit"
  ) {
    return null; // phase sync decides
  }
  if (stepId === "shop_slot" && action.type === "shop") return "shop_buy";
  if (stepId === "shop_buy" && action.type === "shop") return "shop_upgrade";
  if (stepId === "shop_upgrade" && action.type === "shop") return "shop_done";

  return nextStepId(stepId);
}

function syncAfterAct(match: MatchState, stepId: TutorialStepId): TutorialStepId {
  const host = match.players.host;
  settleGuest(match);

  if (stepId === "lock1") {
    if (host.phase === "brace") {
      try {
        applyAction(match, "host", { type: "brace", ships: [] });
      } catch {
        /* */
      }
    }
    if (host.phase === "report") return "report1";
  }
  if (stepId === "lock2") {
    if (host.phase === "brace") return "brace_teach";
    if (host.phase === "report") return "report2";
  }
  if (stepId === "brace_teach" && host.phase === "report") return "report2";
  if (stepId === "lock3") {
    if (host.phase === "brace") {
      try {
        applyAction(match, "host", { type: "brace", ships: [] });
      } catch {
        /* */
      }
    }
    if (
      host.phase === "report" ||
      host.phase === "shop" ||
      host.phase === "over" ||
      host.phase === "ready"
    ) {
      return "finale";
    }
  }
  if (stepId === "report1" && host.phase === "shop") return "shop_intro";
  if (stepId === "report2" && (host.phase === "shop" || host.phase === "ready")) {
    return "roll3";
  }
  return stepId;
}

function settleGuest(match: MatchState) {
  const guest = match.players.guest;
  if (!guest) return;
  if (guest.phase === "brace") {
    try {
      applyAction(match, "guest", { type: "brace", ships: [] });
    } catch {
      /* */
    }
  }
  if (guest.phase === "report") {
    try {
      applyAction(match, "guest", { type: "continue" });
    } catch {
      /* */
    }
  }
  if (guest.phase === "shop") {
    try {
      applyAction(match, "guest", { type: "ready" });
    } catch {
      guest.phase = "ready";
    }
  }
}

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
    const host = match.players.host;
    // Lessons that need the board must leave the shipyard first.
    if (
      (nextStep === "roll1" || nextStep === "roll2" || nextStep === "roll3") &&
      host.phase === "shop"
    ) {
      try {
        applyAction(match, "host", { type: "ready" });
      } catch {
        host.phase = "ready";
      }
    }
    stepRef.current = nextStep;
    setStepId(nextStep);
    applyStepScript(match, stepById(nextStep));
    settleGuest(match);
    stateRef.current = match;
    setState(structuredClone(match));
  }, []);

  const start = useCallback(() => {
    const match = newMatch("tutorial", "0000", "you", "Commander", "solo");
    match.players.guest = newPlayer("enemy", "Rival fleet", "ready");
    match.players.host.phase = "ready";
    match.players.host.name = "You";
    match.status = "active";
    match.players.guest.hp = 45;
    match.players.guest.maxHp = 45;
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
    const current = stepById(stepRef.current);
    if (!current.allow.coachNext) return;
    if (current.id === "finale") {
      finishedRef.current?.();
      return;
    }
    const next = nextStepId(current.id);
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
      const currentId = stepRef.current;
      const current = stepById(currentId);
      if (!actionAllowed(current.allow, action)) {
        setError("The coach is waiting for a different tap — read the tip.");
        return;
      }

      try {
        if (action.type === "submit") {
          prepareGuestForSubmit(match, currentId === "lock2" || currentId === "lock3");
        }
        if (
          action.type === "roll" &&
          action.dice.length === 0 &&
          match.players.host.phase === "rolling"
        ) {
          const flag = match.players.host.dice.find((die) => die.flag);
          if (flag) action = { type: "roll", dice: [flag.id] };
        }
        applyAction(match, "host", action);
        setError(null);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason));
        return;
      }

      let next = advanceAfterAct(currentId, action);
      if (next === null) {
        next = syncAfterAct(match, currentId);
      } else {
        settleGuest(match);
      }

      if (next === currentId) {
        stateRef.current = match;
        setState(structuredClone(match));
        const synced = syncAfterAct(match, currentId);
        if (synced !== currentId) publish(match, synced);
        return;
      }
      publish(match, next);
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
  ensureRollingDice(player);
  applyFaces(player, faces);
}

export function __tutorialActionAllowed(allow: TutorialAllow, action: MatchAction) {
  return actionAllowed(allow, action);
}
