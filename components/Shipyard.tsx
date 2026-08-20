"use client";

/**
 * Between rounds. Buy hulls, upgrade what you have, open a cell, level the
 * flagship — then go back out.
 *
 * Every price is read from the engine, and every button says what it costs and
 * what it gives you before you press it. Nothing here is a surprise.
 */

import { useState } from "react";
import {
  type DieSize,
  type MatchAction,
  type PlayerState,
  TUNING,
  cellForSlot,
  emptyOpenSlots,
  flagshipUpgradeCost,
  nextSlotCost,
  openSlotCount,
  priceOf,
  shipInSlot,
  upgradeCost,
  upgradeTarget,
} from "@/lib/engine";
import { Button, Chip, Notice, Rule, Stat } from "./ui";

const HULLS: DieSize[] = [4, 6, 8, 10];

/** What a hull is for, in one line, so a price is never just a number. */
const HULL_BLURB: Record<DieSize, string> = {
  4: "Cheap and busy. Every face pays a mark.",
  6: "The all-rounder. Best hull for straights.",
  8: "Hits harder and starts reaching the high marks.",
  10: "Heaviest gun and the most Direct in the game.",
};

type Props = {
  player: PlayerState;
  onAction(action: MatchAction): void;
  onDone(): void;
  busy?: boolean;
};

export function Shipyard({ player, onAction, onDone, busy }: Props) {
  const [pickingFor, setPickingFor] = useState<DieSize | "slot" | null>(null);
  const energy = player.energy;
  const empties = emptyOpenSlots(player);
  const slotCost = nextSlotCost(player);
  const flagCost = flagshipUpgradeCost(player.flag.level);
  const opened = openSlotCount(player);

  const lockedSlots = player.open
    .map((open, slot) => ({ open, slot }))
    .filter((entry) => !entry.open)
    .map((entry) => entry.slot);

  function buy(sides: DieSize) {
    if (empties.length === 1) {
      onAction({ type: "shop", operation: "buy", sides, slotIndex: empties[0]! });
      return;
    }
    setPickingFor(sides);
  }

  function openCell() {
    if (lockedSlots.length === 1) {
      onAction({ type: "shop", operation: "slot", slotIndex: lockedSlots[0]! });
      return;
    }
    setPickingFor("slot");
  }

  function chooseSlot(slot: number) {
    if (pickingFor === "slot") {
      onAction({ type: "shop", operation: "slot", slotIndex: slot });
    } else if (pickingFor) {
      onAction({ type: "shop", operation: "buy", sides: pickingFor, slotIndex: slot });
    }
    setPickingFor(null);
  }

  const pickable = pickingFor === "slot" ? lockedSlots : pickingFor ? empties : [];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="t-eyebrow">Shipyard</p>
          <h2 className="t-display text-2xl">Round {player.round}</h2>
        </div>
        <div className="flex items-center gap-2">
          <Stat kind="energy" value={energy} label="in the bank" />
        </div>
      </div>

      {pickingFor && (
        <Notice tone="info">
          Tap the cell you want{pickingFor === "slot" ? " to open" : " to park it in"}.{" "}
          <button
            type="button"
            className="underline underline-offset-2"
            onClick={() => setPickingFor(null)}
          >
            Cancel
          </button>
        </Notice>
      )}

      <div className="scroll-y fade-edges -mx-1 min-h-0 flex-1 px-1">
        {/* The board, so you can see what you are buying into. */}
        <BoardPicker
          player={player}
          highlight={pickable}
          onPick={pickable.length ? chooseSlot : undefined}
        />

        <Section title="Buy a ship" note={empties.length ? `${empties.length} empty ${empties.length === 1 ? "cell" : "cells"}` : "No empty cells"}>
          <div className="grid grid-cols-2 gap-2">
            {HULLS.map((sides) => {
              const cost = priceOf(sides);
              const can = energy >= cost && empties.length > 0;
              return (
                <ShopCard
                  key={sides}
                  title={`d${sides}`}
                  cost={cost}
                  blurb={HULL_BLURB[sides]}
                  disabled={!can || busy}
                  onClick={() => buy(sides)}
                />
              );
            })}
          </div>
        </Section>

        <Section title="Upgrade a ship" note="One size bigger, keeps its cell">
          {player.ships.length === 0 ? (
            <p className="text-sm c-dim">You have no ships to upgrade.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {player.ships
                .slice()
                .sort((a, b) => a.slot - b.slot)
                .map((ship) => {
                  const next = upgradeTarget(ship.sides);
                  const cost = upgradeCost(ship.sides);
                  const can = next !== null && cost !== null && energy >= cost;
                  return (
                    <button
                      key={ship.id}
                      type="button"
                      disabled={!can || busy}
                      onClick={() => onAction({ type: "shop", operation: "upgrade", shipId: ship.id })}
                      className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-left transition disabled:opacity-35 enabled:hover:bg-white/[0.07]"
                    >
                      <span className="t-num flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/8 text-xs">
                        {cellForSlot(ship.slot) + 1}
                      </span>
                      <span className="flex-1 text-[0.9rem]">
                        <b className="t-num text-white">d{ship.sides}</b>
                        {next ? (
                          <>
                            <span className="c-dim"> becomes </span>
                            <b className="t-num text-white">d{next}</b>
                          </>
                        ) : (
                          <span className="c-dim"> is already the biggest hull</span>
                        )}
                      </span>
                      {cost !== null && <Stat kind="energy" value={cost} label="" size="sm" />}
                    </button>
                  );
                })}
            </div>
          )}
        </Section>

        <Section
          title="Open a cell"
          note={opened >= 8 ? "Every cell is open" : `${opened} of 8 open`}
        >
          {slotCost === null ? (
            <p className="text-sm c-dim">Your whole board is open.</p>
          ) : (
            <ShopCard
              title="Open a locked cell"
              cost={slotCost}
              blurb="One more ship on the board, and one more way to line up a row or a column."
              disabled={energy < slotCost || busy}
              onClick={openCell}
              wide
            />
          )}
        </Section>

        <Section title="Level the flagship" note={`Level ${player.flag.level} of 3`}>
          {flagCost === null ? (
            <p className="text-sm c-dim">Your flagship is at level 3. It cannot go higher.</p>
          ) : (
            <ShopCard
              title={`Flagship level ${player.flag.level + 1}`}
              cost={flagCost}
              blurb={`Every one of the six flagship faces gets stronger: bonuses go from ${TUNING.flagBonus[player.flag.level]} to ${TUNING.flagBonus[player.flag.level + 1]}.`}
              disabled={energy < flagCost || busy}
              onClick={() => onAction({ type: "shop", operation: "flagship" })}
              wide
            />
          )}
        </Section>
      </div>

      <Button tone="primary" size="lg" full onClick={onDone} disabled={busy}>
        Take the field
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-4">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="t-eyebrow">{title}</h3>
        {note && <span className="text-[0.68rem] c-dim">{note}</span>}
      </div>
      {children}
      <Rule className="mt-4" />
    </section>
  );
}

function ShopCard({
  title,
  cost,
  blurb,
  disabled,
  onClick,
  wide,
}: {
  title: string;
  cost: number;
  blurb: string;
  disabled?: boolean;
  onClick(): void;
  wide?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex flex-col gap-1.5 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-left transition disabled:opacity-35 enabled:hover:bg-white/[0.07] enabled:active:scale-[0.985] ${
        wide ? "w-full" : ""
      }`}
    >
      <span className="flex items-center justify-between gap-2">
        <b className="t-display text-[1.05rem] text-white">{title}</b>
        <Stat kind="energy" value={cost} label="" size="sm" />
      </span>
      <span className="text-[0.78rem] leading-snug c-dim">{blurb}</span>
    </button>
  );
}

/** A small map of your board, used to pick a cell and to see the shape of it. */
function BoardPicker({
  player,
  highlight,
  onPick,
}: {
  player: PlayerState;
  highlight: number[];
  onPick?: (slot: number) => void;
}) {
  const set = new Set(highlight);
  return (
    <div className="mx-auto grid w-full max-w-[16rem] grid-cols-3 gap-1.5">
      {Array.from({ length: 9 }, (_, cell) => {
        if (cell === 4) {
          return (
            <div
              key={cell}
              className="flex aspect-square flex-col items-center justify-center rounded-lg border border-[--color-energy]/40 bg-[--color-energy]/10"
            >
              <span className="t-num text-[--color-energy] text-sm">L{player.flag.level}</span>
              <span className="t-eyebrow text-[0.5rem] text-[--color-energy]/70">Flag</span>
            </div>
          );
        }
        const slot = cell < 4 ? cell : cell - 1;
        const open = player.open[slot] ?? false;
        const ship = shipInSlot(player, slot);
        const pickable = set.has(slot);
        return (
          <button
            key={cell}
            type="button"
            disabled={!pickable || !onPick}
            onClick={() => onPick?.(slot)}
            className={[
              "flex aspect-square flex-col items-center justify-center rounded-lg border text-center transition",
              open
                ? "border-white/14 bg-white/[0.04]"
                : "border-dashed border-white/10 bg-black/40",
              pickable ? "!border-[--color-repair] bg-[--color-repair]/12 anim-breathe" : "",
            ].join(" ")}
          >
            {ship ? (
              <span className="t-num text-white">d{ship.sides}</span>
            ) : open ? (
              <span className="text-[0.62rem] c-dim">empty</span>
            ) : (
              <span className="text-[0.62rem] text-[--color-hull-500]">locked</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

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
      <Chip tone="energy">Flagship L{player.flag.level}</Chip>
    </div>
  );
}
