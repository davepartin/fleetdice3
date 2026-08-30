"use client";

/**
 * The one help button.
 *
 * A reference, not a novel. Every number comes from `lib/reference.ts`, which
 * reads the engine — so the numbers a player is taught are the numbers they
 * roll. Exhaustive listings (every face, every flagship face, every straight,
 * every shop price) render as compact tables, not one big illustrated card
 * per row — the art is spent once, on the roll-screen diagram and a couple of
 * anchor icons, not repeated ten times for ten numbers that already share a
 * pattern once you've seen it stated.
 */

import { HelpFlagFace, HelpShipFace } from "@/components/HelpArt";
import { HullShape } from "@/components/HullShape";
import { FORMATIONS, HOW_TO_PLAY, type HelpBlock } from "@/lib/reference";
import type { DieSize, Tally } from "@/lib/engine";
import { Button, HpRail, Sheet, TallyStrip } from "./ui";
import type { ReactNode } from "react";

/** A plausible mid-round roll — not a real match, just something worth reading. */
const SCREEN_SAMPLE_TALLY: Tally = {
  attack: 12,
  defense: 8,
  energy: 4,
  heal: 3,
  direct: 2,
  face: 4,
  flagBonus: { attack: 0, defense: 0, energy: 0, heal: 0, direct: 0 },
  run: null,
  lines: [],
};

/** The four cells a fleet opens with, one of each hull, for a diagram that
 *  actually shows every shape rather than four of the same triangle. */
const SCREEN_SAMPLE_SHIPS: Partial<Record<number, DieSize>> = { 1: 4, 3: 6, 5: 8, 7: 10 };

function section(id: string) {
  return HOW_TO_PLAY.find((entry) => entry.id === id);
}

function table(id: string): Extract<HelpBlock, { kind: "table" }> | undefined {
  const block = section(id)?.blocks.find((entry) => entry.kind === "table");
  return block?.kind === "table" ? block : undefined;
}

function steps(id: string) {
  const block = section(id)?.blocks.find((entry) => entry.kind === "steps");
  return block?.kind === "steps" ? block.steps : [];
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <article className="help-card">
      <h3 className="t-display">{title}</h3>
      {children}
    </article>
  );
}

function Copy({ children }: { children: string }) {
  return <p className="help-copy">{children}</p>;
}

/** Column headers reference.ts wrote for a wide desktop table, shortened for
 *  a phone-width column head — "Level 1" and "Biggest is a d4" both fit one
 *  reading at their full length, but not at 298px with four siblings next
 *  to them. The row itself already says which stat or run this is. */
function shortHead(text: string): string {
  return text.replace(/^Level (\d)$/, "L$1").replace(/^Biggest is a (d\d+)$/, "$1");
}

/** Every exhaustive listing in this screen — every face, every flagship face,
 *  every straight, every shop price — renders through this one table so the
 *  reference data stays dense instead of one illustrated card per row. */
function DataTable({ id }: { id: string }) {
  const block = table(id);
  if (!block) return null;
  return (
    <>
      <div className="help-table-scroll">
        <table className="help-data">
          <thead>
            <tr>
              {block.head.map((cell) => (
                <th key={cell}>{shortHead(cell)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, index) => (
              <tr key={index}>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {block.note && <p className="help-note">{block.note}</p>}
    </>
  );
}

export function HowToPlayBody() {
  const intro = section("one-minute");
  const dice = section("your-dice");
  const lines = section("straights-formations");
  const flag = section("flagship");
  const round = section("a-round");
  const yard = section("shipyard");
  const win = section("winning");
  return (
    <div className="help-scroll">
      <p className="help-lede">{intro?.summary}</p>

      <Card title="Read the roll screen">
        <Copy>
          Every match opens on this exact screen — here is what each part is.
        </Copy>
        <div className="help-screen-diagram">
          <div className="help-screen-callout">
            <div className="help-screen-callout-head">
              <span className="help-step-num t-num">1</span>
              <strong>Your vitals</strong>
            </div>
            <div className="help-screen-callout-art">
              <HpRail
                yourHp={60}
                enemyName="Rival fleet"
                enemyHp={54}
                round={3}
                yourFleet={16}
                enemyFleet={12}
              />
            </div>
            <p className="help-screen-callout-copy">
              Your flagship&rsquo;s health, bold and bright, then your
              fleet&rsquo;s soak — how much a brace could still absorb this
              round. Same pair, mirrored, for the enemy.
            </p>
          </div>

          <div className="help-screen-callout">
            <div className="help-screen-callout-head">
              <span className="help-step-num t-num">2</span>
              <strong>Your fleet</strong>
            </div>
            <div className="help-screen-callout-art">
              <div className="recap-board help-screen-board" role="img" aria-label="A sample fleet board">
                {Array.from({ length: 9 }, (_, cell) => cell).map((cell) => {
                  if (cell === 4) {
                    return (
                      <div key={cell} className="recap-cell recap-cell-flag">
                        <span className="recap-cell-flag-star" aria-hidden="true">
                          ★
                        </span>
                      </div>
                    );
                  }
                  const sides = SCREEN_SAMPLE_SHIPS[cell];
                  return (
                    <div key={cell} className={`recap-cell ${sides ? "recap-cell-ship" : "recap-cell-empty"}`}>
                      {sides && (
                        <>
                          <span className="recap-cell-hull">
                            <HullShape sides={sides} tone="live" />
                          </span>
                          <span className="recap-cell-hull-label t-num">d{sides}</span>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
            <p className="help-screen-callout-copy">
              The centre is always your flagship. Every other cell&rsquo;s
              shape tells you the hull size before you read the number.
            </p>
          </div>

          <div className="help-screen-callout">
            <div className="help-screen-callout-head">
              <span className="help-step-num t-num">3</span>
              <strong>This roll&rsquo;s totals</strong>
            </div>
            <div className="help-screen-callout-art">
              <TallyStrip tally={SCREEN_SAMPLE_TALLY} />
            </div>
            <p className="help-screen-callout-copy">
              Attack, Shields, Direct, Repair and Energy — everything your
              dice add up to, live as you reroll.
            </p>
          </div>
        </div>
      </Card>

      <Card title={round?.title ?? "A round, step by step"}>
        <ol className="help-steps">
          {steps("a-round").map((step, index) => (
            <li key={step.name}>
              <span className="help-step-num t-num">{index + 1}</span>
              <span>
                <strong>{step.name.replace(/^\d+\.\s*/, "")}.</strong> {step.text}
              </span>
            </li>
          ))}
        </ol>
      </Card>

      <Card title="How to read a die">
        <Copy>
          Even faces hit, odd faces block, and the number is the size — a 6
          hits for 6, a 5 blocks for 5. The mark under it always pays too,
          win or lose the fight.
        </Copy>
        <div className="help-die-legend">
          <div className="help-die-legend-item">
            <HelpShipFace value={2} size={64} />
            <div>
              <strong>Even · hit</strong>
            </div>
          </div>
          <div className="help-die-legend-item">
            <HelpShipFace value={3} size={64} />
            <div>
              <strong>Odd · block</strong>
            </div>
          </div>
        </div>
        <DataTable id="your-dice" />
      </Card>

      <Card title={flag?.title ?? "Your flagship"}>
        <div className="help-die-legend">
          <div className="help-die-legend-item">
            <HelpFlagFace face={4} size={64} />
            <div>
              <strong>Your flagship&rsquo;s face</strong>
              <span>{flag?.summary ?? ""}</span>
            </div>
          </div>
        </div>
        <DataTable id="flagship" />
        <Copy>
          Once a game, after rolling, you may turn the flagship one face up
          or down — often the nudge that completes a straight or a line.
        </Copy>
      </Card>

      <Card title={lines?.title ?? "Straights and formations"}>
        <Copy>{lines?.summary ?? ""}</Copy>
        <DataTable id="straights-formations" />
        <dl className="help-table">
          {FORMATIONS.map((formation) => (
            <div key={formation.kind}>
              <dt>{formation.name}</dt>
              <dd>{formation.rule}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card title={yard?.title ?? "The shipyard"}>
        <Copy>
          With your Energy: upgrade the flagship, open a new bay, buy a new
          ship, or upgrade a ship you already have.
        </Copy>
      </Card>

      <Card title={win?.title ?? "Winning"}>
        <Copy>{win?.summary ?? ""}</Copy>
      </Card>
    </div>
  );
}

export function HowToPlaySheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="How to play"
      footer={
        <Button tone="primary" full onClick={onClose}>
          Back to the battle
        </Button>
      }
    >
      <HowToPlayBody />
    </Sheet>
  );
}
