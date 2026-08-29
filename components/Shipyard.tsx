"use client";

/**
 * The shipyard. Between rounds, this is the whole screen.
 *
 * The design rule here is one sentence: **the shipyard is the board.** You are
 * spending Energy on nine specific squares, so you should be looking at those
 * nine squares, with the price written on each one. The version this replaces
 * showed a list of buttons above a tiny grid of the words "locked" and "d4",
 * with no price visible anywhere until you had already tapped something.
 *
 * Tap a cell, then confirm. Every cell says what it is, what it would cost, and
 * whether you can afford it, before you touch anything.
 */

import { useEffect, useMemo, useState } from "react";
import {
  type DieSize,
  type MatchAction,
  type PlayerState,
  type Ship,
  TUNING,
  cellForSlot,
  flagshipUpgradeCost,
  flagBonusSize,
  fleetSoak,
  nextSlotCost,
  openSlotCount,
  priceOf,
  shipInSlot,
  slotForCell,
  upgradeCost,
  upgradeTarget,
} from "@/lib/engine";
import { NOUN } from "@/lib/reference";
import { HullShape } from "./HullShape";
import { Button, Chip, HpRail, Notice } from "./ui";

const HULLS: DieSize[] = [4, 6, 8, 10];

/** What a ship is for, in one line, so a price is never just a number. */
const HULL_BLURB: Record<DieSize, string> = {
  4: "Cheap and busy. Every face pays a mark.",
  6: "The all-rounder, and the best ship for straights.",
  8: "Hits harder and reaches the bigger marks.",
  10: "The heaviest gun and the most Direct in the game.",
};

const HULL_FACES: Record<DieSize, string> = {
  4: "rolls 1–4",
  6: "rolls 1–6",
  8: "rolls 1–8",
  10: "rolls 1–10",
};

/** A cool-blue Energy price. Red when you cannot afford it — never hidden. */
function Price({ cost, affordable }: { cost: number; affordable: boolean }) {
  return (
    <span
      className={`yard-price ${affordable ? "yard-price-ok" : "yard-price-no"}`}
      aria-label={`${cost} Energy`}
    >
      <svg className="yard-price-icon" viewBox="0 0 16 20" aria-hidden="true">
        <path d="M9.1 0 1.8 11.1h4.7L5.6 20l8.6-12.3H9.4L9.1 0Z" fill="currentColor" />
      </svg>
      <span className="t-num">{cost}</span>
    </span>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 32 38" aria-hidden="true">
      <path d="M8 16v-5C8 5 11.3 2 16 2s8 3 8 9v5" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
      <rect x="4" y="15" width="24" height="20" rx="5" fill="currentColor" />
      <circle cx="16" cy="24" r="2.4" fill="var(--color-lock-hole)" />
      <path d="M16 25.5v4" stroke="var(--color-lock-hole)" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Working out what each cell offers                                   */
/* ------------------------------------------------------------------ */

type CellOffer =
  | { kind: "flagship"; cell: 4; level: number; cost: number | null }
  | { kind: "ship"; cell: number; slot: number; ship: Ship; next: DieSize | null; cost: number | null }
  | { kind: "empty"; cell: number; slot: number; cheapest: number }
  | { kind: "locked"; cell: number; slot: number; cost: number | null; opensLines: string[] };

const ROWS = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
];
const COLS = [
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
];

function cellIsOpen(player: PlayerState, cell: number): boolean {
  if (cell === 4) return true;
  const slot = slotForCell(cell);
  return slot === null ? false : Boolean(player.open[slot]);
}

/**
 * Which lines opening this cell would complete.
 *
 * This is the one piece of strategy the game has never told anyone: a corner
 * does not just add a ship, it can finish a row or a column, and those pay
 * 5 Energy and 10 Attack. Saying so on the cell itself is the cheapest way to
 * teach it.
 */
function linesOpenedBy(player: PlayerState, cell: number): string[] {
  const out: string[] = [];
  const openAfter = (other: number) => other === cell || cellIsOpen(player, other);
  ROWS.forEach((line, index) => {
    if (line.includes(cell) && line.every(openAfter)) {
      out.push(`${["top", "middle", "bottom"][index]} row`);
    }
  });
  COLS.forEach((line, index) => {
    if (line.includes(cell) && line.every(openAfter)) {
      out.push(`${["left", "middle", "right"][index]} column`);
    }
  });
  return out;
}

function offerFor(player: PlayerState, cell: number): CellOffer {
  if (cell === 4) {
    return { kind: "flagship", cell: 4, level: player.flag.level, cost: flagshipUpgradeCost(player.flag.level) };
  }
  const slot = slotForCell(cell)!;
  if (!player.open[slot]) {
    return { kind: "locked", cell, slot, cost: nextSlotCost(player), opensLines: linesOpenedBy(player, cell) };
  }
  const ship = shipInSlot(player, slot);
  if (!ship) return { kind: "empty", cell, slot, cheapest: priceOf(4) };
  const next = upgradeTarget(ship.sides);
  return { kind: "ship", cell, slot, ship, next, cost: next ? upgradeCost(ship.sides) : null };
}

/* ------------------------------------------------------------------ */

type Props = {
  player: PlayerState;
  enemyName: string;
  enemyHp: number;
  onAction(action: MatchAction): void;
  onDone(): void;
  busy?: boolean;
};

export function Shipyard({ player, enemyName, enemyHp, onAction, onDone, busy }: Props) {
  const [selected, setSelected] = useState<number | null>(null);
  const energy = player.energy;

  const offers = useMemo(
    () => Array.from({ length: 9 }, (_, cell) => offerFor(player, cell)),
    [player],
  );

  // A cell that has just been bought is no longer the same offer, so drop the
  // selection rather than leaving a stale drawer open under the player's thumb.
  useEffect(() => {
    if (selected === null) return;
    const offer = offers[selected]!;
    if (offer.kind === "ship" && !offer.next) setSelected(null);
    if (offer.kind === "flagship" && offer.cost === null) setSelected(null);
  }, [offers, selected]);

  const act = (action: MatchAction) => {
    setSelected(null);
    onAction(action);
  };

  return (
    <div className="yard">
      {/* The shipyard is a full-screen overlay above the match header (see
         .yard's own note), so it carries its own copy of the same HP rail
         rather than relying on one it has covered up. */}
      <HpRail
        yourHp={player.hp}
        enemyName={enemyName}
        enemyHp={enemyHp}
        yourFleet={fleetSoak(player)}
      />

      {/* ---------------- header ---------------- */}
      <header className="yard-head">
        <div>
          <p className="t-eyebrow">Round {player.round}</p>
          <h2 className="t-display text-3xl leading-none">Shipyard</h2>
        </div>
        <div className="yard-bank">
          <span className="yard-bank-value t-num c-energy">{energy}</span>
          <span className="t-eyebrow text-xs">in the bank</span>
        </div>
      </header>

      <div className="yard-stats">
        <Chip>{player.ships.length} ships</Chip>
        <Chip>{openSlotCount(player)}/8 {NOUN.bays}</Chip>
        <Chip tone="energy">{NOUN.flagship} L{player.flag.level}</Chip>
      </div>

      {/* ---------------- the board ---------------- */}
      <div className="yard-main">
      <div className="yard-board" role="group" aria-label="Your fleet">
        {offers.map((offer) => (
          <CellButton
            key={offer.cell}
            offer={offer}
            energy={energy}
            selected={selected === offer.cell}
            onSelect={() => setSelected(selected === offer.cell ? null : offer.cell)}
          />
        ))}
      </div>

      </div>

      {/* ---------------- the drawer ---------------- */}
      <div className="yard-drawer-wrap">
        {selected !== null && (
          <Drawer
            offer={offers[selected]!}
            energy={energy}
            busy={busy}
            onAct={act}
            onClose={() => setSelected(null)}
          />
        )}
      </div>

      {/* ---------------- out ---------------- */}
      <div className="yard-foot">
        <Button tone="primary" size="lg" full onClick={onDone} disabled={busy}>
          Return to battle
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* One cell                                                            */
/* ------------------------------------------------------------------ */

function CellButton({
  offer,
  energy,
  selected,
  onSelect,
}: {
  offer: CellOffer;
  energy: number;
  selected: boolean;
  onSelect(): void;
}) {
  let cost: number | null = null;
  let affordable = false;
  let state = "plain";
  let body: React.ReactNode = null;
  let label = "";

  if (offer.kind === "flagship") {
    cost = offer.cost;
    affordable = cost !== null && cost <= energy;
    state = "flag";
    label = `${NOUN.flagship}, level ${offer.level}`;
    body = (
      <>
        <span className="yard-cell-art yard-cell-flag">★</span>
        <span className="yard-cell-name">{NOUN.flagship}</span>
        <span className="yard-cell-sub">
          {cost === null ? "Level 3 · max" : `L${offer.level} → L${offer.level + 1}`}
        </span>
      </>
    );
  } else if (offer.kind === "ship") {
    cost = offer.cost;
    affordable = cost !== null && cost <= energy;
    state = "ship";
    label = `d${offer.ship.sides} ship${offer.next ? `, upgrade to d${offer.next}` : ", at maximum"}`;
    body = (
      <>
        <span className="yard-cell-art">
          <HullShape sides={offer.ship.sides} tone="live" />
        </span>
        <span className="yard-cell-name">d{offer.ship.sides} ship</span>
        <span className="yard-cell-sub yard-cell-sub-plain">{offer.next ? `upgrade → d${offer.next}` : "max ship"}</span>
      </>
    );
  } else if (offer.kind === "empty") {
    cost = offer.cheapest;
    affordable = cost <= energy;
    state = "empty";
    label = `Open ${NOUN.bay}, add a ship`;
    body = (
      <>
        <span className="yard-cell-art yard-cell-empty-art">+</span>
        <span className="yard-cell-name">Open {NOUN.bay}</span>
        <span className="yard-cell-sub">add a ship</span>
      </>
    );
  } else {
    cost = offer.cost;
    affordable = cost !== null && cost <= energy;
    state = "locked";
    label = `Locked ${NOUN.bay}`;
    body = (
      <>
        <span className="yard-cell-art yard-cell-lock"><LockIcon /></span>
        <span className="yard-cell-name">Locked</span>
        <span className="yard-cell-sub">
          {offer.opensLines.length ? `opens a ${offer.opensLines[0]!.split(" ")[1]}` : "open it"}
        </span>
      </>
    );
  }

  const dead = cost === null;

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={label}
      aria-pressed={selected}
      className={`yard-cell yard-cell-${state}`}
      data-selected={selected || undefined}
      data-affordable={!dead && affordable ? "" : undefined}
      data-dead={dead ? "" : undefined}
    >
      {body}
      {cost !== null && <Price cost={cost} affordable={affordable} />}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* The drawer under the board                                          */
/* ------------------------------------------------------------------ */

/**
 * A purchase confirm button. "{Verb} · {cost} Energy" only — no afford-state
 * suffix, so the label is the same short shape at any cost from any
 * shipyard row. The shortfall, when there is one, gets its own line instead
 * of being crammed onto the button; "Open this bay · 10 Energy · not
 * enough" was long enough to spill past the button's own edges on a phone.
 */
function PurchaseButton({
  verb,
  cost,
  energy,
  busy,
  onClick,
}: {
  verb: string;
  cost: number;
  energy: number;
  busy?: boolean;
  onClick(): void;
}) {
  const short = cost - energy;
  return (
    <>
      {short > 0 && <Notice tone="warn">Need {short} more Energy.</Notice>}
      <Button tone="primary" full disabled={busy || short > 0} onClick={onClick}>
        {verb} · {cost} Energy
      </Button>
    </>
  );
}

function Drawer({
  offer,
  energy,
  busy,
  onAct,
  onClose,
}: {
  offer: CellOffer;
  energy: number;
  busy?: boolean;
  onAct(action: MatchAction): void;
  onClose(): void;
}) {
  if (offer.kind === "flagship") {
    const cost = offer.cost;
    return (
      <section className="yard-drawer anim-rise">
        <DrawerHead title="Your flagship" onClose={onClose} />
        {cost === null ? (
          <p className="yard-copy">
            Level 3 is as far as it goes. Every face already adds{" "}
            <b className="c-energy">{flagBonusSize(3)}</b>.
          </p>
        ) : (
          <>
            <p className="yard-copy">
              Level {offer.level} → {offer.level + 1}. Every one of its six faces goes from adding{" "}
              <b className="c-energy">{flagBonusSize(offer.level)}</b> to{" "}
              <b className="c-energy">{flagBonusSize(offer.level + 1)}</b>. One purchase, all six
              faces.
            </p>
            <PurchaseButton
              verb="Level up"
              cost={cost}
              energy={energy}
              busy={busy}
              onClick={() => onAct({ type: "shop", operation: "flagship" })}
            />
          </>
        )}
      </section>
    );
  }

  if (offer.kind === "ship") {
    const cost = offer.cost;
    return (
      <section className="yard-drawer anim-rise">
        <DrawerHead title={`d${offer.ship.sides} ship · ${NOUN.bay} ${offer.cell + 1}`} onClose={onClose} />
        {offer.next === null || cost === null ? (
          <p className="yard-copy">A d10 is the biggest ship there is. Nothing left to buy here.</p>
        ) : (
          <>
            <div className="yard-compare">
              <div className="yard-compare-side">
                <div className="yard-compare-art">
                  <HullShape sides={offer.ship.sides} tone="ghost" />
                </div>
                <span className="t-num">d{offer.ship.sides}</span>
                <span className="yard-compare-note">{HULL_FACES[offer.ship.sides]}</span>
              </div>
              <span className="yard-compare-arrow" aria-hidden="true">
                →
              </span>
              <div className="yard-compare-side">
                <div className="yard-compare-art">
                  <HullShape sides={offer.next} tone="live" />
                </div>
                <span className="t-num">d{offer.next}</span>
                <span className="yard-compare-note">{HULL_FACES[offer.next]}</span>
              </div>
            </div>
            <p className="yard-copy">{HULL_BLURB[offer.next]}</p>
            <PurchaseButton
              verb="Upgrade"
              cost={cost}
              energy={energy}
              busy={busy}
              onClick={() => onAct({ type: "shop", operation: "upgrade", shipId: offer.ship.id })}
            />
          </>
        )}
      </section>
    );
  }

  if (offer.kind === "empty") {
    return (
      <section className="yard-drawer anim-rise">
        <DrawerHead title={`Open ${NOUN.bay} ${offer.cell + 1}`} onClose={onClose} />
        <div className="yard-hulls">
          {HULLS.map((sides) => {
            const cost = priceOf(sides);
            const can = cost <= energy;
            return (
              <button
                key={sides}
                type="button"
                className="yard-hull"
                disabled={busy || !can}
                onClick={() =>
                  onAct({ type: "shop", operation: "buy", sides, slotIndex: offer.slot })
                }
              >
                <span className="yard-hull-art">
                  <HullShape sides={sides} tone={can ? "live" : "ghost"} />
                </span>
                <span className="yard-hull-name t-num">d{sides}</span>
                <Price cost={cost} affordable={can} />
                <span className="yard-hull-blurb">{HULL_BLURB[sides]}</span>
              </button>
            );
          })}
        </div>
      </section>
    );
  }

  const cost = offer.cost;
  return (
    <section className="yard-drawer anim-rise">
      <DrawerHead title={`Locked ${NOUN.bay} ${offer.cell + 1}`} onClose={onClose} />
      <p className="yard-copy">
        Opening a {NOUN.bay} gives you somewhere to park another ship.
        {offer.opensLines.length > 0 && (
          <>
            {" "}
            This one also completes the <b className="c-run">{offer.opensLines.join(" and the ")}</b>
            {" "}— three matching numbers across a row pays{" "}
            <b className="c-energy">{TUNING.lineAcrossEnergy} Energy</b>, and down a column pays{" "}
            <b className="c-attack">{TUNING.lineDownAttack} Attack</b>.
          </>
        )}
      </p>
      {cost === null ? (
        <p className="yard-copy">Every {NOUN.bay} is already open.</p>
      ) : (
        <PurchaseButton
          verb="Open this bay"
          cost={cost}
          energy={energy}
          busy={busy}
          onClick={() => onAct({ type: "shop", operation: "slot", slotIndex: offer.slot })}
        />
      )}
    </section>
  );
}

function DrawerHead({ title, onClose }: { title: string; onClose(): void }) {
  return (
    <div className="yard-drawer-head">
      <h3 className="t-display text-xl">{title}</h3>
      <button type="button" className="yard-drawer-close" onClick={onClose} aria-label="Close">
        ✕
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */

export function ShipyardSummary({ player }: { player: PlayerState }) {
  const counts = player.ships.reduce<Record<number, number>>((acc, ship) => {
    acc[ship.sides] = (acc[ship.sides] ?? 0) + 1;
    return acc;
  }, {});
  return (
    <div className="flex flex-wrap gap-1.5">
      {HULLS.filter((sides) => counts[sides]).map((sides) => (
        <Chip key={sides}>
          {counts[sides]} × d{sides}
        </Chip>
      ))}
      <Chip tone="energy">{NOUN.flagship} L{player.flag.level}</Chip>
    </div>
  );
}

// Kept so the cell numbering in the drawer matches what the board shows.
void cellForSlot;
