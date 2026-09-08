"use client";
import { useEffect } from "react";
import { notePlaytest, downloadPlaytestReport } from "@/lib/playtest";

export default function GameError({ reset }: { error: Error; reset(): void }) {
  useEffect(() => notePlaytest("screen-error"), []);
  return <div className="recovery-screen">
    <h1>The screen hit a snag.</h1>
    <p>Let’s reopen your battle. Online progress is kept in the room; solo resumes from its latest save on this browser.</p>
    <button onClick={reset}>Reopen battle</button>
    <button onClick={() => downloadPlaytestReport("The game screen stopped working.")}>Save a problem report</button>
  </div>;
}
