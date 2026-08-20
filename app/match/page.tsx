"use client";

/** A live two-player match. The room id is in the query string. */

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { MatchScreen } from "@/components/MatchScreen";
import { Button, Notice, Spinner } from "@/components/ui";
import { useRoomMatch } from "@/lib/useMatch";
import { basePath } from "@/lib/paths";

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
  const home = () => router.push(`${basePath}/`);

  if (controller.status === "error") {
    return (
      <div className="hud">
        <div className="mx-auto flex w-full max-w-[30rem] flex-col gap-4 px-4 pt-8">
          <Notice tone="warn">{controller.error ?? "That room could not be opened."}</Notice>
          <Button tone="primary" full onClick={home}>
            Home
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
        <div className="mx-auto flex w-full max-w-[30rem] flex-col gap-4 px-4 pt-8 text-center">
          <p className="t-eyebrow">Room {controller.state.code}</p>
          <h1 className="t-display text-3xl">Still waiting for a friend</h1>
          <p className="text-[0.92rem] c-dim">
            Give them the four numbers above, or send the link again. This page starts on its own
            the moment they sit down.
          </p>
          <Spinner label="Listening…" />
          <Button tone="ghost" full onClick={home}>
            Home
          </Button>
        </div>
      </div>
    );
  }

  return <MatchScreen controller={controller} onExit={home} />;
}
