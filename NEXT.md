# Where this stopped, and what is left

Written at the end of the first build session and updated after the first live
solo-polish pass. If you hand this project to an assistant again, give it this
file and `README.md` first.

---

## What works right now

- **Solo plays start to finish.** Shipyard, roll, reroll, straights, formations,
  bracing, the round report, victory and defeat. Verified by a script that
  plays the real game in a real browser and screenshots every screen.
- **The rules are tested.** 17 tests, including "every ledger row sums to its
  total" checked on every round of a real match, and "a match always ends".
- **The numbers are measured.** `sim/` plays thousands of matches. See
  `BALANCE.md`.
- **The 3D is real.** Actual polyhedra, not pictures of dice — including a
  correctly proportioned pentagonal trapezohedron for the d10.
- **The help screen cannot go stale.** It is generated from the engine.

## What is written but never tested against a live server

**Two-player rooms.** All of `lib/rooms.ts`, the create / join / invite screens
and the security rules are written, and they are a close port of the Fleet Dice
2 code that already works. But the machine that built them had no route to
Firebase, so not one of those code paths has ever spoken to Firestore.

**This is the first thing to do.** The site is online; deploy the rules, then:

1. On your phone, open the site and tap **Play a friend**. You should get four
   numbers.
2. On a different device (not another tab on the same phone — that counts as a
   different person), type those four numbers on the home page.
3. The host's screen should turn into the battle on its own.
4. Play a round on both. Both sides must lock in before the volley resolves.
5. Try starting a second room while the first is still going.

If something breaks, the message on screen is meant to be readable. Send it
along with which step it happened on.

---

## Known rough edges

- **Victory and defeat are quiet.** The result card appears and the losing
  flagship breaks, but it does not feel like the end of a battle yet.
- **Sound has never been heard.** Every cue is generated in the browser and none
  of it has been listened to by a human. Levels and pitches are guesses.
- **The straight tier chooser only appears when the run is longer than five.**
  That is correct, but it means most players will never see it, and may not know
  it exists.
- **`tools/dbg.mjs`** is a scratch probe. Delete it whenever.
- **`_to_delete/`** in your fleetdice3 folder holds the zips used to move the
  code onto your Mac. Safe to throw away — the sandbox is not allowed to delete
  files on your machine, so it left them there instead.

---

## Balance questions still open

- **The Enemy still under-buys cells on most plans.** Capital still opens about
  0.1 a match. Formation opens about 1.7. A person who wants the corner lines
  will open more than Capital ever will.
- **The Enemy now hunts live lines.** It spots a row or column that is one face
  away, spends spare Energy sending the odd die back, and parks a new hull on
  the bay that already has ships on its line. Formation and Wolfpack shop for
  that; Capital still upgrades instead. Play Solo → Formation to see it.
  Measured at Captain, Formation, 80 matches: a column paid in 11% of rounds,
  and 72% of commanders saw at least one. The roll screen now also tells *you*
  when you are one face away, using the same prize the engine pays.
- **Difficulty has never been measured.** Cadet, Captain and Admiral differ in
  how many reroll options they weigh, but nobody has checked that Admiral
  actually beats Cadet.
- **Straights are now a mid-game reward.** At four cells they fire in about 10%
  of rounds, rising as you buy cells, because a straight needs five different
  numbers and four ships plus a flagship is exactly five dice. That feels right
  on paper — a run should get easier as your fleet grows — but it has not been
  played.
- **Flagship levels are bought about once every two matches** even after the
  price came down from 10/16 to 5/8. That may still be too rare.
- **The measuring lesson from this session.** A number is only as good as the
  brain that produced it. The first balance pass measured 10,042 rounds against
  an opponent whose shopping logic was broken, and drew a confident conclusion
  from it. If a finding surprises you, check what produced it before you act.

## The three things to do next, in order

1. **Test two-player for real.** The game is online, but the Firestore rules
   still need the guarded deployment described in `FIREBASE.md` first.
2. **Play four or five matches yourself and write down what felt off.** Not what
   looked wrong — what *felt* wrong. That list is worth more than any amount of
   polish chosen from a screenshot.
3. **Then polish**, in whatever order that list says.
