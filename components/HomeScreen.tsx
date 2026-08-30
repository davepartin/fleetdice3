"use client";

/**
 * The front door.
 *
 * One tap to play alone, one tap to start a game with a friend, and one box for
 * the four numbers on their screen. Everything else is below the fold.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { HeroStage } from "./HeroStage";
import { Button, Chip, Notice, Panel, Rule, Sheet, Spinner } from "./ui";
import { HowToPlaySheet } from "./HowToPlay";
import { commanderName, ensurePlayerIdentity, firebaseConfigured, rememberCommanderName } from "@/lib/firebase";
import {
  cancelRoom,
  loadRememberedRoomCards,
  watchLiveBattles,
  watchRecentResults,
  type BattleResultRow,
  type LiveBattleRow,
  type RememberedRoomCard,
} from "@/lib/rooms";
import { basePath } from "@/lib/paths";
import { NOUN } from "@/lib/reference";

export function HomeScreen() {
  const [name, setName] = useState("Commander");
  const [code, setCode] = useState("");
  const [helpOpen, setHelpOpen] = useState(false);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cards, setCards] = useState<RememberedRoomCard[]>([]);
  const [battles, setBattles] = useState<LiveBattleRow[]>([]);
  const [results, setResults] = useState<BattleResultRow[]>([]);
  const [showBoard, setShowBoard] = useState(false);
  const [pendingCancel, setPendingCancel] = useState<RememberedRoomCard | null>(null);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    setName(commanderName());
    if (firebaseConfigured) ensurePlayerIdentity().catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!firebaseConfigured) return;
    let alive = true;
    loadRememberedRoomCards()
      .then((rows) => alive && setCards(rows))
      .catch(() => undefined);
    const stopBattles = watchLiveBattles(
      (rows) => alive && setBattles(rows),
      () => undefined,
    );
    const stopResults = watchRecentResults(
      (rows) => alive && setResults(rows.slice(0, 8)),
      () => undefined,
    );
    return () => {
      alive = false;
      stopBattles();
      stopResults();
    };
  }, []);

  const saveName = useCallback((value: string) => {
    setName(value);
    rememberCommanderName(value);
  }, []);

  const join = useCallback(() => {
    const cleaned = code.replace(/\D/g, "").slice(0, 4);
    if (cleaned.length !== 4) {
      setError("Type all four numbers from your friend's screen.");
      return;
    }
    setJoining(true);
    window.location.href = `${basePath}/join/?code=${cleaned}`;
  }, [code]);

  const confirmCancel = useCallback(async () => {
    const card = pendingCancel;
    if (!card) return;
    setClosing(true);
    setError(null);
    try {
      await cancelRoom(card.id);
      setCards((rows) => rows.filter((row) => row.id !== card.id));
      setPendingCancel(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setClosing(false);
    }
  }, [pendingCancel]);

  return (
    <>
      <HeroStage />
      <div className="hud">
        <div className="scroll-y fade-edges flex-1">
          <div className="mx-auto flex w-full max-w-[30rem] flex-col gap-4 px-4 pb-10 pt-8">
            {/* Wordmark */}
            <header className="anim-rise text-center">
              <p className="t-eyebrow">Build the fleet · Break the flagship</p>
              <h1 className="t-display mt-1 text-3xl text-white">
                Fleet Dice<span className="c-energy"> 3</span>
              </h1>
            </header>

            {/* Straight under the wordmark, above the name field and the
                modes: someone who has never played this should not have to
                scroll past three ways to start a match to find the rules. */}
            <Button tone="ghost" full onClick={() => setHelpOpen(true)}>
              How to play
            </Button>

            {/* Name */}
            <Panel className="p-3.5">
              <label className="t-eyebrow mb-1.5 block" htmlFor="commander">
                Your name
              </label>
              <input
                id="commander"
                value={name}
                maxLength={20}
                onChange={(event) => saveName(event.target.value)}
                className="t-num w-full rounded-xl border border-white/12 bg-black/40 px-3 py-2.5 text-base text-white outline-none focus:border-white/40"
              />
            </Panel>

            {/* The two ways to play */}
            <div className="flex flex-col gap-2.5">
              <Link href="/tutorial/" className="block">
                <Panel className="anim-rise flex items-center gap-4 border-[--color-energy]/30 bg-[--color-energy]/[0.06] p-4 transition hover:border-[--color-energy]/50">
                  <ModeIcon kind="tutorial" />
                  <span className="min-w-0 flex-1">
                    <span className="t-display block text-xl text-white">Tutorial</span>
                    <span className="mt-0.5 block text-sm leading-snug c-dim">
                      A short guided flight — faces, formations, the shipyard, a straight, and the flagship token.
                    </span>
                  </span>
                  <span className="c-energy" aria-hidden>
                    ›
                  </span>
                </Panel>
              </Link>

              <Link href="/solo/" className="block">
                <Panel className="anim-rise flex items-center gap-4 p-4 transition hover:border-white/25">
                  <ModeIcon kind="solo" />
                  <span className="min-w-0 flex-1">
                    <span className="t-display block text-xl text-white">Play solo</span>
                    <span className="mt-0.5 block text-sm leading-snug c-dim">
                      Straight into a battle against the ship&apos;s computer. Pick how hard it plays.
                    </span>
                  </span>
                  <span className="c-dim" aria-hidden>
                    ›
                  </span>
                </Panel>
              </Link>

              <Link href="/versus/" className="block">
                <Panel className="anim-rise flex items-center gap-4 p-4 transition hover:border-white/25">
                  <ModeIcon kind="versus" />
                  <span className="min-w-0 flex-1">
                    <span className="t-display block text-xl text-white">Play a friend</span>
                    <span className="mt-0.5 block text-sm leading-snug c-dim">
                      Get a four-digit code and send them the link. Start as many games as you like.
                    </span>
                  </span>
                  <span className="c-dim" aria-hidden>
                    ›
                  </span>
                </Panel>
              </Link>
            </div>

            {/* Join by code */}
            <Panel className="p-4">
              <p className="t-eyebrow mb-2">Got a code from a friend?</p>
              <div className="flex gap-2">
                <input
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={4}
                  value={code}
                  placeholder="0000"
                  onChange={(event) => {
                    setCode(event.target.value.replace(/\D/g, "").slice(0, 4));
                    setError(null);
                  }}
                  onKeyDown={(event) => event.key === "Enter" && join()}
                  aria-label="Four digit game code"
                  className="t-num min-w-0 flex-1 rounded-xl border border-white/12 bg-black/40 px-3 py-3 text-center text-xl tracking-[0.4em] text-white outline-none focus:border-white/40"
                />
                <Button tone="ghost" onClick={join} disabled={joining || code.length !== 4}>
                  {joining ? "…" : "Join"}
                </Button>
              </div>
              {error && (
                <Notice tone="warn" className="mt-2">
                  {error}
                </Notice>
              )}
            </Panel>

            {/* Your games in progress */}
            {cards.length > 0 && (
              <Panel className="p-4">
                <p className="t-eyebrow mb-2">Your {NOUN.games}</p>
                <div className="flex flex-col gap-2">
                  {cards.map((card) => (
                    <div
                      key={card.id}
                      className="flex items-stretch overflow-hidden rounded-xl border border-white/10 bg-white/[0.03]"
                    >
                      <Link
                        href={`/match/?id=${card.id}`}
                        className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 transition hover:bg-white/[0.07]"
                      >
                        <span className="t-num rounded-lg bg-white/8 px-2 py-1 text-sm">{card.code}</span>
                        <span className="min-w-0 flex-1 text-sm">
                          <b className="text-white">
                            {card.enemyName ? `vs ${card.enemyName}` : "Waiting for a friend"}
                          </b>
                          <span className="block text-xs c-dim">
                            {card.status === "waiting" ? "Not started" : `Round ${card.round}`}
                          </span>
                        </span>
                        <span className="c-dim" aria-hidden>
                          ›
                        </span>
                      </Link>
                      <button
                        type="button"
                        className="min-h-[44px] shrink-0 border-l border-white/10 px-3 text-xs font-bold uppercase tracking-wide c-attack-glow"
                        onClick={() => {
                          setError(null);
                          setPendingCancel(card);
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  ))}
                </div>
              </Panel>
            )}

            {/* Now on the field */}
            {firebaseConfigured && (
              <div>
                <button
                  type="button"
                  onClick={() => setShowBoard((value) => !value)}
                  className="flex w-full items-center justify-between gap-2 px-1 py-2"
                >
                  <span className="t-eyebrow">
                    Now on the field
                    {battles.length > 0 && (
                      <span className="c-repair"> · {battles.length}</span>
                    )}
                  </span>
                  <span className={`c-dim transition-transform ${showBoard ? "rotate-180" : ""}`} aria-hidden>
                    ▾
                  </span>
                </button>
                {showBoard && (
                  <Panel className="p-4">
                    {battles.length === 0 ? (
                      <p className="text-sm c-dim">No {NOUN.games} running right now. Start one.</p>
                    ) : (
                      <ul className="flex flex-col gap-1.5">
                        {battles.map((row) => (
                          <li key={row.id} className="flex items-center gap-2 text-sm">
                            <Chip tone={row.status === "active" ? "attack" : "neutral"}>
                              {row.status === "active" ? `Round ${row.round}` : "Waiting"}
                            </Chip>
                            <span className="truncate c-dim-bright">
                              {row.hostName}
                              {row.guestName ? ` vs ${row.guestName}` : ""}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {results.length > 0 && (
                      <>
                        <Rule className="my-3" />
                        <p className="t-eyebrow mb-2">Recent results</p>
                        <ul className="flex flex-col gap-1">
                          {results.map((row) => (
                            <li key={row.id} className="text-sm c-dim">
                              <b className="c-repair">{row.winnerName}</b> beat {row.loserName}
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                  </Panel>
                )}
              </div>
            )}

            {!firebaseConfigured && (
              <Notice tone="warn">
                Two-player games are switched off because this build has no Firebase settings. Solo
                works fine.
              </Notice>
            )}

            <p className="pt-2 text-center text-xs c-dim">
              Fleet Dice 3 · every number in this game was measured, not guessed
            </p>
          </div>
        </div>
      </div>

      <HowToPlaySheet open={helpOpen} onClose={() => setHelpOpen(false)} />
      <Sheet
        open={Boolean(pendingCancel)}
        onClose={() => !closing && setPendingCancel(null)}
        title={`Cancel this ${NOUN.game}?`}
        footer={
          <div className="flex flex-col gap-2">
            <Button tone="ghost" full disabled={closing} onClick={() => setPendingCancel(null)}>
              Keep it
            </Button>
            <Button tone="primary" full disabled={closing} onClick={() => void confirmCancel()}>
              {closing ? "Ending…" : `Cancel ${NOUN.game}`}
            </Button>
          </div>
        }
      >
        <p className="text-base leading-relaxed c-dim-bright">
          This ends{" "}
          {pendingCancel?.enemyName ? `the ${NOUN.game} vs ${pendingCancel.enemyName}` : `this ${NOUN.game}`} for
          both of you. The four-digit code dies.
        </p>
      </Sheet>
      {joining && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60">
          <Spinner label="Finding that room…" />
        </div>
      )}
    </>
  );
}

function ModeIcon({ kind }: { kind: "solo" | "versus" | "tutorial" }) {
  const tone =
    kind === "tutorial"
      ? "border-[--color-energy]/40 bg-[--color-energy]/15 c-energy"
      : kind === "solo"
        ? "border-[--color-energy]/30 bg-[--color-energy]/10 c-energy"
        : "border-[--color-attack]/30 bg-[--color-attack]/10 c-attack";
  return (
    <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl border ${tone}`} aria-hidden>
      {kind === "tutorial" ? (
        <svg viewBox="0 0 32 32" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 7h14a4 4 0 0 1 4 4v14H10a4 4 0 0 0-4 4V7Z" />
          <path d="M6 7a4 4 0 0 1 4-4h14" />
          <path d="M12 12h8M12 17h8M12 22h5" />
        </svg>
      ) : kind === "solo" ? (
        <svg viewBox="0 0 32 32" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M8 5h16l4 7-4 15H8L4 12 8 5Z" />
          <circle cx="11" cy="11" r="1.3" fill="currentColor" stroke="none" />
          <circle cx="21" cy="11" r="1.3" fill="currentColor" stroke="none" />
          <circle cx="16" cy="16" r="1.3" fill="currentColor" stroke="none" />
          <circle cx="11" cy="21" r="1.3" fill="currentColor" stroke="none" />
          <circle cx="21" cy="21" r="1.3" fill="currentColor" stroke="none" />
        </svg>
      ) : (
        <svg viewBox="0 0 32 32" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m7 5 6 6-2.5 2.5L4.5 7.5 7 5Zm4 8 14 14m0-22-6 6 2.5 2.5 6-6L25 5Zm-4 8L7 27" />
          <path d="m5 23 4 4m14-4 4 4" />
        </svg>
      )}
    </span>
  );
}
