# Handing Fleet Dice to another assistant

*The game is called **Fleet Dice**. The repo is still `fleetdice3` and the
Firestore collections are still `fd3*` — the 3 was the development name and
only survives where renaming would break a live URL or live data.*

Read this, then `README.md`, `NEXT.md`, and `AAA_BRIEF.md`. `BALANCE.md` matters
if you touch any number.

The owner is **not a developer**. He thinks in how the game feels and relies on
you for the maths and the code. Prefer plain words. Prefer showing him something
he can open on a phone over inventing architecture.

---

## Status of the original ten-item plan

| # | Item | State |
| --- | --- | --- |
| 1 | Study the Fleet Dice 2 engine and rules | **Done** |
| 2 | Scaffold the repo | **Done** — Next 16 static export, Tailwind 4, Three 0.185 |
| 3 | Build the rules engine | **Done** — `lib/engine.ts`, 111 tests passing |
| 4 | Simulate and retune the balance | **Done** — see `BALANCE.md`, including a correction |
| 5 | AAA 3D dice and battlefield | **Done, not finished** — see below |
| 6 | HUD, VFX and audio | **Built. Audio still never heard by a human** |
| 7 | Solo mode and versus rooms | **Done. Versus played end to end on two devices against real Firebase** |
| 8 | One-button How to Play | **Done** — generated from the engine, cannot go stale |
| 9 | Harsh-critic screenshot loop | **Passed for solo phone** — 390×844 and 402×874 |
| 10 | Playtest and verify end to end | **Both. A full versus match was played and won on the live site** |

### Item 5, honestly

The dice are real polyhedra built face by face, including a correctly
proportioned pentagonal trapezohedron for the d10 — the flat-kite condition
matters and getting it wrong buckles the faces. Materials are polished resin,
not metal (a metal die in a dark room renders black). The deck is a lit,
shadow-receiving slab with a painted texture. Post chain is bloom, vignette,
grain and a little chromatic aberration, with three quality tiers and a
frame-time watchdog that drops a tier rather than stuttering.

What it is **not**: a finished art pass, though it is a good deal further along
than it was. The solo battlefield frames itself inside the actual phone pixels
left by the HUD, at 390×844 and 402×874, and that layout is shared with versus —
which has now had its live two-device check.

Victory and defeat are **no longer quiet**. The losing flagship breaks, the dice
scatter, the camera pushes onto the wreck, and the recap waits ~5.9 seconds for
all of it before sliding up — measured, not assumed. The key art salvaged from
Fleet Dice 1/2 carries the title screen and both end screens. Audio is still
the one thing no human has ever heard.

### Item 9, honestly

The first build did not complete the requested adversarial review. The later
solo-phone pass did: separate layout and renderer audits identified the unsafe
camera/HUD composition, then an independent harsh critic reviewed medium and
high renders at 390×844 and 402×874. Rolled, selected, brace, and report states
passed for die readability, totals, selection clearance, and next-action
hierarchy. That gate applies to solo phone. It is not evidence that versus,
audio, victory, or defeat are finished.

---

## Running it

Node 22+, pnpm.

```bash
pnpm install
pnpm dev                 # http://localhost:3000/ — the game serves from the
                         # root now that it has its own domain
pnpm test                # 111 tests
pnpm build               # static export into out/
node sim/simulate.mjs    # the measurement harness
node sim/ladder.mjs 500  # does each difficulty beat the one below it?
node tools/playtest.mjs 6 phone   # plays the real game in a real browser
```

**Where it lives.** <https://fleetdice.ministrybag.com> — its own subdomain on
the owner's domain, published by `.github/workflows/deploy.yml` on every push to
`main`. `public/CNAME` carries the domain into the build; without that file in
the artifact, Pages drops the custom domain on the next deploy and every asset
path breaks. `davepartin.github.io/fleetdice3/` and `ministrybag.com/fleetdice`
both redirect to it, so older links still land.

`tools/playtest.mjs` is the most useful thing in the repo for you. It drives the
built site with Playwright through a whole solo match at 402×874 and 390×844,
screenshots every screen into `shots/`, and fails loudly on a console error or
a stuck screen. Run it after anything you change in `components/` or
`lib/three/`.

Note: the sim harness bundles the TypeScript with esbuild into `.simbuild/`
first, so it always measures the same code the browser runs. Never hand-write a
second copy of the rules for a simulation.

---

## The one thing that will bite you

**Fleet Dice 1, 2 and 3 share one Firebase project (`space-tribes`) and one set
of security rules.** Deploying `firestore.rules` replaces the rules for all
three games. The file in this repo contains the Fleet Dice 1 and 2 rules copied
verbatim, followed by the `fd3*` ones. Deploy the whole file, never a fragment.
`FIREBASE.md` has the detail. Verified byte-for-byte against the live file on
20 August 2026 and re-confirmed on 1 September 2026.

Fleet Dice 1 and 2 were retired on 2 September 2026 — the `spacetribe-dice` repo
is archived and its Pages site switched off — but **leave their rules section
alone anyway**. It is harmless where it is, their `codes` / `matches` /
`liveBattles` / `battleResults` collections still hold real match history, and
removing it is the one edit that could break something silently.

---

## Architecture in one paragraph

`lib/engine.ts` is the rules, with no React and no browser — the app, the
opponent and the simulations all call the same functions. `lib/ai.ts` is the
opponent's brain and doubles as the yardstick for every measurement.
`lib/reference.ts` generates every word and number the How to Play screen shows,
from the engine, so help can never drift from rules. `lib/three/` is the 3D:
`polyhedron.ts` builds the solids and the per-face UV atlas, `die.ts` is one
die and its throw, `board.ts` and `deckArt.ts` are the deck, `stage.ts` is the
renderer and post chain, `arena.ts` places two boards and moves the camera,
`vfx.ts` is impacts and beams. `lib/rooms.ts` is Firestore. Screens are in
`components/`, routes in `app/`.

The three-by-three board is cells 0–8 with the flagship fixed at cell 4. Ships
live in *slots* 0–7. `cellForSlot` and `slotForCell` convert. Getting these
confused is the easiest bug to write in this codebase.

---

## Where it actually stands

Both of the old first-things are done.

**The Firestore rules are deployed** — confirmed on 1 September 2026, when a
re-deploy reported "already up to date", meaning the live rules were byte-identical
to the file in this repo. They had been live all along.

**Versus has been played end to end**, twice over: two browser clients against a
local emulator, and then a whole match on two real devices against real Firebase,
start to victory screen. That was the largest unknown in the project and it is
closed. It also found a real bug that no local test could have — see the round
report note in `BALANCE.md`.

The project is on Firebase's **Blaze** plan, so the free tier's ~55-matches-a-day
ceiling is gone. Real cost is pennies: a hundred matches a day is about five.

### What to do next

1. **Let him play and write down what felt off.** Every good change in the last
   two sessions came from him playing on a phone and noticing something —
   the reroll cap, the enemy formation rails, the round report bug, the
   difficulty ladder. None of them came from reading code.
2. **`lib/ai.ts` is where the remaining leverage is.** The difficulty ladder is
   now `energyWeight` per tier and it moved every rung; there is probably more
   there. `sim/ladder.mjs` measures it in one command.

Known rough edges and open questions are in `NEXT.md`; every measurement behind
a number is in `BALANCE.md`.

---

## House rules worth keeping

1. **Measure before you believe.** Almost every design instinct on this project
   has been wrong at least once, including several of mine in the first session.
2. **A measurement is only as good as the thing producing it.** The first
   balance pass drew a confident conclusion from 10,042 rounds played by an
   opponent whose shopping logic was broken. If a finding surprises you, check
   what produced it before you act on it.
3. **Tell him when he's wrong, and show your working.** He would rather hear
   "that measured at 84% and would break the game" than have you build it
   politely. He will also tell *you* when you are wrong, and in this project he
   has already been right once about something important.
4. **Plain words.** If you use a term, make sure it names something in the game
   today.
5. **Solo and versus take the same board changes.** `components/MatchScreen.tsx`
   is the battle for both `/solo/` and `/versus/` (`app/match/page.tsx`). A
   rules, HUD, dice, or phone-layout fix that only lands in one mode is unfinished.
   If a lock or tap lives in `lib/useMatch.ts`, update `useSoloMatch` and
   `useRoomMatch` together. Cancel game is the exception: it is a versus room
   action, not a board change.
