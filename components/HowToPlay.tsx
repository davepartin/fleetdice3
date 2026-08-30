"use client";

/**
 * The one help button.
 *
 * Short on purpose. The app does every sum for you, so this does not need to
 * teach arithmetic — it needs to name the five symbols, state the four rules
 * that decide a game (attack vs shields, blocking, formations, straights),
 * and get out of the way. Every number comes from `lib/reference.ts`, which
 * reads the engine, so the help can never drift from the rules.
 *
 * Two words are kept strictly apart everywhere in this game:
 *   Shields — what your blue odd faces roll. They cancel Attack.
 *   Blocking — what a ship does when you send it in front of damage.
 * The words this replaced are gone on purpose.
 */

import { HelpFlagFace, HelpShipFace } from "@/components/HelpArt";
import { HullShape } from "@/components/HullShape";
import { StatIcon } from "@/components/StatIcon";
import {
  FORMATIONS,
  HOW_TO_PLAY,
  STRAIGHT_LADDER,
  STAT_SYMBOL,
  type StatKind,
} from "@/lib/reference";
import { TUNING, type DieSize, type Tally } from "@/lib/engine";
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

/** One of each hull, so the diagram shows every shape rather than four d4s. */
const SCREEN_SAMPLE_SHIPS: Partial<Record<number, DieSize>> = { 1: 4, 3: 6, 5: 8, 7: 10 };

const SYMBOL_ORDER: StatKind[] = ["attack", "shield", "energy", "repair", "direct"];

const STRAIGHT_LENGTHS = [...new Set(STRAIGHT_LADDER.map((rung) => rung.length))];
const STRAIGHT_HULLS = [...new Set(STRAIGHT_LADDER.map((rung) => rung.biggest))] as DieSize[];
const LONGEST_STRAIGHT = STRAIGHT_LENGTHS[STRAIGHT_LENGTHS.length - 1] ?? 0;

function section(id: string) {
  return HOW_TO_PLAY.find((entry) => entry.id === id);
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <article className="help-card">
      <h3 className="t-display">{title}</h3>
      {children}
    </article>
  );
}

function Copy({ children }: { children: ReactNode }) {
  return <p className="help-copy">{children}</p>;
}

/** An inline symbol + number, the way every prize in this screen is written. */
function Pay({ kind, amount }: { kind: StatKind; amount: number }) {
  return (
    <span className={`help-pay c-${kind}`}>
      <StatIcon kind={kind} size={15} />
      <b className="t-num">{amount}</b>
    </span>
  );
}

export function HowToPlayBody() {
  const intro = section("one-minute");
  const win = section("winning");
  return (
    <div className="help-scroll">
      <p className="help-lede">{intro?.summary}</p>

      {/* ---------- 1. The five symbols ---------- */}
      <Card title="The five symbols">
        <Copy>Learn these and you can read any board at a glance.</Copy>
        <dl className="help-symbols">
          {SYMBOL_ORDER.map((kind) => (
            <div key={kind} className={`help-symbol c-${kind}`}>
              <StatIcon kind={kind} size={26} />
              <dt>
                <span className="help-symbol-colour">{STAT_SYMBOL[kind].colour}</span>
                <span className="help-symbol-dash" aria-hidden="true">—</span>
                <span className="help-symbol-name">{STAT_SYMBOL[kind].name}</span>
              </dt>
              <dd>{STAT_SYMBOL[kind].means}</dd>
            </div>
          ))}
        </dl>
      </Card>

      {/* ---------- 2. Reading a die ---------- */}
      <Card title="How to read a die">
        <div className="help-die-legend">
          <div className="help-die-legend-item">
            <HelpShipFace value={6} size={80} />
            <div>
              <strong className="c-attack">
                <StatIcon kind="attack" size={15} /> Attack 6
              </strong>
              <span>Even faces roll Attack for their own number.</span>
            </div>
          </div>
          <div className="help-die-legend-item">
            <HelpShipFace value={5} size={80} />
            <div>
              <strong className="c-shield">
                <StatIcon kind="shield" size={15} /> Shield 5
              </strong>
              <span>Odd faces roll Shields for their own number.</span>
            </div>
          </div>
          <div className="help-die-legend-item">
            <HelpShipFace value={1} size={80} />
            <div>
              <strong className="c-energy">
                <StatIcon kind="energy" size={15} /> Energy 2
              </strong>
              <span>
                The mark under the number always pays, on top of the Attack or
                Shields — and it pays win or lose.
              </span>
            </div>
          </div>
        </div>
        <Copy>
          Bigger hulls are worth having because they show bigger numbers, not
          because they work differently. Every die works the same way.
        </Copy>
      </Card>

      {/* ---------- 3. Shields vs blocking ---------- */}
      <Card title="Shields and blocking">
        <Copy>
          These are two different things, and the game keeps them apart.
        </Copy>
        <div className="help-versus">
          <div className="help-versus-side c-shield">
            <StatIcon kind="shield" size={30} />
            <strong>Shields</strong>
            <span>
              What your odd faces roll. They cancel the enemy&rsquo;s Attack
              before it reaches you. Shields you did not need are wasted.
            </span>
          </div>
          <div className="help-versus-side help-versus-block">
            <span className="help-versus-hull">
              <HullShape sides={4} tone="live" />
            </span>
            <strong>Blocking</strong>
            <span>
              What a <em>ship</em> does. After the volley you choose ships to
              block; each stops damage equal to its own size, then sits out the
              next round.
            </span>
          </div>
        </div>
        <Copy>
          <>
            Nothing stops{" "}
            <span className="help-pay c-direct">
              <StatIcon kind="direct" size={15} />
              <b>Direct</b>
            </span>{" "}
            — not Shields, not blocking. It always lands.
          </>
        </Copy>
      </Card>

      {/* ---------- 4. The flagship ---------- */}
      <Card title="Your flagship">
        <div className="help-die-legend">
          <div className="help-die-legend-item">
            <HelpFlagFace face={1} size={80} />
            <div>
              <strong>Never fights. Boosts the fleet.</strong>
              <span>
                The centre die rolls with your fleet but rolls no Attack and no
                Shields of its own. Whatever face it lands on boosts every
                matching ship around it, and levelling it up makes that boost
                bigger.
              </span>
            </div>
          </div>
        </div>
        <Copy>
          Once a game you may turn it one face up or down — often the nudge
          that completes a straight or a line.
        </Copy>
      </Card>

      {/* ---------- 5. The two ways to score big ---------- */}
      <Card title="Three of a kind">
        <div className="help-formations">
          {FORMATIONS.map((formation) => (
            <div key={formation.kind} className="help-formation">
              <strong>{formation.name}</strong>
              <Pay
                kind={formation.kind === "row" ? "energy" : "attack"}
                amount={formation.amount}
              />
              <span>
                Three matching numbers {formation.kind === "row" ? "across a row" : "down a column"} of
                your board. Your flagship counts as the middle of both.
              </span>
            </div>
          ))}
        </div>
      </Card>

      <Card title="Straights">
        <Copy>
          {`${TUNING.runMin} or more numbers in a row anywhere in your fleet — order on the board does not matter. The biggest ship in the run sets the prize.`}
        </Copy>
        <div className="help-straight-table-wrap">
          <table className="help-straight-table">
            <thead>
              <tr>
                <th>Run</th>
                {STRAIGHT_HULLS.map((sides) => (
                  <th key={sides} className="t-num">
                    d{sides}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {STRAIGHT_LENGTHS.map((length) => (
                <tr key={length}>
                  <th scope="row" className="t-num">
                    {length}
                    {length >= LONGEST_STRAIGHT ? "+" : ""}
                  </th>
                  {STRAIGHT_HULLS.map((biggest) => {
                    const rung = STRAIGHT_LADDER.find(
                      (entry) => entry.length === length && entry.biggest === biggest,
                    );
                    if (!rung?.possible) {
                      return (
                        <td key={biggest} className="help-straight-none">
                          —
                        </td>
                      );
                    }
                    return (
                      <td key={biggest}>
                        <Pay kind={rung.kind === "attack" ? "attack" : "energy"} amount={rung.amount} />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="help-note">
          A dash is a run that cannot happen — small hulls cannot show the high
          numbers a long run needs.
        </p>
      </Card>

      {/* ---------- 6. The screen ---------- */}
      <Card title="Read the roll screen">
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
              Flagship health in bold, then how much your ships could still
              block this round. Mirrored for the enemy.
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
              Flagship in the centre. Each cell&rsquo;s shape is its hull size:
              triangle d4, square d6, diamond d8, pentagon d10.
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
              Everything your dice add up to, live as you reroll. The app does
              all the maths.
            </p>
          </div>
        </div>
      </Card>

      {/* ---------- 7. A round ---------- */}
      <Card title="A round">
        <ol className="help-round">
          <li>
            <span className="help-step-num t-num">1</span>
            <span>
              <strong>Roll.</strong> {TUNING.rollsPerRound} rolls free, then 1
              Energy per die. Keep what you like.
            </span>
          </li>
          <li>
            <span className="help-step-num t-num">2</span>
            <span>
              <strong>Lock in.</strong> Both fleets reveal at once — you are
              guessing at their board, not answering it.
            </span>
          </li>
          <li>
            <span className="help-step-num t-num">3</span>
            <span>
              <strong>Block.</strong> Choose which ships step in front of the
              damage. They sit out next round.
            </span>
          </li>
          <li>
            <span className="help-step-num t-num">4</span>
            <span>
              <strong>Shop.</strong> Spend the Energy you earned on bays,
              ships, upgrades or flagship levels — then roll again.
            </span>
          </li>
        </ol>
      </Card>

      {/* ---------- 8. Winning ---------- */}
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
