/**
 * What the versus screen is allowed to show, and which taps it may send.
 *
 * Pure and separate from the React hook so the two bugs from camping play can
 * be tested without a phone or Firestore:
 *
 *   1. An older live snapshot arriving after a successful move used to replace
 *      the board — a bought die vanished, a roll went backwards, the guest
 *      was told they were waiting on a host who had already moved on.
 *   2. Only Roll dropped a second tap while busy. Buy, leave the shipyard,
 *      lock-in, block, and Continue all queued a second send on a double-tap.
 *
 * The match already carries `version`, bumped on every legal action. The
 * screen keeps the higher one. A second tap while the first is still on the
 * wire is dropped.
 */

export type VersionedRoom = {
  version: number;
  state?: { version?: number };
};

/**
 * The number to compare two snapshots by.
 *
 * The room document and the engine state both carry `version` and they are
 * written together. Taking the max means a half-updated document still sorts
 * in the right order rather than looking older than it is.
 */
export function roomVersion(room: VersionedRoom): number {
  const top = Number.isFinite(room.version) ? room.version : 0;
  const inner = Number.isFinite(room.state?.version) ? (room.state!.version as number) : 0;
  return Math.max(top, inner);
}

/**
 * The room the screen should keep.
 *
 * Older incoming loses. Equal or newer incoming wins — equal is the same
 * write coming back through the live listener, newer is the other commander
 * (or our own in-flight write) moving the match on.
 */
export function pickLiveRoom<T extends VersionedRoom>(current: T | null, incoming: T): T {
  if (!current) return incoming;
  return roomVersion(incoming) < roomVersion(current) ? current : incoming;
}

/** A second tap while the first is still travelling is dropped. */
export function newTapLock(): {
  readonly busy: boolean;
  tryBegin(): boolean;
  release(): void;
} {
  let held = false;
  return {
    get busy() {
      return held;
    },
    tryBegin() {
      if (held) return false;
      held = true;
      return true;
    },
    release() {
      held = false;
    },
  };
}
