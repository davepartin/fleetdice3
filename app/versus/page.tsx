"use client";

/**
 * Start a game with a friend.
 *
 * The lesson from Fleet Dice 1 and 2, learned the hard way: **the host stays
 * here.** Opening your own invite link in a second tab makes you a third
 * person, the room refuses you, and Firestore reports it as a permissions
 * error. So this page never offers the host a way to "open" the invite — only
 * to copy it, send it, and wait.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Notice, Panel, RoomCode, Spinner } from "@/components/ui";
import { commanderName, rememberCommanderName } from "@/lib/firebase";
import {
  cancelRoom,
  createRoom,
  startRoomHeartbeat,
  watchRoom,
  type CreatedRoom,
} from "@/lib/rooms";

export default function VersusPage() {
  const router = useRouter();
  const [name, setName] = useState("Commander");
  const [room, setRoom] = useState<CreatedRoom | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const stopRef = useRef<(() => void) | null>(null);
  const beatRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    setName(commanderName());
  }, []);

  // Once someone takes the second seat, go straight into the battle.
  useEffect(() => {
    if (!room) return;
    let cancelled = false;
    (async () => {
      stopRef.current = await watchRoom(
        room.match.id,
        (next) => {
          if (cancelled) return;
          if (next.state.players.guest) {
            router.push(`/match/?id=${room.match.id}`);
          }
        },
        (reason) => !cancelled && setError(reason.message),
      );
      beatRef.current = startRoomHeartbeat(room.match.id);
    })();
    return () => {
      cancelled = true;
      stopRef.current?.();
      beatRef.current?.();
    };
  }, [room, router]);

  const create = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      rememberCommanderName(name);
      const made = await createRoom(name);
      setRoom(made);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }, [name]);

  const share = useCallback(async () => {
    if (!room) return;
    const text = `Come and fight me at Fleet Dice. Room ${room.match.state.code}: ${room.inviteUrl}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: "Fleet Dice 3", text, url: room.inviteUrl });
        return;
      }
    } catch {
      // The share sheet was dismissed. Fall through to copying.
    }
    try {
      await navigator.clipboard.writeText(room.inviteUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2200);
    } catch {
      setError("Could not copy the link. Read the four numbers out instead.");
    }
  }, [room]);

  const abandon = useCallback(async () => {
    if (!room) return;
    try {
      await cancelRoom(room.match.id);
    } catch {
      // Already gone. Either way we are leaving.
    }
    router.push("/");
  }, [room, router]);

  return (
    <div className="hud">
      <div className="scroll-y fade-edges flex-1">
        <div className="mx-auto flex w-full max-w-[30rem] flex-col gap-4 px-4 pb-10 pt-6">
          <div className="flex items-center gap-2">
            <Button
              tone="ghost"
              size="sm"
              onClick={() => (room ? abandon() : router.push("/"))}
            >
              ‹ {room ? "Close this room" : "Home"}
            </Button>
          </div>

          {!room ? (
            <>
              <header>
                <p className="t-eyebrow">Two commanders</p>
                <h1 className="t-display text-4xl">Start a game</h1>
                <p className="mt-2 text-[0.92rem] leading-relaxed text-[--color-hull-300]">
                  You get a four-digit code and a link. Send either one to your friend. You can run
                  as many games at once as you like — each one gets its own code.
                </p>
              </header>

              <Panel className="p-3.5">
                <label className="t-eyebrow mb-1.5 block" htmlFor="host-name">
                  Your name
                </label>
                <input
                  id="host-name"
                  value={name}
                  maxLength={20}
                  onChange={(event) => setName(event.target.value)}
                  className="t-num w-full rounded-xl border border-white/12 bg-black/40 px-3 py-2.5 text-lg text-white outline-none focus:border-white/40"
                />
              </Panel>

              {error && <Notice tone="warn">{error}</Notice>}

              <Button tone="primary" size="lg" full onClick={create} disabled={busy}>
                {busy ? "Opening a room…" : "Create the room"}
              </Button>
            </>
          ) : (
            <>
              <header className="text-center">
                <p className="t-eyebrow">Your room is open</p>
                <h1 className="t-display text-3xl">Read them these numbers</h1>
              </header>

              <div className="flex justify-center py-2">
                <RoomCode code={room.match.state.code} />
              </div>

              <Button tone="confirm" size="lg" full onClick={share}>
                {copied ? "Link copied" : "Send the link"}
              </Button>

              <Panel className="p-4">
                <p className="text-[0.9rem] leading-relaxed text-[--color-hull-200]">
                  Your friend types those four numbers on the home page, or opens the link. The
                  moment they sit down, this screen turns into the battle.
                </p>
                <p className="mt-2 text-[0.86rem] leading-relaxed c-dim">
                  <b className="text-white">Stay on this page.</b> Do not open your own link — a
                  second tab counts as a third person, and the room only has two seats.
                </p>
              </Panel>

              <div className="flex items-center justify-center gap-3 py-4">
                <Spinner label="Waiting for a friend to join…" />
              </div>

              {error && <Notice tone="warn">{error}</Notice>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
