"use client";

export default function GameError({ reset }: { error: Error; reset(): void }) {
  return (
    <div className="recovery-screen">
      <h1>The screen hit a snag.</h1>
      <p>
        Let’s reopen your battle. Online progress is kept in the room; solo
        resumes from its latest save on this browser.
      </p>
      <button onClick={reset}>Reopen battle</button>
    </div>
  );
}
