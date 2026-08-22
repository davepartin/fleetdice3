"use client";

/**
 * The one help button.
 *
 * One long illustrated scroll, like Fleet Dice 1/2 How to play. Every number
 * comes from `lib/reference.ts`, which reads the engine — so the pictures a
 * player is taught are the same plates they roll, and the numbers match the
 * match. A help screen that drifts from the rules is worse than no help screen.
 */

import { HelpFlagFace, HelpShipFace } from "@/components/HelpArt";
import { HullShape } from "@/components/HullShape";
import {
  FACE_ROWS,
  FLAGSHIP_FACES,
  FORMATIONS,
  GLOSSARY,
  HOW_TO_PLAY,
  SHOP_ROWS,
  STRAIGHT_LADDER,
  type HelpBlock,
  type ShopRow,
} from "@/lib/reference";
import type { DieSize } from "@/lib/engine";
import { Button, Sheet } from "./ui";
import type { ReactNode } from "react";

function section(id: string) {
  return HOW_TO_PLAY.find((entry) => entry.id === id);
}

function texts(id: string): string[] {
  return (
    section(id)?.blocks.filter((block): block is Extract<HelpBlock, { kind: "text" }> => block.kind === "text").map(
      (block) => block.text,
    ) ?? []
  );
}

function steps(id: string) {
  const block = section(id)?.blocks.find((entry) => entry.kind === "steps");
  return block && block.kind === "steps" ? block.steps : [];
}

const HULLS = SHOP_ROWS.filter((row) => row.kind === "hull");
const STRAIGHT_LENGTHS = [...new Set(STRAIGHT_LADDER.map((rung) => rung.length))];
const STRAIGHT_HULLS = [...new Set(STRAIGHT_LADDER.map((rung) => rung.biggest))] as DieSize[];
const LONGEST_STRAIGHT = STRAIGHT_LENGTHS[STRAIGHT_LENGTHS.length - 1] ?? 0;

function dieSizesIn(name: string): DieSize[] {
  const found: DieSize[] = [];
  for (const match of name.matchAll(/d(\d+)/g)) {
    const sides = Number(match[1]);
    if (sides === 4 || sides === 6 || sides === 8 || sides === 10) found.push(sides);
  }
  return found;
}

function shopTitle(row: ShopRow): string {
  if (row.kind === "hull") {
    const sides = dieSizesIn(row.name)[0];
    return sides ? `d${sides}` : row.name;
  }
  if (row.kind === "upgrade") {
    const [from, to] = dieSizesIn(row.name);
    return from && to ? `d${from} → d${to}` : row.name;
  }
  return row.name;
}

function Card({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
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

function ShopItem({ row }: { row: ShopRow }) {
  const sides = dieSizesIn(row.name);
  return (
    <div className="help-shop-row">
      <span className="help-shop-art">
        {row.kind === "flagship" ? (
          <HelpFlagFace face={1} size={48} />
        ) : sides.length ? (
          sides.map((size) => <HullShape key={size} sides={size} tone="live" />)
        ) : (
          <span className="help-shop-slot t-num">+</span>
        )}
      </span>
      <div>
        <strong>{shopTitle(row)}</strong>
        <span className="help-shop-cost">{row.cost} Energy</span>
        <p>{row.gain}</p>
      </div>
    </div>
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
      {texts("one-minute").map((text) => (
        <Copy key={text}>{text}</Copy>
      ))}

      <Card title={round?.title ?? "A round, step by step"}>
        <Copy>{round?.summary ?? ""}</Copy>
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

      <Card title="Ship shapes">
        <p className="help-copy">
          The hull is the size. Once you know the silhouette, you can read the
          board at a glance — the same shapes you see in the shipyard and on
          the table.
        </p>
        <div className="help-hulls">
          {HULLS.map((row) => {
            const sides = dieSizesIn(row.name)[0];
            if (!sides) return null;
            return (
              <div key={row.name} className="help-hull">
                <span className="help-hull-art">
                  <HullShape sides={sides} tone="live" />
                </span>
                <strong className="t-num">d{sides}</strong>
                <span>{row.cost} Energy</span>
              </div>
            );
          })}
        </div>
      </Card>

      <Card title="How to read a die">
        <Copy>{dice?.summary ?? ""}</Copy>
        <div className="help-die-legend">
          <div className="help-die-legend-item">
            <HelpShipFace value={2} size={88} />
            <div>
              <strong>Even · hit</strong>
              <span>{FACE_ROWS.find((row) => row.value === 2)?.line}</span>
            </div>
          </div>
          <div className="help-die-legend-item">
            <HelpShipFace value={3} size={88} />
            <div>
              <strong>Odd · block</strong>
              <span>{FACE_ROWS.find((row) => row.value === 3)?.line}</span>
            </div>
          </div>
          <div className="help-die-legend-item">
            <HelpShipFace value={1} size={88} />
            <div>
              <strong>Marks always pay</strong>
              <span>{FACE_ROWS.find((row) => row.value === 1)?.line}</span>
            </div>
          </div>
        </div>
      </Card>

      <Card title="What each number does">
        <div className="help-face-grid">
          {FACE_ROWS.map((row) => (
            <div key={row.value} className="help-face-row">
              <HelpShipFace value={row.value} size={64} />
              <div>
                <strong className="t-num">
                  {row.value} · {row.fightText}
                </strong>
                <span>
                  {row.markText === "pays nothing extra"
                    ? row.hullsText
                    : `${row.markText} · ${row.hullsText}`}
                </span>
              </div>
            </div>
          ))}
        </div>
        {texts("your-dice").slice(-1).map((text) => (
          <Copy key={text}>{text}</Copy>
        ))}
      </Card>

      <Card title={flag?.title ?? "Your flagship"}>
        <Copy>{flag?.summary ?? ""}</Copy>
        <div className="help-face-grid">
          {FLAGSHIP_FACES.map((face) => (
            <div key={face.face} className="help-face-row">
              <HelpFlagFace face={face.face} size={64} />
              <div>
                <strong>
                  {face.face} · {face.name}
                </strong>
                <span>
                  {face.short}. {face.levels.map((level) => `L${level.level} +${level.bonus}`).join(" · ")}
                </span>
              </div>
            </div>
          ))}
        </div>
        {texts("flagship")
          .slice(2)
          .map((text) => (
            <Copy key={text}>{text}</Copy>
          ))}
      </Card>

      <Card title={lines?.title ?? "Straights and formations"}>
        <Copy>{lines?.summary ?? ""}</Copy>
        <div className="help-prize-row" aria-hidden>
          <HelpShipFace value={1} size={48} />
          <HelpShipFace value={2} size={48} />
          <HelpShipFace value={3} size={48} />
          <HelpShipFace value={4} size={48} />
          <HelpShipFace value={5} size={48} />
        </div>
        <div className="help-prize-list">
          {STRAIGHT_LENGTHS.map((length) => (
            <div key={length} className="help-prize-card">
              <strong>
                {length >= LONGEST_STRAIGHT ? `${length} or more in a row` : `${length} in a row`}
              </strong>
              <div className="help-prize-hulls">
                {STRAIGHT_HULLS.map((biggest) => {
                  const rung = STRAIGHT_LADDER.find(
                    (entry) => entry.length === length && entry.biggest === biggest,
                  );
                  return (
                    <div
                      key={biggest}
                      className={`help-prize-hull${rung?.possible ? "" : " is-empty"}`}
                    >
                      <span className="help-hull-art">
                        <HullShape sides={biggest} tone={rung?.possible ? "live" : "ghost"} />
                      </span>
                      <span>d{biggest}</span>
                      <span>{rung?.possible ? rung.label : "—"}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        <dl className="help-table">
          {FORMATIONS.map((formation) => (
            <div key={formation.kind}>
              <dt>{formation.name}</dt>
              <dd>
                {formation.rule} {formation.note}
              </dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card title={yard?.title ?? "The shipyard"}>
        <Copy>{yard?.summary ?? ""}</Copy>
        <div className="help-shop-list">
          {SHOP_ROWS.map((row) => (
            <ShopItem key={row.name} row={row} />
          ))}
        </div>
      </Card>

      <Card title={win?.title ?? "Winning"}>
        <Copy>{win?.summary ?? ""}</Copy>
        {texts("winning").map((text) => (
          <Copy key={text}>{text}</Copy>
        ))}
      </Card>

      <Card title="Words used in this game">
        <dl className="help-glossary">
          {GLOSSARY.map((entry) => (
            <div key={entry.term}>
              <dt>{entry.term}</dt>
              <dd>{entry.text}</dd>
            </div>
          ))}
        </dl>
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
