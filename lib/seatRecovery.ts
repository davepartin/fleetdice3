"use client";
import { collection, doc, getDoc, limit, onSnapshot, orderBy, query, runTransaction, serverTimestamp, setDoc, type Unsubscribe } from "firebase/firestore";
import { ensurePlayerIdentity, firestore, withTimeout } from "./firebase";
import { type MatchState, opponentOf, roleFor } from "./engine";
import { rememberRoom } from "./rooms";

export type SeatRequest = { uid: string; name: string };
const db = () => { if (!firestore) throw new Error("Online play is unavailable."); return firestore; };

export async function requestSeatReturn(matchId: string | null, code: string, name: string): Promise<string> {
  const user = await ensurePlayerIdentity();
  let id = matchId;
  if (!id) {
    const lookup = await getDoc(doc(db(), "fd3Codes", code));
    id = lookup.data()?.matchId;
  }
  if (!id) throw new Error("That room could not be found. Ask your friend for the current code.");
  await withTimeout(setDoc(doc(db(), "fd3Matches", id, "rejoin", user.uid), {
    uid: user.uid, name: name.trim().slice(0, 40) || "Commander", status: "pending", createdAt: serverTimestamp(),
  }), 15000, "Asking your friend");
  return id;
}

export async function watchMySeatRequest(matchId: string, onApproved: () => void, onError: (message: string) => void): Promise<Unsubscribe> {
  const user = await ensurePlayerIdentity();
  return onSnapshot(doc(db(), "fd3Matches", matchId, "rejoin", user.uid), snap => {
    if (snap.data()?.status === "approved") { rememberRoom(matchId); onApproved(); }
    if (snap.data()?.status === "declined") onError("Your friend declined the request. Check with them before trying again.");
  }, () => onError("Could not check your request. Reconnect and try again."));
}

export function watchSeatRequests(matchId: string, onRows: (requests: SeatRequest[]) => void, onError: () => void): Unsubscribe {
  // New requests must not be crowded out by old, unanswered ones.
  return onSnapshot(query(collection(db(), "fd3Matches", matchId, "rejoin"), orderBy("createdAt", "desc"), limit(20)), snap => {
    onRows(snap.docs.filter(d => {
      const when = d.data().createdAt?.toMillis?.();
      return d.data().status === "pending" && typeof when === "number" && Date.now() - when < 15 * 60 * 1000;
    }).map(d => ({ uid: d.id, name: String(d.data().name || "Commander") })));
  }, onError);
}

/** The seated friend explicitly approves; all gameplay values survive unchanged. */
export async function answerSeatRequest(matchId: string, uid: string, approve: boolean): Promise<void> {
  const user = await ensurePlayerIdentity();
  const database = db();
  await withTimeout(runTransaction(database, async tx => {
    const matchRef = doc(database, "fd3Matches", matchId);
    const requestRef = doc(database, "fd3Matches", matchId, "rejoin", uid);
    const [matchSnap, requestSnap] = await Promise.all([tx.get(matchRef), tx.get(requestRef)]);
    const data = matchSnap.data();
    if (!data || data.status !== "active") throw new Error("This battle has already ended.");
    const state = structuredClone(data.state) as MatchState;
    const side = roleFor(state, user.uid);
    if (!side) throw new Error("Only a commander in the battle can approve a return.");
    const request = requestSnap.data();
    if (!request || request.status !== "pending" || Date.now() - request.createdAt.toMillis() > 15 * 60 * 1000) throw new Error("That request expired. Ask your friend to request again.");
    if (!approve) { tx.update(requestRef, { status: "declined", answeredBy: user.uid }); return; }
    const other = opponentOf(side);
    if (!state.players[other] || roleFor(state, uid)) throw new Error("That browser already has a seat.");
    const codeRef = doc(database, "fd3Codes", state.code);
    const liveRef = doc(database, "fd3Live", matchId);
    const [codeSnap, liveSnap] = await Promise.all([tx.get(codeRef), tx.get(liveRef)]);
    state.players[other]!.uid = uid;
    state.version += 1;
    const seats = { hostUid: state.players.host.uid, guestUid: state.players.guest!.uid };
    tx.update(matchRef, { ...seats, state, version: state.version, acceptedRecovery: uid, updatedAt: serverTimestamp() });
    if (codeSnap.exists()) tx.update(codeRef, { ...seats, updatedAt: serverTimestamp() });
    if (liveSnap.exists()) tx.update(liveRef, { ...seats, updatedAt: serverTimestamp() });
    tx.update(requestRef, { status: "approved", answeredBy: user.uid });
  }), 15000, "Returning your friend's seat");
}
