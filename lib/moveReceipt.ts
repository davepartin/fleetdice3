import type { MatchAction, MatchState, SideId } from "./engine";

export type Receipt = { sequence: number; id: string };
export type MoveEnvelope = {
  id: string;
  sequence: number;
  round: number;
  phase: string;
  rolls: number;
  createdAt: number;
  action: MatchAction;
};
export type MoveReceipts = Partial<Record<SideId, Receipt>>;

export function checkMove(state: MatchState, side: SideId, receipts: MoveReceipts, move: MoveEnvelope): "apply" | "acknowledged" {
  const last = receipts[side];
  if (last && last.sequence >= move.sequence) {
    if (last.sequence === move.sequence && last.id === move.id) return "acknowledged";
    throw new Error("Another tab already moved this fleet. Your battle is up to date; choose your next move.");
  }
  const p = state.players[side]!;
  if (move.sequence !== (last?.sequence ?? 0) + 1 || move.round !== p.round || move.phase !== p.phase || move.rolls !== p.rolls) {
    throw new Error("The battle moved on before that tap arrived. Check your fleet and choose again.");
  }
  if (Date.now() - move.createdAt > 10 * 60 * 1000) {
    throw new Error("That unsent move expired. Your battle is still here; choose your next move.");
  }
  return "apply";
}

export function pendingMoveKey(matchId: string, uid: string) { return `fd3.pending.${matchId}.${uid}`; }
export function loadPendingMove(matchId: string, uid: string): MoveEnvelope | null {
  try {
    const m = JSON.parse(localStorage.getItem(pendingMoveKey(matchId, uid)) || "null");
    return m && typeof m.id === "string" && Number.isInteger(m.sequence) && m.action?.type ? m : null;
  } catch { return null; }
}
export function storePendingMove(matchId: string, uid: string, move: MoveEnvelope) {
  localStorage.setItem(pendingMoveKey(matchId, uid), JSON.stringify(move));
}
export function clearPendingMove(matchId: string, uid: string, id: string) {
  try {
    if (loadPendingMove(matchId, uid)?.id === id) localStorage.removeItem(pendingMoveKey(matchId, uid));
  } catch { /* Safe to retain: the receipt prevents another spend. */ }
}
