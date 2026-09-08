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
import { newTapLock, pickLiveRoom } from "./versusSync";
import { saveSoloBattle, type SoloSave } from "./soloSave";
import { clearPendingMove, loadPendingMove, storePendingMove, type MoveEnvelope } from "./moveReceipt";

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
  recoveringMove?: boolean;
  recoveryNotice?: string | null;
  mode: "solo" | "versus";
};

/* ------------------------------------------------------------------ */
/* Solo                                                                */
/* ------------------------------------------------------------------ */

export type SoloSettings = {
  difficulty: Difficulty;
  plan?: Plan;
  name?: string;
  resume?: SoloSave | null;
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
  const lockRef = useRef(newTapLock());

  const [saveWarning, setSaveWarning] = useState<string | null>(null);
  const persist = useCallback((match: MatchState) => {
    if (brainRef.current && !saveSoloBattle(match, brainRef.current)) {
      setSaveWarning("This browser cannot save your solo battle. Keep this tab open until you finish.");
    }
  }, []);
  const start = useCallback(() => {
    const match = newMatch(`solo-${randomId(8)}`, "0000", "you", settings.name ?? commanderName(), "solo");
    match.players.guest = newPlayer("enemy", "Enemy", "ready");
    applyDifficultyStart(match.players.guest, settings.difficulty);
    match.players.host.phase = "ready";
    match.status = "active";
    brainRef.current = newBrain(settings.plan, settings.difficulty);
    stateRef.current = match;
    persist(match);
    setState(structuredClone(match));
    setError(null);
  }, [settings.difficulty, settings.plan, settings.name, persist]);

  useEffect(() => {
    if (settings.resume) {
      const saved = structuredClone(settings.resume);
      stateRef.current = saved.state;
      brainRef.current = saved.brain;
      setState(saved.state);
    } else start();
    return () => window.clearTimeout(timerRef.current);
  }, [start, settings.resume]);

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
      persist(match);
      setState(structuredClone(match));
      pumpEnemy();
    }, ENEMY_BEAT_MS);
  }, [persist]);

  const act = useCallback(
    (action: MatchAction) => {
      const match = stateRef.current;
      if (!match) return;
      // Same lock as versus: a double-tap must not fire two actions.
      if (!lockRef.current.tryBegin()) return;
      try {
        applyAction(match, "host", action);
        setError(null);
      } catch (reason) {
        lockRef.current.release();
        setError(reason instanceof Error ? reason.message : String(reason));
        return;
      }
      persist(match);
      setState(structuredClone(match));
      lockRef.current.release();
      pumpEnemy();
    },
    [pumpEnemy, persist],
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
    recoveryNotice: saveWarning,
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
  const lockRef = useRef(newTapLock());
  const roomRef = useRef<LiveRoom | null>(null);
  const [recoveringMove, setRecoveringMove] = useState(false);
  const pendingRef = useRef<MoveEnvelope | null>(null);
  const retryMoveRef = useRef<() => void>(() => {});

  /**
   * Put a room on the screen only if it is not older than what we already
   * have. `playAction` and `watchRoom` both call this; without the check,
   * a late snapshot of an earlier version walks the board backwards.
   */
  const showRoom = useCallback((incoming: LiveRoom) => {
    const next = pickLiveRoom(roomRef.current, incoming);
    if (next === roomRef.current) return;
    roomRef.current = next;
    setRoom(next);
    const pending = pendingRef.current;
    const receipt = next.receipts?.[next.side];
    if (pending && receipt && receipt.sequence >= pending.sequence) {
      if (receipt.id !== pending.id) {
        setError("Another tab already moved this fleet. Your battle is up to date; choose your next move.");
      }
      clearPendingMove(next.id, next.state.players[next.side]!.uid, pending.id);
      pendingRef.current = null;
      lockRef.current.release();
      setBusy(false);
      setRecoveringMove(false);
    }
  }, []);

  useEffect(() => {
    roomRef.current = null;
    pendingRef.current = null;
    setRoom(null);
    setStatus("loading");
    setBusy(false);
    setRecoveringMove(false);
    lockRef.current.release();
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
            showRoom(room);
            setStatus("ready");
            setReconnecting(Boolean(room.fromCache) || !navigator.onLine);
          },
          (reason) => {
            if (cancelled) return;
            setError(reason.message);
          },
          (reason) => {
            if (cancelled) return;
            if (isTransientRoomError(reason)) scheduleRetry();
            else { setStatus("error"); setError(reason.message); }
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
        showRoom(first);
        const saved = loadPendingMove(matchId, first.state.players[first.side]!.uid);
        if (saved) {
          pendingRef.current = saved;
          lockRef.current.tryBegin();
          setBusy(true);
          setRecoveringMove(true);
          retryMoveRef.current();
        }
        setStatus("ready");
        setReconnecting(false);
        await subscribe();
        if (!cancelled && !stopBeat) {
          const beat = startRoomHeartbeat(matchId);
          // Keep per-seat presence fresh; returning under a new identity now
          // requires the other commander's explicit approval.
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

    const offline = () => setReconnecting(true);
    window.addEventListener("offline", offline);
    document.addEventListener("visibilitychange", wakeUp);
    window.addEventListener("online", wakeUp);

    return () => {
      cancelled = true;
      clearRetry();
      window.removeEventListener("offline", offline);
      document.removeEventListener("visibilitychange", wakeUp);
      window.removeEventListener("online", wakeUp);
      stop?.();
      stopBeat?.();
    };
  }, [matchId, showRoom]);

  /**
   * Actions are queued rather than fired in parallel. Two shop taps in the same
   * second against the same document would otherwise race, and one would be
   * silently thrown away by the transaction retry.
   *
   * The tap lock sits in front of that queue: a second tap while the first is
   * still on the wire is dropped, not lined up. Roll already did this; buy,
   * leave the shipyard, lock-in, block, and Continue now do too.
   */
  useEffect(() => {
    let disposed = false;
    let inFlight = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const attempt = async () => {
      const pending = pendingRef.current;
      const current = roomRef.current;
      if (disposed || inFlight || !pending || !current || !matchId) return;
      inFlight = true;
      const uid = current.state.players[current.side]!.uid;
      try {
        const next = await playAction(matchId, pending.action, pending);
        if (disposed) return;
        showRoom(next);
        clearPendingMove(matchId, uid, pending.id);
        if (pendingRef.current?.id === pending.id) {
          pendingRef.current = null;
          lockRef.current.release();
          setBusy(false);
          setRecoveringMove(false);
        }
        setError(null);
      } catch (reason) {
        if (disposed || pendingRef.current?.id !== pending.id) return;
        if (isTransientRoomError(reason)) {
          setRecoveringMove(true);
          timer = setTimeout(() => void attempt(), 3000);
        } else {
          clearPendingMove(matchId, uid, pending.id);
          pendingRef.current = null;
          lockRef.current.release();
          setBusy(false);
          setRecoveringMove(false);
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      } finally {
        inFlight = false;
        if (!disposed && pendingRef.current && pendingRef.current.id !== pending.id) void attempt();
      }
    };
    retryMoveRef.current = () => void attempt();
    const wake = () => { if (document.visibilityState === "visible") void attempt(); };
    window.addEventListener("online", wake);
    document.addEventListener("visibilitychange", wake);
    return () => {
      disposed = true;
      clearTimeout(timer);
      window.removeEventListener("online", wake);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [matchId, showRoom]);

  const act = useCallback((action: MatchAction) => {
    const current = roomRef.current;
    if (!matchId || !current || !lockRef.current.tryBegin()) return;
    const you = current.state.players[current.side]!;
    const pending: MoveEnvelope = {
      id: crypto.randomUUID(), sequence: (current.receipts?.[current.side]?.sequence ?? 0) + 1,
      round: you.round, phase: you.phase, rolls: you.rolls, createdAt: Date.now(), action,
    };
    try { storePendingMove(matchId, you.uid, pending); }
    catch {
      lockRef.current.release();
      setError("This browser cannot save your move for recovery. Allow site storage, then try again.");
      return;
    }
    pendingRef.current = pending;
    setBusy(true);
    retryMoveRef.current();
  }, [matchId]);

  const cancel = useCallback(() => {
    if (!matchId || !lockRef.current.tryBegin()) return;
    setBusy(true);
    queueRef.current = queueRef.current
      .then(() => cancelRoom(matchId))
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        lockRef.current.release();
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
    recoveringMove,
    mode: "versus",
  };
}
