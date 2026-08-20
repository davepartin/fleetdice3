"use client";

/**
 * One hook, two kinds of match.
 *
 * Solo keeps the whole match in this browser and runs the Enemy with the brain
 * from `lib/ai.ts`. Versus keeps it in Firestore and both commanders watch the
 * same document. The screens above cannot tell the difference — they get a
 * state, a side, and a way to send an action.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applyAction,
  newMatch,
  newPlayer,
  opponentOf,
  publicMatchView,
  randomId,
  type MatchAction,
  type MatchState,
  type PlayerState,
  type SideId,
} from "./engine";
import { newBrain, nextActions, type Brain, type Difficulty, type Plan } from "./ai";
import {
  enterRoom,
  playAction,
  startRoomHeartbeat,
  watchRoom,
  type LiveRoom,
} from "./rooms";
import { commanderName } from "./firebase";

export type MatchStatus = "loading" | "ready" | "error";

export type MatchController = {
  status: MatchStatus;
  state: MatchState | null;
  side: SideId;
  you: PlayerState | null;
  them: PlayerState | null;
  /** True while an action is in flight to the server. */
  busy: boolean;
  /** True when you have locked in and the other commander has not. */
  waitingOnEnemy: boolean;
  error: string | null;
  clearError(): void;
  act(action: MatchAction): void;
  /** Solo only: start a fresh match with the same settings. */
  restart?(): void;
  mode: "solo" | "versus";
};

/* ------------------------------------------------------------------ */
/* Solo                                                                */
/* ------------------------------------------------------------------ */

export type SoloSettings = {
  difficulty: Difficulty;
  plan?: Plan;
  name?: string;
};

/** How long the Enemy pauses between its own moves, so a turn has a rhythm. */
const ENEMY_BEAT_MS = 420;

/**
 * Read through a function call rather than inline.
 *
 * `applyAction` mutates the match in place, so the status can change under a
 * loop — but the compiler cannot see that and narrows the type away after the
 * first check. Asking a function keeps the check honest.
 */
function isFinished(match: MatchState): boolean {
  return match.status === "finished";
}

export function useSoloMatch(settings: SoloSettings): MatchController {
  const [state, setState] = useState<MatchState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const brainRef = useRef<Brain | null>(null);
  const stateRef = useRef<MatchState | null>(null);
  const timerRef = useRef<number>(0);

  const start = useCallback(() => {
    const match = newMatch(`solo-${randomId(8)}`, "0000", "you", settings.name ?? commanderName(), "solo");
    match.players.guest = newPlayer("enemy", "Enemy", "ready");
    match.players.host.phase = "ready";
    match.status = "active";
    brainRef.current = newBrain(settings.plan, settings.difficulty);
    stateRef.current = match;
    setState(structuredClone(match));
    setError(null);
  }, [settings.difficulty, settings.plan, settings.name]);

  useEffect(() => {
    start();
    return () => window.clearTimeout(timerRef.current);
  }, [start]);

  /** Let the Enemy take whatever moves it currently owes, one beat at a time. */
  const pumpEnemy = useCallback(() => {
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      const match = stateRef.current;
      const brain = brainRef.current;
      if (!match || !brain || isFinished(match)) return;

      const actions = nextActions(match, "guest", brain);
      if (!actions.length) return;

      for (const action of actions) {
        if (isFinished(match)) break;
        try {
          applyAction(match, "guest", action);
        } catch {
          // The Enemy asked for something that is no longer legal. Skip it and
          // let the next beat re-read the board rather than getting stuck.
        }
      }
      setState(structuredClone(match));
      pumpEnemy();
    }, ENEMY_BEAT_MS);
  }, []);

  const act = useCallback(
    (action: MatchAction) => {
      const match = stateRef.current;
      if (!match) return;
      try {
        applyAction(match, "host", action);
        setError(null);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason));
        return;
      }
      setState(structuredClone(match));
      pumpEnemy();
    },
    [pumpEnemy],
  );

  // Keep the Enemy moving even while the player sits on a screen.
  useEffect(() => {
    if (!state || state.status === "finished") return;
    pumpEnemy();
    return () => window.clearTimeout(timerRef.current);
  }, [state, pumpEnemy]);

  const view = useMemo(
    () => (state ? publicMatchView(state, "host") : null),
    [state],
  );

  return {
    status: view ? "ready" : "loading",
    state: view,
    side: "host",
    you: view?.players.host ?? null,
    them: view?.players.guest ?? null,
    busy: false,
    waitingOnEnemy:
      view?.players.host.phase === "submitted" && view?.players.guest?.phase !== "submitted",
    error,
    clearError: () => setError(null),
    act,
    restart: start,
    mode: "solo",
  };
}

/* ------------------------------------------------------------------ */
/* Versus                                                              */
/* ------------------------------------------------------------------ */

export function useRoomMatch(matchId: string | null): MatchController {
  const [room, setRoom] = useState<LiveRoom | null>(null);
  const [status, setStatus] = useState<MatchStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const queueRef = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    if (!matchId) {
      setStatus("error");
      setError("This link is missing its room number.");
      return;
    }
    let stop: (() => void) | null = null;
    let stopBeat: (() => void) | null = null;
    let cancelled = false;

    (async () => {
      try {
        const first = await enterRoom(matchId);
        if (cancelled) return;
        setRoom(first);
        setStatus("ready");
      } catch (reason) {
        if (cancelled) return;
        setStatus("error");
        setError(reason instanceof Error ? reason.message : String(reason));
        return;
      }

      try {
        stop = await watchRoom(
          matchId,
          (next) => {
            if (cancelled) return;
            setRoom(next);
            setStatus("ready");
          },
          (reason) => {
            if (cancelled) return;
            setError(reason.message);
          },
        );
        stopBeat = startRoomHeartbeat(matchId);
      } catch (reason) {
        if (cancelled) return;
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    })();

    return () => {
      cancelled = true;
      stop?.();
      stopBeat?.();
    };
  }, [matchId]);

  /**
   * Actions are queued rather than fired in parallel. Two shop taps in the same
   * second against the same document would otherwise race, and one would be
   * silently thrown away by the transaction retry.
   */
  const act = useCallback(
    (action: MatchAction) => {
      if (!matchId) return;
      setBusy(true);
      queueRef.current = queueRef.current
        .then(() => playAction(matchId, action))
        .then((next) => {
          setRoom(next as LiveRoom);
          setError(null);
        })
        .catch((reason: unknown) => {
          setError(reason instanceof Error ? reason.message : String(reason));
        })
        .finally(() => setBusy(false));
    },
    [matchId],
  );

  const state = room?.state ?? null;
  const side = room?.side ?? "host";
  const you = state?.players[side] ?? null;
  const them = state?.players[opponentOf(side)] ?? null;

  return {
    status,
    state,
    side,
    you,
    them,
    busy,
    waitingOnEnemy: you?.phase === "submitted" && them?.phase !== "submitted",
    error,
    clearError: () => setError(null),
    act,
    mode: "versus",
  };
}
