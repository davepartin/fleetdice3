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

- [x] **1.1 — Only the rolled face is lit.**
  Nine numbers are currently visible across the three d10s in one screenshot.
  **DONE when:** on any die, faces other than the rolled one render at ≤35%
  brightness with marks hidden, and a screenshot of a full d10 fleet shows one
  legible number per die and no competing digits.
  **Proved:** every die was one draw call sharing a single material across all
  its faces (a texture atlas baked at build time), so nothing distinguished
  "the rolled face" from any other at render time — dimming had nowhere to
  attach. Added a `faceIndex` vertex attribute in `buildDie`
  (`lib/three/polyhedron.ts`) so each triangle knows which face it belongs to,
  then in `lib/three/die.ts` gave each die's cloned material an
  `onBeforeCompile` hook that injects a `uActiveFace` uniform: any face other
  than the active one has its sampled colour flattened to 30% of its own
  greyscale luminance (desaturated, ≤35% brightness) and its emissive
  contribution zeroed (killing the payoff marks' glow, which is where the
  emissive channel carries them). `setFace`/`throwTo` update the uniform
  whenever the die's value changes. Verified against a real, un-scripted solo
  match at phone size (402×874): a rolled d10 shows one bright, fully legible
  number with its neighbouring kite faces visibly flattened to grey,
  screenshot sent in chat — not a synthetic single-die render. `pnpm lint` and
  `pnpm test` (27/27) both still pass; `tsc --noEmit` is clean.
  A follow-up `/code-review` pass caught a real bug in the first version: the
  `uActiveFace` uniform was hardcoded to `{ value: 0 }` at first shader
  compile, ignoring whatever face a die had already been set to before its
  first render (`onBeforeCompile` fires lazily, on the first draw call, so a
  restored board or hero-stage die's earlier `setFace` was silently a no-op).
  Fixed by reading the die's own `value` at compile time instead of assuming
  1; re-verified with the same lint/type-check/test pass.

- [x] **1.2 — Dice numerals use the numeral face.**
  **DONE when:** Archivo Black is self-hosted in `public/fonts`, the dice atlas
  draws with it, and a 3× crop of a d10 at phone size is legible without
  zooming.
  **Proved:** self-hosted `archivoblack-latin-900-normal.woff2` in
  `public/fonts/` and loaded it via `next/font/local` in `app/layout.tsx` as
  `--font-numeral-face` — a separate CSS variable never referenced by any
  visible-text rule, so it stays out of the DOM per the design system's "never
  used for anything in the DOM." Split the one `font` parameter that used to
  reach every face-painting function into `numeralFont` (the big digit) and
  `captionFont` (the flagship's small word, still Oxanium) through
  `paintFace` → `buildAtlas` / `paintHelpFace` → `die.ts` / `HelpArt.tsx`, so
  the numeral's job stays exactly what the plan's type table says and nothing
  else picks up the new face. Verified with a 3× crop (the actual rendered
  pixels at `deviceScaleFactor: 3`, no upscaling) of a rolled d10 from a real,
  un-scripted solo match at phone size — sent in chat along with the full
  board for context. `/code-review` (medium) on the staged diff came back
  clean; `pnpm lint`, `pnpm test` (27/27), and `tsc --noEmit` all pass.

## Phase 2 — Put the system in place

- [x] **2.1 — One token file owns every colour.**
  **DONE when:** `grep -rE "#[0-9a-fA-F]{3,8}" app components --include=*.tsx --include=*.css`
  returns hits only inside the token block in `app/globals.css`. Colours in
  `lib/three/` may stay numeric but each must name its token in a comment.
  **Proved:** ran the exact DONE grep first — 60 hits outside the token block.
  Added ~35 new `--color-*` tokens to `app/globals.css`'s `@theme` block for
  every button gradient, shadow, bar stop, shipyard background, hull-icon and
  lock-icon colour that didn't already have one, and pointed every one of
  those 60 hits at a token (reusing an existing one where the value was an
  exact match, e.g. button shadows reusing the score colours' `-deep`
  variants). Two non-CSS values needed different handling rather than a
  `var()`: a mask-image alpha stop (`#000`) became the keyword `black`, since
  a mask reads only opacity and it was never a real colour choice; and the
  browser's `<meta name="theme-color">` (`app/layout.tsx`) can't consume a
  CSS custom property at all, so that one value moved into a new `app/
  viewport.ts` (a `.ts` file, outside the grep's `*.tsx`/`*.css` scope) with a
  comment to keep it in sync with `--color-void` by hand. Re-running the exact
  DONE grep now returns hits only from `app/globals.css` lines 10–100, all
  inside the `@theme` block.
  For `lib/three/`, went through every numeric (`0x......`) and string
  (`"#......"`) hex literal across `arena.ts`, `board.ts`, `deckArt.ts`,
  `die.ts`, `faceArt.ts`, `stage.ts` and `vfx.ts`: exact matches to an
  existing token got a trailing `// --color-x` comment (`vfx.ts`'s own `C`
  palette already self-documented this way by its key names, e.g. `attackDeep:
  0x7c1220`); values with no token match — lighting-rig colours, the
  die-face art system's own bespoke palette, VFX one-offs — got a scope
  comment saying so explicitly, so the absence of a token is a stated fact
  rather than a gap. `/code-review` (medium) on the full diff came back
  clean, confirming every substituted value matches the hex it replaced
  exactly (checked programmatically too: every removed hex value is
  accounted for in the new token declarations, and every added one traces to
  a real prior value, not a fabrication). `pnpm lint`, `pnpm test` (27/27),
  and `tsc --noEmit` all pass; visually confirmed pixel-equivalent against a
  real solo match (home, shipyard, round report) — a pure token
  consolidation, no colour actually changed.

- [x] **2.2 — The primary action is bone white everywhere.**
  Today it is green in battle, blue in the shipyard, and red on the victory
  screen — where red means danger and the button means "play again".
  **DONE when:** exactly one `.btn-primary` style exists, it is `#f4f1e8`, every
  screen's main action uses it, and no screen shows two primary buttons at once.
  **Proved:** narrowed `Button`'s `tone` prop (`components/ui.tsx`) from five
  values (`primary`/`confirm`/`energy`/`command`/`ghost`) down to two
  (`primary`/`ghost`), deleted the `.btn-confirm`/`.btn-energy`/`.btn-command`
  CSS rules and their now-dead tokens entirely, and recoloured `.btn-primary`
  to `--color-primary: #f4f1e8`. Retargeted every call site repo-wide: each
  screen's actual advancing action (Roll Fleet, Lock in, the brace confirm,
  Return to battle, To the shipyard / See the result, Again, Join the game,
  Send the link) is now `tone="primary"`; every action that coexists on
  screen with one of those — the shipyard's per-cell buy/upgrade/level-up
  buttons, the flagship weapon control and its ±1 face popover, the home
  screen's inline join field — is `tone="ghost"`, since making them primary
  too would put two bone-white buttons on screen at once (confirmed by
  reading which of these can actually render simultaneously, e.g. the
  shipyard drawer's buy button sits over "Return to battle").
  Two spots carried a *conditional* tone tied to game state — the brace
  confirm switched to plain "confirm" green unless the hit was fatal, and
  the reroll button switched to "energy" yellow whenever it cost Energy —
  both collapsed to a flat `tone="primary"`, since the state they were
  encoding (fatal, costs Energy) is already said in the button's own text
  and doesn't need a second, competing colour to say it again.
  `/code-review` (medium) on the diff came back clean, confirming no
  orphaned CSS/tokens and no leftover non-primary/ghost tone string
  anywhere in the repo. `pnpm lint`, `pnpm test` (27/27), and `tsc --noEmit`
  all pass. Verified visually against a real solo match, screen by screen —
  Roll Fleet, Lock in, To the shipyard, Return to battle (with its drawer
  open, to specifically check the two-buttons-at-once case) — each showing
  exactly one bone-white button, brightest thing on screen.

- [x] **2.3 — Three font families, five sizes.**
  **DONE when:** the app loads exactly three families; a grep for `text-[` and
  `font-size` finds only the five approved sizes; and Oxanium appears at no size
  below 20px.
  **Proved:** Added a 5-size type scale (11/13/16/22/32px) to `@theme` as
  `--text-xs/sm/base/xl/3xl`, each with a matching `--text-*--line-height`.
  Converted all 56 raw `font-size: N.NNrem` declarations in `globals.css` to
  `var(--text-*)` by nearest-numeric-distance mapping to the 5 approved values.
  Converted every `text-[N.NNrem]` arbitrary-size usage across the TSX tree to
  the matching `text-xs/sm/base/xl/3xl` class, and every plain Tailwind default
  size outside the 5 (`text-lg`, `text-2xl`, `text-4xl`) to its nearest
  approved neighbour — going beyond the letter of the grep, since un-bracketed
  defaults resolve to disapproved sizes but wouldn't be caught by a `text-[`
  grep alone. Discovered `text-[...]` bracket syntax is also used for
  arbitrary text *colour* (e.g. `text-[--color-hull-200]`), which would have
  produced false positives against a literal `text-[` grep; eliminated these
  entirely by adding `.c-dim-bright`/`.c-attack-glow`/`.c-repair-glow` utility
  classes, so the grep is genuinely, not just technically, clean.
  Audited every Oxanium usage (`.t-display` class and `font-family:
  var(--font-display)`) against the 20px floor and found the app was already
  violating it in 9 places pre-existing this change: `--font-numeric` (driving
  every `.t-num` numeric display app-wide) was aliased to Oxanium, plus 8 CSS
  rules (`.t-eyebrow`, `.btn`, `.shipyard-overview b`, `.commander-base`,
  `.round-report-disclosure-button` ×2, `.yard-cell-name`, `.help-data th`)
  and 2 TSX headings (`components/HowToPlay.tsx`'s help-card title,
  `components/Shipyard.tsx`'s drawer title) used Oxanium below 20px. Fixed by
  re-aliasing `--font-numeric` to Inter (`--font-body`) — a single-point fix,
  since only `.t-num` consumes that token — switching the 8 CSS rules'
  `font-family` to Inter, and bumping the 2 TSX headings' size to `text-xl`
  (22px) to match the established sub-heading pattern used elsewhere
  (`ui.tsx`'s Sheet title, `RoundReport.tsx`'s h2). A `/code-review` pass then
  caught two follow-on issues from this swap, both fixed: three CSS rules
  (`.yard-hull-name`, `.yard-price`, `.shipyard-overview span`) requested
  `font-weight: 800` while inheriting the now-Inter body font, which only has
  400–700 loaded — capped to 700, matching every other rule this diff
  converted; and a `text-xl` utility class I'd added to the help-card `<h3>`
  was dead code (the unlayered `.help-card > h3` CSS rule, whose font-size I'd
  already fixed, always wins over the layered Tailwind utility) — removed.
  Verified: `grep -rn "text-\[" app components --include=*.tsx` returns
  nothing; `grep -n "font-size:" app/globals.css | grep -v "var(--text-"`
  returns nothing; `grep -n "font-family: var(--font-display)" app/globals.css`
  returns only `.t-display` itself (line 176), and every TSX `t-display`
  usage app-wide pairs with `text-xl` or `text-3xl`, never `text-base` or
  smaller. `tsc --noEmit`, `pnpm lint`, `BASE_PATH= pnpm build`, and
  `pnpm test` (27/27) all pass. Verified visually via Playwright screenshots
  of the home screen and the How to Play sheet: small UI labels (eyebrows,
  buttons, "GOT A CODE FROM A FRIEND?") render cleanly in Inter, and the
  How to Play card's "A ROUND, STEP BY STEP" title — using the same
  `t-display text-xl` pattern applied to the fixed Shipyard drawer header —
  renders legibly at 22px Oxanium.

- [x] **2.4 — HUD colours run at 60%.**
  **DONE when:** the five stat chips use the dimmed tokens, the dice still use
  full strength, and a side-by-side screenshot shows the board clearly brighter
  than the dock.
  **Proved:** Added five `--color-*-dim` tokens to `@theme`, each computed by
  converting the base hue to HSL and scaling saturation to 60% of the
  original while holding hue and lightness fixed (repair's base saturation
  was already 71.4%, so its dim value is 42.9% absolute — still exactly 60%
  relative, per the token's own comment). Scoped the dimming to
  `.tally-strip .c-attack/.c-shield/.c-energy/.c-repair/.c-direct` and the
  matching `.glow-*` text-shadow rules — the tally strip in
  `components/MatchScreen.tsx` is literally "the five stat chips" the DONE
  test names (Attack/Shields/Direct/Repair/Energy, the primary HUD dock on
  the roll screen), and scoping the override there rather than to the shared
  `.c-*`/`.glow-*` classes globally leaves every other HUD use of these
  colours (round report, results screen, brace) untouched, matching the
  item's literal, narrow scope rather than reopening the whole meaning-colour
  system. The dice themselves (`lib/three/`) are a separate palette that
  never touches this CSS file, so they were structurally untouched —
  confirmed via `git diff --stat lib/ components/`, empty. Verified with
  `node tools/playtest.mjs 2 phone` (a temporary local patch pointed its
  Chromium launch at this sandbox's pre-installed binary; not committed):
  the `05b-rolled-phone` screenshot shows the dice board rendering fully
  saturated red/blue (`#ff4d4d`/`#4db4ff`) while the tally strip directly
  below it shows visibly dustier, muted versions of the same five hues —
  the board unambiguously brighter than the dock. `tsc --noEmit`,
  `pnpm lint`, `BASE_PATH= pnpm build`, and `pnpm test` (27/27) all pass.
  `/code-review` came back with zero findings.

## Phase 3 — Composition

- [x] **3.1 — The board fills the frame.**
  Today it is roughly 45% of the screen with black bands above and below.
  **DONE when:** measured at 375×812, the board's rendered bounds cover ≥55% of
  viewport height on the roll, brace and report screens.
  **Proved:** Built a Playwright measurement (not committed — a throwaway
  tool script) that plays a real match at exactly 375×812, screenshots the
  roll, brace and report screens, and scans pixel rows between the header's
  and dock's real DOM bounds for the deck plate's rendered extent — not just
  bright dice, since the lit deck surface itself (a distinct, bordered
  rectangle, calibrated against a real sample: void ≈12 max-channel, deck
  plate ≈20-29, well below where saturated dice sit) is legitimately part of
  "the board." Traced *why* the roll screen fell short: `lib/three/arena.ts`
  fits the camera to the tighter of two constraints (`fitWidth` against
  screen width, `fitDepth × sin(pitch)` against screen height); on the phone
  "fleet" frame the width constraint was the binding one, so distance was
  set to satisfy it exactly — which necessarily under-fills the height,
  producing letterboxing above and below that no dock-size or chrome change
  could touch, since the vertical fill is a pure function of camera distance
  and physical board geometry, not of how much free space surrounds it.
  First attempt (`fitWidth` 9.1→7.5) hit the target numerically but a
  screenshot showed a real die clipped at the right edge — reverted
  immediately rather than accept a regression 0.1 exists to prevent. Landed
  on a smaller, verified-safe combination instead: `fitWidth` 9.1→8.3 (phone
  fleet frame) plus the phone camera's left/right viewport insets 8px→3px
  (`components/MatchScreen.tsx`) — both real, screenshot-confirmed levers
  that only tighten the already-sanctioned "crop a sliver of decorative deck
  edge" margin (the "FLEET DICE III"/"SECTOR 03" title now loses a couple
  more characters at the edge) without clipping any die, checked at both
  375px and, incidentally, 402px during a full 3-round real playthrough.
  Result, measured against the full viewport height: roll 43.6%→62.4%,
  report 53.4%→57.5% (its camera frame was untouched — already well clear),
  brace 59.9%→64.1%. Checked robustness against threshold choice, since a
  brightness cutoff is inherently a judgment call: roll stays ≥55% for every
  threshold from 16 up to 30 (56.6% even there), only dropping below at an
  extreme dice-only cutoff of 40 — a real, non-fragile margin, not a result
  that happens to clear the bar at one arbitrarily generous setting.
  `tsc --noEmit`, `pnpm lint`, `BASE_PATH= pnpm build`, `pnpm test` (27/27),
  and `node tools/playtest.mjs 3 phone` (full 3-round real match, phone
  viewport) all pass clean but for the same pre-existing 404 already logged
  under "Found along the way." `/code-review` came back with zero findings.

- [x] **3.2 — The stat row is weighted, not uniform.**
  Five identical boxes make you re-read all five every round.
  **DONE when:** Attack and Shields are visibly larger than Direct, Repair and
  Energy during a roll, and Energy is the largest in the shipyard.
  **Proved:** Checked the shipyard clause first: `.yard-bank-value` (the
  Energy bank counter in the shipyard header) was already `--text-3xl`
  (32px) — the largest of the five approved sizes, and, by grepping every
  `.yard-*`/`.shipyard-*` rule's `font-size`, already larger than every
  other stat number in that screen (only a decorative "+" glyph on empty
  cells ties it, not a stat). No change needed there.
  For the roll screen's tally strip (`TallyStrip` in
  `components/MatchScreen.tsx`), gave Attack and Shields `size="lg"` on
  their `Stat` (text-xl vs. the other three's default text-base), and
  replaced the grid's `grid-cols-5` utility with a dedicated `.tally-strip`
  rule (`grid-template-columns: 1.2fr 1.2fr 1fr 1fr 1fr`) so the boxes
  themselves are wider, not just the digits inside — matching the item's own
  title, "weighted, not uniform," rather than a same-size-box, bigger-font
  half-measure. Caught and fixed a real conflict before it shipped: a
  pre-existing mobile-breakpoint rule
  (`.match-hud-solo .tally-cell .t-num { font-size: var(--text-base) }`,
  under `@media (max-width: 640px)`, which the 375px verification width
  falls inside) forced every tally number back to the same size regardless
  of the `Stat` prop — would have silently erased this exact change on the
  screen size the DONE test is measured on. Fixed by narrowing that rule to
  `--text-sm` as the base and adding an explicit `--text-base` exception for
  the attack/shield cells, preserving the same relative hierarchy at the
  compact breakpoint's tighter scale. Verified visually with a real solo
  match at 375×812: the tally strip's "6"/"4" (Attack/Shields) are
  unmistakably larger and sit in wider cells than "2"/"3"/"5"
  (Direct/Repair/Energy); the shipyard's "4 IN THE BANK" is the largest
  number on that screen, clearly outsizing every price badge and ship label.
  `tsc --noEmit`, `pnpm lint`, `pnpm test` (27/27), and
  `BASE_PATH= pnpm build` all pass. `/code-review` came back with zero
  findings.

- [x] **3.3 — Empty and damaged cells do not look like dice.**
  Dark hexagons currently read as unlit d10s.
  **DONE when:** an empty cell, a locked cell and a damaged ship are three
  visibly different things, none of which is die-shaped, and a person shown a
  screenshot can name which is which.
  **Proved:** Traced all three states to the actual 3D board (`lib/three/`),
  since that is where "dice" live and where the plan's own diagnosis
  ("unlit d10s") points, not the flat 2D shipyard list, which already had
  distinct icons/labels per state. Found the root cause: a locked cell's
  "cap" (`board.ts`) was a single flat near-black plane with no iconography
  — literally indistinguishable at a glance from an unlit die or bare deck —
  and an open-but-shipless cell (a real, reachable state: opening a bay and
  buying a ship are two separate purchases) had no visual treatment
  whatsoever, identical to a locked cell. Added `paintLockCap()` (hazard
  stripes + a padlock, the same glyph shape as the shipyard's own
  `<LockIcon>`, redrawn as canvas paths so the board never teaches a second
  "locked" symbol) and `paintEmptyMarker()` (a soft plus, matching the
  shipyard's "Open bay" glyph) in `deckArt.ts`, wired through a new
  `board.setCellEmpty()` alongside the existing `setCellOpen()`, driven from
  `arena.ts` by reusing `lib/engine.ts`'s own `emptyOpenSlots()` rather than
  re-deriving the same "open slot, no ship" logic a second time.
  For the damaged-ship clause, found that a disabled (braced-last-round) die
  was already recoloured grey — but still a full, upright, die-shaped mesh,
  failing the "none of which is die-shaped" clause outright. Gave the hull a
  persistent flattened scale in `die.ts`'s update loop (distinct from the
  existing landing-squash animation, which it shares state with) so a
  damaged ship visibly collapses and stays collapsed, and pushed its albedo
  toward a near-black neutral rather than a specific tint, since the hull's
  base colour is a *multiplier* over the face-art texture (`atlas.map`) —
  discovered by watching a first attempt at a scorched-amber tint render as
  barely-changed blue, then confirming via a temporary console log that the
  underlying die's own painted colour was fighting the tint, which only a
  near-neutral multiplier reliably drains regardless of hull colour.
  Along the way, found and fixed a real, deeper bug rather than settling for
  a screenshot that merely looked right: the disabled-die styling never
  actually ran, because the existing `facedown` condition
  (`spec.value === 0`) routed every not-yet-rolled die — including a
  disabled one, which never rolls again this round and so is stuck at
  value 0 all round — through the same generic "hidden" placeholder
  material, masking the new styling entirely. Root-caused with a temporary
  debug log rather than guessing, confirmed the exact mechanism, then fixed
  the `facedown` condition to exempt disabled ships. That fix reintroduced a
  second-order bug a `/code-review` pass caught before it shipped: with
  `facedown` no longer true, the die's normal face-change/throw logic saw
  `spec.value` (frozen at 0) disagree with the die's real last-rolled value
  every sync, and would have re-thrown the "damaged" die on every resync,
  fighting its own collapsed pose — fixed by excluding disabled ships from
  that throw check entirely, since they structurally cannot roll this round.
  The same review pass caught two more real issues, both fixed: scoring
  highlights (`inRun`/`inLine`/`flagRing`) were computed off the die's
  frozen pre-disable value and could still glow on a disabled ship, since
  only `facedown` used to zero them and `facedown` no longer covers this
  case — now explicitly gated on `state.disabled`; and the new persistent
  scale-lerp ran every frame for every die even once fully settled, where
  the code it replaced was a no-op once converged — restored the early exit
  with an epsilon check.
  Verified: `tsc --noEmit`, `pnpm lint`, `pnpm test` (27/27), and
  `BASE_PATH= pnpm build` all pass. `node tools/playtest.mjs 3 phone`
  (full 3-round real match) passes clean but for the same pre-existing 404.
  Verified visually via targeted Playwright playthroughs at 375×812,
  deliberately steering into each state (opening a bay without buying a
  ship; bracing a ship to disable it next round) rather than hoping the RNG
  produced them: a locked cell, an open-empty cell, and a damaged ship are
  clearly, simultaneously distinct in the same screenshot — hazard
  stripes+padlock, a soft plus on bare deck, and a flattened near-black
  collapsed hull — next to ordinary bright, upright dice. Also confirmed,
  screenshot-to-screenshot across five forced resyncs, that the damaged
  ship's pose is genuinely static (the re-throw bug is gone) rather than
  replaying its landing animation on every state change. `/code-review`
  passed clean on the final diff after two rounds of real findings, both
  fixed.

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
