"use client";

/**
 * What just happened, in the order it happened.
 *
 * Every row is a number the player can check against the board. If a total does
 * not add up here, the rules are wrong, not the display — so the arithmetic is
 * laid out rather than summarised.
 */

import { useState } from "react";
import type { RoundReport as Report } from "@/lib/engine";
import { Button, Notice, Rule, Stat } from "./ui";

/**
 * One arithmetic term in a battle line: an operator, a label, and the
 * number itself — the same "small caption under/after a coloured number"
 * language as the rest of the game, just inline instead of stacked.
 */
function Term({
  op,
  label,
  value,
  tone,
  strong,
}: {
  op?: "+" | "−";
  label: string;
  value: number;
  tone?: "attack" | "shield" | "direct" | "repair";
  strong?: boolean;
}) {
  return (
    <>
      {op && <span className="c-dim"> {op} </span>}
      <span className="c-dim">{label} </span>
      <span className={`t-num ${tone ? `c-${tone}` : "text-white"} ${strong ? "font-semibold" : ""}`}>
        {value}
      </span>
    </>
  );
}

/** The number a battle line arrives at — bold and first, so it reads as the
 *  headline of the sentence rather than one more term in the chain. */
function Result({ value, label, tone }: { value: number; label: string; tone?: "attack" }) {
  return (
    <>
      <span className={`t-num font-semibold ${tone ? `c-${tone}` : "text-white"}`}>{value}</span>{" "}
      <span className="c-dim">{label}</span>
    </>
  );
}

function Row({
  label,
  value,
  tone,
  note,
  strong,
}: {
  label: string;
  value: string;
  tone?: "attack" | "shield" | "energy" | "repair" | "direct" | "dim";
  note?: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className={`text-sm ${strong ? "font-semibold text-white" : "c-dim"}`}>
        {label}
        {note && <span className="block text-xs leading-tight c-dim">{note}</span>}
      </span>
      <span className={`t-num shrink-0 text-base ${tone ? `c-${tone}` : "text-white"}`}>
        {value}
      </span>
    </div>
  );
}

export function RoundReportCard({
  report,
  enemyName,
  waitingForOpponent = false,
  onContinue,
  busy,
}: {
  report: Report;
  enemyName: string;
  /** The other commander is still choosing which ships absorb their volley. */
  waitingForOpponent?: boolean;
  onContinue(): void;
  busy?: boolean;
}) {
  const t = report.tally;
  const enemy = report.enemyTally;
  const survived = report.hpAfter > 0;

  const took = report.damage;
  const blocked = Math.max(0, (enemy?.attack ?? 0) + report.escalation - report.incoming);
  const [detailsOpen, setDetailsOpen] = useState(false);

  // What you dealt them is only ever a ceiling here — their own brace choice
  // (which ships stepped in front of it) isn't known from this side of the
  // match, so this assumes zero and says so, rather than guessing.
  const enemyShieldsStopped = Math.min(t.attack, enemy?.defense ?? 0);
  const enemyRepair = enemy?.heal ?? 0;
  const dealtCeiling = Math.max(0, t.attack - (enemy?.defense ?? 0)) + report.escalation + t.direct;

  return (
    <div className={`round-report flex min-h-0 flex-1 flex-col gap-3 ${detailsOpen ? "is-open" : ""}`}>
      <div className="flex items-baseline justify-between">
        <div>
          <p className="t-eyebrow">Round {report.round}</p>
          <h2 className="t-display text-xl">
            {took === 0 ? "Nothing got through" : `You took ${took}`}
          </h2>
        </div>
        <Stat kind="energy" value={`+${report.energyEarned}`} label="earned" />
      </div>

      {/* The whole round, in the two numbers each commander actually needs:
       * what landed on you, and what you landed on them. Everything below
       * ("Battle details") is the same arithmetic spelled out further, for
       * anyone who wants to check it against the board. */}
      <div className="round-report-mobile-summary">
        <p className="battle-line text-sm leading-snug">
          <Term label="attack" value={enemy?.attack ?? 0} tone="attack" />
          {blocked > 0 && <Term op="−" label="shields" value={blocked} tone="shield" />}
          {report.soaked > 0 && <Term op="−" label="blocked" value={report.soaked} tone="shield" />}
          {report.escalation > 0 && <Term op="+" label="war" value={report.escalation} tone="attack" />}
          {report.direct > 0 && <Term op="+" label="direct" value={report.direct} tone="direct" />}
          <span className="c-dim"> = </span>
          <Result value={took} label="damage to you" tone="attack" />
          {report.repair > 0 && (
            <>
              <span className="c-dim"> · </span>
              <Term op="+" label="repair" value={report.repair} tone="repair" />
            </>
          )}
        </p>
        <p className="battle-line text-sm leading-snug">
          <Term label="attack" value={t.attack} tone="attack" />
          {enemyShieldsStopped > 0 && <Term op="−" label="their shields" value={enemyShieldsStopped} tone="shield" />}
          {report.escalation > 0 && <Term op="+" label="war" value={report.escalation} tone="attack" />}
          {t.direct > 0 && <Term op="+" label="direct" value={t.direct} tone="direct" />}
          <span className="c-dim"> = up to </span>
          <Result value={dealtCeiling} label={`to ${enemyName}`} tone="attack" />
          {enemyRepair > 0 && (
            <>
              <span className="c-dim"> · </span>
              <Term op="+" label="their repair" value={enemyRepair} tone="repair" />
            </>
          )}
          <span className="c-dim"> · their blocks unknown</span>
        </p>
      </div>

      <div className="round-report-disclosure min-h-0">
        <button
          type="button"
          className="round-report-disclosure-button"
          aria-expanded={detailsOpen}
          onClick={() => setDetailsOpen((open) => !open)}
        >
          Battle details
        </button>
        <div className="round-report-details-body">
        {/* What you fired */}
        <section className="panel panel-you panel-flush p-3.5">
          <p className="t-eyebrow mb-1">Your volley</p>
          <div className="grid grid-cols-5 gap-1 py-1">
            <Stat kind="attack" value={t.attack} label="Attack" size="sm" />
            <Stat kind="shield" value={t.defense} label="Shields" size="sm" />
            <Stat kind="direct" value={t.direct} label="Direct" size="sm" />
            <Stat kind="repair" value={t.heal} label="Repair" size="sm" />
            <Stat kind="energy" value={t.energy} label="Energy" size="sm" />
          </div>
          {(t.run || t.lines.length > 0 || report.escalation > 0) && (
            <>
              <Rule className="my-2" />
              {t.run && (
                <Row
                  label={`Straight — ${t.run.taken} in a row`}
                  note={`Biggest ship in the line is a d${t.run.biggest}`}
                  value={`+${t.run.reward.label}`}
                  tone={t.run.reward.kind === "attack" ? "attack" : "energy"}
                />
              )}
              {t.lines.map((line, index) => (
                <Row
                  key={index}
                  label={
                    line.kind === "row"
                      ? `Three ${line.value}s across`
                      : `Three ${line.value}s down`
                  }
                  value={line.kind === "row" ? `+${line.energy} Energy` : `+${line.attack} Attack`}
                  tone={line.kind === "row" ? "energy" : "attack"}
                />
              ))}
              {report.escalation > 0 && (
                <Row
                  label="The war"
                  note="Added to both flagships. Shields cannot stop it"
                  value={`+${report.escalation}`}
                  tone="attack"
                />
              )}
            </>
          )}
        </section>

        {/* What hit you */}
        <section className="panel panel-enemy panel-flush mt-3 p-3.5">
          <p className="t-eyebrow mb-1">{enemyName} fired back</p>
          <Row
            label="Their attack"
            value={String(enemy?.attack ?? 0)}
            tone="attack"
          />
          {report.escalation > 0 && (
            <Row
              label="The war"
              note="Shields cannot stop this. Ships still can."
              value={`+${report.escalation}`}
              tone="attack"
            />
          )}
          <Row label="Your shields stopped" value={`−${blocked}`} tone="shield" />
          {report.bracedShips.length > 0 && (
            <Row
              label={`${report.bracedShips.length} ${report.bracedShips.length === 1 ? "ship" : "ships"} took the hit`}
              note={`${report.bracedShips.map((ship) => `d${ship.sides}`).join(", ")} — out for one round`}
              value={`−${report.soaked}`}
              tone="shield"
            />
          )}
          {report.direct > 0 && (
            <Row
              label="Direct damage"
              note="Nothing stops Direct — not shields, not ships"
              value={`+${report.direct}`}
              tone="direct"
            />
          )}
          <Rule className="my-1.5" />
          <Row label="Landed on your flagship" value={String(took)} tone="attack" strong />
          {report.repair > 0 && <Row label="Your 3s repaired" value={`+${report.repair}`} tone="repair" />}
        </section>

        {!survived && (
          <Notice tone="warn" className="mt-3">
            Your flagship is gone.
          </Notice>
        )}
        </div>
      </div>

      {waitingForOpponent && survived && (
        <p className="round-report-wait" role="status">
          {enemyName} is choosing ships to take the hit. Your shipyard will open when they finish.
        </p>
      )}
      <Button tone="primary" size="lg" full onClick={onContinue} disabled={busy || waitingForOpponent}>
        {!survived ? "See the result" : waitingForOpponent ? `Waiting for ${enemyName}` : "To the shipyard"}
      </Button>
    </div>
  );
}
