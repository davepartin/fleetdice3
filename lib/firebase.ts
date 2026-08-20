"use client";

/**
 * Fleet Dice 3 — Firebase wiring.
 *
 * Anonymous auth only. There is nothing to sign up for: the players are
 * strangers' phones, and a phone's "identity" is an anonymous uid the browser
 * remembers. That has one consequence you must keep in your head while reading
 * anything else in this folder:
 *
 *   A NEW TAB, A DIFFERENT BROWSER, OR CLEARED SITE DATA IS A NEW PERSON.
 *
 * Almost every "Missing or insufficient permissions" report from Fleet Dice 1
 * and 2 was really that: a host opening their own invite link in a second tab,
 * arriving as a third anonymous stranger, and being refused a seat in a room
 * that already had two. Never show a raw Firebase error to a player.
 *
 * This is the same Firebase project (`space-tribes`) that runs Fleet Dice 1 and
 * 2, so the owner has nothing new to set up. Fleet Dice 3 keeps its own
 * `fd3*` collections — see lib/rooms.ts and firestore.rules.
 */

import { getApp, getApps, initializeApp } from "firebase/app";
import {
  browserLocalPersistence,
  getAuth,
  inMemoryPersistence,
  onAuthStateChanged,
  setPersistence,
  signInAnonymously,
  type User,
} from "firebase/auth";
import { getFirestore } from "firebase/firestore";

/**
 * The web API key is public by design — it identifies the project, it does not
 * authorise anything. What actually protects the data is firestore.rules.
 * Every value can still be overridden with a NEXT_PUBLIC_FIREBASE_* env var so
 * a fork can point at its own project without editing code.
 */
export const firebaseConfig = {
  apiKey:
    process.env.NEXT_PUBLIC_FIREBASE_API_KEY ||
    "AIzaSyDpR3PEAEskSCZ7fpvuEi6EBFMoB0UZ6Yw",
  authDomain:
    process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ||
    "space-tribes.firebaseapp.com",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "space-tribes",
  storageBucket:
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ||
    "space-tribes.firebasestorage.app",
  messagingSenderId:
    process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "259546833788",
  appId:
    process.env.NEXT_PUBLIC_FIREBASE_APP_ID ||
    "1:259546833788:web:22ae17ff32c2c60269baf9",
};

export const firebaseConfigured = Boolean(
  firebaseConfig.apiKey && firebaseConfig.authDomain && firebaseConfig.projectId,
);

const app = firebaseConfigured
  ? getApps().length
    ? getApp()
    : initializeApp(firebaseConfig)
  : null;

export const firebaseAuth = app ? getAuth(app) : null;
export const firestore = app ? getFirestore(app) : null;

/** Shown whenever the app has no Firebase project to talk to at all. */
export const NOT_CONFIGURED_MESSAGE =
  "Online play is not switched on in this build. You can still play solo — tap Back and choose Solo.";

/** Shown when the phone is plainly offline before we even try. */
export const OFFLINE_MESSAGE =
  "Your phone looks offline. Reconnect to wi-fi or mobile data and try again.";

/**
 * Fail loudly instead of hanging. A sign-in that never resolves is worse than
 * one that fails: the player just watches a spinner and reloads, which in an
 * anonymous world can hand them a brand new identity.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(
          `${label} is taking too long. Check your connection and try again.`,
        ),
      );
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** True only when the browser is certain it is offline (it is never certain it is online). */
export function browserOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

/** Throw an understandable error rather than letting Firestore queue writes forever. */
export function assertOnline(): void {
  if (browserOffline()) throw new Error(OFFLINE_MESSAGE);
}

let identityPromise: Promise<User> | null = null;

/**
 * Get (or create) this browser's anonymous player. Safe to call repeatedly:
 * concurrent callers share one in-flight sign-in.
 */
export async function ensurePlayerIdentity(): Promise<User> {
  if (!firebaseAuth) throw new Error(NOT_CONFIGURED_MESSAGE);
  if (firebaseAuth.currentUser) return firebaseAuth.currentUser;
  if (identityPromise) return identityPromise;

  identityPromise = (async () => {
    // Embedded browsers (in-app webviews, some ChatGPT / Sites frames) block
    // durable storage. Fall back to in-memory rather than hanging forever —
    // the player gets a fresh identity each reload, which is bad, but playable.
    try {
      await setPersistence(firebaseAuth, browserLocalPersistence);
    } catch {
      await setPersistence(firebaseAuth, inMemoryPersistence);
    }

    // Restore the uid this browser already has, if any. This is what makes
    // "Continue" work, and what keeps a host seated in their own room.
    const restored = await withTimeout(
      new Promise<User | null>((resolve) => {
        const stop = onAuthStateChanged(firebaseAuth, (user) => {
          stop();
          resolve(user);
        });
      }),
      12000,
      "Signing in",
    );
    if (restored) return restored;

    if (browserOffline()) throw new Error(OFFLINE_MESSAGE);

    try {
      const credential = await withTimeout(
        signInAnonymously(firebaseAuth),
        12000,
        "Signing in",
      );
      return credential.user;
    } catch (error) {
      throw friendlyAuthError(error);
    }
  })();

  try {
    return await identityPromise;
  } finally {
    identityPromise = null;
  }
}

/** The uid this browser is already signed in as, without triggering a sign-in. */
export function currentUid(): string | null {
  return firebaseAuth?.currentUser?.uid ?? null;
}

/**
 * Turn an auth failure into something a person can act on. The two that
 * actually happen in the wild are "someone turned Anonymous sign-in off in the
 * console" and "this site's domain is not on the authorised list".
 */
export function friendlyAuthError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (/admin-restricted-operation|operation-not-allowed/i.test(message)) {
    return new Error(
      "Online play is switched off for this game right now. Ask the game's owner to turn Anonymous sign-in back on in Firebase, then try again.",
    );
  }
  if (/unauthorized-domain/i.test(message)) {
    return new Error(
      "This web address is not on the game's approved list, so it cannot sign you in. Ask the game's owner to add this domain in Firebase, then try again.",
    );
  }
  if (/network-request-failed|offline|unavailable/i.test(message)) {
    return new Error(OFFLINE_MESSAGE);
  }
  return error instanceof Error ? error : new Error(message);
}

/*
 * Commander name. Fleet Dice 3 uses its own storage key because GitHub Pages
 * serves all of this owner's projects from one origin — davepartin.github.io —
 * so fleetdice3 and the older games share one localStorage. Anything not
 * prefixed `fd3-` risks stepping on the live games.
 */
const NAME_KEY = "fd3-commander-name";
const LEGACY_NAME_KEY = "fleet-dice-commander-name";

export function commanderName(): string {
  if (typeof window === "undefined") return "Commander";
  try {
    // Read-only courtesy: if they named themselves in Fleet Dice 1 or 2 on this
    // phone, start from that. We never write back to the old key.
    return (
      localStorage.getItem(NAME_KEY) ||
      localStorage.getItem(LEGACY_NAME_KEY) ||
      "Commander"
    );
  } catch {
    return "Commander";
  }
}

export function rememberCommanderName(name: string): void {
  if (typeof window === "undefined") return;
  const cleaned = name.trim().replace(/\s+/g, " ").slice(0, 20) || "Commander";
  try {
    localStorage.setItem(NAME_KEY, cleaned);
  } catch {
    // Private mode with storage blocked. The name just will not stick.
  }
}
