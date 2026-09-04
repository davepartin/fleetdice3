"use client";

/**
 * Fleet Dice — online rooms.
 *
 * The whole match lives in one Firestore document. lib/engine.ts is pure and
 * serialisable, so a move is: read the document inside a transaction, run
 * `applyAction` on it, write it back. Two commanders can tap at the same moment
 * and neither can corrupt the other, because the transaction retries.
 *
 * COLLECTIONS — names keep the fd3* prefix because renaming them would break
 * live rooms. Fleet Dice 1 and 2 are retired; this game never writes to their
 * old collections (`codes`, `matches`, `liveBattles`, `battleResults`).
 *
 *   fd3Matches/{matchId}  the private match document (the whole MatchState)
 *   fd3Codes/{0000}       four-digit room code -> matchId, plus seating
 *   fd3Live/{matchId}     public "now on the field" board: names and round only
 *   fd3Results/{matchId}  public finished-match list: two names and a time
 *
 * THE RULE THAT KEEPS EVERYONE SANE: host stays, guest joins. Creating a room
 * seats you. Opening your own invite link in a second tab makes you a THIRD
 * anonymous person, who is correctly refused a seat. Every message in this file
 * that could be caused by that says so in plain words.
 */

import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
  type DocumentData,
  type DocumentReference,
  type Transaction,
  type Unsubscribe,
} from "firebase/firestore";
import {
  assertOnline,
  ensurePlayerIdentity,
  firestore,
  NOT_CONFIGURED_MESSAGE,
  OFFLINE_MESSAGE,
  withTimeout,
} from "./firebase";
import {
  applyAction,
  joinMatch,
  newMatch,
  publicMatchView,
  roleFor,
  type MatchAction,
  type MatchState,
  type SideId,
} from "./engine";
import { isOnTheField } from "./liveboard";
import { NOUN } from "./reference";

/* ------------------------------------------------------------------ */
/* Names, sizes and timings                                            */
/* ------------------------------------------------------------------ */

export const MATCHES = "fd3Matches";
export const CODES = "fd3Codes";
export const LIVE = "fd3Live";
export const RESULTS = "fd3Results";

/**
 * GitHub Pages used to serve every one of this owner's projects from one
 * origin, so localStorage was shared with Fleet Dice 1 and 2. Prefix
 * everything with `fd3-` and leave it — renaming the keys would forget
 * every remembered room on every phone.
 */
const ROOMS_KEY = "fd3-rooms";

/** How many live rooms one phone can keep on its Continue list. */
const MAX_REMEMBERED_ROOMS = 8;

/** Re-exported so callers of this module keep working. */
export { WAITING_STALE_MS, ACTIVE_STALE_MS } from "./liveboard";

/** How often the waiting screen should say "still here". Comfortably inside the 45 minutes. */
export const HEARTBEAT_MS = 5 * 60 * 1000;

/**
 * How often a seated commander says "still here", and how long a seat must go
 * quiet before someone may take it back.
 *
 * These two are a pair. The beat has to be comfortably shorter than the window
 * or a player who is merely thinking about a shop purchase would look gone and
 * could be turfed out of a live match. Sixty seconds is also about as long as
 * someone whose tab just died is willing to wait before deciding the game is
 * broken.
 */
export const SEAT_BEAT_MS = 20 * 1000;
export const SEAT_STALE_MS = 60 * 1000;

/** Firestore calls that get no answer in this long are reported, not left spinning. */
const NETWORK_TIMEOUT_MS = 15000;

/** Where a guest lands. The page that reads `id` and `code` builds itself; this is the contract. */
export const INVITE_ROUTE = "/join/";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

/** The shape of one fd3Matches document. `state` is the engine's MatchState. */
type MatchDocument = {
  code: string;
  hostUid: string;
  guestUid: string | null;
  status: MatchState["status"];
  state: MatchState;
  version: number;
};

/** The shape of one fd3Codes document. Seating is denormalised on purpose. */
type CodeDocument = {
  matchId: string;
  hostUid: string;
  guestUid: string | null;
  status: "waiting" | "active" | "finished";
};

/** A room you are seated in, as this phone should render it. */
export type LiveRoom = {
  id: string;
  code: string;
  /** Which commander you are. */
  side: SideId;
  /** Already passed through `publicMatchView` — the enemy's dice are stripped. */
  state: MatchState;
  version: number;
};

export type CreatedRoom = {
  match: LiveRoom;
  side: SideId;
  /** App-relative, e.g. `/fleetdice3/join/?id=…&code=0525`. */
  invitePath: string;
  /** Full URL to text to a friend. Same thing with the origin on the front. */
  inviteUrl: string;
};

/** One row of the Continue list on this phone. */
export type RememberedRoomCard = {
  id: string;
  code: string;
  side: SideId;
  status: MatchState["status"];
  round: number;
  youName: string;
  enemyName: string | null;
};

/** One row of the public board. Names and round only — never dice, never health. */
export type LiveBattleRow = {
  id: string;
  hostName: string;
  guestName: string | null;
  status: "waiting" | "active";
  round: number;
  updatedAt: Date | null;
};

/** One row of the public results list. Names only. */
export type BattleResultRow = {
  id: string;
  winnerName: string;
  loserName: string;
  finishedAt: Date;
};

/* ------------------------------------------------------------------ */
/* The messages players actually read                                  */
/* ------------------------------------------------------------------ */

/**
 * This one message is the whole lesson of Fleet Dice 1 and 2. Firestore says
 * "Missing or insufficient permissions"; what happened is that a third
 * anonymous browser identity asked for a seat in a room built for two.
 */
export const ROOM_FULL_MESSAGE =
  `That room already has two commanders. If you started this ${NOUN.game}, go back to the tab you created it in and carry on there — a new tab counts as a different person, so it cannot take a seat.`;

const ROOM_GONE_MESSAGE =
  `That room is not there any more. Ask your friend for a new four-digit code, or start a new ${NOUN.game}.`;

const NOT_YOUR_ROOM_MESSAGE =
  `You are not one of the two commanders in that room. If you started it, reopen it from Your ${NOUN.games} on the same phone and browser you used before.`;

const MATCH_OVER_MESSAGE =
  `That ${NOUN.game} has already finished. Start a new one, or join a friend's with their four-digit code.`;

const JOIN_FIRST_MESSAGE =
  `Tap Join the ${NOUN.game} first — you have not taken a seat in that room yet.`;

const NEED_FOUR_DIGITS_MESSAGE =
  "Type the four numbers showing on your friend's screen, for example 0525.";

const CODE_NOT_FOUND_MESSAGE =
  `No ${NOUN.game} is using that four-digit code. Check the numbers on your friend's screen — codes are reused, so an old one may have gone.`;

const CODES_EXHAUSTED_MESSAGE =
  "Every room code was busy just then. Tap Create the room once more.";

const RULES_NOT_DEPLOYED_MESSAGE =
  `Two-player ${NOUN.games} are not switched on in the database yet. The site can sign you in, but it cannot open a room until the Fleet Dice rules are published. On a computer signed into the space-tribes Google account, run: npx -y firebase-tools@latest deploy --only firestore:rules --project space-tribes`;

/* ------------------------------------------------------------------ */
/* Creating, joining, entering                                         */
/* ------------------------------------------------------------------ */

/**
 * Make a private room with a four-digit code and seat the creator as host.
 *
 * We deliberately do NOT close this phone's other waiting rooms. The owner
 * wants a group of friends running several battles at once, and one person may
 * legitimately be hosting two rooms while two different friends find their
 * phones. Closing a room is always an explicit `cancelRoom`.
 */
export async function createRoom(name: string): Promise<CreatedRoom> {
  const db = requireDb();
  assertOnline();
  const user = await ensurePlayerIdentity();

  // Four digits is 10,000 rooms, so collisions are ordinary, not exceptional.
  // The check and the claim happen inside one transaction, so two phones
  // creating rooms in the same second cannot both win the same code.
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const matchRef = doc(collection(db, MATCHES));
    const code = String(Math.floor(Math.random() * 10000)).padStart(4, "0");
    const codeRef = doc(db, CODES, code);
    const boardRef = doc(db, LIVE, matchRef.id);
    const state = newMatch(matchRef.id, code, user.uid, name, "versus");

    try {
      await withTimeout(
        runTransaction(db, async (transaction) => {
          const existingCode = await transaction.get(codeRef);
          if (existingCode.exists()) throw new CodeCollisionError();

          transaction.set(codeRef, {
            matchId: matchRef.id,
            hostUid: user.uid,
            guestUid: null,
            status: "waiting",
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          transaction.set(matchRef, {
            code,
            hostUid: user.uid,
            guestUid: null,
            status: state.status,
            state,
            version: state.version,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          transaction.set(boardRef, {
            hostName: state.players.host.name,
            guestName: null,
            status: "waiting",
            round: state.round,
            hostUid: user.uid,
            guestUid: null,
            updatedAt: serverTimestamp(),
          });
        }),
        NETWORK_TIMEOUT_MS,
        "Creating the room",
      );
    } catch (error) {
      if (error instanceof CodeCollisionError) continue;
      if (isPermissionDenied(error)) throw new Error(RULES_NOT_DEPLOYED_MESSAGE);
      throw friendlyRoomError(error);
    }

    rememberRoom(matchRef.id);
    const invitePath = invitePathFor(matchRef.id, code);
    return {
      match: { id: matchRef.id, code, side: "host", state, version: state.version },
      side: "host",
      invitePath,
      inviteUrl: absoluteUrl(invitePath),
    };
  }

  throw new Error(CODES_EXHAUSTED_MESSAGE);
}

/** Take the open seat in a room you know the id of (the invite link case). */
export async function joinRoomById(matchId: string, name: string): Promise<LiveRoom> {
  const db = requireDb();
  if (!matchId) throw new Error("That invite link is missing its room. Ask your friend to send it again.");
  assertOnline();
  const user = await ensurePlayerIdentity();

  const matchRef = doc(db, MATCHES, matchId);
  const boardRef = doc(db, LIVE, matchId);

  try {
    const room = await withTimeout(
      runTransaction(db, async (transaction) => {
        // Every read must happen before every write in a Firestore transaction.
        const snapshot = await transaction.get(matchRef);
        if (!snapshot.exists()) throw new RoomGoneError();
        const data = snapshot.data() as MatchDocument;
        const state = structuredClone(data.state);

        const alreadySeated = roleFor(state, user.uid);
        if (alreadySeated) {
          // Re-entering, not joining. Change nothing: a stray join must never
          // reset a match in progress.
          return {
            id: matchId,
            code: state.code,
            side: alreadySeated,
            state: publicMatchView(state, alreadySeated),
            version: data.version,
          } satisfies LiveRoom;
        }

        if (state.status === "finished") throw new Error(MATCH_OVER_MESSAGE);

        const boardSnap = await transaction.get(boardRef);
        const codeRef = doc(db, CODES, state.code);
        const codeSnap = await transaction.get(codeRef);

        // `joinMatch` throws "This match already has two commanders." and
        // "This match has already started." Both are the third-tab problem
        // wearing a different hat, so both get the room-full explanation.
        try {
          joinMatch(state, user.uid, name);
        } catch {
          throw new RoomFullError();
        }
        const side = roleFor(state, user.uid);
        if (!side) throw new RoomFullError();

        transaction.update(matchRef, {
          guestUid: user.uid,
          status: state.status,
          state,
          version: state.version,
          updatedAt: serverTimestamp(),
        });
        if (codeSnap.exists()) {
          transaction.update(codeRef, {
            guestUid: user.uid,
            status: "active",
            updatedAt: serverTimestamp(),
          });
        }
        const boardPayload = {
          hostName: state.players.host.name,
          guestName: state.players.guest?.name ?? name,
          status: "active" as const,
          round: state.round,
          hostUid: data.hostUid,
          guestUid: user.uid,
          updatedAt: serverTimestamp(),
        };
        if (boardSnap.exists()) {
          transaction.update(boardRef, boardPayload);
        } else {
          transaction.set(boardRef, boardPayload);
        }

        return {
          id: matchId,
          code: state.code,
          side,
          state: publicMatchView(state, side),
          version: state.version,
        } satisfies LiveRoom;
      }),
      NETWORK_TIMEOUT_MS,
      "Joining the room",
    );
    rememberRoom(matchId);
    return room;
  } catch (error) {
    throw friendlyRoomError(error);
  }
}

/** Take the open seat using the four digits on the host's screen. */
export async function joinRoomByCode(code: string, name: string): Promise<LiveRoom> {
  const db = requireDb();
  assertOnline();
  const user = await ensurePlayerIdentity();

  const digits = code.replace(/\D/g, "");
  if (!digits.length || digits.length > 4) throw new Error(NEED_FOUR_DIGITS_MESSAGE);
  const cleaned = digits.padStart(4, "0");

  let codeSnapshot;
  try {
    codeSnapshot = await withTimeout(
      getDoc(doc(db, CODES, cleaned)),
      NETWORK_TIMEOUT_MS,
      "Looking up that code",
    );
  } catch (error) {
    if (isPermissionDenied(error)) throw new Error(RULES_NOT_DEPLOYED_MESSAGE);
    throw friendlyRoomError(error);
  }
  if (!codeSnapshot.exists()) throw new Error(CODE_NOT_FOUND_MESSAGE);

  const codeData = codeSnapshot.data() as CodeDocument;
  const matchId = String(codeData.matchId ?? "");
  if (!matchId) throw new Error(CODE_NOT_FOUND_MESSAGE);

  // The seating fields on the tiny code document are the whole reason this
  // collection exists. An active match document is readable only by its two
  // commanders, so without this we could not tell a third person "that room is
  // full" — we could only hand them a permissions error.
  if (codeData.hostUid === user.uid || codeData.guestUid === user.uid) {
    return enterRoom(matchId);
  }
  if (codeData.status === "finished") throw new Error(MATCH_OVER_MESSAGE);
  if (codeData.guestUid) throw new Error(ROOM_FULL_MESSAGE);

  return joinRoomById(matchId, name);
}

/**
 * Reopen a room you already belong to. Never seats anybody: if you are not one
 * of the two commanders you get told so, in words.
 */
export async function enterRoom(
  matchId: string,
  options: { remember?: boolean } = {},
): Promise<LiveRoom> {
  const db = requireDb();
  if (!matchId) throw new Error("That link is missing its room. Ask your friend to send it again.");
  assertOnline();
  const user = await ensurePlayerIdentity();

  try {
    const snapshot = await withTimeout(
      getDoc(doc(db, MATCHES, matchId)),
      NETWORK_TIMEOUT_MS,
      "Opening the room",
    );
    if (!snapshot.exists()) throw new RoomGoneError();

    const data = snapshot.data() as MatchDocument;
    const side = roleFor(data.state, user.uid);
    if (!side) {
      // A finished room is readable by anyone, so say the true thing rather
      // than "full". A waiting room means they simply have not joined yet.
      if (data.state.status === "finished") throw new NotSeatedError(MATCH_OVER_MESSAGE);
      throw data.state.status === "waiting"
        ? new NotSeatedError(JOIN_FIRST_MESSAGE)
        : new RoomFullError();
    }

    if (data.state.status === "finished") {
      forgetRoom(matchId);
    } else if (options.remember !== false) {
      rememberRoom(matchId);
    }

    return {
      id: matchId,
      code: data.state.code,
      side,
      state: publicMatchView(data.state, side),
      version: data.version,
    };
  } catch (error) {
    throw friendlyRoomError(error);
  }
}

/* ------------------------------------------------------------------ */
/* Playing                                                             */
/* ------------------------------------------------------------------ */

/**
 * Apply one move. The engine decides everything; this only moves the document.
 *
 * Note what is NOT here: any waiting. Shopping, bracing and starting the next
 * roll are per-player and resolve immediately. Only `submit` can leave you
 * waiting, and only because the engine holds the volley until both sides have
 * locked their rolls.
 */
export async function playAction(matchId: string, action: MatchAction): Promise<LiveRoom> {
  const db = requireDb();
  assertOnline();
  const user = await ensurePlayerIdentity();

  const matchRef = doc(db, MATCHES, matchId);
  const boardRef = doc(db, LIVE, matchId);

  try {
    const room = await withTimeout(
      runTransaction(db, async (transaction) => {
        const snapshot = await transaction.get(matchRef);
        if (!snapshot.exists()) throw new RoomGoneError();
        const data = snapshot.data() as MatchDocument;
        const state = structuredClone(data.state);

        const side = roleFor(state, user.uid);
        if (!side) throw new NotSeatedError(NOT_YOUR_ROOM_MESSAGE);

        const boardSnap = await transaction.get(boardRef);
        const codeRef = doc(db, CODES, state.code);
        const codeSnap = await transaction.get(codeRef);

        // Engine errors are already written for players ("You need 4 Energy for
        // that."), so they travel straight through to the screen.
        applyAction(state, side, action);

        transaction.update(matchRef, {
          status: state.status,
          state,
          version: state.version,
          updatedAt: serverTimestamp(),
        });

        if (state.status === "finished") {
          finishRoomWrites(transaction, {
            state,
            boardRef,
            boardExists: boardSnap.exists(),
            codeRef,
            codeExists: codeSnap.exists(),
            resultRef: doc(db, RESULTS, matchId),
            hostIsMe: data.hostUid === user.uid,
          });
        } else if (boardSnap.exists()) {
          transaction.update(boardRef, {
            round: state.round,
            status: "active",
            updatedAt: serverTimestamp(),
          });
        }

        return {
          id: matchId,
          code: state.code,
          side,
          state: publicMatchView(state, side),
          version: state.version,
        } satisfies LiveRoom;
      }),
      NETWORK_TIMEOUT_MS,
      "Sending your move",
    );
    if (room.state.status === "finished") forgetRoom(matchId);
    return room;
  } catch (error) {
    throw friendlyRoomError(error);
  }
}

/**
 * Close a room. Either commander may do it, at any point.
 *
 * The engine has no "cancel" action, so we set the finished state by hand:
 * status finished, no winner, `cancelledBy` naming who walked, both phases
 * over. That mirrors what `finishIfNeeded` would have produced.
 */
export async function cancelRoom(matchId: string): Promise<void> {
  const db = requireDb();
  assertOnline();
  const user = await ensurePlayerIdentity();

  const matchRef = doc(db, MATCHES, matchId);
  const boardRef = doc(db, LIVE, matchId);

  try {
    await withTimeout(
      runTransaction(db, async (transaction) => {
        const snapshot = await transaction.get(matchRef);
        if (!snapshot.exists()) throw new RoomGoneError();
        const data = snapshot.data() as MatchDocument;
        const state = structuredClone(data.state);

        const side = roleFor(state, user.uid);
        if (!side) throw new NotSeatedError(NOT_YOUR_ROOM_MESSAGE);
        if (state.status === "finished") return;

        const boardSnap = await transaction.get(boardRef);
        const codeRef = doc(db, CODES, state.code);
        const codeSnap = await transaction.get(codeRef);

        state.status = "finished";
        state.winner = null;
        state.cancelledBy = state.players[side]?.name ?? "A commander";
        state.players.host.phase = "over";
        if (state.players.guest) state.players.guest.phase = "over";
        state.version += 1;

        transaction.update(matchRef, {
          status: "finished",
          state,
          version: state.version,
          updatedAt: serverTimestamp(),
        });
        finishRoomWrites(transaction, {
          state,
          boardRef,
          boardExists: boardSnap.exists(),
          codeRef,
          codeExists: codeSnap.exists(),
          resultRef: doc(db, RESULTS, matchId),
          hostIsMe: data.hostUid === user.uid,
        });
      }),
      NETWORK_TIMEOUT_MS,
      "Closing the room",
    );
  } catch (error) {
    // A room that has already vanished is a successful cancel from where the
    // player is standing.
    if (!(error instanceof RoomGoneError)) throw friendlyRoomError(error);
  }
  forgetRoom(matchId);
}

type DocRef = DocumentReference<DocumentData, DocumentData>;

/** Shared tail of "this match is over": clear the board, park the code, publish the result. */
function finishRoomWrites(
  transaction: Transaction,
  args: {
    state: MatchState;
    boardRef: DocRef;
    boardExists: boolean;
    codeRef: DocRef;
    codeExists: boolean;
    resultRef: DocRef;
    hostIsMe: boolean;
  },
): void {
  const { state } = args;

  // Off the public board immediately — a finished match is not "now on the field".
  if (args.boardExists) transaction.delete(args.boardRef);

  // Only a real win goes on the public results list. Cancels and draws do not:
  // the rules check the names against the winner, and there is no winner.
  if ((state.winner === "host" || state.winner === "guest") && state.players.guest) {
    const loserSide: SideId = state.winner === "host" ? "guest" : "host";
    transaction.set(args.resultRef, {
      winnerName: state.players[state.winner]!.name,
      loserName: state.players[loserSide]!.name,
      finishedAt: serverTimestamp(),
    });
  }

  // Free the four digits for reuse if we can (only the host may delete), else
  // mark the code finished so a late joiner is told the game is over rather
  // than being bounced off the private match document.
  if (args.codeExists) {
    if (args.hostIsMe) {
      transaction.delete(args.codeRef);
    } else {
      transaction.update(args.codeRef, {
        status: "finished",
        updatedAt: serverTimestamp(),
      });
    }
  }
}

/* ------------------------------------------------------------------ */
/* Watching                                                            */
/* ------------------------------------------------------------------ */

/** Live subscription to one room. Resolve first, then keep the callbacks. */
export async function watchRoom(
  matchId: string,
  onMatch: (room: LiveRoom) => void,
  onError: (error: Error) => void,
  /**
   * The listener itself died. Firestore ENDS a subscription when its error
   * callback fires and never restarts it, so anything arriving here leaves the
   * client permanently deaf unless the caller resubscribes. It is kept apart
   * from onError because the two need opposite handling: this one is a dropped
   * connection to retry, that one is a decision about the room to show.
   */
  onDisconnect?: (error: Error) => void,
): Promise<Unsubscribe> {
  const db = requireDb();
  if (!matchId) throw new Error("That link is missing its room. Ask your friend to send it again.");
  const user = await ensurePlayerIdentity();

  return onSnapshot(
    doc(db, MATCHES, matchId),
    (snapshot) => {
      try {
        if (!snapshot.exists()) {
          forgetRoom(matchId);
          onError(new Error(ROOM_GONE_MESSAGE));
          return;
        }
        const data = snapshot.data() as MatchDocument;
        const side = roleFor(data.state, user.uid);
        if (!side) {
          onError(
            new Error(
              data.state.status === "waiting"
                ? JOIN_FIRST_MESSAGE
                : data.state.status === "finished"
                  ? MATCH_OVER_MESSAGE
                  : ROOM_FULL_MESSAGE,
            ),
          );
          return;
        }
        if (data.state.status === "finished") {
          forgetRoom(matchId);
        } else {
          rememberRoom(matchId);
        }
        onMatch({
          id: matchId,
          code: data.state.code,
          side,
          state: publicMatchView(data.state, side),
          version: data.version,
        });
      } catch (reason) {
        onError(friendlyRoomError(reason));
      }
    },
    // A listener that is refused is almost always the third-tab problem: the
    // rules will not let a stranger read an active match. Everything else here
    // is a phone that slept, changed network, or lost signal.
    (error) => {
      const friendly = friendlyRoomError(error);
      if (onDisconnect) onDisconnect(friendly);
      else onError(friendly);
    },
  );
}

/** The public board: who is playing right now. Names and round only, never dice. */
export function watchLiveBattles(
  onRows: (rows: LiveBattleRow[]) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  const db = requireDb();
  return onSnapshot(
    collection(db, LIVE),
    (snapshot) => {
      const rows = snapshot.docs
        .map((entry) => {
          const data = entry.data();
          return {
            id: entry.id,
            hostName: String(data.hostName || "Commander"),
            guestName: data.guestName ? String(data.guestName) : null,
            status: data.status === "active" ? "active" : "waiting",
            round: Number(data.round) || 1,
            updatedAt: toDate(data.updatedAt),
          } satisfies LiveBattleRow;
        })
        // An abandoned room is worse than no room: someone reads "Round 3" and
        // thinks a game is going on. Both kinds go quiet if nothing has touched
        // them — a waiting room sooner, since it has nothing to show for itself
        // but a host who closed their phone.
        .filter((row) => isOnTheField(row.status, row.updatedAt))
        .sort((a, b) => {
          if (a.status !== b.status) return a.status === "active" ? -1 : 1;
          return a.hostName.localeCompare(b.hostName);
        });
      onRows(rows);
    },
    (error) => onError(friendlyBoardError(error)),
  );
}

/** The public results list: who beat whom, in the last 30 days. Names only. */
export function watchRecentResults(
  onRows: (rows: BattleResultRow[]) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  const db = requireDb();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);

  return onSnapshot(
    query(
      collection(db, RESULTS),
      where("finishedAt", ">=", Timestamp.fromDate(cutoff)),
      orderBy("finishedAt", "desc"),
    ),
    (snapshot) => {
      const rows = snapshot.docs.flatMap((entry) => {
        const data = entry.data();
        const finishedAt = toDate(data.finishedAt);
        if (!finishedAt) return [];
        return [
          {
            id: entry.id,
            winnerName: String(data.winnerName || "Commander"),
            loserName: String(data.loserName || "Commander"),
            finishedAt,
          } satisfies BattleResultRow,
        ];
      });
      onRows(rows);
    },
    (error) => onError(friendlyBoardError(error)),
  );
}

/* ------------------------------------------------------------------ */
/* Heartbeat                                                           */
/* ------------------------------------------------------------------ */

/** Say "the host is still on this page" by touching the public board row. */
export async function touchRoom(matchId: string): Promise<void> {
  if (!firestore || !matchId) return;
  try {
    await ensurePlayerIdentity();
    await updateDoc(doc(firestore, LIVE, matchId), { updatedAt: serverTimestamp() });
  } catch {
    // The room is gone, or we are not seated in it. Either way there is
    // nothing for a player to do about a heartbeat, so it stays silent.
  }
}

/**
 * Say "still here" for one seat.
 *
 * Written on the match itself rather than the public board, because the point
 * is to tell one commander's presence from the other's — the board has a single
 * `updatedAt` that either of them touches.
 */
export async function touchSeat(matchId: string, side: SideId): Promise<void> {
  if (!firestore || !matchId) return;
  try {
    await ensurePlayerIdentity();
    await updateDoc(doc(firestore, MATCHES, matchId), {
      [side === "host" ? "hostSeenAt" : "guestSeenAt"]: serverTimestamp(),
    });
  } catch {
    // Not seated, or the room is gone. Nothing a player can do about a
    // heartbeat, so it stays silent.
  }
}

/** Beat for as long as this commander is on the match screen. */
export function startSeatPresence(matchId: string, side: SideId, everyMs = SEAT_BEAT_MS): () => void {
  if (typeof window === "undefined" || !matchId) return () => {};
  void touchSeat(matchId, side);
  const timer = window.setInterval(() => void touchSeat(matchId, side), everyMs);
  return () => window.clearInterval(timer);
}

/**
 * Take back a guest seat whose commander has gone quiet.
 *
 * This is the answer to losing your seat by closing a tab. A seat belongs to an
 * anonymous id in that browser's storage for that exact address; a private tab,
 * a different domain, or cleared storage all mint a new person, and the old one
 * holds the seat with nothing able to reach it. Before this, that ended the
 * match for both players.
 *
 * It is a blind write on purpose. An active match may not be read by anyone but
 * its two commanders — the document holds both fleets, including dice that have
 * not been revealed — so someone locked out cannot look before they leap. They
 * send only the two fields that change their own identity, and the rules decide,
 * from the seat's own timestamp, whether the seat was really abandoned.
 */
export async function reclaimGuestSeat(matchId: string, name: string): Promise<void> {
  const db = requireDb();
  if (!matchId) throw new Error("That invite link is missing its room. Ask your friend to send it again.");
  assertOnline();
  const user = await ensurePlayerIdentity();
  try {
    await withTimeout(
      updateDoc(doc(db, MATCHES, matchId), {
        guestUid: user.uid,
        "state.players.guest.uid": user.uid,
        "state.players.guest.name": name.trim() || "Commander",
        guestSeenAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
      NETWORK_TIMEOUT_MS,
      "Taking your seat back",
    );
    rememberRoom(matchId);
  } catch (reason) {
    if (isPermissionDenied(reason)) {
      throw new Error(
        "That seat is still in use. If it is yours, the other device is still connected — close it, wait a minute, and try again.",
      );
    }
    throw friendlyRoomError(reason);
  }
}

/**
 * Start the waiting-room heartbeat. Call it when the waiting screen mounts and
 * call the returned function when it unmounts. Stop beating and the room falls
 * off the public board about 45 minutes later.
 */
export function startRoomHeartbeat(matchId: string, everyMs: number = HEARTBEAT_MS): () => void {
  if (typeof window === "undefined" || !matchId) return () => {};
  void touchRoom(matchId);
  const timer = window.setInterval(() => void touchRoom(matchId), everyMs);
  return () => window.clearInterval(timer);
}

/* ------------------------------------------------------------------ */
/* This phone's rooms                                                  */
/* ------------------------------------------------------------------ */

/**
 * Every live room this phone remembers, newest first. Several at once is the
 * point: a group of friends can have four battles running and one person can
 * be in two of them.
 */
export function rememberedRooms(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(ROOMS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return [
      ...new Set(parsed.filter((value): value is string => typeof value === "string" && !!value)),
    ].slice(0, MAX_REMEMBERED_ROOMS);
  } catch {
    return [];
  }
}

export function rememberRoom(matchId: string): void {
  if (typeof window === "undefined" || !matchId) return;
  writeRememberedRooms([matchId, ...rememberedRooms().filter((id) => id !== matchId)]);
}

/** Drop one room from the Continue list, or all of them if no id is given. */
export function forgetRoom(matchId?: string): void {
  if (typeof window === "undefined") return;
  writeRememberedRooms(matchId ? rememberedRooms().filter((id) => id !== matchId) : []);
}

function writeRememberedRooms(ids: string[]): void {
  try {
    const next = [...new Set(ids.filter(Boolean))].slice(0, MAX_REMEMBERED_ROOMS);
    if (!next.length) localStorage.removeItem(ROOMS_KEY);
    else localStorage.setItem(ROOMS_KEY, JSON.stringify(next));
  } catch {
    // Storage blocked. Continue will not work, but nothing else breaks.
  }
}

/**
 * Refresh the Continue list. Finished and vanished rooms are dropped; rooms we
 * merely could not reach are kept, because losing every game you are playing
 * to one dropped bar of signal is unforgivable.
 */
export async function loadRememberedRoomCards(): Promise<RememberedRoomCard[]> {
  const ids = rememberedRooms();
  if (!ids.length) return [];

  const cards: RememberedRoomCard[] = [];
  for (const id of ids) {
    try {
      const room = await enterRoom(id, { remember: false });
      if (room.state.status === "finished") {
        forgetRoom(id);
        continue;
      }
      const you = room.state.players[room.side]!;
      const enemy = room.state.players[room.side === "host" ? "guest" : "host"];
      cards.push({
        id: room.id,
        code: room.code,
        side: room.side,
        status: room.state.status,
        round: you.round,
        youName: you.name,
        enemyName: enemy?.name ?? null,
      });
    } catch (error) {
      if (isPermanentRoomFailure(error)) forgetRoom(id);
      // Anything else (offline, timeout) leaves the card in storage so it comes
      // back when the signal does.
    }
  }
  return cards;
}

/* ------------------------------------------------------------------ */
/* Invite links                                                        */
/* ------------------------------------------------------------------ */

/** App-relative invite path. Includes both the id and the code so either works. */
export function invitePathFor(matchId: string, code: string): string {
  const base = process.env.NEXT_PUBLIC_BASE_PATH || "";
  return `${base}${INVITE_ROUTE}?id=${encodeURIComponent(matchId)}&code=${encodeURIComponent(code)}`;
}

/** The full link to text to a friend. */
export function absoluteUrl(path: string): string {
  if (typeof window === "undefined") return path;
  return `${window.location.origin}${path}`;
}

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

class CodeCollisionError extends Error {}
class RoomGoneError extends Error {
  constructor() {
    super(ROOM_GONE_MESSAGE);
  }
}
class RoomFullError extends Error {
  constructor() {
    super(ROOM_FULL_MESSAGE);
  }
}
class NotSeatedError extends Error {}

/** These mean the room really is not ours any more, so it is safe to forget it. */
function isPermanentRoomFailure(error: unknown): boolean {
  if (error instanceof RoomGoneError || error instanceof RoomFullError) return true;
  if (error instanceof NotSeatedError) return true;
  if (!(error instanceof Error)) return false;
  return error.message === ROOM_GONE_MESSAGE || error.message === ROOM_FULL_MESSAGE;
}

function errorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return "";
}

function isPermissionDenied(error: unknown): boolean {
  const code = errorCode(error);
  const message = error instanceof Error ? error.message : String(error);
  return code.includes("permission-denied") || /insufficient permissions/i.test(message);
}

/**
 * Never let a raw Firebase error reach a player.
 *
 * `permission-denied` on a room is, in practice, always one thing: somebody who
 * is not one of the two commanders asked for the private match document. Nine
 * times in ten it is the host in a second tab. So that is what we say.
 */
/**
 * Is this worth trying again, or is it the room's answer?
 *
 * A phone that cannot reach the database is the common case and it fixes
 * itself; a room that is gone, full, or not yours never will. Getting this
 * split wrong in either direction is bad: retrying a real answer spins
 * forever, and giving up on a blip strands a player on a dead screen with a
 * live match on the other end.
 */
export function isTransientRoomError(error: unknown): boolean {
  if (error instanceof RoomGoneError || error instanceof RoomFullError) return false;
  if (error instanceof NotSeatedError) return false;
  if (isPermissionDenied(error)) return false;

  const code = errorCode(error);
  const message = error instanceof Error ? error.message : String(error);
  if (code.includes("not-found")) return false;
  // A lost player badge needs a reload, which is what its message already says.
  if (code.includes("unauthenticated")) return false;

  return (
    code.includes("unavailable") ||
    code.includes("deadline-exceeded") ||
    code.includes("aborted") ||
    code.includes("resource-exhausted") ||
    code.includes("internal") ||
    code.includes("cancelled") ||
    /network|offline|timed out|did not answer/i.test(message) ||
    message === OFFLINE_MESSAGE
  );
}

export function friendlyRoomError(error: unknown): Error {
  if (error instanceof RoomGoneError || error instanceof RoomFullError) return error;

  const code = errorCode(error);
  const message = error instanceof Error ? error.message : String(error);

  if (isPermissionDenied(error)) {
    return new Error(ROOM_FULL_MESSAGE);
  }
  if (code.includes("not-found")) return new Error(ROOM_GONE_MESSAGE);
  if (code.includes("unavailable") || /network|offline/i.test(message)) {
    return new Error(OFFLINE_MESSAGE);
  }
  if (code.includes("deadline-exceeded") || code.includes("aborted")) {
    return new Error(`The ${NOUN.game} did not answer in time. Check your connection and try that again.`);
  }
  if (code.includes("resource-exhausted")) {
    return new Error(`The ${NOUN.game} is busy right now. Wait a moment and try again.`);
  }
  if (code.includes("unauthenticated")) {
    return new Error("This browser lost its player badge. Reload the page and try again.");
  }

  // Engine messages ("You need 4 Energy for that.") and our own messages land
  // here already written for a person, so they pass through untouched.
  return error instanceof Error ? error : new Error(message);
}

/** The public boards are read-only decoration; failing them must never sound alarming. */
function friendlyBoardError(error: unknown): Error {
  const code = errorCode(error);
  if (code.includes("failed-precondition")) {
    return new Error(`The list of recent ${NOUN.games} is not ready yet. Try again in a minute.`);
  }
  if (code.includes("unavailable") || code.includes("permission-denied")) {
    return new Error(`Could not load the list of ${NOUN.games} right now. It will reappear on its own.`);
  }
  return friendlyRoomError(error);
}

function requireDb() {
  if (!firestore) throw new Error(NOT_CONFIGURED_MESSAGE);
  return firestore;
}

function toDate(value: unknown): Date | null {
  if (value instanceof Timestamp) return value.toDate();
  if (value instanceof Date) return value;
  return null;
}
