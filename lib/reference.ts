/**
 * Fleet Dice 3 — the teaching material.
 *
 * Plain data and copy. No React, no JSX, no DOM: the How to Play screen and the
 * in-game tooltips import from here and render it however they like.
 *
 * Every number below is read out of lib/engine.ts rather than typed in by hand.
 * If the balance work moves a price or a prize, this help moves with it. Nothing
 * in this file may be a second opinion about the rules.
 */

import {
  TUNING,
  faceTable,
  priceOf,
  upgradeTarget,
  upgradeCost,
  nextSlotCost,
  flagshipUpgradeCost,
  flagBonusSize,
  straightReward,
  escalationFor,
  attackOf,
  defenseOf,
  energyOf,
  repairOf,
  directOf,
  slotForCell,
  FLAG_FACES,
  type DieSize,
  type FaceRow,
  type PlayerState,
} from "@/lib/engine";

/* ------------------------------------------------------------------ */
/* Reading the engine                                                  */
/* ------------------------------------------------------------------ */

/** The hulls you can own, cheapest first, straight off the price list. */
const HULLS: DieSize[] = (Object.keys(TUNING.prices) as string[])
  .map(Number)
  .sort((a, b) => a - b) as DieSize[];

/** The board is 3×3. One cell is the flagship, the rest hold ships. */
const BOARD_CELLS = 9;
const BOARD_SIDE = Math.round(Math.sqrt(BOARD_CELLS));
const FLEET_CELLS = Array.from({ length: BOARD_CELLS }, (_, cell) => slotForCell(cell)).filter(
  (slot) => slot !== null,
).length;

/** The first round the war escalates, and how heavy it is a few rounds later. */
const FIRST_ESCALATED_ROUND = TUNING.escalateAfterRound + 1;

/** A fleet starts with the cheapest hull in every cell it owns. */
const START_HULL = HULLS[0]!;
/** Smallest and biggest hull, for the sentences that compare the two ends. */
const SMALL = HULLS[0]!;
const BIG = HULLS[HULLS.length - 1]!;
/** The flagship has one face per entry in the engine's list. */
const FLAG_SIDES = FLAG_FACES.length;
/** A middle hull, for the worked example in the straights section. */
const MID = HULLS[Math.max(0, HULLS.length - 2)]!;
/** What the smallest hull upgrades into. */
const NEXT_UP = upgradeTarget(SMALL) ?? SMALL;

function die(sides: number): string {
  return `d${sides}`;
}

/** 1.5 not 1.50, 3 not 3.00. Averages read better without dead zeros. */
function num(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/** 5 → "5th". The board labels its own cells 1–9, so help never says "cell 5". */
function ordinal(value: number): string {
  const tens = value % 100;
  if (tens >= 11 && tens <= 13) return `${value}th`;
  return `${value}${({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[value % 10] ?? "th"}`;
}

function joinWords(parts: string[], last: "and" | "or" = "and"): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} ${last} ${parts[parts.length - 1]}`;
}

/** What one roll of a hull pays on average, straight from the face functions. */
function averagePerRoll(sides: DieSize) {
  const faces = Array.from({ length: sides }, (_, index) => index + 1);
  const mean = (pick: (value: number) => number) =>
    faces.reduce((sum, value) => sum + pick(value), 0) / sides;
  return {
    attack: mean(attackOf),
    defense: mean(defenseOf),
    energy: mean(energyOf),
    repair: mean(repairOf),
    direct: mean(directOf),
  };
}

/**
 * nextSlotCost() only reads the `open` array, so a stub board is enough here.
 * Going through the engine keeps cell prices on the engine's side of the wall.
 */
function slotCostAfter(openCount: number): number | null {
  const stub = {
    open: Array.from({ length: FLEET_CELLS }, (_, index) => index < openCount),
  } as Pick<PlayerState, "open"> as PlayerState;
  return nextSlotCost(stub);
}

/**
 * Can a run of this length, topped by this hull, actually happen?
 * Every number in a run needs a die showing it. A ship only shows up to its own
 * size, and the single flagship is a d6, so at most one number above the biggest
 * ship can be covered, and only if that number is 6 or less.
 */
function runIsPossible(length: number, biggest: DieSize): boolean {
  if (length <= biggest) return true;
  if (length === biggest + 1) return biggest + 1 <= 6;
  return false;
}

const RUN_LENGTHS = Array.from(
  { length: TUNING.runMax - TUNING.runMin + 1 },
  (_, index) => TUNING.runMin + index,
);

function runLengthLabel(length: number): string {
  return length >= TUNING.runMax ? `${length} or more in a row` : `${length} in a row`;
}

/* ------------------------------------------------------------------ */
/* FACE_ROWS — the face table                                          */
/* Rendered by: How to Play ("Your dice"), and the tooltip on a die.   */
/* ------------------------------------------------------------------ */

export type FaceReference = {
  value: number;
  /** Even faces hit, odd faces block. */
  fights: "hits" | "blocks";
  /** How much it hits or blocks for. */
  amount: number;
  energy: number;
  repair: number;
  direct: number;
  /** "hits for 6" */
  fightText: string;
  /** "fires 1 Direct" */
  markText: string;
  /** "A 6 hits for 6 and fires 1 Direct." */
  line: string;
  /** "on d6, d8 and d10" — which hulls can even show this face. */
  hullsText: string;
};

function markText(row: FaceRow): string {
  const parts: string[] = [];
  if (row.energy) parts.push(`pays ${row.energy} Energy`);
  if (row.repair) parts.push(`repairs ${row.repair}`);
  if (row.direct) parts.push(`fires ${row.direct} Direct`);
  return parts.length ? joinWords(parts) : "pays nothing extra";
}

/** Every face 1–10: what it hits or blocks for, and exactly what its mark pays. */
export const FACE_ROWS: readonly FaceReference[] = faceTable().map((row) => {
  const fightText = `${row.fights === "hits" ? "hits" : "blocks"} for ${row.amount}`;
  const mark = markText(row);
  const hulls = HULLS.filter((sides) => sides >= row.value).map(die);
  return {
    value: row.value,
    fights: row.fights,
    amount: row.amount,
    energy: row.energy,
    repair: row.repair,
    direct: row.direct,
    fightText,
    markText: mark,
    line: `A ${row.value} ${fightText} and ${mark}.`,
    hullsText: `on ${joinWords(hulls)}`,
  };
});

/* ------------------------------------------------------------------ */
/* FLAGSHIP_FACES — the six gold faces                                 */
/* Rendered by: How to Play ("Your flagship") and the flagship tooltip.*/
/* ------------------------------------------------------------------ */

export type FlagshipLevelReference = {
  level: number;
  /** The size of the bonus at this level. */
  bonus: number;
  /** "every 2 in your fleet fires 3 more Direct" */
  text: string;
};

export type FlagshipFaceReference = {
  face: number;
  name: string;
  /** One line, no numbers, for a tight tooltip. */
  short: string;
  /** What it touches, spelled out. */
  detail: string;
  levels: readonly FlagshipLevelReference[];
};

function flagLevelText(face: number, bonus: number): string {
  switch (face) {
    case 1:
      return `each 1 raises your income by ${bonus} Energy a round, up to ${TUNING.reactorCap} a round; once your income is ${TUNING.reactorCap}, a 1 pays a flat ${TUNING.reactorOverflow} Energy that round instead`;
    case 2:
      return `every 2 in your fleet fires ${bonus} more Direct`;
    case 3:
      return `every 3 in your fleet repairs ${bonus} more`;
    case 4:
      return `every 4 in your fleet pays ${bonus} more Energy`;
    case 5:
      return `every odd ship blocks ${bonus} more`;
    default:
      return `every even ship hits ${bonus} more`;
  }
}

/**
 * The engine's own blurbs name the die colours (blue for odd, red for even).
 * The help screen never teaches those colours, so it says odd and even instead.
 */
function flagShort(face: number): string {
  switch (face) {
    case 1:
      return "Raises your Energy income for the rest of the match";
    case 2:
      return "Every 2 in your fleet fires more Direct";
    case 3:
      return "Every 3 in your fleet repairs more";
    case 4:
      return "Every 4 in your fleet pays more Energy";
    case 5:
      return "Every odd ship blocks more";
    default:
      return "Every even ship hits more";
  }
}

function flagDetail(face: number): string {
  switch (face) {
    case 1:
      return "Nothing lands this round. Instead your Energy income goes up for the rest of the match, and the raise is in the bank in time for next round's pay.";
    case 2:
      return "Counts the ships showing a 2 and adds Direct for each one.";
    case 3:
      return "Counts the ships showing a 3 and adds repair for each one.";
    case 4:
      return "Counts the ships showing a 4 and adds Energy for each one.";
    case 5:
      return "Counts every ship showing an odd number, not just the 5s, and adds to what each one blocks.";
    default:
      return "Counts every ship showing an even number, not just the 6s, and adds to what each one hits.";
  }
}

/** All six flagship faces, with the exact bonus at each of the three levels. */
export const FLAGSHIP_FACES: readonly FlagshipFaceReference[] = FLAG_FACES.map((entry) => ({
  face: entry.face,
  name: entry.name,
  short: flagShort(entry.face),
  detail: flagDetail(entry.face),
  levels: [1, 2, 3].map((level) => {
    const bonus = flagBonusSize(level);
    return { level, bonus, text: flagLevelText(entry.face, bonus) };
  }),
}));

/* ------------------------------------------------------------------ */
/* STRAIGHT_LADDER — every rung of the straight prize                  */
/* Rendered by: How to Play ("Straights and formations") and the       */
/* straight chooser on the roll screen.                                */
/* ------------------------------------------------------------------ */

export type StraightRung = {
  /** How many consecutive numbers you cash. */
  length: number;
  /** The biggest ship in the line. The flagship never counts here. */
  biggest: DieSize;
  kind: "energy" | "attack";
  amount: number;
  /** "12 Energy" */
  label: string;
  /** "Five in a row with a d8 as your biggest ship pays 12 Energy." */
  line: string;
  /**
   * False where the rung cannot be reached: with small hulls there is no die
   * left to show the numbers a longer run needs.
   */
  possible: boolean;
};

const SPELLED: Record<number, string> = { 5: "Five", 6: "Six", 7: "Seven" };

/** Every length × biggest-ship pairing, with the exact prize. */
export const STRAIGHT_LADDER: readonly StraightRung[] = RUN_LENGTHS.flatMap((length) =>
  HULLS.map((biggest) => {
    const reward = straightReward(length, biggest);
    const amount = reward.attack ?? reward.energy ?? 0;
    const spelled = SPELLED[length] ?? String(length);
    const more = length >= TUNING.runMax ? " or more" : "";
    return {
      length,
      biggest,
      kind: reward.kind,
      amount,
      label: reward.label,
      line: `${spelled}${more} in a row with a ${die(biggest)} as your biggest ship pays ${reward.label}.`,
      possible: runIsPossible(length, biggest),
    };
  }),
);

/* ------------------------------------------------------------------ */
/* FORMATIONS — three of a kind on the board                           */
/* Rendered by: How to Play ("Straights and formations") and the       */
/* highlight tooltip when a line lights up.                            */
/* ------------------------------------------------------------------ */

export type FormationReference = {
  kind: "row" | "col";
  name: string;
  /** The prize, worded exactly. */
  rule: string;
  amount: number;
  pays: "Energy" | "Attack";
  note: string;
};

/** The two formation prizes. */
export const FORMATIONS: readonly FormationReference[] = [
  {
    kind: "row",
    name: "Row of three",
    rule: `Three matching numbers across a row of your board pays ${TUNING.lineAcrossEnergy} Energy.`,
    amount: TUNING.lineAcrossEnergy,
    pays: "Energy",
    note: "The middle row runs through your flagship, so on that line you only need two ships to match its face.",
  },
  {
    kind: "col",
    name: "Column of three",
    rule: `Three matching numbers down a column of your board pays ${TUNING.lineDownAttack} Attack.`,
    amount: TUNING.lineDownAttack,
    pays: "Attack",
    note: "The middle column runs through your flagship too. Every cell in the line has to be open and hold a ship that rolled this round.",
  },
];

/* ------------------------------------------------------------------ */
/* SHOP_ROWS — the whole price list                                    */
/* Rendered by: How to Play ("The shipyard") and the shop panel.       */
/* ------------------------------------------------------------------ */

export type ShopRow = {
  kind: "hull" | "upgrade" | "cell" | "flagship";
  name: string;
  cost: number;
  /** What the Energy actually buys you, in numbers. */
  gain: string;
};

function hullGain(sides: DieSize): string {
  const avg = averagePerRoll(sides);
  return `Shows 1 to ${sides}. Averages ${num(avg.attack)} Attack, ${num(avg.defense)} Shields, ${num(avg.energy)} Energy, ${num(avg.repair)} repair and ${num(avg.direct)} Direct a roll.`;
}

const HULL_ROWS: ShopRow[] = HULLS.map((sides) => ({
  kind: "hull" as const,
  name: `Buy a ${die(sides)}`,
  cost: priceOf(sides),
  gain: hullGain(sides),
}));

const UPGRADE_ROWS: ShopRow[] = HULLS.flatMap((sides) => {
  const next = upgradeTarget(sides);
  const cost = upgradeCost(sides);
  if (next === null || cost === null) return [];
  const from = averagePerRoll(sides);
  const to = averagePerRoll(next);
  return [
    {
      kind: "upgrade" as const,
      name: `Upgrade a ${die(sides)} to a ${die(next)}`,
      cost,
      gain: `Two more faces. Average Attack goes ${num(from.attack)} to ${num(to.attack)}, average Shields ${num(from.defense)} to ${num(to.defense)}. It also soaks ${next - sides} more when it braces.`,
    },
  ];
});

const CELL_ROWS: ShopRow[] = Array.from(
  { length: FLEET_CELLS - TUNING.startSlots },
  (_, index) => TUNING.startSlots + index,
).flatMap((openCount) => {
  const cost = slotCostAfter(openCount);
  if (cost === null) return [];
  return [
    {
      kind: "cell" as const,
      name: `Open your ${ordinal(openCount + 1)} cell`,
      cost,
      gain: `One more place to park a ship, and one more line it can complete. The ship is a separate purchase, from ${priceOf(HULLS[0]!)} Energy.`,
    },
  ];
});

const FLAGSHIP_ROWS: ShopRow[] = [1, 2].flatMap((level) => {
  const cost = flagshipUpgradeCost(level);
  if (cost === null) return [];
  return [
    {
      kind: "flagship" as const,
      name: `Flagship level ${level + 1}`,
      cost,
      gain: `Its face bonus grows from ${flagBonusSize(level)} to ${flagBonusSize(level + 1)}. Health does not change.`,
    },
  ];
});

/** Every purchase in the game, with its price. */
export const SHOP_ROWS: readonly ShopRow[] = [
  ...HULL_ROWS,
  ...UPGRADE_ROWS,
  ...CELL_ROWS,
  ...FLAGSHIP_ROWS,
];

/* ------------------------------------------------------------------ */
/* HOW_TO_PLAY — the one-button help                                   */
/* Rendered by: the How to Play screen. Sections in this order; the    */
/* summary is meant to read on its own next to the title.              */
/* ------------------------------------------------------------------ */

export type HelpBlock =
  | { kind: "text"; text: string }
  | {
      kind: "table";
      head: readonly string[];
      rows: readonly (readonly string[])[];
      note?: string;
    }
  | { kind: "steps"; steps: readonly { name: string; text: string }[] };

export type HelpSection = {
  id: string;
  title: string;
  /** One line. Stands on its own for anyone skimming headers. */
  summary: string;
  blocks: readonly HelpBlock[];
};

const FACE_TABLE_BLOCK: HelpBlock = {
  kind: "table",
  head: ["Face", "In the fight", "On top of that"],
  rows: FACE_ROWS.map((row) => [
    String(row.value),
    `${row.fights === "hits" ? "Hits" : "Blocks"} for ${row.amount}`,
    row.markText === "pays nothing extra"
      ? "—"
      : row.markText.charAt(0).toUpperCase() + row.markText.slice(1),
  ]),
  note: `Faces above ${HULLS[0]} only turn up on the bigger hulls: a ${die(HULLS[0]!)} never shows a ${HULLS[0]! + 1}.`,
};

const STRAIGHT_TABLE_BLOCK: HelpBlock = {
  kind: "table",
  head: ["Run", ...HULLS.map((sides) => `Biggest is a ${die(sides)}`)],
  rows: RUN_LENGTHS.map((length) => [
    runLengthLabel(length),
    ...HULLS.map((biggest) => {
      const rung = STRAIGHT_LADDER.find(
        (entry) => entry.length === length && entry.biggest === biggest,
      );
      if (!rung) return "—";
      return rung.possible ? rung.label : "—";
    }),
  ]),
  note: "A dash is a run that cannot happen. Small hulls cannot show the high numbers a long run needs, and you only have one flagship to cover a gap.",
};

const FLAGSHIP_TABLE_BLOCK: HelpBlock = {
  kind: "table",
  head: ["Face", "What it does", "Level 1", "Level 2", "Level 3"],
  rows: FLAGSHIP_FACES.map((face) => [
    `${face.face} ${face.name}`,
    face.short,
    ...face.levels.map((level) => String(level.bonus)),
  ]),
  note: `The number in the level columns is the size of the bonus. On a ${FLAGSHIP_FACES[0]!.name} face it is Energy a round, up to ${TUNING.reactorCap}; everywhere else it is added to each matching ship.`,
};

const SHOP_TABLE_BLOCK: HelpBlock = {
  kind: "table",
  head: ["Buy", "Energy", "What you get"],
  rows: SHOP_ROWS.map((row) => [row.name, String(row.cost), row.gain]),
};

/** The one-button help, in sections. */
export const HOW_TO_PLAY: readonly HelpSection[] = [
  {
    id: "one-minute",
    title: "In one minute",
    summary: `Two commanders, a ${BOARD_SIDE} by ${BOARD_SIDE} board each, and one flagship carrying ${TUNING.hp} health that you are trying to knock to 0.`,
    blocks: [
      {
        kind: "text",
        text: `You and one other commander each keep a ${BOARD_SIDE} by ${BOARD_SIDE} board. The cell in the middle is your flagship. It holds all ${TUNING.hp} of your health and it never fights. The ${FLEET_CELLS} cells around it hold your ships, and a ship is simply a die: a ${joinWords(HULLS.map(die), "or")}. The size of the die is called its hull. You start with ${TUNING.startSlots} cells open and a ${die(START_HULL)} in each one.`,
      },
      {
        kind: "text",
        text: "Every round you both roll your fleet, keep what you want, and lock it in at the same time. Even faces hit, odd faces block, and whatever gets past the other commander's blocking comes off their flagship. Between rounds you spend Energy, the money of this game, on better dice and more cells. The first flagship to reach 0 loses.",
      },
    ],
  },
  {
    id: "your-dice",
    title: "Your dice",
    summary: "Even hits for its own number, odd blocks for its own number, and the small mark under the number always pays as well.",
    blocks: [
      {
        kind: "text",
        text: "Every ship is a die, and every face on every die works the same way. Even faces hit for their own number, so a 6 hits for 6. Odd faces block for their own number, so a 5 blocks for 5. There is no other rule for the fight. A bigger hull is worth having because it can show bigger numbers, not because it works differently.",
      },
      {
        kind: "text",
        text: "Under the number sits a mark, and the mark always pays. It pays whether the face hit or blocked, and it pays before anyone works out who got through. Energy is money for the shipyard. Repair puts health back on your flagship. Direct is damage that ignores blocking altogether: no shield stops it and no ship can step in front of it.",
      },
      FACE_TABLE_BLOCK,
      {
        kind: "text",
        text: `So a fleet showing 2, 4, 6 and 8 hits for ${attackOf(2) + attackOf(4) + attackOf(6) + attackOf(8)} and, on top of that, fires ${directOf(2) + directOf(4) + directOf(6) + directOf(8)} Direct. A fleet showing 1, 3, 5 and 7 blocks ${defenseOf(1) + defenseOf(3) + defenseOf(5) + defenseOf(7)}, banks ${energyOf(1) + energyOf(3) + energyOf(5) + energyOf(7)} Energy and repairs ${repairOf(1) + repairOf(3) + repairOf(5) + repairOf(7)}.`,
      },
    ],
  },
  {
    id: "straights-formations",
    title: "Straights and formations",
    summary: `A run of ${TUNING.runMin} or more consecutive numbers pays a prize set by the biggest ship in it, and three matching numbers pays ${TUNING.lineAcrossEnergy} Energy across a row or ${TUNING.lineDownAttack} Attack down a column.`,
    blocks: [
      {
        kind: "text",
        text: `A straight is ${TUNING.runMin} or more consecutive numbers showing anywhere in your fleet. The order on the board does not matter. Say four of your ships show 2, 3, 4 and 5 and your flagship lands on 6. That is ${TUNING.runMin} in a row.`,
      },
      {
        kind: "text",
        text: `The length of the run picks the rung. The biggest ship in the run picks how much that rung pays. Your flagship is allowed to fill a gap in the line, but it never decides the size of the prize, so in that example the prize comes from the biggest of the four ships showing 2, 3, 4 and 5. If that is a ${die(MID)}, you take ${straightReward(TUNING.runMin, MID).label}.`,
      },
      STRAIGHT_TABLE_BLOCK,
      {
        kind: "text",
        text: `Past ${TUNING.runMax} in a row the prize stops growing. You can also cash a long run as a shorter one when the shorter prize suits you better: ${TUNING.runMin + 1} in a row with a ${die(BIG)} pays ${straightReward(TUNING.runMin + 1, BIG).label}, and if you would rather have the money you can take the same run as ${TUNING.runMin} and get ${straightReward(TUNING.runMin, BIG).label}. Cashing short does not shrink the ship that sets the prize.`,
      },
      {
        kind: "text",
        text: `Formations are three matching numbers in a line on the board itself, so here the layout is the whole point. ${FORMATIONS[0]!.rule} ${FORMATIONS[1]!.rule} Your flagship sits in the middle of the board, which puts it in the middle row and the middle column, so those two lines only need two ships to match its face.`,
      },
    ],
  },
  {
    id: "flagship",
    title: "Your flagship",
    summary: `It never fights. Its face each round boosts your fleet, its level sets the size of that boost (${joinWords([1, 2, 3].map((level) => String(flagBonusSize(level))))}), and once a match you may turn it one number.`,
    blocks: [
      {
        kind: "text",
        text: `Your flagship is a ${die(FLAG_SIDES)} in the centre cell. It rolls with the fleet every round, but it never hits and it never blocks. What it does is ring the ships around it. Its face decides which kind of help arrives, and its level decides how much.`,
      },
      FLAGSHIP_TABLE_BLOCK,
      {
        kind: "text",
        text: `Two of those faces are wider than they look. A ${FLAGSHIP_FACES[4]!.face} lifts every odd ship you have, not only the ones showing a ${FLAGSHIP_FACES[4]!.face}, and a ${FLAGSHIP_FACES[5]!.face} lifts every even ship. At level 1 that is ${flagBonusSize(1)} each: four even ships under a ${FLAGSHIP_FACES[5]!.face} is ${4 * flagBonusSize(1)} more Attack. The ${FLAGSHIP_FACES[0]!.name} face is the odd one out. Nothing lands that round; instead your Energy income rises for the rest of the match, and the raise is there in time for the next round's pay.`,
      },
      {
        kind: "text",
        text: `You also carry one Flagship Token. Once a match, after you have rolled, you may turn the flagship one number up or down. It wraps around, so ${FLAG_SIDES} can turn into 1 and 1 can turn into ${FLAG_SIDES}. That one nudge is often what completes a straight or a formation.`,
      },
      {
        kind: "text",
        text: `Levelling the flagship is a shipyard purchase: ${flagshipUpgradeCost(1)} Energy for level 2 and ${flagshipUpgradeCost(2)} for level 3. It buys a bigger bonus, not more health.`,
      },
    ],
  },
  {
    id: "a-round",
    title: "A round, step by step",
    summary: "Shop, roll, lock in, watch the volley land, choose who takes the hit, then collect repairs and Energy.",
    blocks: [
      {
        kind: "steps",
        steps: [
          {
            name: "1. The shipyard",
            text: `You decide what to spend. Hulls, upgrades, cells and flagship levels all come out of the same Energy. Round one skips this, because you start with ${TUNING.startEnergy} Energy and ${TUNING.startSlots} ${die(START_HULL)}s already in place.`,
          },
          {
            name: "2. Roll",
            text: `You decide what to keep. The first roll throws your whole fleet and your flagship. After that you may pick any dice and throw them again. You get ${TUNING.rollsPerRound} rolls a round for nothing, which is the opening throw plus ${TUNING.rollsPerRound - 1} free rerolls. Past that, each die you throw again costs 1 Energy out of the same purse you shop with.`,
          },
          {
            name: "3. The Flagship Token",
            text: "You decide whether this is the round. Turning the flagship one number is once a match, and it can only be done after you have rolled.",
          },
          {
            name: "4. Lock in",
            text: "You decide which straight to cash, if you rolled one and a shorter prize suits you better. Then you commit. Both commanders lock in before anything is revealed, so you are guessing at their board, not answering it.",
          },
          {
            name: "5. The volley",
            text: "Nothing to decide. Both boards turn over. Your Attack, plus the round's escalation, minus their blocking, is what arrives at their flagship. Their Attack, minus your blocking, is what arrives at yours. Blocking that is not needed is simply wasted; it does not carry over. Direct is added on afterwards and ignores blocking completely.",
          },
          {
            name: "6. Brace",
            text: `You decide who takes the hit. Any ship that rolled this round can step in front of the incoming damage and soak its own size: a ${die(SMALL)} soaks ${SMALL}, a ${die(BIG)} soaks ${BIG}. A ship that braces sits out the whole of next round, so it neither rolls nor blocks nor helps a line. Direct still goes through: bracing does nothing about it.`,
          },
          {
            name: "7. Repairs and pay",
            text: `Nothing to decide. Damage lands, then repair goes back on, and health never climbs past ${TUNING.hp}. Then your Energy is paid: everything your marks and your lines earned, plus whatever income your flagship has built up.`,
          },
        ],
      },
    ],
  },
  {
    id: "shipyard",
    title: "The shipyard",
    summary: `Energy buys hulls (${joinWords(HULLS.map((sides) => String(priceOf(sides))))}), upgrades (${joinWords(HULLS.map(upgradeCost).filter((cost): cost is number => cost !== null).map(String))}), cells (${slotCostAfter(TUNING.startSlots)} up to ${slotCostAfter(FLEET_CELLS - 1)}) and flagship levels (${flagshipUpgradeCost(1)} then ${flagshipUpgradeCost(2)}).`,
    blocks: [
      {
        kind: "text",
        text: "The shipyard opens between rounds and there is only one purse. Every Energy you spend on a hull is an Energy you cannot spend on a reroll later.",
      },
      SHOP_TABLE_BLOCK,
      {
        kind: "text",
        text: `Upgrading is cheaper than buying twice. A ${die(SMALL)} costs ${priceOf(SMALL)} and a ${die(NEXT_UP)} costs ${priceOf(NEXT_UP)}, but turning the ${die(SMALL)} you already own into a ${die(NEXT_UP)} costs ${upgradeCost(SMALL)}. Opening a cell only gives you the space; the ship that stands in it is a separate bill, and each cell costs 1 more than the last.`,
      },
    ],
  },
  {
    id: "winning",
    title: "Winning",
    summary: `Knock the enemy flagship from ${TUNING.hp} to 0. From round ${FIRST_ESCALATED_ROUND} both fleets hit harder every round, and if the clock runs out the higher health wins.`,
    blocks: [
      {
        kind: "text",
        text: `Both flagships start at ${TUNING.hp} health. The first one to reach 0 loses the match, and health can never be repaired past ${TUNING.hp}.`,
      },
      {
        kind: "text",
        text: `Matches are not allowed to drift. After round ${TUNING.escalateAfterRound} the war escalates: every plain attack, yours and theirs alike, carries ${TUNING.escalateStep} more each round. That is ${escalationFor(FIRST_ESCALATED_ROUND)} in round ${FIRST_ESCALATED_ROUND}, ${escalationFor(FIRST_ESCALATED_ROUND + 1)} in round ${FIRST_ESCALATED_ROUND + 1}, ${escalationFor(FIRST_ESCALATED_ROUND + 5)} by round ${FIRST_ESCALATED_ROUND + 5}. Direct does not change and the dice do not change, so blocking has to grow or the match ends.`,
      },
      {
        kind: "text",
        text: `If both fleets somehow survive to round ${TUNING.roundLimit}, the commander with more health wins, and equal health is a draw. If both flagships fall in the same volley, the heavier attack that round takes it; if those are equal, the most damage dealt across the whole match; and if that is equal too, it is a draw.`,
      },
    ],
  },
];

/* ------------------------------------------------------------------ */
/* GLOSSARY — the words the game uses                                  */
/* Rendered by: How to Play (foot of the screen) and any term tooltip. */
/* ------------------------------------------------------------------ */

export type GlossaryEntry = { term: string; text: string };

export const GLOSSARY: readonly GlossaryEntry[] = [
  {
    term: "Attack",
    text: "What your even faces add up to, plus anything your lines and your flagship added. It is checked against the enemy's Shields, so only the part that gets past them lands.",
  },
  {
    term: "Shields",
    text: "What your odd faces add up to. Shields subtract from the enemy's Attack for this round only. Anything left over is wasted, and Shields do nothing about Direct.",
  },
  {
    term: "Energy",
    text: `The money of the game. You earn it from marks, rows, straights and your flagship's income, and you spend it in the shipyard and on extra rerolls. You start a match with ${TUNING.startEnergy}.`,
  },
  {
    term: "Repair",
    text: `Health put back on your flagship after the damage lands. It cannot take you past ${TUNING.hp}, so healing a full flagship throws the repair away.`,
  },
  {
    term: "Direct",
    text: "Damage that skips the whole fight. Shields do not reduce it and a bracing ship does not stop it. Whatever Direct you fire lands on the enemy flagship.",
  },
  {
    term: "Straight",
    text: `${TUNING.runMin} or more consecutive numbers showing across your fleet. The length picks the rung and the biggest ship in the line sets the amount. Your flagship may fill a gap but never sets the amount.`,
  },
  {
    term: "Formation",
    text: `Three matching numbers in a line on the board. Across a row it pays ${TUNING.lineAcrossEnergy} Energy; down a column it pays ${TUNING.lineDownAttack} Attack.`,
  },
  {
    term: "Flagship",
    text: `The ${die(FLAG_SIDES)} in the centre cell. It carries your ${TUNING.hp} health, it never hits and never blocks, and its face each round boosts the ships around it.`,
  },
  {
    term: "Volley",
    text: "The moment both commanders' boards are revealed and the damage for the round is worked out. Nobody sees the other board until both have locked in.",
  },
  {
    term: "Brace",
    text: "Putting a ship in front of the incoming damage. It soaks its own size and then sits out the whole of the next round.",
  },
  {
    term: "Escalation",
    text: `Extra Attack that both sides get for free once the match runs long. It starts in round ${FIRST_ESCALATED_ROUND} at ${escalationFor(FIRST_ESCALATED_ROUND)} and grows ${TUNING.escalateStep} a round after that.`,
  },
];

/* ------------------------------------------------------------------ */
/* TIPS — short strategy, all of it checkable against the numbers      */
/* Rendered by: How to Play (last panel) and the loading screen.       */
/* ------------------------------------------------------------------ */

export type Tip = { title: string; text: string };

const AVG_SMALL = averagePerRoll(SMALL);
const AVG_BIG = averagePerRoll(BIG);

export const TIPS: readonly Tip[] = [
  {
    title: "Small hulls are the better earners",
    text: `A ${die(SMALL)} averages ${num(AVG_SMALL.energy)} Energy a roll; a ${die(BIG)} averages ${num(AVG_BIG.energy)}. If you are saving for a cell or a flagship level, keeping a couple of small ships on the board pays for it.`,
  },
  {
    title: "One big hull lifts every straight you ever roll",
    text: `The biggest ship in the line sets the prize. ${TUNING.runMin} in a row is ${straightReward(TUNING.runMin, SMALL).label} when your biggest is a ${die(SMALL)} and ${straightReward(TUNING.runMin, BIG).label} when it is a ${die(BIG)}. The same run, more than twice the prize.`,
  },
  {
    title: "Cash a straight short when you need the money",
    text: `${TUNING.runMin + 1} in a row with a ${die(BIG)} pays ${straightReward(TUNING.runMin + 1, BIG).label}. Take the same run as ${TUNING.runMin} and it pays ${straightReward(TUNING.runMin, BIG).label} instead. If the enemy is well shielded this round, the Energy is often worth more than the swing.`,
  },
  {
    title: "Rows and columns are different currencies",
    text: `Three matching across pays ${TUNING.lineAcrossEnergy} Energy. The same three matching down pays ${TUNING.lineDownAttack} Attack. When a reroll could land either, decide first whether this round needs the money or the hit.`,
  },
  {
    title: "The two lines through your flagship are the cheap ones",
    text: `The middle row and the middle column both run through the flagship, so they only need two ships to match it. And the flagship is a ${die(FLAG_SIDES)}, so those lines are always on a number from 1 to ${FLAG_SIDES}.`,
  },
  {
    title: "Your opening board can only make one formation",
    text: `The ${TUNING.startSlots} cells you start with are the four around your flagship, so from the very first roll you can finish the middle row across (${TUNING.lineAcrossEnergy} Energy) or the middle column down (${TUNING.lineDownAttack} Attack) — and your flagship counts as the middle of both. Every cell you buy after that is a corner, and a corner opens whole new lines rather than finishing the ones you have.`,
  },
  {
    title: "Brace with the smallest ship that does the job",
    text: `A braced ${die(SMALL)} soaks ${SMALL} and takes an average of ${num(AVG_SMALL.attack + AVG_SMALL.defense)} hitting and blocking off your next board. A braced ${die(BIG)} soaks ${BIG} but takes ${num(AVG_BIG.attack + AVG_BIG.defense)} off it. Soak with the big one only when the small ones cannot cover the damage.`,
  },
  {
    title: "Direct is the answer to a wall of shields",
    text: `Shields above what the enemy throws are thrown away; Direct never is. A ${die(BIG)} showing ${BIG} fires ${directOf(BIG)} Direct on its own, and no shield and no bracing ship takes any of it off.`,
  },
  {
    title: "Save the token for a straight, not a nudge",
    text: `Turning the flagship one number is worth a small bonus at best, but it can be the difference between no straight and ${straightReward(TUNING.runMax, BIG).label}. Hold it until the board is one number short of a run.`,
  },
  {
    title: "Long matches are decided before they get long",
    text: `Escalation adds ${TUNING.escalateStep} Attack a round to both sides from round ${FIRST_ESCALATED_ROUND}, so by round ${FIRST_ESCALATED_ROUND + 5} both fleets carry ${escalationFor(FIRST_ESCALATED_ROUND + 5)} before a single die is read. A fleet built only to block runs out of road; buy the hulls that can hit while you still have rounds to spend them in.`,
  },
];
