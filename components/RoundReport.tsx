"use client";

/**
 * What just happened, in the order it happened.
 *
 * Every row is a number the player can check against the board. If a total does
 * not add up here, the rules are wrong, not the display — so the arithmetic is
 * laid out rather than summarised.
 */

import { useState } from "react";
import type { PlayerState, RoundReport as Report } from "@/lib/engine";
import { Button, HealthBar, Rule, Stat, Ticker } from "./ui";

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
      <span className={`text-[0.88rem] ${strong ? "font-semibold text-white" : "text-[--color-hull-300]"}`}>
        {label}
        {note && <span className="block text-[0.72rem] leading-tight c-dim">{note}</span>}
      </span>
      <span className={`t-num shrink-0 text-[0.98rem] ${tone ? `c-${tone}` : "text-white"}`}>
        {value}
      </span>
    </div>
  );
}

export function RoundReportCard({
  report,
  you,
  enemyName,
  onContinue,
  busy,
}: {
  report: Report;
  you: PlayerState;
  enemyName: string;
  onContinue(): void;
  busy?: boolean;
}) {
  const t = report.tally;
  const enemy = report.enemyTally;
  const survived = report.hpAfter > 0;

  const took = report.damage;
  const blocked = Math.max(0, (enemy?.attack ?? 0) + report.escalation - report.incoming);
  const [detailsOpen, setDetailsOpen] = useState(false);

  return (
    <div className={`round-report flex min-h-0 flex-1 flex-col gap-3 ${detailsOpen ? "is-open" : ""}`}>
      <div className="flex items-baseline justify-between">
        <div>
          <p className="t-eyebrow">Round {report.round}</p>
          <h2 className="t-display text-2xl">
            {took === 0 ? "Nothing got through" : `You took ${took}`}
          </h2>
        </div>
        <Stat kind="energy" value={`+${report.energyEarned}`} label="earned" />
      </div>

      <div className="round-report-mobile-summary">
        <div className="grid grid-cols-4 gap-1">
          <Stat kind="attack" value={t.attack} label="Attack" size="sm" />
          <Stat kind="shield" value={t.defense} label="Shields" size="sm" />
          <Stat kind="direct" value={t.direct} label="Direct" size="sm" />
          <Stat kind="repair" value={t.heal} label="Repair" size="sm" />
        </div>
        <div className="round-report-mobile-hp flex items-center gap-2">
          <span className="t-eyebrow">Ship</span>
          <HealthBar className="min-w-0 flex-1" value={report.hpAfter} max={you.maxHp} />
          <span className="t-num text-white"><Ticker value={Math.max(0, report.hpAfter)} />/{you.maxHp}</span>
        </div>
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

        {/* Health */}
        <section className="mt-3 px-1">
          <div className="mb-1.5 flex items-baseline justify-between">
            <span className="t-eyebrow">Your flagship</span>
            <span className="t-num text-lg text-white">
              <Ticker value={Math.max(0, report.hpAfter)} /> / {you.maxHp}
            </span>
          </div>
          <HealthBar value={report.hpAfter} max={you.maxHp} />
          {!survived && (
            <p className="mt-2 text-sm text-[--color-attack-glow]">Your flagship is gone.</p>
          )}
        </section>
        </div>
      </div>

      <Button tone="primary" size="lg" full onClick={onContinue} disabled={busy}>
        {survived ? "To the shipyard" : "See the result"}
      </Button>
    </div>
  );
}
