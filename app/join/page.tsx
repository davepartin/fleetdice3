"use client";

/**
 * Taking the second seat.
 *
 * Reached from an invite link, or from typing four numbers on the home page.
 * Either way this screen does exactly one thing, and says plainly what went
 * wrong when it cannot.
 */

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Notice, Panel, RoomCode, Spinner } from "@/components/ui";
import { HowToPlaySheet } from "@/components/HowToPlay";
import { commanderName, ensurePlayerIdentity, rememberCommanderName } from "@/lib/firebase";
import { joinRoomByCode, joinRoomById, reclaimGuestSeat } from "@/lib/rooms";
import { NOUN } from "@/lib/reference";

export default function JoinPage() {
  return (
    <Suspense fallback={<Booting />}>
      <JoinInner />
    </Suspense>
  );
}

function Booting() {
  return (
    <div className="hud items-center justify-center">
      <Spinner label="Looking for that room…" />
    </div>
  );
}

function JoinInner() {
  const router = useRouter();
  const params = useSearchParams();
  const id = params.get("id");
  const code = (params.get("code") ?? "").replace(/\D/g, "").slice(0, 4);

  const [name, setName] = useState("Commander");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seatTaken, setSeatTaken] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    setName(commanderName());
    ensurePlayerIdentity().catch(() => undefined);
  }, []);

  const join = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      rememberCommanderName(name);
      const room = id ? await joinRoomById(id, name) : await joinRoomByCode(code, name);
      router.push(`/match/?id=${room.id}`);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      setError(message);
      // "Full" is also what it looks like when the seat is your own and your
      // browser has forgotten it — a private tab, a different address, cleared
      // storage. Offer the way back rather than leaving a dead end.
      setSeatTaken(/two commanders|already started/i.test(message));
      setBusy(false);
    }
  }, [id, code, name, router]);

  const reclaim = useCallback(async () => {
    if (!id) return;
    setBusy(true);
    setError(null);
    try {
      rememberCommanderName(name);
      await reclaimGuestSeat(id, name);
      router.push(`/match/?id=${id}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setBusy(false);
    }
  }, [id, name, router]);

  if (!id && code.length !== 4) {
    return (
      <div className="hud">
        <div className="mx-auto flex w-full max-w-[30rem] flex-col gap-4 px-4 pt-8">
          <Notice tone="warn">
            That link is missing its room. Go back to the home page and type the four numbers on
            your friend&apos;s screen.
          </Notice>
          <Button tone="primary" full onClick={() => router.push("/")}>
            {NOUN.home}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="hud">
      <div className="scroll-y flex-1">
        <div className="mx-auto flex w-full max-w-[30rem] flex-col gap-4 px-4 pb-10 pt-6">
          <div className="flex items-center gap-2">
            <Button tone="ghost" size="sm" onClick={() => router.push("/")}>
              ‹ Back to {NOUN.home}
            </Button>
            <span className="flex-1" />
            <Button tone="ghost" size="sm" onClick={() => setHelpOpen(true)}>
              How to play
            </Button>
          </div>

          <header className="text-center">
            <p className="t-eyebrow">You have been challenged</p>
            <h1 className="t-display text-3xl">Take the second seat</h1>
          </header>

          {code.length === 4 && (
            <div className="flex justify-center py-1">
              <RoomCode code={code} />
            </div>
          )}

          <Panel className="p-3.5">
            <label className="t-eyebrow mb-1.5 block" htmlFor="guest-name">
              Your name
            </label>
            <input
              id="guest-name"
              value={name}
              maxLength={20}
              onChange={(event) => setName(event.target.value)}
              className="t-num w-full rounded-xl border border-white/12 bg-black/40 px-3 py-2.5 text-base text-white outline-none focus:border-white/40"
            />
          </Panel>

          {error && <Notice tone="warn">{error}</Notice>}

          {seatTaken && id && (
            <Panel className="flex flex-col gap-2 p-4">
              <p className="t-eyebrow">Were you already in this game?</p>
              <p className="text-sm leading-snug c-dim-bright">
                If that second seat is yours and this browser has forgotten it, you can take it
                back. It only works once the other device has been quiet for a minute, so nobody
                can be pushed out of a game they are still playing.
              </p>
              <Button tone="ghost" size="lg" full onClick={reclaim} disabled={busy}>
                {busy ? "Taking the seat…" : "Take my seat back"}
              </Button>
            </Panel>
          )}

          <Button tone="primary" size="lg" full onClick={join} disabled={busy}>
            {busy ? "Sitting down…" : "Join the game"}
          </Button>
        </div>
      </div>
      <HowToPlaySheet open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}
