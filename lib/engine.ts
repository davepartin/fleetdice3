/**
 * Fleet Dice 3 — the rules engine.
 *
 * One file, no framework, no DOM. The React app, the solo opponent and the
 * simulation harness all call these same functions, so what you measure in a
 * simulation is exactly what a player experiences in a match.
 *
 * Inherited from Fleet Dice 2 and retuned. Every number lives in TUNING.
 */

export type SideId = "host" | "guest";
export type DieSize = 4 | 6 | 8 | 10;

export type PlayerPhase =
  | "waiting"
  | "shop"
  | "ready"
  | "rolling"
  | "submitted"
  | "brace"
  | "report"
  | "over";

export type Ship = {
  id: string;
  sides: DieSize;
  /** Round number this ship sits out because it took a hit. */
  disabledRound: number | null;
  /** Which of the 8 cells around the flagship this ship occupies (0–7). */
  slot: number;
};

export type DieValue = {
  id: string;
  sides: number;
  value: number;
  flag?: boolean;
  slot?: number;
};

export type FormationLine = {
  kind: "row" | "col";
  /** Board cells 0–8 (4 is the flagship). */
  idx: number[];
  value: number;
  energy: number;
  attack: number;
};

export type StraightReward = {
  kind: "energy" | "attack";
  label: string;
  energy?: number;
  attack?: number;
};

export type Straight = {
  start: number;
  top: number;
  length: number;
  biggest: DieSize;
  /** How much of the run the commander decided to cash. */
  taken: number;
  reward: StraightReward;
};

export type Tally = {
  attack: number;
  defense: number;
  energy: number;
  heal: number;
  direct: number;
  /** The flagship's face this round. */
  face: number;
  /** How much of each number the flagship face itself contributed. */
  flagBonus: { attack: number; defense: number; energy: number; heal: number; direct: number };
  run: Straight | null;
  lines: FormationLine[];
};

export type RoundReport = {
  round: number;
  hpBefore: number;
  hpAfter: number;
  /** Blockable damage that arrived, before soak. */
  incoming: number;
  /** Unblockable damage that arrived. */
  direct: number;
  /** Total that actually landed on the flagship. */
  damage: number;
  repair: number;
  energyEarned: number;
  soaked: number;
  bracedShips: { id: string; sides: DieSize }[];
  escalation: number;
  tally: Tally;
  dice: DieValue[];
  /** What the enemy showed this round, for the reveal screen. */
  enemyTally: Tally | null;
  enemyDice: DieValue[];
};

export type PlayerState = {
  uid: string;
  name: string;
  hp: number;
  maxHp: number;
  energy: number;
  baseEnergy: number;
  /** Which of the 8 cells around the flagship are open. */
  open: boolean[];
  ships: Ship[];
  flag: { level: number; face: number; token: boolean };
  /** Combat round this commander is currently playing. */
  round: number;
  phase: PlayerPhase;
  rolls: number;
  dice: DieValue[];
  /** Which straight length the commander chose to cash, if they narrowed it. */
  straightTake: number | null;
  tally: Tally | null;
  incoming: number;
  directIncoming: number;
  braceShips: string[];
  report: RoundReport | null;
  /** Running totals for the end-of-match card. */
  stats: { damageDealt: number; directDealt: number; repaired: number; straights: number; lines: number };
};

export type MatchState = {
  id: string;
  code: string;
  status: "waiting" | "active" | "finished";
  round: number;
  createdAt: string;
  /** "solo" matches run the guest with the built-in opponent. */
  mode: "solo" | "versus";
  players: { host: PlayerState; guest: PlayerState | null };
  winner: SideId | "draw" | null;
  cancelledBy?: string | null;
  version: number;
};

export type MatchAction =
  | { type: "shop"; operation: "upgrade"; shipId: string }
  | { type: "shop"; operation: "buy"; sides: DieSize; slotIndex: number }
  | { type: "shop"; operation: "slot"; slotIndex: number }
  | { type: "shop"; operation: "flagship" }
  | { type: "ready" }
  | { type: "roll"; dice: string[] }
  | { type: "flag-token"; direction: -1 | 1 }
  | { type: "straight-take"; take: number }
  | { type: "submit" }
  | { type: "brace"; ships: string[] }
  | { type: "continue" };

/* ------------------------------------------------------------------ */
/* Tuning — every number in the game                                   */
/* ------------------------------------------------------------------ */

export const TUNING = {
  /** Flagship health. The length dial: 60 gives roughly a 12-round match. */
  hp: 60,
  /**
   * How many fleet cells are open at the start, of 8.
   *
   * Which ones they are matters far more than how many. See CELL_ORDER below.
   */
  startSlots: 4,
  /** Energy in the bank at the start. */
  startEnergy: 0,
  /** Free rolls a round; after that 1 Energy per die. */
  rollsPerRound: 3,
  /** Ship prices, by measured value rather than by size. */
  prices: { 4: 4, 6: 6, 8: 9, 10: 13 } as Record<DieSize, number>,
  /**
   * Opening the Nth cell costs N + slotCostOffset.
   *
   * Back at Fleet Dice 2's price. It was briefly raised to 4, on a measurement
   * that turned out to be answering a different question: at the time the
   * starting cells were the top-left corner, columns could not form, and the
   * cheap wide fleet ran away with matches. Once the opening shape became the
   * four cells around the flagship, 2, 3 and 4 measured within noise of each
   * other — the spread moved further between two runs of the same setting than
   * it did between settings. With nothing to choose between them, the cheaper
   * cell wins: more cells bought means more lines on the board.
   */
  slotCostOffset: 2,
  /**
   * Flagship level 1 → 2 → 3. At 10 then 16 levelling was a dead purchase: the
   * same Energy spent on upgrades beat it 60/40 at level 2 and 78/22 at level 3.
   * At 5 then 8 both steps land inside a point or two of an even trade.
   */
  flagCost: { 1: 5, 2: 8 } as Record<number, number>,
  /** Flagship bonus size at each level. */
  flagBonus: { 1: 2, 2: 3, 3: 4 } as Record<number, number>,
  /** Reactor: base Energy ceiling, and what a capped Reactor pays instead. */
  reactorCap: 6,
  reactorOverflow: 2,
  /** Dice needed before a straight counts. */
  runMin: 5,
  /** Longest run that pays more. Beyond this the prize stops growing. */
  runMax: 7,
  /** Three of a kind across a row of the board. */
  lineAcrossEnergy: 5,
  /** Three of a kind down a column of the board. */
  lineDownAttack: 10,
  /** Attack (not Direct) rises by this much per round once the war escalates. */
  escalateAfterRound: 8,
  escalateStep: 4,
  /** Hard stop so a stalled match cannot run forever. */
  roundLimit: 40,
};

/**
 * The order fleet cells open in — the four beside the flagship first, then the
 * corners.
 *
 * Fleet Dice 2 opened slots 0,1,2,3, which is the top-left corner of the board:
 *
 *     # # #     A row is possible. A column never is: there is no second cell
 *     # F .     under any of the top three. The 10 Attack column prize could
 *     . . .     not be collected, however long the match ran.
 *
 * Opening the four cells *around* the flagship instead gives:
 *
 *     . # .     One row and one column, both live from the very first roll,
 *     # F #     both running through the flagship. Same four ships, same
 *     . # .     price. The grid is finally a grid.
 *
 * Each corner bought after that adds new lines rather than making the first
 * one possible, which is what spending Energy on a cell should feel like.
 */
export const CELL_ORDER: readonly number[] = [1, 3, 4, 6, 0, 2, 5, 7];

/** The slots a fleet begins with, in opening order. */
export function openingSlots(count: number = TUNING.startSlots): number[] {
  return CELL_ORDER.slice(0, Math.max(0, Math.min(8, count)));
}

const UPGRADE: Partial<Record<DieSize, DieSize>> = { 4: 6, 6: 8, 8: 10 };

/* ------------------------------------------------------------------ */
/* Face table — what every number on every ship pays                   */
/* ------------------------------------------------------------------ */

/** Even hits, odd blocks. Covers every face on every ship, the 1 included. */
export function attackOf(value: number): number {
  return value % 2 === 0 ? value : 0;
}
export function defenseOf(value: number): number {
  return value % 2 === 1 ? value : 0;
}
export function energyOf(value: number): number {
  if (value === 1) return 2;
  if (value === 4) return 1;
  return 0;
}
export function repairOf(value: number): number {
  if (value === 3) return 3;
  return ({ 5: 1, 7: 2, 9: 3 } as Record<number, number>)[value] ?? 0;
}
export function directOf(value: number): number {
  if (value === 2) return 2;
  return ({ 6: 1, 8: 2, 10: 3 } as Record<number, number>)[value] ?? 0;
}

export type FaceRow = {
  value: number;
  fights: "hits" | "blocks";
  amount: number;
  energy: number;
  repair: number;
  direct: number;
};

/** The whole face table, for How to play. */
export function faceTable(): FaceRow[] {
  return Array.from({ length: 10 }, (_, index) => {
    const value = index + 1;
    return {
      value,
      fights: value % 2 === 0 ? ("hits" as const) : ("blocks" as const),
      amount: value,
      energy: energyOf(value),
      repair: repairOf(value),
      direct: directOf(value),
    };
  });
}

export const FLAG_FACES = [
  { face: 1, name: "Reactor", blurb: "your Energy income rises for the rest of the match" },
  { face: 2, name: "Direct", blurb: "every 2 in your fleet fires extra Direct" },
  { face: 3, name: "Repair", blurb: "every 3 in your fleet repairs extra" },
  { face: 4, name: "Energy", blurb: "every 4 in your fleet pays extra Energy" },
  { face: 5, name: "Shields", blurb: "every blue ship blocks extra" },
  { face: 6, name: "Attack", blurb: "every red ship hits extra" },
] as const;

export function flagBonusSize(level: number): number {
  return TUNING.flagBonus[Math.min(3, Math.max(1, level))] ?? 2;
}

/* ------------------------------------------------------------------ */
/* Board geometry — 3×3, flagship at centre                            */
/* ------------------------------------------------------------------ */

/** Board cell 0–8. Cell 4 is the flagship; ships live in fleet slots 0–7. */
export function cellForSlot(slot: number): number {
  return slot < 4 ? slot : slot + 1;
}
export function slotForCell(cell: number): number | null {
  if (cell === 4) return null;
  return cell < 4 ? cell : cell - 1;
}
/** The number a player sees on a cell: ships are 1–4 and 6–9, flagship is 5. */
export function cellLabel(cell: number): number {
  return cell + 1;
}

const FLEET_LINES: { kind: "row" | "col"; idx: number[] }[] = [
  { kind: "row", idx: [0, 1, 2] },
  { kind: "row", idx: [3, 4, 5] },
  { kind: "row", idx: [6, 7, 8] },
  { kind: "col", idx: [0, 3, 6] },
  { kind: "col", idx: [1, 4, 7] },
  { kind: "col", idx: [2, 5, 8] },
];

/* ------------------------------------------------------------------ */
/* Randomness — injectable so simulations can be reproducible          */
/* ------------------------------------------------------------------ */

export type Rng = () => number;
let RNG: Rng = Math.random;
export function setRng(rng: Rng) {
  RNG = rng;
}
export function makeRng(seed: number): Rng {
  // mulberry32 — small, fast, good enough for dice.
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function roll(sides: number): number {
  return Math.floor(RNG() * sides) + 1;
}

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
export function randomId(length = 12): string {
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += ALPHABET[Math.floor(RNG() * ALPHABET.length)];
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Setting up                                                          */
/* ------------------------------------------------------------------ */

export function newPlayer(uid: string, name: string, phase: PlayerPhase): PlayerState {
  return {
    uid,
    name: cleanName(name),
    hp: TUNING.hp,
    maxHp: TUNING.hp,
    energy: TUNING.startEnergy,
    baseEnergy: 0,
    open: (() => {
      const start = openingSlots();
      return Array.from({ length: 8 }, (_, index) => start.includes(index));
    })(),
    ships: openingSlots().map((slot, index) => ({
      id: `s${index}${randomId(6)}`,
      sides: 4 as DieSize,
      disabledRound: null,
      slot,
    })),
    flag: { level: 1, face: 1, token: true },
    round: 1,
    phase,
    rolls: 0,
    dice: [],
    straightTake: null,
    tally: null,
    incoming: 0,
    directIncoming: 0,
    braceShips: [],
    report: null,
    stats: { damageDealt: 0, directDealt: 0, repaired: 0, straights: 0, lines: 0 },
  };
}

export function newMatch(
  id: string,
  code: string,
  uid: string,
  name: string,
  mode: "solo" | "versus" = "versus",
): MatchState {
  return {
    id,
    code,
    status: mode === "solo" ? "active" : "waiting",
    round: 1,
    createdAt: new Date().toISOString(),
    mode,
    players: {
      host: newPlayer(uid, name, mode === "solo" ? "ready" : "waiting"),
      guest: mode === "solo" ? newPlayer("enemy", "Enemy", "ready") : null,
    },
    winner: null,
    version: 1,
  };
}

export function joinMatch(state: MatchState, uid: string, name: string): MatchState {
  if (state.players.host.uid === uid) return state;
  if (state.players.guest?.uid === uid) return state;
  if (state.players.guest) throw new Error("This match already has two commanders.");
  if (state.status !== "waiting") throw new Error("This match has already started.");
  state.players.guest = newPlayer(uid, name, "ready");
  state.players.host.phase = "ready";
  state.status = "active";
  return state;
}

export function roleFor(state: MatchState, uid: string): SideId | null {
  if (state.players.host.uid === uid) return "host";
  if (state.players.guest?.uid === uid) return "guest";
  return null;
}

export function opponentOf(side: SideId): SideId {
  return side === "host" ? "guest" : "host";
}

/* ------------------------------------------------------------------ */
/* Prices and shop reads                                               */
/* ------------------------------------------------------------------ */

export function priceOf(sides: DieSize): number {
  return TUNING.prices[sides];
}
export function upgradeTarget(sides: DieSize): DieSize | null {
  return UPGRADE[sides] ?? null;
}
export function upgradeCost(sides: DieSize): number | null {
  const next = UPGRADE[sides];
  if (!next) return null;
  return priceOf(next) - priceOf(sides);
}
export function openSlotCount(player: PlayerState): number {
  return player.open.filter(Boolean).length;
}
export function nextSlotCost(player: PlayerState): number | null {
  const opened = openSlotCount(player);
  if (opened >= 8) return null;
  return opened + 1 + TUNING.slotCostOffset;
}
export function flagshipUpgradeCost(level: number): number | null {
  return TUNING.flagCost[level] ?? null;
}
export function shipInSlot(player: PlayerState, slot: number): Ship | undefined {
  return player.ships.find((ship) => ship.slot === slot);
}
export function emptyOpenSlots(player: PlayerState): number[] {
  const out: number[] = [];
  for (let slot = 0; slot < 8; slot += 1) {
    if (player.open[slot] && !shipInSlot(player, slot)) out.push(slot);
  }
  return out;
}
export function activeShips(player: PlayerState, round: number): Ship[] {
  return player.ships.filter((ship) => ship.disabledRound !== round);
}
export function fleetValue(player: PlayerState): number {
  return player.ships.reduce((sum, ship) => sum + priceOf(ship.sides), 0);
}

/* ------------------------------------------------------------------ */
/* Scoring                                                             */
/* ------------------------------------------------------------------ */

function boardCell(dice: DieValue[], cell: number): DieValue | undefined {
  if (cell === 4) return dice.find((die) => die.flag);
  const slot = slotForCell(cell);
  return dice.find((die) => !die.flag && die.slot === slot);
}

export function findLines(dice: DieValue[]): FormationLine[] {
  const hits: FormationLine[] = [];
  for (const line of FLEET_LINES) {
    const cells = line.idx.map((cell) => boardCell(dice, cell));
    if (cells.some((die) => !die || !die.value)) continue;
    const first = cells[0]!;
    if (!cells.every((die) => die!.value === first.value)) continue;
    hits.push({
      kind: line.kind,
      idx: line.idx.slice(),
      value: first.value,
      energy: line.kind === "row" ? TUNING.lineAcrossEnergy : 0,
      attack: line.kind === "col" ? TUNING.lineDownAttack : 0,
    });
  }
  return hits;
}

export function straightReward(length: number, biggest: DieSize): StraightReward {
  if (length >= 7) {
    return { kind: "attack", attack: biggest * 3, label: `${biggest * 3} Attack` };
  }
  if (length >= 6) {
    return { kind: "attack", attack: biggest * 2, label: `${biggest * 2} Attack` };
  }
  const energy = Math.round(biggest * 1.5);
  return { kind: "energy", energy, label: `${energy} Energy` };
}

export function bestRun(dice: DieValue[], chosenTake?: number | null): Straight | null {
  // Biggest ship showing each number. The flagship joins the line but is size 0,
  // because it never fights and must not decide how big the prize is.
  const byValue = new Map<number, number>();
  for (const die of dice) {
    if (die.flag) {
      if (!byValue.has(die.value)) byValue.set(die.value, 0);
    } else {
      byValue.set(die.value, Math.max(byValue.get(die.value) ?? 0, die.sides));
    }
  }

  let best: { start: number; top: number; length: number; biggest: DieSize } | null = null;
  for (let start = 1; start <= 10; start += 1) {
    if (!byValue.has(start)) continue;
    if (byValue.has(start - 1)) continue; // only measure from the bottom of a run
    let length = 0;
    while (byValue.has(start + length)) length += 1;
    if (length < TUNING.runMin) continue;
    let biggest = 0;
    for (let value = start; value < start + length; value += 1) {
      biggest = Math.max(biggest, byValue.get(value) ?? 0);
    }
    if (!biggest) continue; // a run made only of the flagship is not a fleet line
    if (!best || length > best.length || (length === best.length && biggest > best.biggest)) {
      best = { start, top: start + length - 1, length, biggest: biggest as DieSize };
    }
  }
  if (!best) return null;

  const cap = Math.min(best.length, TUNING.runMax);
  const taken = Math.max(TUNING.runMin, Math.min(chosenTake ?? cap, cap));
  return { ...best, taken, reward: straightReward(taken, best.biggest) };
}

export function tally(
  dice: DieValue[],
  flagLevel: number,
  chosenTake?: number | null,
): Tally {
  const result: Tally = {
    attack: 0,
    defense: 0,
    energy: 0,
    heal: 0,
    direct: 0,
    face: dice.find((die) => die.flag)?.value ?? 1,
    flagBonus: { attack: 0, defense: 0, energy: 0, heal: 0, direct: 0 },
    run: null,
    lines: [],
  };

  const fleet = dice.filter((die) => !die.flag);
  for (const die of fleet) {
    result.attack += attackOf(die.value);
    result.defense += defenseOf(die.value);
    result.energy += energyOf(die.value);
    result.heal += repairOf(die.value);
    result.direct += directOf(die.value);
  }

  const run = bestRun(dice, chosenTake);
  result.run = run;
  if (run) {
    result.attack += run.reward.attack ?? 0;
    result.energy += run.reward.energy ?? 0;
  }

  result.lines = findLines(dice);
  for (const line of result.lines) {
    result.attack += line.attack;
    result.energy += line.energy;
  }

  // The flagship never fights. Its face rings matching ships and boosts them.
  const bonus = flagBonusSize(flagLevel);
  const face = result.face;
  if (face === 2) {
    const hit = fleet.filter((die) => die.value === 2).length * bonus;
    result.direct += hit;
    result.flagBonus.direct = hit;
  } else if (face === 3) {
    const hit = fleet.filter((die) => die.value === 3).length * bonus;
    result.heal += hit;
    result.flagBonus.heal = hit;
  } else if (face === 4) {
    const hit = fleet.filter((die) => die.value === 4).length * bonus;
    result.energy += hit;
    result.flagBonus.energy = hit;
  } else if (face === 5) {
    const hit = fleet.filter((die) => die.value % 2 === 1).length * bonus;
    result.defense += hit;
    result.flagBonus.defense = hit;
  } else if (face === 6) {
    const hit = fleet.filter((die) => die.value % 2 === 0).length * bonus;
    result.attack += hit;
    result.flagBonus.attack = hit;
  }

  return result;
}

export function previewTally(player: PlayerState, take?: number | null): Tally {
  return tally(player.dice, player.flag.level, take ?? player.straightTake);
}

export function escalationFor(round: number): number {
  return round > TUNING.escalateAfterRound
    ? (round - TUNING.escalateAfterRound) * TUNING.escalateStep
    : 0;
}

/* ------------------------------------------------------------------ */
/* Playing a round                                                     */
/* ------------------------------------------------------------------ */

export function applyAction(state: MatchState, side: SideId, action: MatchAction): MatchState {
  if (state.status === "finished") throw new Error("This match is finished.");
  if (finishIfNeeded(state)) return state;

  const player = state.players[side];
  if (!player) throw new Error("The second commander has not joined yet.");

  switch (action.type) {
    case "shop":
      handleShop(player, action);
      break;
    case "ready":
      if (player.phase !== "shop") throw new Error("You are not in the shipyard.");
      prepareRound(player);
      break;
    case "roll":
      handleRoll(player, action.dice);
      break;
    case "flag-token":
      handleFlagToken(player, action.direction);
      break;
    case "straight-take":
      handleStraightTake(player, action.take);
      break;
    case "submit":
      handleSubmit(player);
      resolveSubmissions(state);
      break;
    case "brace":
      handleBrace(state, player, action.ships);
      break;
    case "continue":
      handleContinue(state, player);
      break;
  }

  state.version += 1;
  finishIfNeeded(state);
  return state;
}

function handleShop(player: PlayerState, action: Extract<MatchAction, { type: "shop" }>) {
  if (player.phase !== "shop") throw new Error("The shipyard is only open between rounds.");

  if (action.operation === "slot") {
    const slot = action.slotIndex;
    if (slot < 0 || slot > 7) throw new Error("Tap the locked cell you want to open.");
    if (player.open[slot]) throw new Error("That cell is already open.");
    const cost = nextSlotCost(player);
    if (cost === null) throw new Error("Every fleet cell is already open.");
    spend(player, cost);
    player.open = player.open.map((value, index) => (index === slot ? true : value));
    return;
  }

  if (action.operation === "flagship") {
    const cost = flagshipUpgradeCost(player.flag.level);
    if (cost === null) throw new Error("Your flagship is already at level 3.");
    spend(player, cost);
    player.flag.level += 1;
    return;
  }

  if (action.operation === "buy") {
    const slot = action.slotIndex;
    if (!emptyOpenSlots(player).includes(slot)) throw new Error("Tap an open, empty cell first.");
    spend(player, priceOf(action.sides));
    player.ships.push({ id: `s${randomId(9)}`, sides: action.sides, disabledRound: null, slot });
    return;
  }

  const ship = player.ships.find((candidate) => candidate.id === action.shipId);
  if (!ship) throw new Error("That ship is no longer in your fleet.");
  const next = upgradeTarget(ship.sides);
  if (!next) throw new Error("That ship is already a d10.");
  spend(player, priceOf(next) - priceOf(ship.sides));
  ship.sides = next;
}

function prepareRound(player: PlayerState) {
  player.phase = "ready";
  player.rolls = 0;
  player.dice = [];
  player.straightTake = null;
  player.tally = null;
  player.report = null;
}

function handleRoll(player: PlayerState, chosen: string[]) {
  if (player.phase === "ready") {
    player.dice = activeShips(player, player.round).map((ship) => ({
      id: ship.id,
      sides: ship.sides,
      value: roll(ship.sides),
      slot: ship.slot,
    }));
    player.flag.face = roll(6);
    player.dice.push({ id: "flag", sides: 6, value: player.flag.face, flag: true });
    player.rolls = 1;
    player.straightTake = null;
    player.phase = "rolling";
    return;
  }

  if (player.phase !== "rolling") throw new Error("Your fleet is not ready to roll.");
  const unique = [...new Set(chosen)];
  if (!unique.length) throw new Error("Choose at least one die to reroll.");
  for (const id of unique) {
    if (!player.dice.some((die) => die.id === id)) throw new Error("That die is not in your fleet.");
  }
  if (player.rolls >= TUNING.rollsPerRound) spend(player, unique.length);

  for (const die of player.dice) {
    if (!unique.includes(die.id)) continue;
    die.value = roll(die.sides);
    if (die.flag) player.flag.face = die.value;
  }
  player.rolls += 1;
  // A fresh roll invalidates a straight choice made against the old dice.
  player.straightTake = null;
}

function handleFlagToken(player: PlayerState, direction: -1 | 1) {
  if (player.phase !== "rolling" || player.rolls < 1) {
    throw new Error("Roll your fleet before using the Flagship Token.");
  }
  if (!player.flag.token) throw new Error("Your Flagship Token is already spent.");
  const next = ((player.flag.face - 1 + direction + 6) % 6) + 1;
  player.flag.face = next;
  const flag = player.dice.find((die) => die.flag);
  if (flag) flag.value = next;
  player.flag.token = false;
  player.straightTake = null;
}

function handleStraightTake(player: PlayerState, take: number) {
  if (player.phase !== "rolling") throw new Error("Roll your fleet first.");
  const run = bestRun(player.dice);
  if (!run) throw new Error("You have no straight this round.");
  const cap = Math.min(run.length, TUNING.runMax);
  if (take < TUNING.runMin || take > cap) throw new Error("That straight prize is not available.");
  player.straightTake = take;
}

function handleSubmit(player: PlayerState) {
  if (player.phase !== "rolling") throw new Error("Roll your fleet before locking in.");
  player.tally = tally(player.dice, player.flag.level, player.straightTake);
  player.phase = "submitted";
}

function resolveSubmissions(state: MatchState) {
  const guest = state.players.guest;
  if (!guest) return;
  const host = state.players.host;
  if (host.phase !== "submitted" || guest.phase !== "submitted") return;
  if (host.round !== guest.round) return;

  const combatRound = host.round;
  const escalation = escalationFor(combatRound);

  const hostAttack = (host.tally?.attack ?? 0) + escalation;
  const guestAttack = (guest.tally?.attack ?? 0) + escalation;

  host.incoming = Math.max(0, guestAttack - (host.tally?.defense ?? 0));
  host.directIncoming = guest.tally?.direct ?? 0;
  guest.incoming = Math.max(0, hostAttack - (guest.tally?.defense ?? 0));
  guest.directIncoming = host.tally?.direct ?? 0;

  host.stats.damageDealt += guest.incoming;
  host.stats.directDealt += guest.directIncoming;
  guest.stats.damageDealt += host.incoming;
  guest.stats.directDealt += host.directIncoming;
  for (const player of [host, guest]) {
    if (player.tally?.run) player.stats.straights += 1;
    player.stats.lines += player.tally?.lines.length ?? 0;
  }

  for (const player of [host, guest]) {
    player.braceShips = [];
    if (player.incoming > 0 && activeShips(player, player.round).length > 0) {
      player.phase = "brace";
    } else {
      settlePlayer(state, player);
    }
  }
  finishIfNeeded(state);
}

function handleBrace(state: MatchState, player: PlayerState, selected: string[]) {
  if (player.phase !== "brace") throw new Error("There is no volley to brace against.");
  const choices = [...new Set(selected)];
  const available = new Set(activeShips(player, player.round).map((ship) => ship.id));
  if (choices.some((id) => !available.has(id))) {
    throw new Error("One of those ships cannot take the hit.");
  }
  player.braceShips = choices;
  settlePlayer(state, player);
  finishIfNeeded(state);
}

function settlePlayer(state: MatchState, player: PlayerState) {
  const before = player.hp;
  let soaked = 0;
  const braced: { id: string; sides: DieSize }[] = [];
  for (const ship of player.ships) {
    if (!player.braceShips.includes(ship.id)) continue;
    soaked += ship.sides;
    ship.disabledRound = player.round + 1;
    braced.push({ id: ship.id, sides: ship.sides });
  }
  const damage = Math.max(0, player.incoming - soaked) + player.directIncoming;
  const repair = player.tally?.heal ?? 0;

  player.hp = Math.min(player.maxHp, before - damage + repair);
  player.stats.repaired += Math.max(0, Math.min(repair, player.maxHp - (before - damage)));

  const earned = player.baseEnergy + (player.tally?.energy ?? 0);
  player.energy += earned;

  // Reactor: the flagship's 1 raises income for the rest of the match.
  if (player.flag.face === 1) {
    if (player.baseEnergy < TUNING.reactorCap) {
      player.baseEnergy = Math.min(
        TUNING.reactorCap,
        player.baseEnergy + flagBonusSize(player.flag.level),
      );
    } else {
      player.energy += TUNING.reactorOverflow;
    }
  }

  const enemy = state.players[player === state.players.host ? "guest" : "host"];

  player.report = {
    round: player.round,
    hpBefore: before,
    hpAfter: player.hp,
    incoming: player.incoming,
    direct: player.directIncoming,
    damage,
    repair,
    energyEarned: earned,
    soaked: Math.min(soaked, player.incoming),
    bracedShips: braced,
    escalation: escalationFor(player.round),
    tally: player.tally!,
    dice: player.dice.map((die) => ({ ...die })),
    enemyTally: enemy?.tally ? structuredClone(enemy.tally) : null,
    enemyDice: enemy?.dice ? enemy.dice.map((die) => ({ ...die })) : [],
  };
  player.phase = "report";
}

/** True when soaking with every available ship still leaves HP at 0 or below. */
function inescapableDeath(player: PlayerState): boolean {
  if (player.phase !== "brace") return false;
  const maxSoak = activeShips(player, player.round).reduce((sum, ship) => sum + ship.sides, 0);
  const damage = Math.max(0, player.incoming - maxSoak) + player.directIncoming;
  const repair = player.tally?.heal ?? 0;
  return player.hp - damage + repair <= 0;
}

function autoSettleBrace(state: MatchState, player: PlayerState) {
  if (player.phase !== "brace") return;
  player.braceShips = activeShips(player, player.round).map((ship) => ship.id);
  settlePlayer(state, player);
}

function finishIfNeeded(state: MatchState): boolean {
  const guest = state.players.guest;
  if (!guest) return state.status === "finished";
  const host = state.players.host;

  if (inescapableDeath(host)) autoSettleBrace(state, host);
  if (inescapableDeath(guest)) autoSettleBrace(state, guest);
  if (host.phase === "brace" && guest.hp <= 0) autoSettleBrace(state, host);
  if (guest.phase === "brace" && host.hp <= 0) autoSettleBrace(state, guest);

  const outOfRounds = host.round > TUNING.roundLimit || guest.round > TUNING.roundLimit;
  if (host.hp > 0 && guest.hp > 0 && !outOfRounds) return false;
  if (host.phase === "brace" || guest.phase === "brace") return false;

  state.status = "finished";
  if (outOfRounds && host.hp > 0 && guest.hp > 0) {
    state.winner = host.hp === guest.hp ? "draw" : host.hp > guest.hp ? "host" : "guest";
  } else if (host.hp <= 0 && guest.hp <= 0) {
    // Both flagships fell together: heavier final volley, then damage across the match.
    const hostVolley = host.tally?.attack ?? 0;
    const guestVolley = guest.tally?.attack ?? 0;
    if (hostVolley !== guestVolley) state.winner = hostVolley > guestVolley ? "host" : "guest";
    else if (host.stats.damageDealt !== guest.stats.damageDealt) {
      state.winner = host.stats.damageDealt > guest.stats.damageDealt ? "host" : "guest";
    } else state.winner = "draw";
  } else {
    state.winner = host.hp <= 0 ? "guest" : "host";
  }
  host.phase = "over";
  guest.phase = "over";
  return true;
}

function handleContinue(state: MatchState, player: PlayerState) {
  finishIfNeeded(state);
  if (player.phase === "over" || state.status === "finished" || player.hp <= 0) {
    player.phase = "over";
    finishIfNeeded(state);
    return;
  }
  if (player.phase !== "report") throw new Error("Finish the current round first.");

  const opponent = state.players[player === state.players.host ? "guest" : "host"];
  if (opponent?.phase === "brace") {
    throw new Error("Wait for the enemy to finish taking damage. The match may end here.");
  }

  player.round += 1;
  player.phase = "shop";
  player.rolls = 0;
  player.dice = [];
  player.straightTake = null;
  player.tally = null;
  player.incoming = 0;
  player.directIncoming = 0;
  player.braceShips = [];
  syncMatchRound(state);
  finishIfNeeded(state);
}

function syncMatchRound(state: MatchState) {
  const guest = state.players.guest;
  state.round = guest ? Math.min(state.players.host.round, guest.round) : state.players.host.round;
}

function spend(player: PlayerState, amount: number) {
  if (player.energy < amount) throw new Error(`You need ${amount} Energy for that.`);
  player.energy -= amount;
}

function cleanName(name: string): string {
  const cleaned = String(name || "").trim().replace(/\s+/g, " ").slice(0, 20);
  return cleaned || "Commander";
}

/* ------------------------------------------------------------------ */
/* Views                                                               */
/* ------------------------------------------------------------------ */

/** What a commander is allowed to see. Their dice stay hidden until both lock. */
export function publicMatchView(state: MatchState, viewer: SideId): MatchState {
  const copy = structuredClone(state);
  const you = copy.players[viewer];
  const them = copy.players[opponentOf(viewer)];
  const revealed =
    you?.phase === "brace" || you?.phase === "report" || you?.phase === "over";
  if (them && you && state.status === "active" && !revealed) {
    them.dice = [];
    them.tally = null;
  }
  return copy;
}
