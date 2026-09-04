/**
 * Fleet Dice 3 — the first-flight tutorial.
 *
 * A short scripted battle that forces the teaching beats (a row, a column, a
 * shipyard trip, a straight, the flagship token) so a new commander meets every
 * rule once. Copy lives here; the controller in useTutorialMatch drives it.
 */

import { TUNING } from "./engine";

export type TutorialStepId =
  | "intro"
  | "faces"
  | "marks"
  | "roll1"
  | "tour_hp"
  | "tour_board"
  | "read1"
  | "reroll1"
  | "row_done"
  | "lock1"
  | "report1"
  | "shop_intro"
  | "shop_slot"
  | "shop_buy"
  | "shop_upgrade"
  | "shop_done"
  | "roll2"
  | "col_done"
  | "lock2"
  | "brace_teach"
  | "report2"
  | "roll3"
  | "token_teach"
  | "straight_done"
  | "lock3"
  | "finale";

export type CoachTone = "good" | "warn" | "info";

/**
 * A real region of the roll screen this step is talking about. The shell
 * puts this on a data attribute; CSS rings the matching element in place —
 * the tutorial points at the actual HUD, not a mockup of it.
 */
export type TutorialSpotlight = "hp" | "board" | "tally";

export type TutorialStep = {
  id: TutorialStepId;
  /** Short eyebrow above the coach card. */
  eyebrow: string;
  /** The line the player should read. */
  title: string;
  body: string;
  /** Primary coach button. Absent means "wait for the expected board action". */
  nextLabel?: string;
  /** Which engine actions are legal on this step. */
  allow: TutorialAllow;
  /** Optional board setup applied when this step begins (after the triggering act). */
  script?: TutorialScript;
  /** A real HUD region to ring while this step is showing. */
  spotlight?: TutorialSpotlight;
};

export type TutorialAllow = {
  /** Advance with the coach Next button. */
  coachNext?: boolean;
  rollAll?: boolean;
  /** Any reroll (outcome is scripted anyway). */
  reroll?: boolean;
  submit?: boolean;
  continue?: boolean;
  brace?: boolean;
  ready?: boolean;
  shopSlot?: boolean;
  shopBuy?: boolean;
  shopUpgrade?: boolean;
  /** Flagship token directions allowed. */
  token?: (-1 | 1)[];
  straightTake?: boolean;
};

export type TutorialScript =
  | { kind: "board"; faces: TutorialFaces }
  | { kind: "seedEnergy"; amount: number }
  | { kind: "guestWeak" };

/**
 * Faces for the four opening ships by board role, plus the flagship.
 * Opening slots are N=1, W=3, E=4, S=6 in slot space (cells 1,3,5,7).
 */
export type TutorialFaces = {
  north: number;
  west: number;
  east: number;
  south: number;
  flag: number;
};

export const TUTORIAL_INTRO = {
  eyebrow: "First flight",
  title: "You command a fleet of dice",
  paragraphs: [
    "Across the black between stars, two fleets close on each other — not ships of steel, but dice: living hulls that roll their fate every volley.",
    "Your flagship holds the line at the centre. Around it, a growing swarm of d4s, d6s, d8s and d10s fights for Energy, shields, and the shot that cracks the enemy flagship.",
    "Spend wisely. Reroll bravely. Match numbers across the board when you can. The galaxy rewards a commander who reads the dice.",
    "This short flight walks you through one battle. Tap what the coach asks. Happy fleet battles.",
  ],
};

/**
 * Ordered steps. The controller advances when the player does the allowed act
 * (or taps Next on coach-only steps).
 */
export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: "intro",
    eyebrow: "Welcome",
    title: "A quick flight before the war",
    body: "Two minutes. Real dice, real rules — we just make sure the important moments show up so you see them once.",
    nextLabel: "Teach me the faces",
    allow: { coachNext: true },
  },
  {
    id: "faces",
    eyebrow: "The faces",
    title: "Even attacks. Odd shields.",
    body: `Every number on every ship does two jobs. Evens roll Attack — they hurt the enemy flagship. Odds roll Shields — they cancel Attack before it lands. The number itself is the amount: a 6 rolls 6 Attack, a 5 rolls 5 Shields.`,
    nextLabel: "What about the marks?",
    allow: { coachNext: true },
  },
  {
    id: "marks",
    eyebrow: "The marks",
    title: "1 Energy · 2 Direct · 3 Repair",
    body: `Some faces also pay a mark under the number. The lightning bolt is Energy — a 1 pays 2. The chevron is Direct, damage no Shield and no block can stop — a 2 fires 2. The plus is Repair — a 3 repairs 3. Energy is the purse for the shipyard and for extra rerolls.`,
    nextLabel: "Show me my fleet",
    allow: { coachNext: true },
  },
  {
    id: "roll1",
    eyebrow: "Round 1",
    title: "Tap Roll fleet",
    body: "Your four d4s sit around the flagship. The first throw is free — send the whole fleet.",
    allow: { rollAll: true },
  },
  {
    id: "tour_hp",
    eyebrow: "Read the screen",
    title: "Your vitals live up top",
    body: "That's the same bar every screen in the game keeps on top. Your flagship's health is the bold number on the left; the smaller number right after it is how much your ships could still block this round. Same pair, mirrored, for the enemy on the right.",
    nextLabel: "Show me the board",
    allow: { coachNext: true },
    spotlight: "hp",
  },
  {
    id: "tour_board",
    eyebrow: "Read the screen",
    title: "Nine cells, one fleet",
    body: "Your flagship sits in the centre — it never fights, but its face rings the ships around it every round. Every other cell can hold a ship, and its shape tells you the hull size before you even read the number: triangle d4, square d6, diamond d8, pentagon d10.",
    nextLabel: "Show me the totals",
    allow: { coachNext: true },
    spotlight: "board",
  },
  {
    id: "read1",
    eyebrow: "Read the screen",
    title: "Look at the five totals",
    body: "Attack, Shields, Direct, Repair, and Energy add up from every face — including the flagship's bonus face at the bottom. Your middle row is almost three 4s. One die is spoiling it.",
    nextLabel: "Help me fix the row",
    allow: { coachNext: true },
    spotlight: "tally",
    script: {
      kind: "board",
      // Near a middle-row of 4s: W and E show 4, flag shows 3 — odd one out.
      faces: { north: 1, west: 4, east: 4, south: 3, flag: 3 },
    },
  },
  {
    id: "reroll1",
    eyebrow: "Reroll",
    title: "Send a die back, then Reroll",
    body: `Tap any die you want to change (try the flagship or a mismatched ship), then tap Reroll. You get ${TUNING.rollsPerRound} rolls free each round, then up to ${TUNING.paidRollsPerRound} more at 1 Energy for each die you send back.`,
    allow: { reroll: true },
  },
  {
    id: "row_done",
    eyebrow: "Formation",
    title: `Three across — +${TUNING.lineAcrossEnergy} Energy`,
    body: `Matching numbers across a row pays ${TUNING.lineAcrossEnergy} Energy into your purse. The flagship counts as the middle of the row. This is how a board of small dice punches above its weight.`,
    nextLabel: "Lock this volley in",
    allow: { coachNext: true },
    script: {
      kind: "board",
      // Complete middle row of 4s through the flagship.
      faces: { north: 1, west: 4, east: 4, south: 2, flag: 4 },
    },
  },
  {
    id: "lock1",
    eyebrow: "Commit",
    title: "Tap Lock in",
    body: "Both fleets hide their boards until both commanders lock in. No take-backs after this.",
    allow: { submit: true },
    script: { kind: "guestWeak" },
  },
  {
    id: "report1",
    eyebrow: "The report",
    title: "See what landed",
    body: "The battle line shows Attack, Shields, Direct, Repair, and your new hit points. Energy from marks and that row is already in your bank for the shipyard.",
    allow: { continue: true },
  },
  {
    id: "shop_intro",
    eyebrow: "Shipyard",
    title: "One purse, many choices",
    body: "Energy buys new bays, new hulls, upgrades, and flagship levels — and it also buys extra rerolls later. Keeping a little in the bank is sometimes smarter than spending every spark.",
    nextLabel: "Open a new bay",
    allow: { coachNext: true },
    script: { kind: "seedEnergy", amount: 24 },
  },
  {
    id: "shop_slot",
    eyebrow: "Buy a bay",
    title: "Tap a locked corner, then open it",
    body: "The hazard-striped cells are locked. Opening one costs Energy and gives you room for another ship — and new rows and columns to match on.",
    allow: { shopSlot: true },
  },
  {
    id: "shop_buy",
    eyebrow: "Buy a hull",
    title: "Tap the empty bay, buy a d4",
    body: "An open empty cell can hold a new ship. Start cheap — a d4 fills the bay and keeps your three-of-a-kind chances high.",
    allow: { shopBuy: true },
  },
  {
    id: "shop_upgrade",
    eyebrow: "Upgrade",
    title: "Tap a d4, upgrade it toward a d6",
    body: "Bigger hulls roll more Attack and can show higher faces — but they match threes less often. A d6 is the bridge: still useful for lines, better for straights. Bigger ships also block more damage when you send them in.",
    allow: { shopUpgrade: true },
  },
  {
    id: "shop_done",
    eyebrow: "Shipyard",
    title: "Tap Leave shipyard",
    body: "You can always spend nothing and leave. Round one skipped the yard because you started at 0 Energy — from now on it opens between every volley.",
    allow: { ready: true },
  },
  {
    id: "roll2",
    eyebrow: "Round 2",
    title: "Roll again",
    body: "This time we are hunting a column — three matching numbers down through the flagship. That pays Attack, not Energy.",
    allow: { rollAll: true },
  },
  {
    id: "col_done",
    eyebrow: "Formation",
    title: `Three down — +${TUNING.lineDownAttack} Attack`,
    body: `We lined the middle column on 2s for you after that throw. Three matching down pays ${TUNING.lineDownAttack} Attack — a real bite out of their flagship. Rows pay money; columns pay damage.`,
    nextLabel: "Lock in",
    allow: { coachNext: true },
    script: {
      kind: "board",
      faces: { north: 2, west: 1, east: 3, south: 2, flag: 2 },
    },
  },
  {
    id: "lock2",
    eyebrow: "Commit",
    title: "Tap Lock in",
    body: "The enemy is throwing a harder volley this time so you can practice bracing.",
    allow: { submit: true },
    script: { kind: "guestWeak" },
  },
  {
    id: "brace_teach",
    eyebrow: "Block",
    title: "Send a ship in to block",
    body: "Shields are what your odd faces rolled. Blocking is what happens now: tap one or more ships, then confirm. Each one blocks damage equal to its hull size (a d4 blocks 4, a d10 blocks 10), then sits out the next round. Bigger hulls block more — another reason to grow them.",
    allow: { brace: true },
  },
  {
    id: "report2",
    eyebrow: "The report",
    title: "Damage, then repair",
    body: "Shields cancel Attack first. Direct ignores Shields. Blocking ships take what is left. Then Repair lands. Tap through when you have read the line.",
    allow: { continue: true },
  },
  {
    id: "roll3",
    eyebrow: "Round 3",
    title: "Roll for a straight",
    body: `A straight is ${TUNING.runMin}+ consecutive numbers anywhere in your fleet — order on the board does not matter. The biggest ship in the run sets how big the prize is.`,
    allow: { rollAll: true },
  },
  {
    id: "token_teach",
    eyebrow: "Flagship weapon",
    title: "Nudge the flagship once",
    body: "Once per battle you may turn the centre die one face up or down. Tap Flagship weapon, then +1 face — that turns your 4 into a 5 and completes 1–2–3–4–5.",
    allow: { token: [1] },
    script: {
      kind: "board",
      // All d4-legal: 1–4 on the ships, flag on 4 — one nudge from a five-straight.
      faces: { north: 1, west: 2, east: 3, south: 4, flag: 4 },
    },
  },
  {
    id: "straight_done",
    eyebrow: "Straight",
    title: "Five in a row pays",
    body: "The run is real. Five in a row pays Energy scaled by your biggest ship in the line; six or seven flip to Attack. You can sometimes cash a long run short if you would rather have the money.",
    nextLabel: "Lock in the finale",
    allow: { coachNext: true, straightTake: true },
  },
  {
    id: "lock3",
    eyebrow: "Finale",
    title: "Tap Lock in",
    body: "One last volley. You have now seen rows, columns, the shipyard, bracing, a straight, and the flagship token.",
    allow: { submit: true },
    script: { kind: "guestWeak" },
  },
  {
    id: "finale",
    eyebrow: "Happy fleet battles",
    title: "You are ready",
    body: "Build the fleet. Break the flagship. Spend Energy on hulls or save it for rerolls. Match across for money, down for damage. Grow carefully — every d10 you buy costs a little of that sweet three-of-a-kind luck. Now go pick a fight.",
    nextLabel: "Back to home",
    allow: { coachNext: true },
  },
];

export function stepIndex(id: TutorialStepId): number {
  return TUTORIAL_STEPS.findIndex((step) => step.id === id);
}

export function stepById(id: TutorialStepId): TutorialStep {
  const step = TUTORIAL_STEPS.find((entry) => entry.id === id);
  if (!step) throw new Error(`Unknown tutorial step ${id}`);
  return step;
}

export function nextStepId(id: TutorialStepId): TutorialStepId | null {
  const index = stepIndex(id);
  if (index < 0 || index >= TUTORIAL_STEPS.length - 1) return null;
  return TUTORIAL_STEPS[index + 1]!.id;
}
