/** Local-only diagnostics. No names, room codes, UIDs, dice or credentials. */
export const PLAYTEST_BUILD = process.env.NEXT_PUBLIC_BUILD_ID || "playtest-recovery-1";
const KEY = "fd3.playtest.events.v1";
type Event = { at: string; kind: string; round?: number; phase?: string; action?: string };

export function notePlaytest(kind: string, context: Omit<Event, "at" | "kind"> = {}) {
  if (typeof window === "undefined") return;
  try {
    const events = readEvents();
    events.push({ at: new Date().toISOString(), kind, ...context });
    localStorage.setItem(KEY, JSON.stringify(events.slice(-80)));
  } catch { /* Diagnostics must never interrupt a match. */ }
}

function readEvents(): Event[] {
  try {
    const data = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(data) ? data.slice(-80) : [];
  } catch { return []; }
}

export function playtestReport(feedback: string) {
  return JSON.stringify({
    build: PLAYTEST_BUILD,
    createdAt: new Date().toISOString(),
    feedback: feedback.slice(0, 2000),
    viewport: typeof window === "undefined" ? null : { width: innerWidth, height: innerHeight, pixelRatio: devicePixelRatio },
    online: typeof navigator === "undefined" ? null : navigator.onLine,
    events: readEvents(),
  }, null, 2);
}

export function downloadPlaytestReport(feedback = "") {
  const url = URL.createObjectURL(new Blob([playtestReport(feedback)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `fleet-dice-feedback-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
