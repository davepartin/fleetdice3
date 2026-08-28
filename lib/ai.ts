/**
 * The opponent brain — and the yardstick.
 *
 * Solo mode drives the Enemy with this. The simulation harness drives *both*
 * commanders with it, which is why a number measured in `sim/` means something
 * about the game a person actually plays.
 *
 * No DOM, no React. Pure functions over engine state.
 */

import {
  type DieValue,
  type DieSize,
  type MatchAction,
  type MatchState,
  type PlayerState,
  type SideId,
  type Tally,
  TUNING,
  activeShips,
  bestRun,
  emptyOpenSlots,
  escalationFor,
  flagshipUpgradeCost,
  nextSlotCost,
  openSlotCount,
  priceOf,
  roll,
  shipInSlot,
  tally,
  upgradeCost,
  upgradeTarget,
} from "./engine";

export type Plan = "width" | "capital" | "command" | "balanced" | "formation";
export const PLANS: Plan[] = ["width", "capital", "command", "balanced", "formation"];

export const PLAN_LABEL: Record<Plan, string> = {
  width: "Wolfpack",
  capital: "Capital",
  command: "Command",
  balanced: "Balanced",
  formation: "Formation",
};

export const PLAN_BLURB: Record<Plan, string> = {
  width: "Opens every cell and floods the board with cheap hulls.",
  capital: "Few ships, but the biggest ones — d8s and d10s.",
  command: "Pours Energy into the flagship, then grows around it.",
  balanced: "Takes whatever is cheapest per point of value.",
  formation: "Builds toward matching rows and columns on the board.",
};

export type Difficulty = "cadet" | "captain" | "admiral";

/**
 * How hard the Enemy plays.
 *
 * `candidates` caps how many reroll shapes get evaluated — see chooseReroll's
 * SHAPES list below, which is ordered most-valuable-first specifically so a
 * low candidate count still reaches "build a formation" and "build a
 * straight" rather than only the generic keep-the-good-stuff shapes. Every
 * tier can now SEE a formation; what separates them is how well they read
 * it (`samples`, noisier when low), how consistently they act on their own
 * best read (`greed`), how readily they'll spend banked Energy on a reroll
 * instead of saving it (`rerollThreshold` — the minimum value gained per
 * Energy spent; lower means more willing to spend), how big a swing the
 * once-a-match flagship token needs before it's worth using
 * (`tokenThreshold`), how eagerly it throws extra hulls in front of a
 * volley beyond what survival requires (`braceCaution` — the health
 * fraction below which it starts feeding ships it doesn't strictly need
 * to; low means it commits hulls only when truly squeezed, high means it
 * plays it safe and burns ships early), and how much Energy it holds back
 * while shopping once its fleet is established (`rerollReserve`) — a tier
 * that spends paid rerolls precisely should keep some Energy in the bank
 * for them rather than dumping it all on the shipyard.
 */
export const DIFFICULTY: Record<
  Difficulty,
  {
    samples: number;
    candidates: number;
    greed: number;
    rerollThreshold: number;
    tokenThreshold: number;
    braceCaution: number;
    rerollReserve: number;
    label: string;
    blurb: string;
  }
> = {
  cadet: {
    samples: 12,
    candidates: 4,
    greed: 0.55,
    rerollThreshold: 2.4,
    tokenThreshold: 9,
    braceCaution: 0.65,
    rerollReserve: 0,
    label: "Cadet",
    blurb: "Learning the ropes. Spots a formation but reads it poorly, and rarely spends Energy to chase one.",
  },
  captain: {
    samples: 40,
    candidates: 7,
    greed: 0.85,
    rerollThreshold: 1.7,
    tokenThreshold: 6,
    braceCaution: 0.45,
    rerollReserve: 2,
    label: "Captain",
    blurb: "Plays the board properly — chases formations and straights, spends Energy when it's worth it.",
  },
  admiral: {
    samples: 120,
    candidates: 10,
    greed: 1,
    rerollThreshold: 1.15,
    tokenThreshold: 4,
    braceCaution: 0.3,
    rerollReserve: 4,
    label: "Admiral",
    blurb: "Reads every line, never wastes a roll or a hull, and knows exactly when a paid reroll pays for itself.",
  },
};

/* ------------------------------------------------------------------ */
/* Valuing a round                                                     */
/* ------------------------------------------------------------------ */

/**
 * What a roll is worth in one number, in "points of damage".
 *
 * Direct beats plain attack because nothing stops it. Energy is worth more than
 * a point of damage because it compounds into ships. Shields are worth less
 * than attack because they only matter against what the other side happens to
 * throw this round.
 */
export const WEIGHTS = {
  attack: 1,
  defense: 0.62,
  energy: 1.45,
  heal: 0.95,
  direct: 1.75,
};

export function valueOfTally(t: Tally, ctx: { hpRatio: number; pressure: number } = { hpRatio: 1, pressure: 0 }): number {
  // Low on health? Shields and repair are suddenly worth a great deal more.
  const panic = 1 + (1 - ctx.hpRatio) * 1.4;
  // Late-game Energy is worth less because there is less time to spend it.
  const energyWorth = WEIGHTS.energy * (1 - ctx.pressure * 0.45);
  return (
    t.attack * WEIGHTS.attack +
    t.defense * WEIGHTS.defense * panic +
    t.energy * energyWorth +
    t.heal * WEIGHTS.heal * panic +
    t.direct * WEIGHTS.direct
  );
}

/* ------------------------------------------------------------------ */
/* Choosing which dice to send back                                    */
/* ------------------------------------------------------------------ */

function cloneDice(dice: DieValue[]): DieValue[] {
  return dice.map((die) => ({ ...die }));
}

/** Roll the chosen dice `samples` times and average what the fleet is worth. */
function expectedValue(
  dice: DieValue[],
  rerollIds: Set<string>,
  flagLevel: number,
  ctx: { hpRatio: number; pressure: number },
  samples: number,
): number {
  if (!rerollIds.size) {
    return valueOfTally(tally(dice, flagLevel), ctx);
  }
  let total = 0;
  const working = cloneDice(dice);
  for (let sample = 0; sample < samples; sample += 1) {
    for (let index = 0; index < working.length; index += 1) {
      const source = dice[index]!;
      working[index]!.value = rerollIds.has(source.id) ? roll(source.sides) : source.value;
    }
    total += valueOfTally(tally(working, flagLevel), ctx);
  }
  return total / samples;
}

/** Which board cells already share a number with two others in a line. */
function lineCandidates(dice: DieValue[]): Set<string> {
  const keep = new Set<string>();
  const counts = new Map<number, DieValue[]>();
  for (const die of dice) {
    const bucket = counts.get(die.value) ?? [];
    bucket.push(die);
    counts.set(die.value, bucket);
  }
  for (const [, bucket] of counts) {
    if (bucket.length >= 2) for (const die of bucket) keep.add(die.id);
  }
  return keep;
}

function runCandidates(dice: DieValue[]): Set<string> {
  const keep = new Set<string>();
  const seen = new Set<number>();
  // Keep one die per distinct value — that is what a straight needs.
  const sorted = [...dice].sort((a, b) => a.value - b.value);
  for (const die of sorted) {
    if (seen.has(die.value)) continue;
    seen.add(die.value);
    keep.add(die.id);
  }
  return keep;
}

export type RerollChoice = { reroll: string[]; gain: number };

/**
 * Pick the dice to send back. Generates a handful of sensible "keep" shapes,
 * measures each by rolling it out, and returns the best — along with `gain`,
 * how many points that best shape is worth over just keeping the roll as-is.
 * A caller decides whether that gain is worth paying Energy for.
 *
 * The list is ordered most-valuable-first on purpose: `candidates` (which
 * varies by difficulty) truncates it, and a weak opponent should still be
 * ABLE to see "build a formation" or "build a straight" — the tiers differ
 * in how well they read and commit to that shape, not in whether it exists
 * for them at all.
 */
export function chooseRerollDetailed(
  player: PlayerState,
  options: { samples: number; candidates: number; greed: number; pressure: number },
): RerollChoice {
  const dice = player.dice;
  if (!dice.length) return { reroll: [], gain: 0 };
  const ctx = { hpRatio: player.hp / player.maxHp, pressure: options.pressure };
  const flagLevel = player.flag.level;

  const runKeep = runCandidates(dice);
  const lineKeep = lineCandidates(dice);
  const run = bestRun(dice);
  const inRun = new Set<string>();
  if (run) {
    for (const die of dice) {
      if (die.value >= run.start && die.value <= run.top) inRun.add(die.id);
    }
  }

  const shapes: Set<string>[] = [];
  const add = (keep: (die: DieValue) => boolean) => {
    const reroll = new Set(dice.filter((die) => !keep(die)).map((die) => die.id));
    if (shapes.some((existing) => sameSet(existing, reroll))) return;
    shapes.push(reroll);
  };

  add(() => true); // keep everything — the "do nothing" baseline
  add((die) => lineKeep.has(die.id)); // build a formation
  add((die) => runKeep.has(die.id)); // build a straight
  add((die) => inRun.has(die.id) || runKeep.has(die.id)); // protect the run we have
  add((die) => lineKeep.has(die.id) || die.value >= die.sides - 1); // formation plus the big faces
  add((die) => die.value % 2 === 0 && die.value >= 4); // keep the big hits
  add((die) => die.value >= die.sides - 1); // keep the top faces
  add((die) => die.value % 2 === 0 || die.value === 1 || die.value === 3); // keep hits and marks
  add((die) => die.flag === true); // keep only the flagship
  add((die) => die.value >= 3); // dump the dregs

  const pool = shapes.slice(0, Math.max(3, options.candidates));
  // expectedValue short-circuits to an exact score when the reroll set is
  // empty, so this doubles as the "keep everything" baseline for `gain`.
  const baseline = expectedValue(dice, new Set(), flagLevel, ctx, options.samples);
  let best: { reroll: Set<string>; score: number } | null = null;
  for (const reroll of pool) {
    const score = reroll.size === 0 ? baseline : expectedValue(dice, reroll, flagLevel, ctx, options.samples);
    if (!best || score > best.score) best = { reroll, score };
  }
  if (!best) return { reroll: [], gain: 0 };

  // A weaker opponent sometimes takes the second-best line.
  const picked =
    options.greed < 1 && Math.random() > options.greed
      ? pool[Math.floor(Math.random() * pool.length)]!
      : best.reroll;
  const pickedScore = picked === best.reroll ? best.score : expectedValue(dice, picked, flagLevel, ctx, options.samples);
  return { reroll: [...picked], gain: pickedScore - baseline };
}

/** Just the reroll ids, for callers that don't need the value gain. */
export function chooseReroll(
  player: PlayerState,
  options: { samples: number; candidates: number; greed: number; pressure: number },
): string[] {
  return chooseRerollDetailed(player, options).reroll;
}

function sameSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) if (!b.has(value)) return false;
  return true;
}

/* ------------------------------------------------------------------ */
/* The rest of a turn                                                  */
/* ------------------------------------------------------------------ */

/** Which straight length to cash. Longer is not always better. */
export function chooseStraightTake(player: PlayerState, pressure: number): number | null {
  const run = bestRun(player.dice);
  if (!run) return null;
  const cap = Math.min(run.length, TUNING.runMax);
  const ctx = { hpRatio: player.hp / player.maxHp, pressure };
  let best: { take: number; score: number } | null = null;
  for (let take = TUNING.runMin; take <= cap; take += 1) {
    const score = valueOfTally(tally(player.dice, player.flag.level, take), ctx);
    if (!best || score > best.score) best = { take, score };
  }
  return best?.take ?? null;
}

/** Should the flagship be nudged one number, and which way? */
export function chooseFlagToken(
  player: PlayerState,
  pressure: number,
  threshold = 6,
): -1 | 1 | null {
  if (!player.flag.token || player.phase !== "rolling") return null;
  const ctx = { hpRatio: player.hp / player.maxHp, pressure };
  const now = valueOfTally(tally(player.dice, player.flag.level), ctx);
  let best: { direction: -1 | 1; score: number } | null = null;
  for (const direction of [-1, 1] as const) {
    const moved = cloneDice(player.dice);
    const flag = moved.find((die) => die.flag);
    if (!flag) continue;
    flag.value = ((player.flag.face - 1 + direction + 6) % 6) + 1;
    const score = valueOfTally(tally(moved, player.flag.level), ctx);
    if (!best || score > best.score) best = { direction, score };
  }
  // Only spend the once-a-match token on a swing worth this difficulty's bar.
  if (!best || best.score < now + threshold) return null;
  return best.direction;
}

/**
 * Which ships to throw in front of the volley.
 *
 * Feeding a ship costs you that die next round, so only feed enough to survive
 * or to stop a genuinely painful hit. Smallest hulls first — a d10 that sits
 * out costs far more than a d4 that does. `caution` is the health fraction
 * below which it starts feeding hulls beyond what survival strictly
 * requires — high for a tier that plays it safe and burns ships early, low
 * for one that commits hulls only when truly squeezed.
 */
export function chooseBrace(player: PlayerState, caution = 0.45): string[] {
  const available = activeShips(player, player.round)
    .slice()
    .sort((a, b) => a.sides - b.sides);
  const repair = player.tally?.heal ?? 0;
  const incoming = player.incoming;
  const direct = player.directIncoming;
  const survivable = player.hp + repair - direct;

  // How much blockable damage can land and still leave us alive with room?
  const chosen: string[] = [];
  let soaked = 0;
  for (const ship of available) {
    const landing = Math.max(0, incoming - soaked);
    if (landing === 0) break;
    const hpAfter = survivable - landing;
    // Always survive. Beyond that, feed a hull only when it stops more than it costs.
    const mustBlock = hpAfter <= 0;
    const worthIt = landing >= ship.sides && hpAfter < player.maxHp * caution;
    if (!mustBlock && !worthIt) break;
    chosen.push(ship.id);
    soaked += ship.sides;
  }
  return chosen;
}

/* ------------------------------------------------------------------ */
/* The shipyard                                                        */
/* ------------------------------------------------------------------ */

type Buy =
  | { kind: "slot"; slotIndex: number; cost: number }
  | { kind: "ship"; sides: DieSize; slotIndex: number; cost: number }
  | { kind: "upgrade"; shipId: string; from: DieSize; cost: number }
  | { kind: "flagship"; cost: number };

function affordableBuys(player: PlayerState): Buy[] {
  const out: Buy[] = [];
  const slotCost = nextSlotCost(player);
  if (slotCost !== null && slotCost <= player.energy) {
    const locked = player.open.map((open, index) => ({ open, index })).filter((entry) => !entry.open);
    // Prefer a cell that completes a line with ships already on the board.
    const ranked = locked.sort((a, b) => lineAffinity(player, b.index) - lineAffinity(player, a.index));
    if (ranked.length) out.push({ kind: "slot", slotIndex: ranked[0]!.index, cost: slotCost });
  }
  const empties = emptyOpenSlots(player);
  if (empties.length) {
    for (const sides of [4, 6, 8, 10] as DieSize[]) {
      if (priceOf(sides) <= player.energy) {
        out.push({ kind: "ship", sides, slotIndex: empties[0]!, cost: priceOf(sides) });
      }
    }
  }
  for (const ship of player.ships) {
    const cost = upgradeCost(ship.sides);
    if (cost !== null && cost <= player.energy) {
      out.push({ kind: "upgrade", shipId: ship.id, from: ship.sides, cost });
    }
  }
  const flagCost = flagshipUpgradeCost(player.flag.level);
  if (flagCost !== null && flagCost <= player.energy) out.push({ kind: "flagship", cost: flagCost });
  return out;
}

/** How many lines through this cell already hold ships. */
function lineAffinity(player: PlayerState, slot: number): number {
  const cell = slot < 4 ? slot : slot + 1;
  const row = Math.floor(cell / 3);
  const col = cell % 3;
  let score = 0;
  for (let other = 0; other < 9; other += 1) {
    if (other === cell) continue;
    const sameLine = Math.floor(other / 3) === row || other % 3 === col;
    if (!sameLine) continue;
    if (other === 4) score += 1; // the flagship always shows up
    else {
      const otherSlot = other < 4 ? other : other - 1;
      if (shipInSlot(player, otherSlot)) score += 1;
    }
  }
  return score;
}

/**
 * What one round of a purchase is worth, in points of damage.
 *
 * These come from `node sim/simulate.mjs output`, not from taste. An earlier
 * version of this function scored purchases on hand-picked "base" numbers
 * divided by price, and because a 2⚡ upgrade divides so much better than a 9⚡
 * cell, the brain spent 95% of its money on upgrades and opened a cell roughly
 * once a match. Every balance number measured against that brain described a
 * game nobody plays.
 */
const SHIP_WORTH: Record<DieSize, number> = { 4: 7.5, 6: 8.8, 8: 10.6, 10: 12.4 };
const UPGRADE_WORTH: Record<number, number> = { 4: 1.3, 6: 1.8, 8: 1.8 };

/** Value per Energy of a purchase, shaded by the plan being played. */
function buyScore(player: PlayerState, buy: Buy, plan: Plan, round: number): number {
  const shipCount = player.ships.length;
  let worth: number;
  let cost = buy.cost;
  let bias = 1;

  if (buy.kind === "slot") {
    // An empty cell is worth nothing on its own — price it together with the
    // cheapest hull that would fill it, because that is what you actually buy.
    worth = SHIP_WORTH[4];
    cost = buy.cost + priceOf(4);
    if (plan === "width") bias = 1.5;
    if (plan === "formation") bias = 1.45;
    if (plan === "capital") bias = 0.7;
    if (plan === "command") bias = 0.85;
  } else if (buy.kind === "ship") {
    worth = SHIP_WORTH[buy.sides];
    if (shipCount < 5) bias = 1.25; // a thin fleet needs hulls before anything
    if (plan === "width") bias *= buy.sides <= 6 ? 1.3 : 0.75;
    if (plan === "capital") bias *= buy.sides >= 8 ? 1.35 : 0.8;
    if (plan === "formation") bias *= buy.sides === 6 ? 1.3 : 0.95;
  } else if (buy.kind === "upgrade") {
    worth = UPGRADE_WORTH[buy.from] ?? 1.4;
    if (plan === "capital") bias = 1.45;
    if (plan === "width") bias = 0.75;
    if (plan === "formation") bias = buy.from === 4 ? 1.25 : 1;
  } else {
    // A flagship level pays on every round still to come, so it is worth most
    // early and close to nothing once a match is nearly over.
    worth = 2.3 * Math.max(0.35, 1 - round / 16);
    if (plan === "command") bias = 1.8;
  }

  return (worth / Math.max(1, cost)) * bias;
}

/** One shopping trip. Returns the actions to apply, in order. */
export function planShopping(
  player: PlayerState,
  plan: Plan,
  round: number,
  greed = 1,
  rerollReserve = 2,
): MatchAction[] {
  const actions: MatchAction[] = [];
  const scratch = structuredClone(player);
  // Keep a little back for paid rerolls once the fleet is established.
  const reserve = scratch.ships.length >= 6 ? rerollReserve : 0;

  for (let step = 0; step < 8; step += 1) {
    const buys = affordableBuys(scratch).filter((buy) => buy.cost <= scratch.energy - reserve);
    if (!buys.length) break;
    const ranked = buys
      .map((buy) => ({ buy, score: buyScore(scratch, buy, plan, round) }))
      .sort((a, b) => b.score - a.score);
    const pick =
      greed >= 1 || Math.random() < greed
        ? ranked[0]!
        : ranked[Math.min(ranked.length - 1, 1)]!;
    const buy = pick.buy;

    if (buy.kind === "slot") {
      actions.push({ type: "shop", operation: "slot", slotIndex: buy.slotIndex });
      scratch.energy -= buy.cost;
      scratch.open[buy.slotIndex] = true;
    } else if (buy.kind === "ship") {
      actions.push({ type: "shop", operation: "buy", sides: buy.sides, slotIndex: buy.slotIndex });
      scratch.energy -= buy.cost;
      scratch.ships.push({ id: `sim${step}`, sides: buy.sides, disabledRound: null, slot: buy.slotIndex });
    } else if (buy.kind === "upgrade") {
      actions.push({ type: "shop", operation: "upgrade", shipId: buy.shipId });
      scratch.energy -= buy.cost;
      const ship = scratch.ships.find((candidate) => candidate.id === buy.shipId);
      if (ship) ship.sides = upgradeTarget(ship.sides) ?? ship.sides;
    } else {
      actions.push({ type: "shop", operation: "flagship" });
      scratch.energy -= buy.cost;
      scratch.flag.level += 1;
    }
  }
  return actions;
}

/* ------------------------------------------------------------------ */
/* Driving a whole turn                                                */
/* ------------------------------------------------------------------ */

export type Brain = {
  plan: Plan;
  difficulty: Difficulty;
};

export function newBrain(plan?: Plan, difficulty: Difficulty = "captain"): Brain {
  return {
    plan: plan ?? PLANS[Math.floor(Math.random() * PLANS.length)]!,
    difficulty,
  };
}

/** How urgent the match feels, 0 at the start and 1 when a flagship is nearly gone. */
export function pressureOf(state: MatchState, side: SideId): number {
  const you = state.players[side]!;
  const them = state.players[side === "host" ? "guest" : "host"];
  const lowest = Math.min(you.hp, them?.hp ?? you.hp);
  const byHp = 1 - Math.max(0, lowest) / you.maxHp;
  const byRound = Math.min(1, you.round / 14);
  return Math.max(byHp, byRound * 0.8);
}

/**
 * Everything the opponent wants to do from wherever it currently stands.
 * Call it repeatedly until it returns an empty list.
 */
export function nextActions(state: MatchState, side: SideId, brain: Brain): MatchAction[] {
  const player = state.players[side];
  if (!player || state.status === "finished") return [];

  // In Solo, the battle report belongs to the human. Do not let the Enemy
  // continue, shop and roll the next round behind that report: its newly
  // rolled dice can briefly appear while the reveal camera is still active.
  // Pressing "To the Shipyard" moves the host to `shop`, which is the explicit
  // handoff that releases the Enemy to prepare its next turn out of sight.
  if (
    state.mode === "solo" &&
    side === "guest" &&
    player.phase === "report" &&
    state.players.host.phase !== "shop"
  ) {
    return [];
  }

  const knobs = DIFFICULTY[brain.difficulty];
  const pressure = pressureOf(state, side);

  switch (player.phase) {
    case "shop": {
      return [
        ...planShopping(player, brain.plan, player.round, knobs.greed, knobs.rerollReserve),
        { type: "ready" },
      ];
    }
    case "ready":
      return [{ type: "roll", dice: [] }];
    case "rolling": {
      const actions: MatchAction[] = [];
      const free = player.rolls < TUNING.rollsPerRound;
      const choice = chooseRerollDetailed(player, {
        samples: knobs.samples,
        candidates: knobs.candidates,
        greed: knobs.greed,
        pressure,
      });
      if (free) {
        if (choice.reroll.length) return [{ type: "roll", dice: choice.reroll }];
      } else if (choice.reroll.length) {
        // A paid reroll costs one Energy per die. Asking for more dice than the
        // bank covers makes the engine refuse the move, and with nothing else
        // queued the match simply stops — so check the real price, not a guess.
        const cost = choice.reroll.length;
        const affordable = cost <= player.energy;
        // Worth it when the expected value gained per Energy spent clears the
        // bar for this difficulty — not a flat "got 6 Energy?" gate, so a real
        // shot at a formation gets taken even on a tight bank, and a marginal
        // one still gets passed up even on a full one. Getting desperate (low
        // HP, late round) lowers the bar: a losing fleet should gamble Energy
        // it would otherwise hoard.
        const bar = knobs.rerollThreshold * (1 - pressure * 0.35);
        if (affordable && choice.gain / cost >= bar) return [{ type: "roll", dice: choice.reroll }];
      }
      const token = chooseFlagToken(player, pressure, knobs.tokenThreshold);
      if (token) actions.push({ type: "flag-token", direction: token });
      const take = chooseStraightTake(player, pressure);
      if (take !== null) actions.push({ type: "straight-take", take });
      actions.push({ type: "submit" });
      return actions;
    }
    case "brace":
      return [{ type: "brace", ships: chooseBrace(player, knobs.braceCaution) }];
    case "report":
      return [{ type: "continue" }];
    default:
      return [];
  }
}

/* ------------------------------------------------------------------ */
/* Coaching the human                                                  */
/* ------------------------------------------------------------------ */

export type Hint = { text: string; tone: "good" | "warn" | "info" };

/** A single, honest line of advice for the roll screen. Never nags. */
export function rollHint(state: MatchState, side: SideId): Hint | null {
  const you = state.players[side];
  if (!you || you.phase !== "rolling") return null;
  const t = tally(you.dice, you.flag.level, you.straightTake);
  const run = bestRun(you.dice);
  const rollsLeft = TUNING.rollsPerRound - you.rolls;

  if (run && run.length >= 6) {
    return { text: `${run.length} in a row — worth ${run.reward.label}.`, tone: "good" };
  }
  if (t.lines.some((line) => line.kind === "col")) {
    return { text: "Three matching down a column — that is +10 Attack.", tone: "good" };
  }
  if (t.lines.some((line) => line.kind === "row")) {
    return { text: "Three matching across a row — that is +5 Energy.", tone: "good" };
  }
  const them = state.players[side === "host" ? "guest" : "host"];
  if (them && you.hp <= them.hp * 0.5 && t.heal < 3) {
    return { text: "You are behind on health. A 3 repairs 3.", tone: "warn" };
  }
  if (run && run.length === 4 && rollsLeft > 0) {
    return { text: "One number short of a straight. You need five in a row.", tone: "info" };
  }
  if (you.energy < 4 && t.energy < 3 && rollsLeft > 0) {
    return { text: "Low on Energy — a 1 pays 2, a 4 pays 1.", tone: "info" };
  }
  return null;
}
