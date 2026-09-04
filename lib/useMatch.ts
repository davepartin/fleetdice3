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
import { applyDifficultyStart, newBrain, nextActions, type Brain, type Difficulty, type Plan } from "./ai";
import {
  cancelRoom,
  enterRoom,
  isTransientRoomError,
  playAction,
  startRoomHeartbeat,
  startSeatPresence,
  watchRoom,
  type LiveRoom,
} from "./rooms";
import { commanderName } from "./firebase";
import { reconnectDelay } from "./backoff";

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
  /** Versus only: end the room for both commanders. */
  cancel?(): void;
  /**
   * The live connection dropped and is being re-established. Versus only —
   * solo has nothing to reconnect to.
   */
  reconnecting?: boolean;
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
  const rollLockRef = useRef(false);

  const start = useCallback(() => {
    const match = newMatch(`solo-${randomId(8)}`, "0000", "you", settings.name ?? commanderName(), "solo");
    match.players.guest = newPlayer("enemy", "Enemy", "ready");
    applyDifficultyStart(match.players.guest, settings.difficulty);
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
      if (action.type === "roll") {
        if (rollLockRef.current) return;
        rollLockRef.current = true;
      }
      try {
        applyAction(match, "host", action);
        setError(null);
      } catch (reason) {
        rollLockRef.current = false;
        setError(reason instanceof Error ? reason.message : String(reason));
        return;
      }
      setState(structuredClone(match));
      rollLockRef.current = false;
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
  const [reconnecting, setReconnecting] = useState(false);
  const queueRef = useRef<Promise<unknown>>(Promise.resolve());
  const busyRef = useRef(false);

  useEffect(() => {
    if (!matchId) {
      setStatus("error");
      setError("This link is missing its room number.");
      return;
    }
    let stop: (() => void) | null = null;
    let stopBeat: (() => void) | null = null;
    let cancelled = false;
    let retry: number | null = null;
    let attempt = 0;

    const clearRetry = () => {
      if (retry !== null) {
        window.clearTimeout(retry);
        retry = null;
      }
    };

    /**
     * Come back after a dropped listener.
     *
     * Backing off matters because the common cause is a phone with no signal:
     * hammering Firestore from a dead network wakes the radio over and over and
     * fixes nothing. Capped, because a match should never take longer than
     * fifteen seconds to rejoin once the network is actually back.
     */
    // Whatever step is currently failing, so a retry resumes from there.
    let next: () => Promise<void> = async () => {};

    const scheduleRetry = () => {
      if (cancelled) return;
      setReconnecting(true);
      clearRetry();
      const wait = reconnectDelay(attempt);
      attempt += 1;
      retry = window.setTimeout(() => void next(), wait);
    };

    const subscribe = async () => {
      if (cancelled) return;
      clearRetry();
      next = subscribe;
      try {
        stop?.();
        stop = null;
        stop = await watchRoom(
          matchId,
          (room) => {
            if (cancelled) return;
            // A snapshot arrived, so the connection is genuinely back. This
            // deliberately does not clear `error`: that carries the engine's
            // own refusals ("You need 4 Energy for that"), which a routine
            // update from the other commander must not wipe off the screen.
            attempt = 0;
            setRoom(room);
            setStatus("ready");
            setReconnecting(false);
          },
          (reason) => {
            if (cancelled) return;
            setError(reason.message);
          },
          () => {
            if (cancelled) return;
            scheduleRetry();
          },
        );
      } catch (reason) {
        if (cancelled) return;
        if (isTransientRoomError(reason)) scheduleRetry();
        else {
          setStatus("error");
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      }
    };

    /**
     * Take the seat, then listen.
     *
     * Failing to take it is not the end of the road, and treating it as one is
     * what stranded players. A tab that iOS killed and restored comes back on
     * whatever network the phone has at that instant; when that is nothing,
     * this used to print "your phone looks offline" and stay there for good —
     * with a live match on the other end and no way back but a manual reload.
     * Anything that might pass now keeps trying and says "Reconnecting"; only
     * a real answer from the room — gone, full, not yours — stops here.
     */
    const start = async () => {
      if (cancelled) return;
      clearRetry();
      next = start;
      try {
        const first = await enterRoom(matchId);
        if (cancelled) return;
        attempt = 0;
        setRoom(first);
        setStatus("ready");
        setReconnecting(false);
        await subscribe();
        if (!cancelled && !stopBeat) {
          const beat = startRoomHeartbeat(matchId);
          // Says "still here" for this seat alone, so a seat that goes quiet
          // can be taken back without a live one ever being taken.
          const seat = startSeatPresence(matchId, first.side);
          stopBeat = () => {
            beat();
            seat();
          };
        }
      } catch (reason) {
        if (cancelled) return;
        if (isTransientRoomError(reason)) {
          scheduleRetry();
          return;
        }
        setStatus("error");
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    };

    /**
     * iOS suspends a backgrounded tab and quietly kills its connection, and the
     * page is often visible again before the SDK notices. Coming back to the
     * tab, or to the network, tries again at once rather than waiting out a
     * backoff that started while the screen was off.
     */
    const wakeUp = () => {
      if (cancelled || document.visibilityState !== "visible") return;
      attempt = 0;
      void next();
    };

    void start();

    document.addEventListener("visibilitychange", wakeUp);
    window.addEventListener("online", wakeUp);

    return () => {
      cancelled = true;
      clearRetry();
      document.removeEventListener("visibilitychange", wakeUp);
      window.removeEventListener("online", wakeUp);
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
      // Two taps in the same moment both see busy=false. Same lock as solo.
      // A second roll would either error or write a second set of faces.
      if (action.type === "roll" && busyRef.current) return;
      busyRef.current = true;
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
        .finally(() => {
          busyRef.current = false;
          setBusy(false);
        });
    },
    [matchId],
  );

  const cancel = useCallback(() => {
    if (!matchId) return;
    busyRef.current = true;
    setBusy(true);
    queueRef.current = queueRef.current
      .then(() => cancelRoom(matchId))
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        busyRef.current = false;
        setBusy(false);
      });
  }, [matchId]);

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
    cancel,
    reconnecting,
    mode: "versus",
  };
}
