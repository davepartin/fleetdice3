/**
 * When a commander taps Roll, the board must throw the dice once.
 *
 * Versus used to mark the dice as "thrown" on the tap, then immediately
 * sync the *old* board (the button press also flips busy / selection). That
 * first sync tossed them. When the real numbers arrived a moment later, they
 * tossed again. This file decides whether the new state is actually the roll
 * we asked for.
 */

import type { PlayerState } from "./engine";

export type PendingThrow = {
  ids: Set<string>;
  rolls: number;
  signature: string;
};

export function diceSignature(player: PlayerState | null | undefined): string {
  if (!player?.dice.length) return "";
  return player.dice
    .map((die) => `${die.id}:${die.value}`)
    .sort()
    .join(",");
}

export function pendingThrow(player: PlayerState | null | undefined, ids: Iterable<string>): PendingThrow | null {
  if (!player) return null;
  return {
    ids: new Set(ids),
    rolls: player.rolls,
    signature: diceSignature(player),
  };
}

/** True once this player's board has actually changed since they tapped Roll. */
export function pendingThrowReady(
  pending: PendingThrow | null | undefined,
  player: PlayerState | null | undefined,
): boolean {
  if (!pending || !player) return false;
  return player.rolls > pending.rolls || diceSignature(player) !== pending.signature;
}
