"use client";
import { useEffect, useState } from "react";
import { answerSeatRequest, watchSeatRequests, type SeatRequest } from "@/lib/seatRecovery";
import { Button, Notice, Sheet } from "./ui";

export function SeatReturn({ matchId, otherName }: { matchId: string; otherName: string }) {
  const [requests, setRequests] = useState<SeatRequest[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => watchSeatRequests(matchId, setRequests, () => {
    // Old production rules may not expose the new collection yet.
    setRequests([]);
  }), [matchId]);
  const request = requests[0];
  if (!request) return null;
  const answer = async (approve: boolean) => {
    setBusy(true); setError(null);
    try { await answerSeatRequest(matchId, request.uid, approve); setOpen(false); }
    catch { setError("Could not confirm the return. Check your connection and try again."); }
    finally { setBusy(false); }
  };
  return <>
    <button className="seat-return-notice" onClick={() => setOpen(true)}>A friend wants to rejoin · Review</button>
    <Sheet open={open} onClose={() => setOpen(false)} title="Is this your friend?">
      <p className="text-sm">{request.name} is asking to return as {otherName}. Confirm with your friend before approving. Their old browser will lose access; the battle will continue with the same fleet and progress.</p>
      {error && <Notice tone="warn">{error}</Notice>}
      <div className="mt-4 flex flex-col gap-2">
        <Button full disabled={busy} onClick={() => void answer(true)}>Yes, reconnect my friend</Button>
        <Button full tone="ghost" disabled={busy} onClick={() => void answer(false)}>Decline</Button>
      </div>
    </Sheet>
  </>;
}
