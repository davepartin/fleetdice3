# Fleet Dice 3

**Build the fleet. Break the flagship.**

A two-player dice battle you play in a browser. Every ship is a die — a d4, d6,
d8 or d10 — sitting in a three-by-three grid. In the middle is your flagship: a
d6 carrying all 60 of your health, which never fights. The first flagship to
reach zero loses.

This is the third version. Fleet Dice 1 and 2 live in
[`spacetribe-dice`](https://github.com/davepartin/spacetribe-dice) and are
untouched by anything here.

---

## Getting it online, once

You only do this part once. It takes about five minutes.

**1. Make an empty repository on GitHub** called exactly `fleetdice3`. Do not
let GitHub add a README, a licence or a `.gitignore` — it must be empty.

**2. Push this folder to it.** From inside the `fleetdice3` folder on your Mac:

```bash
git init
git add .
git commit -m "Fleet Dice 3"
git branch -M main
git remote add origin https://github.com/davepartin/fleetdice3.git
git push -u origin main
```

**3. Turn on GitHub Pages.** On the repository page go to **Settings → Pages**,
and under *Build and deployment* set **Source** to **GitHub Actions**. That's
the only setting.

Give it two or three minutes and the game is at:

**https://davepartin.github.io/fleetdice3/**

**4. Deploy the Firebase rules** — needed once, before two-player games work:

```bash
npx -y firebase-tools@latest deploy --only firestore:rules --project space-tribes
```

Read [`FIREBASE.md`](FIREBASE.md) before you run that. There is one way to break
Fleet Dice 1 and 2 with it, and that file explains how to avoid it.

After that, every time you push to `main` the site rebuilds itself. Nothing else
to do.

---

## Playing it

| Where | What |
| --- | --- |
| `/` | Home. Your name, solo, two-player, and a box for a friend's code. |
| `/solo/` | Pick a difficulty and fight the ship's computer. |
| `/versus/` | Opens a room. You get four numbers and a link to send. |
| `/join/` | Where an invite link lands. |
| `/match/` | The battle itself. |

**Two-player works like Jackbox.** You create a room, read your friend the four
numbers or send them the link, and the moment they sit down your screen turns
into the battle. You can have as many rooms running as you like — a group of
friends can all be playing different matches at the same time.

**One thing to remember:** if you created the room, *stay on your own screen*.
Opening your own invite link in a second tab makes you look like a third
person to the room, and a room only has two seats.

---

## Running it on your own Mac

Node 22 or newer, and pnpm.

```bash
pnpm install
pnpm dev
```

Then open `http://localhost:3000/fleetdice3/`.

For the root path instead:

```bash
BASE_PATH= pnpm dev
```

Other useful commands:

```bash
pnpm test        # the rules, checked against themselves
pnpm sim         # what the numbers actually do, over thousands of matches
pnpm build       # the static site, into out/
```

---

## What changed from Fleet Dice 2

The rules are the same game. What changed is the **shape of the board you start
with**, and it changed because of something a simulation found.

### Your three-in-a-row-down rule almost never fired

Not because the rule was wrong — because of where your four opening cells were.
They were the top-left corner of the board:

```
# # #     A row is possible. A column never is: there is no second
# F .     cell under any of the top three. Completing a column meant a
. . .     deliberate, specific purchase, and nothing told you that.
```

Measured across 250 matches, only **2.8% of commanders** ever saw a column pay
out in a whole match, and when it did it was around round nine.

Your four opening cells are now the four **around your flagship**:

```
. # .     One row and one column, both live from the very first roll,
# F #     both running through your flagship. Same four ships, same
. # .     price, same starting Energy.
```

Rows now fire in 9.0% of rounds and columns in 8.0% — a three-by-three grid that
finally treats both directions the same. **62% of commanders** now see a column
in a match, first one around round four. Every cell you buy after that is a
corner, and a corner opens whole new lines instead of finishing the one you have.

As a side effect the game got fairer: the gap between the best and worst
strategy fell from 17.8 points to **8.7**, because the wide cheap fleet no
longer owned the only line on the board.

### Levelling the flagship was a dead purchase

At 10 then 16 Energy, the same money spent on ships beat it 60/40 at level 2 and
78/22 at level 3, and the computer opponent bought one roughly once every
twenty-five matches. It now costs **5 then 8**, and both steps measure as an
even trade.

### Everything else is unchanged

The face table, the marks, the straight ladder, five in a row, ship prices, cell
prices, 60 health, and **three across for 5 Energy, three down for 10 Attack**.

The full working — including a correction where a measurement turned out to be
answering the wrong question, and the ideas that measured badly and were thrown
away — is in [`BALANCE.md`](BALANCE.md).

---

## How it is put together

| Folder | What is in it |
| --- | --- |
| `lib/engine.ts` | The rules. No React, no browser. Every number is in `TUNING` at the top. |
| `lib/ai.ts` | The opponent's brain — and the yardstick the simulations play with. |
| `lib/reference.ts` | Every word and number the How to Play screen shows, generated from the engine so it can never drift from the rules. |
| `lib/rooms.ts` | Two-player rooms: creating, joining, watching, cancelling. |
| `lib/three/` | The 3D: the dice themselves, the deck they sit on, the lighting, the effects. |
| `lib/audio.ts` | Every sound, made from scratch in the browser. No audio files. |
| `components/` | The screens. |
| `sim/` | The measuring stick. Nothing goes in on a hunch. |
| `tests/` | The rules, checked against themselves. |
| `tools/` | Scripts that play the real game in a real browser and screenshot every screen. |

### The house rules

1. **Measure before you believe.** Almost every design instinct on this project
   has been wrong at least once. `sim/` exists so a change can be argued with
   numbers rather than opinions.
2. **Every ledger row sums to its total.** If the round report says you took 10,
   the rows above it add to 10. `tests/` checks that on every round of a real
   match.
3. **The help screen is generated from the engine.** Change a price and the How
   to Play screen changes with it. It cannot go stale.
4. **A face does one thing, automatically.** No menus on a die. The choosing in
   this game lives in which dice you send back.
