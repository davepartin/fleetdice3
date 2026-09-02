# Fleet Dice online — the whole thing in plain words

This file is for the person who owns the game, not for a programmer. If online
play stops working, start here.

**Where things stand (2 September 2026)**

- The security rules **are deployed**. A re-deploy on 1 September reported
  "already up to date", which means the live rules already matched this repo.
  You only need to deploy again if `firestore.rules` changes.
- Two-player **has been played end to end** on two real devices against the real
  database — a whole match, start to victory screen.
- The project is on Firebase's **Blaze** (pay-as-you-go) plan with a $25 budget
  alert. That alert is a **warning email, not a cap** — it does not switch
  anything off. Real spending is pennies: roughly five cents for a hundred
  matches in a day, because the free allowance still applies underneath.
- Fleet Dice 1 and 2 were retired on 2 September. Their data and their section
  of the rules were **deliberately left in place** — see the warning below.

---

## ⚠️ READ THIS FIRST — the one way to break the family's games

Fleet Dice 1, Fleet Dice 2 and Fleet Dice 3 all share **one** Firebase project,
called `space-tribes`. That project has **one** set of security rules. There is
no such thing as "the Fleet Dice 3 rules" on Google's side.

So: **deploying `firestore.rules` replaces the rules for all three games at
once.**

`fleetdice3/firestore.rules` already contains the Fleet Dice 1 and 2 rules,
copied word for word, followed by the new Fleet Dice 3 rules. That is on
purpose. Deploy that whole file and nothing breaks.

If anyone ever deploys a file that has only the Fleet Dice 3 part in it, the
games your family plays today stop working **immediately and silently** — no
warning, no email, just "something went wrong" on their phones. The fix is to
deploy the full file again, but you have to know that's what happened.

**The rule of thumb:** never deploy a `firestore.rules` that does not have the
big `FLEET DICE 1 AND 2 — LIVE. COPIED VERBATIM.` banner inside it. Open the
file and look for that line before you deploy.

---

## Deploying the rules

**You should not normally need to do this.** They are already live. Do it only
after `firestore.rules` has actually changed.

One line, run from inside the game's folder:

```bash
npx -y firebase-tools@latest deploy --only firestore:rules --project space-tribes
```

The first time it will ask you to sign in with the Google account that owns the
`space-tribes` project. It prints something like `+ Deploy complete!` when it
worked.

You only need to run this when `firestore.rules` has actually changed. Putting a
new version of the website online (GitHub Pages) does **not** update the rules,
and updating the rules does **not** update the website. They are two separate
things.

If the command complains that it can't find a project, add a small file called
`.firebaserc` next to `firestore.rules` containing:

```json
{ "projects": { "default": "space-tribes" } }
```

and a `firebase.json` containing:

```json
{ "firestore": { "rules": "firestore.rules" } }
```

(Neither of those files holds a secret. Never put a downloaded service-account
key, a `firebase-debug.log`, or anything from a `.env` file into this folder.)

---

## If joining games suddenly breaks for everyone

Go to <https://console.firebase.google.com>, pick the **space-tribes** project,
and check these three things in order. It is nearly always one of them.

**1. Anonymous sign-in is still switched on.**
`Build → Authentication → Sign-in method`. There should be a row called
**Anonymous** marked *Enabled*. Fleet Dice never asks anyone for a password or
an email address — every player is an anonymous guest — so if this is off,
nobody anywhere can play online. If it got switched off, switch it on.

**2. The website's address is on the approved list.**
`Build → Authentication → Settings → Authorised domains`. The list must include
the address people actually type, for example `davepartin.github.io`, plus
`localhost` for testing. If you move the game to a new web address, add it here
or sign-in will refuse it.

**3. The rules are actually deployed.**
`Build → Firestore Database → Rules`. Scroll the text shown there. You should
see blocks for `codes`, `matches`, `liveBattles`, `battleResults` (the older
games) **and** `fd3Codes`, `fd3Matches`, `fd3Live`, `fd3Results` (this game). If
the `fd3` ones are missing, the rules were never deployed — run the deploy
command above.

A fourth thing, rarely: `Build → Firestore Database → Usage`. The free tier is
generous but not infinite. If reads or writes are maxed out, everything looks
"broken" until the next day.

---

## What is stored, and why

Everything lives in Firestore, the project's database. Fleet Dice 3 keeps to its
own four collections so it can never tread on the older games.

| Collection | What one entry is | Who can see it |
| --- | --- | --- |
| `fd3Matches` | The entire game: both fleets, both sets of dice, health, energy, whose turn is where. One entry per game. | Only the two commanders in it (plus anyone holding the link while it is still waiting for a second player). |
| `fd3Codes` | A four-digit code, e.g. `0525`, pointing at a game — plus who is sitting in it. Nothing about the game itself. | Anyone signed in, if they know the four digits. They cannot list them all. |
| `fd3Live` | The "now on the field" board on the home page: two names, the round number, and a timestamp. | Everybody. |
| `fd3Results` | Finished games: winner's name, loser's name, when. | Everybody. Can never be edited or deleted once written. |

Two of those need a word of explanation:

**Why `fd3Codes` exists at all.** A game in progress is private to its two
players — that is the point. But when a third person types the code, we still
want to tell them *"that room already has two commanders"* rather than a
frightening error. We can't read the private game to find that out. So the
seating information is copied onto the tiny code entry, which anyone may read.
It holds no dice, no health, no names.

**Why `fd3Live` has a timestamp.** While someone is sat on the waiting screen,
their phone quietly says "still here" every few minutes. If a host closes their
phone and never comes back, that stops, and after about **45 minutes** the room
stops being shown on the home page. This stops the board filling up with empty
rooms nobody can join.

Fleet Dice 3 never writes to `codes`, `matches`, `liveBattles` or
`battleResults`. Those belong to Fleet Dice 1 and 2.

---

## The thing that confuses everybody

**The host stays. The guest joins.**

When you tap *Create game* you are **already in the game**. Stay on that screen.
The link and the four digits are for your friend, not for you.

If you open your own invite link in a second tab, that tab is **a different
person** as far as the game is concerned. Every browser tab that has never
played before gets its own anonymous identity, the same way a new phone would.
So your second tab walks up to a room that already has two people in it and is
turned away — correctly, but confusingly, because it looks like *you* being
locked out of *your own game*.

Same thing applies to: opening the game in a different browser, using a private
/ incognito window, or clearing your browsing data. Each of those makes a new
player. There is no account to log back in to, by design — nobody has to sign up
for anything.

**If it happens:** close the extra tab and go back to the original one. The game
is still there.

---

## What each message means, and what to do

Messages players can see, and the honest translation:

> **"That room already has two commanders. If you started this game, go back to
> the tab you created it in and carry on there — a new tab counts as a different
> person, so it cannot take a seat."**

Exactly what it says. Nine times out of ten it is the host in a second tab; the
answer is to go back to the first tab. If it really is a third friend trying to
watch — sorry, Fleet Dice is two players.

> **"No game is using that four-digit code."**

Either a digit was mistyped, or the game has finished and the code has been
handed back for someone else to use. Ask for a fresh code.

> **"That room is not there any more."**

The host closed it, or it finished. Start a new game.

> **"That game has already finished."**

Somebody won, or somebody tapped Cancel. Nothing to rejoin.

> **"Tap Join game first — you have not taken a seat in that room yet."**

They followed a link into a room that is still waiting, but never actually
pressed the join button. Press it.

> **"You are not one of the two commanders in that room."**

Usually a bookmark or an old link opened on a different phone from the one that
played. Reopen it from *Your games* on the phone and browser you originally
used.

> **"Your phone looks offline."** / **"Sending your move is taking too long."**

Signal. The game does not lose anything — reconnect and reopen it from *Your
games*. Your rooms are remembered on the phone and are not thrown away just
because the connection dropped.

> **"Online play is switched off for this game right now. Ask the game's owner
> to turn Anonymous sign-in back on in Firebase."**

That is item **1** in the checklist above. Nobody can play online until it is
switched back on.

> **"This web address is not on the game's approved list."**

That is item **2** in the checklist above — *Authorised domains*.

> **"Online play is not switched on in this build."**

The copy of the game they are running was built without Firebase settings. Solo
play still works.

---

## Things worth knowing

- **The four-digit codes get reused.** There are only 10,000 of them. When a
  game ends the code is handed back. A code written on a scrap of paper
  yesterday probably belongs to somebody else today.
- **One phone can have several games going at once.** Up to eight are kept on
  the *Your games* list, so a group of friends can run a small tournament and
  one person can be in two battles at the same time.
- **Nobody is ever waiting except at one moment.** Shopping, taking damage and
  starting your next roll all happen on your own phone at your own speed. The
  only time you wait for the other person is after you both lock in your
  rolls — the volley cannot resolve until both fleets have committed.
- **Nothing here costs money** at the sizes this game runs at, and there is
  nothing to cancel.
- **There is no personal data in any of this.** No email addresses, no
  passwords, no location. A player is a random string and whatever name they
  typed.

---

## For whoever maintains the code

- `lib/firebase.ts` — the project settings and anonymous sign-in. Every setting
  can be overridden with a `NEXT_PUBLIC_FIREBASE_*` environment variable; the
  defaults in the file are the `space-tribes` ones. The API key in there is a
  public identifier, not a secret — the security rules are what protect the
  data.
- `lib/rooms.ts` — create / join / play / watch / cancel, the Continue list, the
  public boards and the heartbeat. It never invents game rules; it reads the
  match, runs `applyAction` from `lib/engine.ts` inside a transaction, and
  writes it back.
- `firestore.rules` — the Fleet Dice 1/2 rules verbatim, then the `fd3` rules.
  Read the comments before loosening anything: a permissions complaint from a
  player has historically meant a confused host, not a rule that is too tight.
- The invite link is `/join/?id=…&code=0525`. Whatever page answers that route
  should call `joinRoomByCode` or `joinRoomById`.
