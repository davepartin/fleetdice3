# Handing Fleet Dice 3 to another assistant

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
| 3 | Build the FD3 rules engine | **Done** — `lib/engine.ts`, 17 tests passing |
| 4 | Simulate and retune the balance | **Done** — see `BALANCE.md`, including a correction |
| 5 | AAA 3D dice and battlefield | **Done, not finished** — see below |
| 6 | HUD, VFX and audio | **Built. Audio never heard by a human** |
| 7 | Solo mode and versus rooms | **Solo done and tested. Versus never ran against a live server** |
| 8 | One-button How to Play | **Done** — generated from the engine, cannot go stale |
| 9 | Harsh-critic screenshot loop | **Passed for solo phone** — 390×844 and 402×874 |
| 10 | Playtest and verify end to end | **Solo yes at both phone sizes. Versus no** |

### Item 5, honestly

The dice are real polyhedra built face by face, including a correctly
proportioned pentagonal trapezohedron for the d10 — the flat-kite condition
matters and getting it wrong buckles the faces. Materials are polished resin,
not metal (a metal die in a dark room renders black). The deck is a lit,
shadow-receiving slab with a painted texture. Post chain is bloom, vignette,
grain and a little chromatic aberration, with three quality tiers and a
frame-time watchdog that drops a tier rather than stuttering.

What it is **not**: a finished art pass. The solo battlefield now frames itself
inside the actual phone pixels left by the HUD, with large readable dice and a
compact totals dock at 390×844 and 402×874. That proven phone layout is shared
with versus, but versus still needs a live two-device check. Victory and defeat
are still quiet.

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
pnpm dev                 # http://localhost:3000/fleetdice3/
BASE_PATH= pnpm dev      # or at the root path

pnpm test                # 17 engine tests
pnpm build               # static export into out/
node sim/simulate.mjs    # the measurement harness
node sim/columns.mjs 250 # does the formation rule fire?
node tools/playtest.mjs 6 phone   # plays the real game in a real browser
```

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
verbatim, followed by the new `fd3*` ones. Deploy the whole file or the games
the owner's family plays today stop working, silently. `FIREBASE.md` has the
detail. Verified byte-for-byte against the live file on 20 August 2026.

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

## Do these in this order

1. **Deploy the Firestore rules**, then test two-player on two real devices.
   Every versus code path is unexercised. This is the largest unknown in the
   project by a wide margin. The game and its GitHub Pages site are already
   online.
2. **Let him play four or five solo matches and write down what felt off.**
   Then polish against that list, not against a screenshot.

Everything else worth knowing — known rough edges, open balance questions, and
the measuring lesson from the first session — is in `NEXT.md`.

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
