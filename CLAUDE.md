# Working on Fleet Dice 3

Read `HANDOFF.md` first for the project's history and state, `BALANCE.md` before
you touch any number. This file is the short version of how to work here without
undoing decisions that were reached with measurements.

The owner is not a developer. He thinks in how the game feels. Prefer plain
words, and prefer showing him something he can open on a phone over explaining
an approach.

## Running it

```bash
pnpm dev                 # localhost:3000, live reload — use this, not a build
pnpm test                # 70 rule tests, ~2s
pnpm build               # static export to out/ (what GitHub Pages serves)
pnpm lint
```

Versus needs Firebase. Never test it against the real project — that puts junk
rooms in front of real players:

```bash
pnpm emulators           # local firestore + auth
pnpm build:emulator      # a build pointed at them
pnpm serve
pnpm test:versus         # two browser clients, connection pulled mid-match
```

Balance and AI:

```bash
node sim/sweep.mjs difficulty 1500       # the tier ladder
node sim/difficulty-source.mjs 1200      # WHY a tier is strong, knob by knob
node sim/swarm-vs-ai.mjs 300 expert      # a strategy against the game's best
node sim/straights.mjs 200               # what tiers build when left alone
```

## House rules

**`lib/engine.ts` is the only source of truth.** Pure, no DOM, no React.
`TUNING` holds every balance number. The simulations and the app run the same
engine, which is why a number measured in `sim/` means something about the game
a person plays.

**Never hardcode a number the engine knows.** `lib/reference.ts` and every help
string interpolate from `TUNING` and from the face functions (`repairOf`,
`energyOf`, `attackOf`…). A balance change must not be able to leave a sentence
on screen lying. This has been violated twice and caught both times; assume it
will be violated again.

**Two words, and only two.** *Shields* are blue odd faces cancelling Attack.
*Blocking* is a ship stepping in front of damage and sitting out a round. The
words *brace*, *soak* and *absorb* must never reach the screen — a test in
`tests/howtoplay.test.mjs` fails if they do. (`brace` survives as an internal
action name in the engine; renaming that is a much bigger change than the words
a player reads.)

Faces roll **"Attack N"** or **"Shield N"** — never "hits" or "blocks".

**One mark, one meaning.** A ship spending a round out is drawn by
`paintHullPlate` as a flat plate: its hull silhouette, its size, a red bar
through it. The same mark appears the instant you tap a ship to block. Do not
add a second way to say this.

**Hull shapes are fixed.** d4 triangle, d6 square, d8 diamond, d10 pentagon,
from `addHullPath` in `components/HullShape.tsx`. Everything — fleet icons, help
screen, board plates — uses that one path set. A die's real 3D silhouette is not
the shape the game uses for it.

## Verifying work

**Measure; do not eyeball a screenshot.** Use real DOM numbers — `scrollWidth`
vs `clientWidth`, bounding boxes. Several bugs this session were invisible in a
screenshot and obvious in a measurement, and at least one was "fixed" twice
because a screenshot looked plausible.

**The dice are WebGL and unreachable from the DOM.** `window.__fd3` is the hatch
(`{arena, tap(id), debug()}`); `die.stats()` reports enough to prove an
animation is running.

**Playwright, in this repo:** scripts must sit in the project root to resolve
modules, and Chromium wants
`{executablePath:"/opt/pw-browsers/chromium", args:["--use-gl=swiftshader","--enable-webgl","--ignore-gpu-blocklist","--disable-gpu-sandbox"]}`.
Check 390×844, 390×620 and 360×780 — the dock clips horizontal overflow, so a
too-wide row disappears silently rather than scrolling.

**A strategy simulation needs a real opponent as a control.** A hand-written
"opposing strategy" will be worse than it looks and will hand you a confident
wrong answer. See `sim/swarm-vs-capital.mjs`, which measures 90% for one side
and carries a warning pointing at `sim/swarm-vs-ai.mjs`, where the same strategy
loses. Either file alone misleads.

**`lib/ai.ts` calls `Math.random()` in four places** rather than the engine's
seeded RNG, so a "seeded" simulation involving any tier below Expert is not
reproducible. Confidence intervals still mean what they say; identical re-runs
do not. Worth fixing.

## Settled with numbers — do not re-litigate without new measurements

- **Expert reads the other fleet and carries +10 starting health.** The read
  alone did not carry the tier: 47.8% ±4.0 against Hard through Energy and
  blocking, then 47.6% ±3.7 with shipyard buys priced in too. Both coin flips.
  The read stays because it makes Expert *play* differently — racing when ahead,
  digging in when behind — and the health is what makes the rung mean something.
  Ladder at 700 matches a pairing: Medium over Low 59.9%, Hard over Medium
  52.7%, Expert over Hard 54.9% ±3.7.
- **`samples` is a dead knob.** 120 versus 40 is 51.4% ±3.3 — thinking harder
  buys nothing. Hard and Expert burn three times the CPU per decision for it.
- **The all-d4 swarm is strong and fair.** ~11 lines a match against Expert's
  2.5, and it still loses 72.7%. Lines are a bonus, not a win condition.
- **Repair resolves in the same step as damage** (`before - damage + repair`),
  so it can save a flagship that damage alone would destroy, and healing past
  the maximum raises it. Zero is dead.
- **The block screen is skipped for a reason** when shields ate the whole attack
  and only Direct is left — about one damaging round in six. The report says so.

## Open, unmeasured

- **d10 looks mispriced.** Expert ends ~56% d6 and ~6% d10; the *worst* tier
  ends ~39% d10. Buying the biggest hull is what weak play looks like.
- **Straights barely happen** — 1.76 per match at Expert level, needing five
  consecutive numbers from a ~5-dice fleet, for a prominent chunk of How to Play.
