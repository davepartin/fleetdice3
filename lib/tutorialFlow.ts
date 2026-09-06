/**
 * Pure first-flight controller — no React, no DOM.
 *
 * useTutorialMatch is the hook. This file is the rails: what is legal, which
 * board a step paints, and how a tap advances. Tests walk the same functions.
 */

import {
  applyAction,
  newMatch,
  newPlayer,
  tally,
  type MatchAction,
  type MatchState,
  type PlayerState,
} from "./engine";
import {
  nextStepId,
  stepById,
  type TutorialAllow,
  type TutorialFaces,
  type TutorialStep,
  type TutorialStepId,
} from "./tutorial";

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
  // Tutorial boards need the full cross visible — clear the sit-out from blocks.
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

export function tutorialActionAllowed(allow: TutorialAllow, action: MatchAction): boolean {
  switch (action.type) {
    case "roll":
      return action.dice.length === 0 ? !!allow.rollAll : !!allow.reroll;
    case "submit":
      return !!allow.submit;
    case "continue":
      return !!allow.continue;
    case "brace":
      // The lesson is sending a ship in. Confirming with nobody picked
      // skips the beat the coach just named.
      return !!allow.brace && action.ships.length > 0;
    case "ready":
      return !!allow.ready;
    case "flag-token":
      return !!allow.token?.includes(action.direction);
    case "straight-take":
      return !!allow.straightTake;
    case "shop":
      if (action.operation === "slot") return !!allow.shopSlot;
      // The coach asked for a d4. Any other hull still works in a real
      // yard; here it would skip the sentence the player just read.
      if (action.operation === "buy") return !!allow.shopBuy && action.sides === 4;
      if (action.operation === "upgrade") return !!allow.shopUpgrade;
      return false;
    default:
      return false;
  }
}

function advanceAfterAct(stepId: TutorialStepId, action: MatchAction): TutorialStepId | null {
  const step = stepById(stepId);
  if (!tutorialActionAllowed(step.allow, action)) return null;

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
    return "shop_leave";
  }
  return stepId;
}

export function commitTutorialStep(match: MatchState, nextStep: TutorialStepId): TutorialStepId {
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
  applyStepScript(match, stepById(nextStep));
  settleGuest(match);
  return nextStep;
}

export function startTutorialMatch(): MatchState {
  const match = newMatch("tutorial", "0000", "you", "Commander", "solo");
  match.players.guest = newPlayer("enemy", "Rival fleet", "ready");
  match.players.host.phase = "ready";
  match.players.host.name = "You";
  match.status = "active";
  match.players.guest.hp = 45;
  match.players.guest.maxHp = 45;
  return match;
}

export function applyTutorialCoachNext(
  match: MatchState,
  stepId: TutorialStepId,
): TutorialStepId | "finished" | null {
  const current = stepById(stepId);
  if (!current.allow.coachNext) return null;
  if (current.id === "finale") return "finished";
  const next = nextStepId(current.id);
  if (!next) return null;
  return commitTutorialStep(match, next);
}

export function applyTutorialAction(
  match: MatchState,
  stepId: TutorialStepId,
  action: MatchAction,
): { ok: true; stepId: TutorialStepId } | { ok: false; error: string } {
  const current = stepById(stepId);
  if (!tutorialActionAllowed(current.allow, action)) {
    return { ok: false, error: "The coach is waiting for a different tap — read the tip." };
  }

  try {
    if (action.type === "submit") {
      prepareGuestForSubmit(match, stepId === "lock2" || stepId === "lock3");
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
  } catch (reason) {
    return { ok: false, error: reason instanceof Error ? reason.message : String(reason) };
  }

  let next = advanceAfterAct(stepId, action);
  if (next === null) {
    next = syncAfterAct(match, stepId);
  } else {
    settleGuest(match);
  }

  if (next === stepId) {
    const synced = syncAfterAct(match, stepId);
    if (synced !== stepId) return { ok: true, stepId: commitTutorialStep(match, synced) };
    return { ok: true, stepId };
  }
  return { ok: true, stepId: commitTutorialStep(match, next) };
}

export function applyTutorialFaces(player: PlayerState, faces: TutorialFaces) {
  ensureRollingDice(player);
  applyFaces(player, faces);
}

/**
 * Walk the flight the way a player who follows the coach would: every
 * allowed tap, in order, no skips. Used by the test so a broken gate fails
 * in Node instead of on a phone.
 */
export function walkFirstFlight(): { stepId: TutorialStepId; match: MatchState } {
  const match = startTutorialMatch();
  let stepId: TutorialStepId = "intro";

  const coach = (): TutorialStepId => {
    const next = applyTutorialCoachNext(match, stepId);
    if (next === null || next === "finished") {
      throw new Error(`coach next stuck on ${stepId}`);
    }
    return next;
  };

  const act = (action: MatchAction): TutorialStepId => {
    const result = applyTutorialAction(match, stepId, action);
    if (!result.ok) throw new Error(`${stepId}: ${result.error}`);
    return result.stepId;
  };

  stepId = coach(); // faces
  stepId = coach(); // marks
  stepId = coach(); // roll1
  stepId = act({ type: "roll", dice: [] }); // tour_hp
  stepId = coach(); // tour_board
  stepId = coach(); // read1
  stepId = coach(); // reroll1
  const reroll = match.players.host.dice.find((die) => !die.flag) ?? match.players.host.dice[0];
  if (!reroll) throw new Error("reroll1: no die to send back");
  stepId = act({ type: "roll", dice: [reroll.id] }); // row_done
  stepId = coach(); // lock1
  stepId = act({ type: "submit" }); // report1
  stepId = act({ type: "continue" }); // shop_intro
  stepId = coach(); // shop_slot
  const locked = match.players.host.open.findIndex((open) => !open);
  if (locked < 0) throw new Error("shop_slot: no locked bay");
  stepId = act({ type: "shop", operation: "slot", slotIndex: locked }); // shop_buy
  stepId = act({ type: "shop", operation: "buy", sides: 4, slotIndex: locked }); // shop_upgrade
  const d4 = match.players.host.ships.find((ship) => ship.sides === 4);
  if (!d4) throw new Error("shop_upgrade: no d4");
  stepId = act({ type: "shop", operation: "upgrade", shipId: d4.id }); // shop_done
  stepId = act({ type: "ready" }); // roll2
  stepId = act({ type: "roll", dice: [] }); // col_done
  stepId = coach(); // lock2
  stepId = act({ type: "submit" }); // brace_teach
  if (match.players.host.phase !== "brace") {
    throw new Error(`lock2 should teach blocking, phase is ${match.players.host.phase}`);
  }
  const blocker = match.players.host.ships[0];
  if (!blocker) throw new Error("brace_teach: no ship");
  stepId = act({ type: "brace", ships: [blocker.id] }); // report2
  stepId = act({ type: "continue" }); // shop_leave
  if (stepId !== "shop_leave") {
    throw new Error(`report2 should open the yard, landed on ${stepId}`);
  }
  stepId = act({ type: "ready" }); // roll3
  stepId = act({ type: "roll", dice: [] }); // token_teach
  stepId = act({ type: "flag-token", direction: 1 }); // straight_done
  stepId = coach(); // lock3
  stepId = act({ type: "submit" }); // finale

  return { stepId, match };
}
