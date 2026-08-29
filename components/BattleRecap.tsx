"use client";

/**
 * The battle recap.
 *
 * The screen a match ends on: both fleets, board for board, and the totals
 * from the whole game laid out side by side. Players talk about the games
 * they played — this is the screen worth a screenshot when they do.
 */

import type { PlayerState } from "@/lib/engine";
import { shipInSlot, slotForCell } from "@/lib/engine";
import { NOUN } from "@/lib/reference";
import { HullShape } from "./HullShape";
import { Button, Ticker } from "./ui";

const CELLS = Array.from({ length: 9 }, (_, cell) => cell);

/** The 3×3 fleet, exactly as the shipyard draws it, at the size a screenshot needs. */
function FleetBoard({ player }: { player: PlayerState }) {
  return (
    <div className="recap-board" role="group" aria-label="Final fleet">
      {CELLS.map((cell) => {
        if (cell === 4) {
          return (
            <div key={cell} className="recap-cell recap-cell-flag">
              <span className="recap-cell-flag-star" aria-hidden="true">★</span>
              <span className="recap-cell-flag-level t-num">L{player.flag.level}</span>
            </div>
          );
        }
        const slot = slotForCell(cell)!;
        const ship = player.open[slot] ? shipInSlot(player, slot) : undefined;
        return (
          <div key={cell} className={`recap-cell ${ship ? "recap-cell-ship" : "recap-cell-empty"}`}>
            {ship && (
              <>
                <span className="recap-cell-hull">
                  <HullShape sides={ship.sides} tone="live" />
                </span>
                <span className="recap-cell-hull-label t-num">d{ship.sides}</span>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

function FleetPanel({
  player,
  name,
  you,
}: {
  player: PlayerState;
  name: string;
  you: boolean;
}) {
  return (
    <div className={`panel ${you ? "panel-you" : "panel-enemy"} recap-fleet`}>
      <div className="recap-fleet-head">
        <p className="recap-fleet-name">{name}</p>
        <p className="recap-fleet-hp t-num">
          <Ticker value={Math.max(0, player.hp)} />
          <span className="recap-fleet-hp-unit"> HP</span>
        </p>
      </div>
      <FleetBoard player={player} />
    </div>
  );
}

/** One line of the totals: your number, a share bar, their number — the
 *  same colour carrying all three, so the row reads before it's parsed. */
function StatRow({
  label,
  you,
  them,
  color,
}: {
  label: string;
  you: number;
  them: number;
  color: string;
}) {
  const total = you + them;
  const yourShare = total > 0 ? (you / total) * 100 : 50;
  const tone = { color: `var(--color-${color})` };
  return (
    <div className="recap-row">
      <span className="recap-row-value recap-row-value-you t-num" style={tone}>
        <Ticker value={you} />
      </span>
      <div className="recap-row-mid">
        <span className="recap-row-label">{label}</span>
        <div className="recap-row-bar">
          <span
            className="recap-row-bar-fill"
            style={{ width: `${yourShare}%`, background: `var(--color-${color})` }}
          />
        </div>
      </div>
      <span className="recap-row-value recap-row-value-them t-num" style={tone}>
        <Ticker value={them} />
      </span>
    </div>
  );
}

/**
 * The volley that ended it. Both commanders lock in blind, so the two
 * fleets shown side by side are the only way — on a phone, not next to
 * each other — to see why the match actually went the way it did.
 */
function LastRound({
  you,
  them,
  enemyName,
}: {
  you: PlayerState;
  them: PlayerState;
  enemyName: string;
}) {
  const yourReport = you.report;
  const theirReport = them.report;
  if (!yourReport || !theirReport) return null;

  const yourAttack = yourReport.tally.attack;
  const theirAttack = theirReport.tally.attack;
  const yourShields = yourReport.tally.defense;
  const theirShields = theirReport.tally.defense;
  const yourDirect = yourReport.tally.direct;
  const theirDirect = theirReport.tally.direct;

  // Both flagships falling in the same volley is the one outcome the HP
  // numbers alone don't explain — the engine breaks that tie on the
  // heavier volley, then on damage across the whole match, so this reads
  // out exactly the numbers it used.
  const bothFell = you.hp <= 0 && them.hp <= 0;
  let tiebreak: string | null = null;
  if (bothFell) {
    if (yourAttack !== theirAttack) {
      const youHadIt = yourAttack > theirAttack;
      tiebreak = `Both flagships fell in the same volley — ${youHadIt ? "you" : enemyName} fired the heavier Attack that round, ${Math.max(yourAttack, theirAttack)} to ${Math.min(yourAttack, theirAttack)}, and it decided it.`;
    } else if (you.stats.damageDealt !== them.stats.damageDealt) {
      const youHadIt = you.stats.damageDealt > them.stats.damageDealt;
      tiebreak = `Both flagships fell in the same volley with equal Attack — it came down to total damage across the whole match, ${Math.max(you.stats.damageDealt, them.stats.damageDealt)} to ${Math.min(you.stats.damageDealt, them.stats.damageDealt)}, and ${youHadIt ? "you" : enemyName} had it.`;
    } else {
      tiebreak = "Both flagships fell in the same volley, dead even all the way down — a draw.";
    }
  }

  return (
    <div className="panel recap-stats">
      <p className="t-eyebrow recap-lastround-title">Round {yourReport.round} — the final volley</p>
      <div className="recap-stats-head">
        <span className="t-eyebrow">You</span>
        <span className="t-eyebrow">{enemyName}</span>
      </div>
      <div className="recap-lastround-hp">
        <span className="recap-lastround-hp-side recap-lastround-hp-you">
          <span className="c-hp t-num">{Math.max(0, yourReport.hpBefore)}</span>
          <span className="recap-lastround-arrow" aria-hidden="true">→</span>
          <span className="c-hp t-num">{Math.max(0, yourReport.hpAfter)}</span>
        </span>
        <span className="recap-lastround-hp-side recap-lastround-hp-them">
          <span className="c-hp t-num">{Math.max(0, theirReport.hpBefore)}</span>
          <span className="recap-lastround-arrow" aria-hidden="true">→</span>
          <span className="c-hp t-num">{Math.max(0, theirReport.hpAfter)}</span>
        </span>
      </div>
      <StatRow label="Attack" you={yourAttack} them={theirAttack} color="attack" />
      <StatRow label="Shields" you={yourShields} them={theirShields} color="shield" />
      <StatRow label="Direct" you={yourDirect} them={theirDirect} color="direct" />
      {tiebreak && <p className="recap-lastround-note">{tiebreak}</p>}
    </div>
  );
}

export function BattleRecap({
  won,
  draw,
  cancelledBy,
  youCancelled,
  you,
  them,
  enemyName,
  onExit,
  onRestart,
}: {
  won: boolean;
  draw: boolean;
  cancelledBy?: string | null;
  youCancelled?: boolean;
  you: PlayerState;
  them: PlayerState | null;
  enemyName: string;
  onExit(): void;
  onRestart?(): void;
}) {
  const cancelled = Boolean(cancelledBy);
  const outcome = cancelled ? "cancelled" : draw ? "draw" : won ? "won" : "lost";

  return (
    <div className="recap">
      <div className="recap-scroll fade-edges">
        <div className="recap-head">
          <p className="t-eyebrow">{cancelled ? "Game cancelled" : "Battle recap"}</p>
          <h2 className={`t-display text-3xl recap-title-${outcome}`}>
            {cancelled
              ? youCancelled
                ? `You ended the ${NOUN.game}`
                : `${cancelledBy} ended the ${NOUN.game}`
              : draw
                ? "A draw"
                : won
                  ? `You beat ${enemyName}`
                  : `${enemyName} wins`}
          </h2>
        </div>

        {them && <LastRound you={you} them={them} enemyName={enemyName} />}

        <div className="recap-fleets">
          <FleetPanel player={you} name="You" you />
          {them && <FleetPanel player={them} name={enemyName} you={false} />}
        </div>

        {them ? (
          <div className="panel recap-stats">
            <div className="recap-stats-head">
              <span className="t-eyebrow">You</span>
              <span className="t-eyebrow">{enemyName}</span>
            </div>
            <StatRow label="Hit points" you={Math.max(0, you.hp)} them={Math.max(0, them.hp)} color="hp" />
            <StatRow label="Flagship level" you={you.flag.level} them={them.flag.level} color="flag-glow" />
            <StatRow
              label="Total attack"
              you={you.stats.damageDealt}
              them={them.stats.damageDealt}
              color="attack"
            />
            <StatRow
              label="Shields blocked"
              you={you.stats.shieldsBlocked}
              them={them.stats.shieldsBlocked}
              color="shield"
            />
            <StatRow
              label="Direct hits"
              you={you.stats.directDealt}
              them={them.stats.directDealt}
              color="direct"
            />
            <StatRow label="Repaired" you={you.stats.repaired} them={them.stats.repaired} color="repair" />
            <StatRow label="Straights" you={you.stats.straights} them={them.stats.straights} color="run" />
            <StatRow label="Rows, three across" you={you.stats.rows} them={them.stats.rows} color="energy" />
            <StatRow label="Columns, three down" you={you.stats.cols} them={them.stats.cols} color="attack" />
            <StatRow
              label="Energy spent rerolling"
              you={you.stats.rerollEnergy}
              them={them.stats.rerollEnergy}
              color="energy"
            />
          </div>
        ) : (
          <div className="panel recap-stats">
            <StatRow label="Total attack" you={you.stats.damageDealt} them={0} color="attack" />
            <StatRow label="Shields blocked" you={you.stats.shieldsBlocked} them={0} color="shield" />
            <StatRow label="Direct hits" you={you.stats.directDealt} them={0} color="direct" />
            <StatRow label="Repaired" you={you.stats.repaired} them={0} color="repair" />
            <StatRow label="Straights" you={you.stats.straights} them={0} color="run" />
            <StatRow label="Energy spent rerolling" you={you.stats.rerollEnergy} them={0} color="energy" />
          </div>
        )}
      </div>

      <div className="recap-foot">
        <Button tone="ghost" size="lg" full onClick={onExit}>
          Back to {NOUN.home}
        </Button>
        {onRestart && !cancelled && (
          <Button tone="primary" size="lg" full onClick={onRestart}>
            Again
          </Button>
        )}
      </div>
    </div>
  );
}
