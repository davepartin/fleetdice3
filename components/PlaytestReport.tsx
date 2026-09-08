"use client";
import { useState } from "react";
import { Button, Sheet } from "./ui";
import { downloadPlaytestReport, PLAYTEST_BUILD } from "@/lib/playtest";

export function PlaytestReport({ open, onClose }: { open: boolean; onClose(): void }) {
  const [feedback, setFeedback] = useState("");
  return <Sheet open={open} onClose={onClose} title="Help improve Fleet Dice" footer={
    <Button full onClick={() => downloadPlaytestReport(feedback)}>Save feedback file</Button>
  }>
    <label className="block text-sm" htmlFor="playtest-feedback">What happened, or what felt great?</label>
    <textarea id="playtest-feedback" className="feedback-input" rows={5} maxLength={2000} value={feedback} onChange={e => setFeedback(e.target.value)} />
    <p className="text-sm c-dim">The file includes your note and recent game steps. It does not include player names, room codes or hidden dice. Nothing is sent automatically. Share the file with Dave.</p>
    <p className="mt-3 text-xs c-dim">Build {PLAYTEST_BUILD}</p>
  </Sheet>;
}
