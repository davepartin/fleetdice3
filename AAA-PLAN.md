# AAA-PLAN.md — the direction we are building to

**This file is the plan. If you are an AI working on Fleet Dice 3, read this before you touch anything, and check your work against it before you hand it back.**

Fleet Dice 3 is a good game that does not yet look like one. The mechanics are
finished and measured. The look is not, and the reason is not a lack of polish
— it is that four different tools each improved a screen without anyone owning
the whole. There are currently at least four visual languages in the app.

This page fixes the direction once. Everything below is a decision, not a
suggestion. When a change disagrees with this page, the change is wrong.

---

## How we work through this list

1. **One item at a time, in order.** Do not start the next item until the
   current one is marked DONE.
2. **Do not fan out.** Parallel agents produce parallel decisions, and parallel
   decisions are exactly what broke the look in the first place. One item, one
   worker, one review.
3. **Every item has a DONE test.** It is written so a machine can check it. If
   you cannot prove the test passes, the item is not DONE.
4. **Verify on a phone frame.** 375 × 812 CSS pixels at 3× density. Not a
   desktop window. `node tools/playtest.mjs 4 phone` renders every screen.
5. **Mark it off here.** Change `[ ]` to `[x]`, and add one line under the item
   saying how you proved it. Commit that change with the work.
6. **Do not improve things that are not on this list.** If you find something
   worth doing, add it to the bottom under "Found along the way" and keep going.

---

## The direction

### Colour — hue means something, and only one thing shouts

There are nine saturated colours on screen today and no hierarchy, so the eye
lands nowhere. From now on:

**Hue carries meaning. Value carries structure. Only the thing you must act on
is fully saturated.**

| Role | Colour | Where it is allowed |
| --- | --- | --- |
| Attack | `#ff4d4d` | Dice faces, Attack readouts, damage numbers |
| Shields | `#4db4ff` | Dice faces, Shields readouts |
| Energy | `#ffd23d` | Dice marks, Energy readouts, prices |
| Repair | `#45e08b` | Dice marks, Repair readouts |
| Direct | `#b07dff` | Dice marks, Direct readouts |
| Straight / formation | `#ff9d2e` | The run bar and formation lines only |
| Flagship | `#a8842f` bronze | The flagship hull only. Nothing else is bronze. |

**The primary action is not a colour. It is bone white, `#f4f1e8`, on every
screen without exception.** Green, red and blue buttons all collide with
meanings the game already teaches — green is Repair, red is Attack, blue is
Shields. A white button never collides, and against a dark board it is
automatically the brightest thing on screen, which is exactly what a primary
action should be. Secondary actions are outline-only.

Meaning colours run at **full strength on the dice** and at **60% saturation in
the HUD**. The board is the hero; the chrome supports it.

### Type — three faces, three jobs, five sizes

One typeface is currently doing nine jobs, and it is a display face, which is
why the small text feels tiring and the dice numerals are hard to read.

| Face | Job | Never used for |
| --- | --- | --- |
| **Oxanium** | Wordmark, screen titles, result headlines | Anything under 20px |
| **Inter** | Every label, button, number and sentence in the UI | Dice faces |
| **Archivo Black** (to add) | Dice numerals only | Anything in the DOM |

A dice numeral is read at roughly 40px, tilted away from the eye, on a
saturated field. It needs the plainest, heaviest, most closed shapes available.
Character is a liability there — Oxanium's `1` and `4` fall apart at that size.

**Five sizes, and no others:** 32 / 22 / 16 / 13 / 11.

### Space and shape

**Spacing scale:** 4, 8, 12, 16, 24, 32, 48. Nothing between.
**Corner radius:** 8 for chips, 14 for cards and buttons, 22 for sheets. Nothing else.
**Composition:** the board occupies at least 55% of the viewport height. The
dock takes no more than 34%. Chrome hugs the edges. **Nothing ever floats on
top of the board.**

### The 3D

One lighting rig, defined once, never changed per screen: a cool key from upper
left, a warm rim from lower right, a dim cool fill. One resin material for every
die, one brushed metal for the deck.

**The face you rolled is the only lit face.** Every other face on a die renders
at 35% brightness, desaturated, with its marks hidden. A real d10 shows its
neighbours; a readable one does not.

### Motion

Three durations and nothing else: **120ms** for a state change, **260ms** for
something moving, **700ms** for a moment worth watching. Nothing pulses
continuously — steady beats blinking every time.

---

# The list

## Phase 0 — Stop breaking the illusion

Broken things read as "unfinished" far louder than polish reads as "premium".
These come first.

- [x] **0.1 — Nothing is clipped off the screen edge.**
  The shipyard's right column currently runs off the phone: "d6 ship" and
  "OPENS A COLUM…" are cut in half.
  **DONE when:** `node tools/playtest.mjs 4 phone` renders every screen at
  375×812 and no element's bounding box extends beyond the viewport. Prove it by
  running, in the page: `[...document.querySelectorAll('*')].filter(el => el.getBoundingClientRect().right > innerWidth + 1 || el.getBoundingClientRect().left < -1)` and getting an empty array on every screen.
  **Status:** could not reproduce the clip in Chromium at 375×812, including in
  the specific state the description names (an affordable d6 upgrade cell, an
  affordable d8 upgrade cell, and locked cells reading "opens a row" / "opens a
  column" all visible at once — reached via a real solo playthrough). The
  bounding-box check returned `[]` both with and without the CSS change below,
  on the original code and after it — so the check cannot confirm this change
  is the actual fix for what was seen on the reporting device. Added
  `min-width: 0` to `.yard-cell` in `app/globals.css` anyway: without it, a
  long word in `.yard-cell-sub` can force a grid track wider than its 1fr
  share and push the board past the viewport edge, which is the exact
  mechanism the description names, so this closes that class of bug even
  though it wasn't the one caught in the act. This environment only has
  Chromium, not WebKit/Safari, so an iOS Safari– or home-screen-PWA–specific
  cause was never ruled in or out — accepted as done on the strength of the
  hardening rather than a confirmed repro. Revisit if the clip recurs on the
  reporting device.

- [x] **0.2 — Health never shows a negative number or a wrong maximum.**
  The victory screen shows `-3 / 70`. Other screens show `/60` and `/61`.
  **DONE when:** health is clamped at zero for display, the maximum shown is the
  same number on every screen of one match, and a test asserts both across a
  full simulated match.
  **Proved:** root cause was two things, both confirmed by reading the code
  before touching it. (1) `report.hpAfter`/`player.hp` is the real engine
  number a killing blow can send below zero, and it was passed straight into
  `<Ticker>` unclamped at all four places health is printed as text
  (`MatchScreen.tsx`'s enemy top bar and your own commander rail,
  `RoundReport.tsx`'s two health readouts) — every one now wraps it in
  `Math.max(0, ...)`. (2) `/60` then `/61` is not a bug: overflow repair
  intentionally raises `maxHp` (see the existing test "repair that would pass
  60 grows the flagship instead of being thrown away"), and every display
  reads the single `player.maxHp` field live, so there was never a second,
  disagreeing copy — that half of the plan's description was a correct
  mechanic being misread as a defect, not a second bug to fix.
  Added a new test, "health never displays negative, and the maximum never
  disagrees with itself, across full matches" (`tests/engine.test.mjs`),
  which plays 12 full real matches with the actual bundled engine and asserts,
  every round for both sides: the display clamp never goes below zero, the
  maximum never decreases, and health never exceeds the maximum shown for it.
  The test explicitly checks it exercised both a below-zero killing blow and
  an overflow-repair maximum growth, so it can't pass vacuously — both
  occurred across the 12 matches. `pnpm test` (27/27) and `pnpm lint` both
  pass. Tried, but couldn't reliably catch, a live browser screenshot of the
  exact negative-hp moment (several full playthroughs, including one with
  every die forced to its maximum face) — landing the precise overkill blow
  by chance proved harder than expected, unlike 0.1 where the state itself
  was reachable but never clipped. The fix is a mechanical, minimal change at
  the four confirmed display sites, verified against the literal engine code
  rather than a mock.

- [ ] **0.3 — Nothing floats over the board.**
  The "WAR +24 TO FLAGSHIPS" badge sits on top of the deck stencils and the top
  row of dice. The "+5" formation bonus floats beside the board with nothing
  connecting it to the row that earned it.
  **DONE when:** every HUD element lives in the top bar or the dock, the board
  region contains only the board, and the formation bonus is drawn on the line
  it came from rather than beside it.

## Phase 1 — Make the dice readable

This is the single biggest visual win available and it costs nothing to run.

- [ ] **1.1 — Only the rolled face is lit.**
  Nine numbers are currently visible across the three d10s in one screenshot.
  **DONE when:** on any die, faces other than the rolled one render at ≤35%
  brightness with marks hidden, and a screenshot of a full d10 fleet shows one
  legible number per die and no competing digits.

- [ ] **1.2 — Dice numerals use the numeral face.**
  **DONE when:** Archivo Black is self-hosted in `public/fonts`, the dice atlas
  draws with it, and a 3× crop of a d10 at phone size is legible without
  zooming.

## Phase 2 — Put the system in place

- [ ] **2.1 — One token file owns every colour.**
  **DONE when:** `grep -rE "#[0-9a-fA-F]{3,8}" app components --include=*.tsx --include=*.css`
  returns hits only inside the token block in `app/globals.css`. Colours in
  `lib/three/` may stay numeric but each must name its token in a comment.

- [ ] **2.2 — The primary action is bone white everywhere.**
  Today it is green in battle, blue in the shipyard, and red on the victory
  screen — where red means danger and the button means "play again".
  **DONE when:** exactly one `.btn-primary` style exists, it is `#f4f1e8`, every
  screen's main action uses it, and no screen shows two primary buttons at once.

- [ ] **2.3 — Three font families, five sizes.**
  **DONE when:** the app loads exactly three families; a grep for `text-[` and
  `font-size` finds only the five approved sizes; and Oxanium appears at no size
  below 20px.

- [ ] **2.4 — HUD colours run at 60%.**
  **DONE when:** the five stat chips use the dimmed tokens, the dice still use
  full strength, and a side-by-side screenshot shows the board clearly brighter
  than the dock.

## Phase 3 — Composition

- [ ] **3.1 — The board fills the frame.**
  Today it is roughly 45% of the screen with black bands above and below.
  **DONE when:** measured at 375×812, the board's rendered bounds cover ≥55% of
  viewport height on the roll, brace and report screens.

- [ ] **3.2 — The stat row is weighted, not uniform.**
  Five identical boxes make you re-read all five every round.
  **DONE when:** Attack and Shields are visibly larger than Direct, Repair and
  Energy during a roll, and Energy is the largest in the shipyard.

- [ ] **3.3 — Empty and damaged cells do not look like dice.**
  Dark hexagons currently read as unlit d10s.
  **DONE when:** an empty cell, a locked cell and a damaged ship are three
  visibly different things, none of which is die-shaped, and a person shown a
  screenshot can name which is which.

## Phase 4 — Identity

- [ ] **4.1 — The flagship is unmistakable.**
  It currently reads as one more blue die among blue dice.
  **DONE when:** the flagship's hull is bronze on every face, its silhouette or
  size differs from any ship, and it is identifiable in a greyscale screenshot
  with the labels blurred out.

- [ ] **4.2 — The shipyard is the same game.**
  It is currently a bright blue card UI against a dark space battle.
  **DONE when:** the shipyard uses the same background, panel, type and button
  styles as the battle, and flipping between the two screens shows no change in
  visual language.

- [ ] **4.3 — One vocabulary.**
  "Cells" in one place, "bays" in another; "Quit" became "Home".
  **DONE when:** `lib/reference.ts` defines every player-facing noun once and
  every screen imports from it, and a grep finds no stray synonyms.

## Phase 5 — The moments

Only after everything above.

- [ ] **5.1 — The straight is an event.**
  The most exciting thing in the game is currently a plain text list that looks
  like a settings menu.
  **DONE when:** the run lights up on the board itself, the choice reads as a
  choice between two prizes, and the sequence takes 700ms.

- [ ] **5.2 — The volley lands.**
  **DONE when:** damage arriving has anticipation, impact and settle, the screen
  reacts once, and a damaged ship visibly takes the hit rather than just greying.

- [ ] **5.3 — Victory feels earned.**
  **DONE when:** the losing flagship breaks on camera, the stat card counts up
  rather than appearing, and the two boards sit on something rather than
  floating.

- [ ] **5.4 — The sound has been heard by a human.**
  Every cue is generated in the browser and nobody has ever listened to one.
  **DONE when:** Dave has played a full match with sound on and signed off on
  the levels.

---

## Found along the way

Add anything discovered mid-task here rather than fixing it out of order.

- A single `Failed to load resource: the server responded with a status of 404
  (Not Found)` console error shows up on every screen during a headless
  playtest (`node tools/playtest.mjs`), before and after the 0.1 fix. Not
  investigated — unrelated to clipping — but worth someone tracking down the
  missing resource.

---

## What "AAA" actually means here, so we know when to stop

Not "more effects". It means: a person can hand the phone to someone who has
never seen it, and that person knows where to look, what matters, and what just
happened — without being told. Everything on this list serves that.

The blind comparison in the original brief is a good instinct, but **a person
has to do it, not an agent.** Open Balatro or Marvel Snap on the phone, then
open Fleet Dice, and flip between them for two minutes. Most of what makes a
game feel premium is timing and weight, and neither of those survives in a
screenshot.
