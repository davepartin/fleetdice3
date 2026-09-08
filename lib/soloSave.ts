import type { MatchState } from "./engine";
import { DIFFICULTIES, PLANS, type Brain, type Difficulty } from "./ai";

export const SOLO_SAVE_KEY = "fd3.solo.battle.v1";
export type SoloSave = { schema: 1; savedAt: number; state: MatchState; brain: Brain };

/** Reject damaged or incompatible saves without overwriting the original. */
export function parseSoloSave(raw: string | null): SoloSave | null {
  try {
    const save = JSON.parse(raw || "null") as SoloSave | null;
    if (!save || save.schema !== 1 || !Number.isFinite(save.savedAt)) return null;
    if (!DIFFICULTIES.includes(save.brain?.difficulty) || !PLANS.includes(save.brain?.plan)) return null;
    const s = save.state;
    if (!s || s.mode !== "solo" || !s.id || s.status !== "active" || !Number.isInteger(s.version)) return null;
    for (const p of [s.players?.host, s.players?.guest]) {
      if (!p || !Number.isFinite(p.hp) || !Number.isFinite(p.energy) || !Number.isInteger(p.round)) return null;
      if (!Array.isArray(p.ships) || !Array.isArray(p.dice) || p.open?.length !== 8 || !p.flag) return null;
      if (!["shop", "ready", "rolling", "submitted", "brace", "report", "over"].includes(p.phase)) return null;
    }
    return save;
  } catch { return null; }
}

export function loadSoloSave(): SoloSave | null {
  try { return parseSoloSave(localStorage.getItem(SOLO_SAVE_KEY)); } catch { return null; }
}

export function saveSoloBattle(state: MatchState, brain: Brain): boolean {
  try {
    if (state.status === "finished") {
      // Do not remove a different battle saved by another tab.
      if (loadSoloSave()?.state.id === state.id) localStorage.removeItem(SOLO_SAVE_KEY);
    } else {
      localStorage.setItem(SOLO_SAVE_KEY, JSON.stringify({ schema: 1, savedAt: Date.now(), state, brain } satisfies SoloSave));
    }
    return true;
  } catch { return false; }
}

export function resumeDifficulty(save: SoloSave): Difficulty { return save.brain.difficulty; }
