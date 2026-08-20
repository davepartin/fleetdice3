"use client";

/**
 * The one help button.
 *
 * Everything here is generated from `lib/reference.ts`, which reads the real
 * engine — so the numbers a player is taught are the numbers the game uses.
 * A help screen that drifts from the rules is worse than no help screen.
 */

import { useState } from "react";
import { GLOSSARY, HOW_TO_PLAY, TIPS, type HelpBlock } from "@/lib/reference";
import { Button, Rule, Sheet } from "./ui";

function Block({ block }: { block: HelpBlock }) {
  if (block.kind === "text") {
    return <p className="text-[0.94rem] leading-relaxed text-[--color-hull-200]">{block.text}</p>;
  }

  if (block.kind === "steps") {
    return (
      <ol className="flex flex-col gap-3">
        {block.steps.map((step, index) => (
          <li key={step.name} className="flex gap-3">
            <span className="t-num mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-white/8 text-[0.72rem] text-[--color-hull-200]">
              {index + 1}
            </span>
            <span className="text-[0.94rem] leading-relaxed text-[--color-hull-200]">
              <b className="font-semibold text-white">{step.name}. </b>
              {step.text}
            </span>
          </li>
        ))}
      </ol>
    );
  }

  return (
    <div>
      <div className="-mx-1 overflow-x-auto">
        <table className="w-full min-w-[19rem] border-collapse text-left text-[0.86rem]">
          <thead>
            <tr>
              {block.head.map((cell) => (
                <th
                  key={cell}
                  className="t-eyebrow whitespace-nowrap border-b border-white/12 px-2 pb-2 text-[0.58rem]"
                >
                  {cell}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, index) => (
              <tr key={index} className="border-b border-white/[0.06] last:border-0">
                {row.map((cell, cellIndex) => (
                  <td
                    key={cellIndex}
                    className={`px-2 py-2 align-top ${
                      cellIndex === 0
                        ? "t-num whitespace-nowrap font-semibold text-white"
                        : "text-[--color-hull-200]"
                    }`}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {block.note && (
        <p className="mt-2 text-[0.8rem] leading-snug text-[--color-hull-400]">{block.note}</p>
      )}
    </div>
  );
}

export function HowToPlayBody() {
  const [openId, setOpenId] = useState<string>(HOW_TO_PLAY[0]?.id ?? "");
  const [showExtras, setShowExtras] = useState(false);

  return (
    <div className="flex flex-col gap-2 pb-2">
      {HOW_TO_PLAY.map((section) => {
        const open = openId === section.id;
        return (
          <div key={section.id} className="overflow-hidden rounded-2xl border border-white/[0.09] bg-white/[0.025]">
            <button
              type="button"
              onClick={() => setOpenId(open ? "" : section.id)}
              aria-expanded={open}
              className="flex w-full items-start gap-3 px-4 py-3.5 text-left"
            >
              <span className="min-w-0 flex-1">
                <span className="t-display block text-[1.02rem] leading-tight text-white">
                  {section.title}
                </span>
                <span className="mt-1 block text-[0.82rem] leading-snug text-[--color-hull-400]">
                  {section.summary}
                </span>
              </span>
              <span
                className={`mt-1 shrink-0 text-[--color-hull-400] transition-transform duration-200 ${
                  open ? "rotate-180" : ""
                }`}
                aria-hidden
              >
                ▾
              </span>
            </button>
            {open && (
              <div className="flex flex-col gap-4 px-4 pb-4">
                <Rule />
                {section.blocks.map((block, index) => (
                  <Block key={index} block={block} />
                ))}
              </div>
            )}
          </div>
        );
      })}

      <button
        type="button"
        onClick={() => setShowExtras((value) => !value)}
        className="mt-1 self-start text-[0.8rem] font-semibold uppercase tracking-[0.14em] text-[--color-hull-400] hover:text-white"
      >
        {showExtras ? "Hide" : "Show"} words and tips
      </button>

      {showExtras && (
        <div className="flex flex-col gap-4 rounded-2xl border border-white/[0.09] bg-white/[0.025] p-4">
          <div>
            <p className="t-eyebrow mb-2">Words used in this game</p>
            <dl className="flex flex-col gap-2">
              {GLOSSARY.map((entry) => (
                <div key={entry.term} className="text-[0.88rem] leading-snug">
                  <dt className="inline font-semibold text-white">{entry.term}. </dt>
                  <dd className="inline text-[--color-hull-300]">{entry.text}</dd>
                </div>
              ))}
            </dl>
          </div>
          <Rule />
          <div>
            <p className="t-eyebrow mb-2">Once you know the rules</p>
            <ul className="flex flex-col gap-2">
              {TIPS.map((tip) => (
                <li key={tip.title} className="text-[0.88rem] leading-snug">
                  <b className="font-semibold text-white">{tip.title}. </b>
                  <span className="text-[--color-hull-300]">{tip.text}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
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
