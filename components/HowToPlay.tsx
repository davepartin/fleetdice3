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
  type HelpBlock,
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

function table(id: string, index = 0) {
  const block = section(id)?.blocks.filter((entry) => entry.kind === "table")[index];
  return block && block.kind === "table" ? block : null;
}

const HULLS = SHOP_ROWS.filter((row) => row.kind === "hull");

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

function HelpTable({
  block,
}: {
  block: Extract<HelpBlock, { kind: "table" }>;
}) {
  return (
    <div>
      <div className="-mx-1 overflow-x-auto">
        <table className="help-data">
          <thead>
            <tr>
              {block.head.map((cell) => (
                <th key={cell}>{cell}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, index) => (
              <tr key={index}>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex} className={cellIndex === 0 ? "t-num" : undefined}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {block.note && <p className="help-note">{block.note}</p>}
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
  const straightTable = table("straights-formations");
  const shopTable = table("shipyard");

  return (
    <div className="help-scroll">
      <p className="help-lede">
        {intro?.summary} {texts("one-minute")[0]}
      </p>
      {texts("one-minute")
        .slice(1)
        .map((text) => (
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
            const sides = Number(row.name.replace(/\D/g, "")) as DieSize;
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
        {texts("your-dice")
          .slice(0, 2)
          .map((text) => (
            <Copy key={text}>{text}</Copy>
          ))}
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
        {texts("your-dice")
          .slice(2)
          .map((text) => (
            <Copy key={text}>{text}</Copy>
          ))}
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
      </Card>

      <Card title={flag?.title ?? "Your flagship"}>
        <Copy>{flag?.summary ?? ""}</Copy>
        {texts("flagship").map((text) => (
          <Copy key={text}>{text}</Copy>
        ))}
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
      </Card>

      <Card title={lines?.title ?? "Straights and formations"}>
        <Copy>{lines?.summary ?? ""}</Copy>
        {texts("straights-formations").map((text) => (
          <Copy key={text}>{text}</Copy>
        ))}
        <div className="help-prize-row" aria-hidden>
          <HelpShipFace value={1} size={48} />
          <HelpShipFace value={2} size={48} />
          <HelpShipFace value={3} size={48} />
          <HelpShipFace value={4} size={48} />
          <HelpShipFace value={5} size={48} />
        </div>
        {straightTable && <HelpTable block={straightTable} />}
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
        {texts("shipyard").map((text) => (
          <Copy key={text}>{text}</Copy>
        ))}
        {shopTable && <HelpTable block={shopTable} />}
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
