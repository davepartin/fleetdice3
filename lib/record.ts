/**
 * Your solo record, kept on this device.
 *
 * Every difficulty number in `sim/` is the Enemy playing itself. That says the
 * tiers are ordered; it says nothing about whether *you* can beat them, which
 * is the only question "is this the right difficulty?" is really asking. This
 * is the missing half — the result of matches a person actually played.
 *
 * localStorage only. Nothing leaves the device and nothing is sent anywhere.
 * Every read and write is guarded: a browser in private mode, with site data
 * blocked, or over quota throws instead of returning empty, and a thrown
 * storage error must never cost someone the match they just won.
 */

import { DIFFICULTIES, type Difficulty } from "./ai";

const KEY = "fd3.solo.record.v1";

export type TierRecord = {
  wins: number;
  losses: number;
  draws: number;
  /** Summed so the store stays a fixed size no matter how much you play. */
  roundsTotal: number;
  /** Your flagship health at the end, summed across finished matches. */
  hpLeftTotal: number;
};

export type SoloRecord = {
  tiers: Partial<Record<Difficulty, TierRecord>>;
  /** The last match folded in, so a re-render or remount cannot double-count. */
  lastId: string | null;
};

export type SoloResult = {
  matchId: string;
  difficulty: Difficulty;
  outcome: "win" | "loss" | "draw";
  rounds: number;
  hpLeft: number;
};

export const emptyRecord = (): SoloRecord => ({ tiers: {}, lastId: null });

const emptyTier = (): TierRecord => ({
  wins: 0,
  losses: 0,
  draws: 0,
  roundsTotal: 0,
  hpLeftTotal: 0,
});

/**
 * Fold one finished match into the record.
 *
 * Pure, and idempotent per match: replaying the same `matchId` returns the
 * store untouched, which is what makes it safe to call from a render effect.
 */
export function applyResult(store: SoloRecord, result: SoloResult): SoloRecord {
  if (store.lastId === result.matchId) return store;
  const before = store.tiers[result.difficulty] ?? emptyTier();
  const tier: TierRecord = {
    wins: before.wins + (result.outcome === "win" ? 1 : 0),
    losses: before.losses + (result.outcome === "loss" ? 1 : 0),
    draws: before.draws + (result.outcome === "draw" ? 1 : 0),
    roundsTotal: before.roundsTotal + Math.max(0, result.rounds),
    hpLeftTotal: before.hpLeftTotal + Math.max(0, result.hpLeft),
  };
  return { tiers: { ...store.tiers, [result.difficulty]: tier }, lastId: result.matchId };
}

export const played = (tier?: TierRecord): number =>
  tier ? tier.wins + tier.losses + tier.draws : 0;

/** Your win rate on a tier, or null until it means anything. */
export function winRate(tier: TierRecord | undefined, minimum = 3): number | null {
  const n = played(tier);
  if (!tier || n < minimum) return null;
  return (tier.wins + tier.draws * 0.5) / n;
}

/**
 * The tier to suggest next, or null to stay put.
 *
 * Only ever suggests one step up, and only on real evidence — a tier you are
 * clearly winning. It never suggests stepping *down*: being told the game
 * thinks you should try something easier is a worse feeling than losing.
 */
export function suggestStepUp(store: SoloRecord, current: Difficulty): Difficulty | null {
  const rate = winRate(store.tiers[current]);
  if (rate === null || rate < 0.6) return null;
  const next = DIFFICULTIES[DIFFICULTIES.indexOf(current) + 1];
  return next ?? null;
}

/* ------------------------------------------------------------------ */
/* Storage                                                             */
/* ------------------------------------------------------------------ */

export function loadRecord(): SoloRecord {
  if (typeof window === "undefined") return emptyRecord();
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return emptyRecord();
    const parsed = JSON.parse(raw) as SoloRecord;
    if (!parsed || typeof parsed !== "object" || !parsed.tiers) return emptyRecord();
    return { tiers: parsed.tiers, lastId: parsed.lastId ?? null };
  } catch {
    return emptyRecord();
  }
}

export function saveRecord(store: SoloRecord): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    /* private mode, blocked site data, or over quota — the match still counts on screen */
  }
}

/** Fold a finished match in and persist it. Returns the new record. */
export function recordSoloResult(result: SoloResult): SoloRecord {
  const next = applyResult(loadRecord(), result);
  saveRecord(next);
  return next;
}

export function clearRecord(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* nothing to do */
  }
}
