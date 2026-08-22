"use client";

/** A live two-player match. The room id is in the query string. */

import { Suspense, useCallback, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { MatchScreen } from "@/components/MatchScreen";
import { Button, Notice, RoomCode, Spinner } from "@/components/ui";
import { useRoomMatch } from "@/lib/useMatch";
import { cancelRoom } from "@/lib/rooms";

export default function MatchPage() {
  return (
    <Suspense
      fallback={
        <div className="hud items-center justify-center">
          <Spinner label="Joining the battle…" />
        </div>
      }
    >
      <MatchInner />
    </Suspense>
  );
}

function MatchInner() {
  const router = useRouter();
  const params = useSearchParams();
  const id = params.get("id");
  const controller = useRoomMatch(id);
  const [closing, setClosing] = useState(false);
  const home = () => router.push("/");

  const closeRoom = useCallback(async () => {
    if (!id) {
      router.push("/");
      return;
    }
    setClosing(true);
    try {
      await cancelRoom(id);
    } catch {
      // Already gone. Either way we are leaving.
    }
    router.push("/");
  }, [id, router]);

  if (controller.status === "error") {
    return (
      <div className="hud">
        <div className="mx-auto flex w-full max-w-[30rem] flex-col gap-4 px-4 pt-8">
          <Notice tone="warn">{controller.error ?? "That room could not be opened."}</Notice>
          <Button tone="primary" full onClick={home}>
            Back to home
          </Button>
        </div>
      </div>
    );
  }

  if (controller.status === "loading" || !controller.state) {
    return (
      <div className="hud items-center justify-center">
        <Spinner label="Joining the battle…" />
      </div>
    );
  }

  if (controller.state.status === "waiting") {
    return (
      <div className="hud">
        <div className="scroll-y fade-edges flex-1">
          <div className="mx-auto flex w-full max-w-[30rem] flex-col gap-4 px-4 pb-10 pt-6">
            <div className="flex flex-wrap items-center gap-2">
              <Button tone="ghost" size="sm" onClick={home} className="self-start">
                ‹ Back to home
              </Button>
              <Button tone="ghost" size="sm" onClick={closeRoom} disabled={closing} className="self-start">
                {closing ? "Closing…" : "Cancel game"}
              </Button>
            </div>
            <header className="text-center">
              <p className="t-eyebrow">Your room is open</p>
              <h1 className="t-display text-3xl">Still waiting for a friend</h1>
            </header>
            <div className="flex justify-center py-2">
              <RoomCode code={controller.state.code} />
            </div>
            <p className="text-center text-[0.92rem] leading-relaxed c-dim">
              Give them these four numbers, or send the link again. This screen turns into the
              battle the moment they sit down — the same board you already know from solo.
            </p>
            <Spinner label="Listening…" />
          </div>
        </div>
      </div>
    );
  }

  return <MatchScreen controller={controller} onExit={home} />;
}
