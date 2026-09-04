/**
 * What belongs under "Now on the field".
 *
 * Pure and separate from `lib/rooms.ts` so the rule can be tested without a
 * Firestore or the Firebase SDK — and so there is exactly one copy of it. The
 * bug this guards against was found by the owner: a match showing "Round 3 ·
 * Sam vs Alex" had been on the public board for eleven days, because waiting
 * rooms were aged out and matches already in progress never were.
 */

/** An empty waiting room drops off the board after this long with no heartbeat. */
export const WAITING_STALE_MS = 45 * 60 * 1000;

/**
 * A match in progress drops off after this long with nothing happening.
 *
 * Every action writes the board document, so a match anyone is actually
 * playing keeps its timestamp fresh. Longer than the waiting window, because a
 * real match can pause for a meal — and nothing is lost if this guess is wrong
 * in either direction: the board carries no join button, players resume from
 * their own list, and the very next action puts the row straight back.
 */
export const ACTIVE_STALE_MS = 3 * 60 * 60 * 1000;

/**
 * Is this room still worth showing? An abandoned room is worse than no room:
 * someone reads "Round 3" and believes a game is going on.
 */
export function isOnTheField(
  status: "active" | "waiting",
  updatedAt: Date | null,
  now: number = Date.now(),
): boolean {
  if (!updatedAt) return false;
  const idle = now - updatedAt.getTime();
  return idle < (status === "active" ? ACTIVE_STALE_MS : WAITING_STALE_MS);
}
