# Fleet Dice 3 — balance notes

> ## Correction, written after the owner pushed back
>
> An earlier version of this file said the three-in-a-row-down prize was
> **impossible** to collect. That was wrong, and the owner was right to
> challenge it.
>
> A column was always a purchase away. Cell 2 and the flagship sit in the middle
> column from the first roll, so buying the cell below completes it. What the
> measurement actually showed was that **nobody ever did** — 0 of 10,042 rounds
> — and the reason was two things stacked on top of each other:
>
> 1. The opening four cells were the **top-left corner** of the board, which can
>    form a row but geometrically cannot form a column. So a column needed a
>    deliberate, specific purchase, and nothing in the game said so.
> 2. The computer opponent, which produced every one of those 10,042 rounds,
>    almost never bought a cell — its shopping logic divided value by price, so
>    a 2⚡ upgrade always beat a 9⚡ cell. That brain was fixed *afterwards*,
>    which means the number that justified changing the starting cells had been
>    measured on a version of the game nobody plays.
>
> The lesson is the project's own house rule, aimed back at us: a measurement is
> only as good as the thing doing the measuring. Re-measured with the fixed
> brain, four corner cells still gave a column to only **2.8%** of commanders
> across a whole match — real, but for a different reason than first claimed.
>
> **The fix that shipped is not more cells. It is a different shape.** See §0.

---


Newest finding first. Every number here comes from playing the real engine, not
from arithmetic on paper. Where I am guessing, I say so.

Two numbers changed in the end:

| in `TUNING` | was | now |
| --- | --- | --- |
| `startSlots` | 4 | **6** |
| `flagCost` | `{1: 10, 2: 16}` | **`{1: 5, 2: 8}`** |

Nothing else moved. I tested a lot more than that and threw most of it away —
the discarded ideas are at the bottom, and they are worth reading.

---

## Read this before you ship

**There is a bug in `lib/ai.ts` that you have to fix first.** I was not allowed
to touch that file, so I can only tell you about it.

The Enemy sometimes asks to pay for a reroll it cannot afford, the engine
refuses, and the Enemy has no other move. It then sits there forever. The match
never ends.

The line is in `nextActions`:

```ts
const paidWorthIt = !free && player.energy >= 6 && pressure > 0.35;
```

It checks that the commander has at least 6 Energy, then picks the dice to send
back — and a paid reroll costs one Energy *per die*. With seven or eight dice on
the board it asks for 7 or 8 and only has 6. The fix is to trim the reroll to
what the bank can pay, or to check `player.energy >= reroll.length` after
choosing.

How often it happens, out of 6000 matches each:

| starting cells | matches that froze |
| --- | --- |
| 4 (the old setting) | 0 |
| 5 | 2 |
| 6 (the new setting) | 11 |

It only bites fleets of six ships or more, which is why nobody has seen it. My
`startSlots` change makes fleets that big from round one, so it takes the rate
from zero to about 1 match in 550. That is a freeze, and a freeze is worse than
any balance problem, so please make that one-line change at the same time.

If you cannot change code today, set `startSlots` back to 4 and ship only the
flagship price. You lose the biggest win but you take no risk.

---

## 0. The opening shape, not the opening count

The four cells a fleet starts with used to be slots 0–3, which is the top-left
corner of the board:

```
# # #     A row is possible. A column never is: there is no second cell
# F .     under any of the top three. The 10 Attack prize could not be
. . .     collected from this shape, however long the match ran.
```

They are now the four cells **around the flagship**:

```
. # .     One row and one column, both live from the very first roll,
# F #     both running through the flagship. Same four ships, same
. # .     price, same starting Energy.
```

Every cell bought after that is a corner, and a corner opens whole new lines
rather than making the first one possible. That is what spending Energy on a
cell should feel like.

Measured over 250 matches at each setting, with the fixed brain:

| Opening shape | Row fires | Column fires | Saw a column all match | Straights | Length |
| --- | ---: | ---: | ---: | ---: | ---: |
| Top-left four (Fleet Dice 2) | 7.8% | **0.3%** | 2.8% | 7.1% | 12.3 |
| Six, top-left | 10.2% | 5.8% | 51.2% | 22.4% | 11.9 |
| **Four around the flagship** | **9.0%** | **8.0%** | **61.8%** | 10.2% | 11.7 |

Rows at 9.0% and columns at 8.0% is the point. A three-by-three grid should not
favour one direction over the other, and for two versions it silently did.

Plan spread came down from 17.8 points to **8.7 ±3.2** as a side effect, because
the wide cheap fleet no longer had the only line on the board.

### What this un-did

`slotCostOffset` was briefly raised from 2 to 4 to hold back the wide fleet.
With the new shape, offsets of 2, 3 and 4 measured at 15.8, 12.5 and 15.1 points
of spread — and two runs of the *same* setting differed by more than that. The
price is no longer deciding anything, so it went back to Fleet Dice 2's number.
Cheaper cells mean more cells bought (1.21 a commander, up from 0.65), which
means more lines on the board, which is the whole point.

`startSlots` went back to **4**. Six was only ever a way of buying a column with
extra ships.

---

## 1. What the first measurement found (superseded by §0)

This is the big one, and it is not what either of us expected.

**Three matching down a column pays 10 Attack. In 10,042 rounds of real matches
it happened zero times.**

Not rarely. Zero.

Here is why. A commander starts with four cells open, and they are always the
first four: the top row and the first cell of the middle row. The three columns
of the board need the bottom-row cells, and those start locked. So a column
cannot be completed. It is not unlikely — it is impossible.

The commander could of course open more cells. But the Enemy brain almost never
does (see finding 3), so it finishes a match with 4.3 cells open on average. The
column prize is decoration.

The straight is nearly as bad. With four ships you have five dice including the
flagship, and you need five different numbers in a row. It landed in 5.1% of
rounds — one round in twenty.

### What I changed

`startSlots` from 4 to 6. A commander now starts with six cells and six d4s
instead of four and four. Both sides get it, so nobody gains an edge.

Six is the smallest number that works. Cells open in order, so:

- 4 cells → one row possible, no column
- 5 cells → two rows possible, still no column
- **6 cells → two rows and the first column**

Five does not fix it. I measured that too.

### Before and after

Every submitted round of 600 real matches, about 14,000 rounds each:

| starting cells | rounds seen | avg ships | a row fires | a column fires | either | a straight fires |
| --- | --- | --- | --- | --- | --- | --- |
| 4 (old) | 15,060 | 4.2 | 5.9% | **0.0%** | 5.9% | 5.1% |
| 5 | 14,728 | 5.2 | 10.3% | 0.1% | 10.4% | 11.5% |
| **6 (new)** | 14,273 | 6.1 | 9.8% | **4.7%** | 13.0% | 18.3% |

A special rule that fires in one round of eight is a special rule. Your own note
says anything past about 75% stops being a bonus; 13% is comfortably the other
side of that.

### What it costs

Nothing measurable. Match length is unchanged:

| | mean rounds | median | under 7 rounds | 10–15 rounds | over 15 | hit the 40-round backstop |
| --- | --- | --- | --- | --- | --- | --- |
| before | 11.8 ±0.11 | 12 | 5.9% | 67.0% | 11.3% | 0 |
| after | 11.8 ±0.11 | 12 | 6.1% | 67.0% | 10.7% | 0 |

3000 matches each. That is as close to "no change" as this instrument can read.

I checked HP 65, 70, 75, 80 and 90 as well, in case a wider board wanted a
longer match. It does not. 60 is right. Details in the discard pile.

---

## 2. Levelling the flagship was a dead purchase

The test: hand one commander the thing. Hand the other commander exactly the
Energy it costs, to spend however they like. Play a full match. 50% means the
price is right.

At the old price of 10 then 16:

| what one side was handed | Energy the other side got | it won |
| --- | --- | --- |
| flagship level 2 | 10 | **35.2% ±3.8** |
| flagship level 3 | 26 | **20.9% ±3.3** |

600 matches a row. Level 3 was not merely weak — a commander who spent 26 Energy
climbing the flagship lost four matches in five to one who did nothing clever
with the same money.

The Enemy brain had already worked this out. Across 300 matches it bought a
flagship level **0.04 times per commander**. Average flagship level at the end of
a match: **1.04**. The "Command" plan, whose whole description is "pours Energy
into the flagship", was pouring nothing into anything.

### What I changed

`flagCost` from `{1: 10, 2: 16}` to `{1: 5, 2: 8}`. The bonus ladder stays at
2 / 3 / 4 — I tried moving that instead and it went wrong in a way I explain
below.

I priced it on two different boards, because the flagship boosts matching ships
and is therefore worth more the more ships you own. "Narrow" is the ordinary
starting board. "Wide" is all eight cells filled. Side B always spent the same
Energy on upgrades, which is the strongest thing to spend it on.

| bonus | costs | level 2, narrow | level 3, narrow | level 2, wide | level 3, wide |
| --- | --- | --- | --- | --- | --- |
| 2/3/4 | 10 + 16 (old) | 40.5% | **19.9%** | 43.4% | 33.5% |
| 2/3/4 | 6 + 9 | 51.6% | 43.4% | 53.5% | 49.0% |
| **2/3/4** | **5 + 8 (new)** | **56.6%** | **49.3%** | **52.0%** | **54.1%** |
| 2/3/4 | 4 + 7 | 57.5% | 50.2% | 55.0% | 57.0% |

800 matches a row, 95% confidence ±3.4 points. At 5 and 8 all four readings sit
within about six points of an even trade. At 10 and 16 the level-3 climb was
thirty points under.

Five, not six, for one extra reason: five is the price at which the brain
actually buys it. Flagship levels bought per commander went from **0.04 to
0.59**, average flagship level at the end of a match from **1.04 to 1.62**, and
Command now buys one inside the first three rounds. A strategy that used to be a
label is now a strategy.

### Fair warning

This change is nearly invisible in Enemy-vs-Enemy matches, because the brain
still prefers upgrades to almost everything. It matters for people.

---

## 3. The d4 → d6 "trap" is not real, and I know why it looked real

You measured the d4 fleet at 59.8 value and the d6 fleet at 61.7, and concluded
that sixteen Energy of upgrades bought almost nothing.

I reproduced your table exactly:

```
fleet    cost  attack  shields  energy  repair  direct  straight  formation  value  per ⚡
8 × d4     32    25.4      8.4    10.9     7.0    3.81     10.7%      66.3%   59.7  1.865
8 × d6     48    32.2     10.0     6.9     4.6    5.22     49.1%      34.5%   61.8  1.287
8 × d8     72    39.5     14.2     5.9     4.8    6.65     51.4%      20.0%   73.1  1.016
8 × d10   104    45.1     17.3     4.9     5.7    9.35     35.9%      12.6%   84.7  0.815
```

So the arithmetic is right. The conclusion is not.

**`value` is not a win rate. It is the AI's opinion of a roll.** It lives in
`WEIGHTS` in `lib/ai.ts` and it prices one point of Energy at 1.45 points of
damage. The d4 fleet earns 10.9 Energy a round to the d6 fleet's 6.9, so that
one weight hands the d4 about six free points of "value" every round. Take the
opinion out and fight instead, and the picture reverses completely.

Eight ships of one size against the same eight one size bigger. No shopping, so
the only thing being measured is what the hulls do:

| step | Energy for all 8 | Energy each | the upgraded fleet wins | 95% ci | win points per Energy |
| --- | --- | --- | --- | --- | --- |
| 8 × d4 → 8 × d6 | 16 | 2 | **93.5%** | ±2.0 | 2.72 |
| 8 × d6 → 8 × d8 | 24 | 3 | **97.5%** | ±1.2 | 1.98 |
| 8 × d8 → 8 × d10 | 32 | 4 | **95.5%** | ±1.7 | 1.42 |

600 matches a step. Far from being four times worse than the later steps, the
**first upgrade is the best value in the ladder**, and it is the later ones that
tail off — which is exactly what you want, because they are the endgame.

And with the shop open, upgrading is an honest trade against holding the money:

| what one side was handed | Energy the other got | it won | verdict |
| --- | --- | --- | --- |
| 1 upgrade d4 → d6 | 2 | 52.4% ±3.5 | fair |
| 2 upgrades d4 → d6 | 4 | 48.8% ±3.5 | fair |
| 4 upgrades d4 → d6 | 8 | 53.3% ±3.5 | fair |
| 4 upgrades d4 → d8 | 20 | 60.4% ±3.4 | good |
| 4 upgrades d4 → d10 | 36 | 66.0% ±3.3 | good |

800 matches a row. No rung is a trap. **I changed nothing here.**

### To stop this happening again

I added `node sim/simulate.mjs ladder`, which answers "is each upgrade worth its
Energy" by fighting rather than by opinion, and I put a warning under the
`output` table saying what the `value` column really is. If a future table makes
a purchase look bad, fight it before you believe it.

The deeper fix, which I could not make: `WEIGHTS.energy` is 1.45 and it should
probably be nearer 1.0. That is in `lib/ai.ts`.

---

## 4. The d4 swarm formation rate is 66%, and it does not matter

Confirmed, almost to the decimal. Eight d4s hit a row or a column in **66.3%**
of rounds, over 2400 rounds.

But two things take the sting out of it.

**It is worth less than it looks.** For all that it fires two rounds in three,
the row and column prizes are only **16.0%** of what an eight-d4 fleet produces.
Turning the prizes off entirely drops that fleet from 59.4 value to 51.4.

| fleet | cost | a line fires | Energy from rows | Attack from columns | share of the fleet's whole output |
| --- | --- | --- | --- | --- | --- |
| 8 × d4 | 32 | 67.0% | 2.7 | 5.7 | 16.0% |
| 8 × d6 | 48 | 35.1% | 1.1 | 2.4 | 6.5% |
| 8 × d8 | 72 | 19.1% | 0.5 | 1.1 | 2.6% |
| 8 × d10 | 104 | 13.4% | 0.4 | 0.7 | 1.5% |
| 6 × d4 | 24 | 45.0% | 1.8 | 2.2 | 11.0% |
| 4 × d4 | 16 | 25.1% | 1.3 | 0.0 | 6.6% |

**And nobody builds it.** An eight-d4 board costs 32 Energy in hulls plus 19 in
cells. In real matches the average commander finishes with six ships of which
0.7% are still d4s — 91% are d8s and d10s. The eight-d4 swarm is a shape on a
spreadsheet, not a fleet anyone fields.

The realistic worry is the six-d4 board you get at the start now, at 45.0%.
That is under your 75% line, and it fades within a few rounds as people upgrade.

**I changed nothing here.** Your 5 Energy and 10 Attack stay exactly as they are.
I sweep them in `node sim/sweep.mjs lines` if you ever want to revisit it.

---

## 5. A strategy the Enemy cannot see — and how it got fixed by accident

A flagship showing 1 is the Reactor: your income goes up by 2 a round for the
rest of the match, up to 6.

The brain never chases it, because it scores only the round in front of it and
the Reactor pays later. Over 300 matches the flagship showed a 1 in 6.6% of
rounds — *less* than the 16.7% you would get by not caring — and average income
at the end of a match was 1.67 a round against a cap of 6.

So I built a commander who does chase it: it throws the flagship die back
whenever it is not a 1, and spends the Flagship Token to step onto one.

| | the chaser's win rate |
| --- | --- |
| against the old settings | **67.6% ±4.1** |
| against the new settings | **46.4% ±3.5** |

800 matches. That was a genuinely dominant line that no simulated match would
ever have revealed, and widening the starting board closed it on its own. On a
six-ship board the flagship's fighting faces — 5 for Shields, 6 for Attack —
boost twice as many ships, so throwing rounds away hunting a 1 finally costs
something real.

**I changed nothing about the Reactor itself.** `reactorCap` 6 and
`reactorOverflow` 2 stay. I did try moving them; see the discard pile.

Still true, and worth knowing: free income is enormously strong. A commander
handed +1 Energy a round for nothing wins 65.7% of matches; +2 a round wins
79.0% (±3.3, 600 matches). The Reactor is the strongest card in the deck. It is
now paid for in attention rather than free.

---

## 6. Opening a cell is still the best buy in the game

Same test as before: one side gets the thing, the other gets the Energy.

| what one side was handed | Energy the other got | it won | verdict |
| --- | --- | --- | --- |
| one more cell, left empty | 9 | 47.5% ±3.5 | fair |
| one more cell with a d4 in it | 13 | **81.3% ±2.7** | bargain |
| two more cells with d4s in them | 27 | **95.4% ±1.5** | bargain |

And with both sides spending the same 27 Energy on a shopping list of their own
choosing, then playing on normally:

| shopping list | Energy | overall win rate |
| --- | --- | --- |
| two more cells + two d4s | 27 | **85.4% ±1.5** |
| one more cell + a d6 + 4 upgrades | 23 | 65.5% ±2.1 |
| 4 upgrades to d8 | 20 | 38.0% ±2.1 |
| 2 upgrades to d10 | 18 | 39.8% ±2.1 |
| flagship level 2 + 4 upgrades | 13 | 36.0% ±2.1 |
| flagship level 3 | 13 | 33.6% ±2.1 |

400 matches a pairing. An extra die beats a bigger die, every time, at almost
any price. I chased down what a cell would have to cost to be an even trade:

| `slotCostOffset` | the last cells cost | a cell + a d4 wins |
| --- | --- | --- |
| **2 (current)** | 9, 10 | 70.5% ±3.6 |
| 4 | 11, 12 | 67.7% ±3.7 |
| 6 | 13, 14 | 59.2% ±3.9 |
| 12 | 19, 20 | 49.8% ±4.0 |
| 20 | 27, 28 | 30.8% ±3.7 |

600 matches a row. The honest price of a cell is somewhere around 19 or 20
Energy.

**I did not raise it, deliberately.** Here is the reasoning, and you may
disagree with it:

- At 19 Energy a cell, nobody ever finishes the board. The third row and two of
  the three columns would be permanently out of reach, and we have just spent
  finding 1 establishing that those rules barely fire as it is. Pricing cells
  honestly would delete the part of the game you like most.
- Widening the start already took the edge off. It was 90.0% before; it is 70.5%
  now, because there are only two cells left to buy and each extra die is worth
  less on a fuller board.
- The Enemy never buys a cell anyway, so raising the price would punish only
  human players — and only the ones who had worked out the right line.

If you decide you want the last two cells to be a real decision rather than a
formality, `slotCostOffset: 6` is the number I would try (13 and 14 a cell,
59.2%). I have not shipped it and I have not validated it in a match the Enemy
plays, because the Enemy does not play it.

---

## 7. Everything else I checked and left alone

**Match length is right.** 11.8 rounds on average, median 12, 67% of matches
land in the 10–15 band, **zero** hit the 40-round backstop in 3000 matches. HP 60
is correct. HP 70 shifts the mean to 12.5 and 75 to 12.7; both fine, neither
better. Not worth moving.

**No hull is dead.** Buying a fresh d4, d6, d8 or d10 into an open cell all come
out between 72% and 83% against the same Energy in upgrades — that is the cell
effect from finding 6, and every size shares it. Against each other, each size
beats the size below plus the cash difference by 54–56% (±4.0), and a d10 beats
a d4 plus 9 Energy by 62.2%. The price ladder 4 / 6 / 9 / 13 is internally
consistent, with the big hulls very slightly on the good side. Left alone.

**The straight ladder is fine.** A commander forced to always cash the longest
run wins 49.6% ±3.5 against one that plays it by ear. Forced to always take just
five, 52.0% ±3.5. Both are a coin flip, so nothing is upside down. Straights land
in 18.3% of real rounds now, and 37–59% for a full fleet depending on size.
Left alone.

**Three free rolls is right.** Two gives 13.1 rounds and drops straights to
47.4%; four gives 12.2 rounds and pushes them to 66.8%, which starts to feel
automatic. Three sits between. Left alone.

**Escalation is doing its job.** After round 8, +4 a round. Zero backstop hits in
every run I did. Left alone.

**The plans are close together.** 300 matches per pairing, 2400 per plan:

| plan | wins | 95% ci |
| --- | --- | --- |
| Balanced | 51.2% | ±2.0 |
| Wolfpack | 50.8% | ±2.0 |
| Command | 50.7% | ±2.0 |
| Formation | 48.8% | ±2.0 |
| Capital | 48.5% | ±2.0 |

**Spread best to worst: 2.7 points, and the confidence interval on that spread
is about ±2.8 points.** So the honest statement is "the five plans are within
about three points of each other, and I cannot tell them apart". Your limit is
12. Before my changes, on the same run size, it was **2.6 points**. No change
either way — which is the right answer, since neither of my changes favours a
plan.

Be careful with this statistic. At 150 matches a pairing the same baseline read
2.2 points, at 200 it read 4.6, and at 20 it read 11. "Best minus worst" across
five noisy numbers drifts upward as the sample shrinks. Use 300 a pairing.

---

## The discard pile

Things I tested and did not ship. Roughly as useful as the things I did.

**Raising the cell price.** Covered above. The honest price kills the board.

**Making the flagship bonus 2 / 4 / 6 instead of 2 / 3 / 4.** Tempting, because
it is a prettier ladder and it would have let me keep 10 and 16. It measured
well on its own (level 2 at 10 Energy went from 40.5% to about 52%), but the
flagship bonus is *also* the Reactor's step size. At 2/4/6 a level-3 flagship
gains 6 income from a single Reactor round and hits the cap instantly, which
makes the strategy from finding 5 worse, not better. Two things on one number.
Left it at 2/3/4.

**Cheaper big hulls, to make upgrading compete with widening.** Tried
4/6/8/11 and 4/5/7/9. A cell plus a d4 went from 90.0% to 88.3% to 85.8%. It
barely moved. The gap between an extra die and a bigger die is not a pricing
problem.

**Raising the d4's price to 5.** Same idea from the other end. Did not fix
anything either, and it makes the opening feel mean.

**Softening the small-face marks.** Every face on a d4 pays something — 1 gives
2 Energy, 2 gives 2 Direct, 3 repairs 3, 4 gives 1 Energy — and that is genuinely
why the d4 looks strong on paper. Marks are 48.7% of a d4 fleet's output against
34% for a d10. I was ready to flatten the ladders. Then finding 3 showed the d4
loses 93.5% of the time anyway, so there was nothing to fix. `energyOf`,
`repairOf` and `directOf` are untouched.

**Moving the row and column prizes.** Swept 3/6, 4/8, 5/12, 6/12 and 3/10. They
move the d4-to-d8 ratio by two or three points in either direction, which is not
enough to matter. Your 5 and 10 stay.

**Changing the straight ladder.** I was suspicious that a length-5 run paying
1.5 × the biggest ship in Energy was better than a length-6 run paying 2 ×
in Attack — a longer run paying less would be upside down. It is not: the brain
narrowed a run to a shorter one in **0 of 1646** chances, and the two forced
habits both land on a coin flip. `straightReward` is untouched.

**Shortening the match.** Escalating after round 6 at +6 gives a tight 10.1
rounds, range 6–14. Genuinely tidy. But 11.8 with a median of 12 is already
inside the target, and matches would have lost their late swing. Not worth it.

**More HP to pay for the wider board.** I thought six ships from round one would
mean faster kills and more blowouts, and an early measurement seemed to show
short matches going from 0.5% to 6.4%. It was an instrument artefact — the two
runs used different sets of plan pairings. Measured properly on the same
instrument, match length is identical before and after. A good reminder that the
harness can lie if you change two things at once.

**`startSlots: 5`.** Half a fix. Rows and straights come alive, columns stay at
0.1%, and the freeze bug still shows up twice in 6000. If you want the smallest
possible step it is available, but it does not solve the thing worth solving.

---

## Where the numbers came from

| command | what it answers |
| --- | --- |
| `node sim/simulate.mjs ladder 600` | is each upgrade worth its Energy, by fighting |
| `node sim/simulate.mjs matchups 300` | are the five plans close |
| `node sim/lab.mjs fair 800` | is each purchase fairly priced against cash |
| `node sim/lab.mjs spend 400` | same Energy, different shopping list |
| `node sim/lab.mjs arena 400` | fixed fleets, no shop, straight fight |
| `node sim/lab.mjs purchases 400` | what the brain actually buys, and when |
| `node sim/sweep.mjs live 600` | do rows, columns and straights fire in real matches |
| `node sim/sweep.mjs flag2 800` | flagship price, on a narrow and a wide board |
| `node sim/sweep.mjs slot 600` | what a cell would have to cost |
| `node sim/sweep.mjs chaser 800` | is Reactor-hunting a dominant strategy |
| `node sim/sweep.mjs hp 3000` | match length against flagship health |

`sim/sweep.mjs` changes `TUNING` in memory, measures, and puts it back, so you
can try a number without editing the engine. `START_SLOTS`, `FLAG_COST`,
`FLAG_GRID` and `HP_GRID` are environment variables it reads if you want a
different grid.

A caution about sample sizes. A win rate from 400 matches carries about ±5
points of uncertainty; from 800, about ±3.5. Two readings four points apart on
400 matches are the same reading. And a "spread best to worst" across five plans
is biased upward at small samples — at 20 matches a pairing it reported an
11-point spread where 300 matches a pairing reported 2.7. Do not read a spread
off a short run.

---

## What I could not settle

**The brain shops backwards, and I could not fix it from `TUNING`.** Across 400
matches, **94.7% of everything the Enemy buys is an upgrade**. It opens a cell
0.14 times per commander and buys a ship 0.11 times. Meanwhile finding 6 shows a
cell plus a hull is the strongest purchase in the game by roughly thirty win
points. The Enemy is playing the shop upside down.

The cause is one line in `buyScore` in `lib/ai.ts`:

```ts
return base / Math.max(1, buy.cost) + base * 0.06;
```

Dividing by cost means a cheap thing almost always outranks an expensive one. A
2-Energy upgrade scores 2.24; a 9-Energy cell scores 0.55. No price I could set
closes that — I worked out that a cell would have to cost under 2 Energy to win
the comparison, which is absurd. A human who works out that cells come first
will beat the Enemy comfortably, and there is nothing I can do about it in
numbers.

**Because of that, everything measured Enemy-against-Enemy is measuring a
narrower game than the one people will play.** The plan spread of 2.7 points is a
spread between five strategies that all end up buying the same thing. Take it as
"nothing is obviously broken", not as "the plans are genuinely different".

**The flagship reprice will not show up in your usual reports** for the same
reason. I priced it with a test that hands one side the level and the other side
the money, which sidesteps the brain's judgement. If you want to see it work,
run `node sim/lab.mjs fair 800` rather than `matchups`.

**I did not test difficulty settings.** Everything here is Captain. Cadet and
Admiral shop with the same broken preference, so I would expect the same
picture, but I have not measured it and I am guessing.

---

## Measurements from the AAA polish pass

Every number below is from a script in `sim/` that can be re-run. Caveat, now
historical: when these were measured, `lib/ai.ts` called `Math.random()` in four
places instead of the engine's seeded RNG, so runs involving any tier below
Expert were **not** bit-for-bit reproducible. The confidence intervals still
mean what they say, and the Expert numbers were never affected — at `greed: 1`
the coin flip short-circuits and was never reached. That is fixed (see
"Reproducibility" at the end of this file), so anything measured from now on
replays exactly; the Low and Medium numbers in the table below cannot be
reproduced bit-for-bit and would have to be re-measured to get a replayable
figure.

### Expert is a read plus ten health, and the read was not enough

`readOpponent` does the race arithmetic on the other fleet — what each side
lands per round from hulls, bays and flagship level, and therefore who finishes
whom first — using only what is on the board for both players. It never reads
unrevealed dice, and a test fails if that changes.

It did not carry the tier on its own, measured twice:

| Expert build | vs Hard |
| --- | --- |
| read wired into Energy and blocking, no health bonus | 47.8% ±4.0 |
| read also pricing every shipyard buy, no health bonus | 47.6% ±3.7 |
| read plus +10 starting health | **54.9% ±3.7** |

Grok's original Expert was +20 health and no read; its knob differences from
Hard contributed nothing measurable (48.2% ±3.3 with the health removed), and
Hard's brain wearing that +20 scored 66.6% — the whole tier was the health bar.
The read stays because it makes Expert *play* unlike Hard; the health, halved,
is what makes the rung real.

Ladder at 700 matches per pairing: Medium over Low 59.9%, Hard over Medium
52.7%, Expert over Hard 54.9% ±3.7.

### `samples` does nothing

Hard at `samples: 120` against the identical brain at 40: **51.4% ±3.3**. The
dial is saturated well below 40, and Hard and Expert pay three times the compute
per decision for it. `sim/difficulty-source.mjs` re-runs this.

### Nine d4s chasing one number: strong, fair, and not a solved game

| Matchup | Result |
| --- | --- |
| swarm vs a hand-written "big hulls and straights" player | swarm 89.5% ±3.0 |
| swarm vs the game's Expert | **swarm 27.3% ±5.0** |

The first row is close to meaningless on its own — that opponent landed 0.23
straights per match, so it never did what it existed to do. Against Expert the
swarm completes ~11 lines a match to Expert's 2.5 **and still loses**, because a
d4 caps at 4: between lines it produces almost nothing and blocks four at a
time. Lines are a bonus, not a win condition.

### What the tiers actually build

200 matches per tier, both sides the same tier:

| tier | straights/cmdr | lines/cmdr | ships | rounds | final fleet mix |
| --- | --- | --- | --- | --- | --- |
| low | 0.56 | 1.88 | 5.03 | 13.2 | d4 2% · d6 15% · d8 44% · d10 39% |
| medium | 1.15 | 2.46 | 5.14 | 11.7 | d4 4% · d6 49% · d8 39% · d10 7% |
| hard | 1.60 | 2.87 | 5.28 | 11.5 | d4 7% · d6 57% · d8 30% · d10 5% |
| expert | 1.76 | 2.92 | 5.37 | 11.5 | d4 7% · d6 56% · d8 31% · d10 6% |

Two open questions sit in that table. **d10 looks mispriced**: the best tier
buys the fewest and the worst tier buys the most, so at 13 Energy the biggest
hull is what weak play looks like. And **straights barely happen** — under twice
a match even for Expert, needing five consecutive numbers from a fleet averaging
five dice, for a mechanic with its own chart in How to Play.

### Repair, and the order a round resolves in

Damage and repair land in one step (`before - damage + repair` in
`settlePlayer`), so repair can save a flagship that damage alone would destroy,
and healing past the maximum raises the maximum. Zero is dead, not alive.

Measured over 500 matches: repair turns a lethal round survivable in 1.3% of
rounds — but **133 of those 136 saves happen in round 5 or later**. Repair does
almost nothing early, when nothing is lethal yet, and is the entire late-game
lifeline. Moving it after the death check would delete those saves and make
matches end sooner and more abruptly.

### Waiting, in versus

Before the fix, `handleContinue` refused to leave the report screen while the
other commander was still choosing blockers. Over 300 matches that stranded a
player on **46.4% of resolved rounds** — the rounds where their own volley left
them nothing to block. Both fleets roll at once; only the volley and the victory
check need both players.

---

## Reproducibility — one bag of dice, not two

*Fixed 1 September 2026. No balance number moved.*

The engine's randomness has always been injectable — `setRng(makeRng(seed))` —
so a simulation could be replayed exactly. It could not. `lib/ai.ts` called
`Math.random()` in four places, which no seed can reach:

| line | what the coin flip decides |
| --- | --- |
| `ai.ts:403` | whether a weaker tier takes the second-best reroll instead of the best |
| `ai.ts:404` | which worse reroll it takes |
| `ai.ts:661` | whether a weaker tier buys the second-best thing in the shipyard |
| `ai.ts:699` | which of the five plans a fresh brain is given |

So the dice repeated and the opponent's decisions did not. Demonstrated by
running `node sim/straights.mjs 60` twice, same seeds both times:

| tier | run 1 straights/cmdr | run 2 | agrees? |
| --- | ---: | ---: | --- |
| low | 0.63 | 0.63 | lines/cmdr 2.10 → 1.82, **no** |
| medium | 1.40 | 1.26 | **no** |
| hard | 1.42 | 1.42 | yes |
| expert | 1.73 | 1.73 | yes |

The split is the diagnosis. `greed` is 0.5 at Low and 0.85 at Medium, but
exactly **1** at Hard and Expert — and at `greed: 1` both coin flips
short-circuit before reaching `Math.random`. The two tiers that drifted are
precisely the two that make deliberate mistakes.

**The fix.** `lib/engine.ts` now exports `random()`, handing out numbers from
the same seeded source as `roll()`. The four sites in `lib/ai.ts` call it. Same
maths, same mistake rate, one bag instead of two. After the fix the identical
command produced byte-identical output twice, and Hard and Expert kept the exact
numbers they had before (1.42 / 2.98 / 5.28 / 11.6 and 1.73 / 3.19 / 5.47 /
11.7) — which is the evidence that nothing about how the game plays changed.
Low and Medium now draw from a different stream, so their figures moved the way
any re-roll of luck moves a 60-match sample. That is new luck, not new balance.

**Guarded by `tests/rng.test.mjs`**, which greps `lib/ai.ts` for `Math.random`
*and* replays a full match on each of the four tiers, asserting the second
playthrough matches the first. Putting the bug back deliberately fails the grep
plus Low and Medium, and leaves Hard and Expert passing — the same fingerprint
as the live symptom.

### Why this was worth doing before touching the d10

An A/B on a `TUNING` number used to mean two independent runs, each carrying
about ±3.5 points at 800 matches. A five-point price effect was invisible in
that. Now the same seeds can be played under both values, so both runs get
identical luck and only the number under test differs. The noise largely
cancels, and an effect worth a few points becomes readable in minutes rather
than needing tens of thousands of matches.

**Caveat that remains.** Every Low and Medium figure measured before this date —
including the tier table above — was produced by the unseeded brain. Those
numbers are still honest within their confidence intervals, but they cannot be
replayed bit-for-bit, and re-running the script today will not reproduce them.
Re-measure if you need a figure someone else can check. Expert and Hard numbers
are unaffected and always were.

---

## The d10 is not mispriced — the question was about a price nobody pays

*Measured 1 September 2026, on seeded paired runs. Nothing changed.*

The open question was: "d10 looks mispriced. Expert ends ~6% d10 and the worst
tier ends ~39%. Buying the biggest hull is what weak play looks like." It is a
real pattern with an innocent cause, and the price is fine. Four findings.

### 1. Nobody has ever bought a d10

`node sim/d10.mjs` instruments every shop action. Across **960 commanders**, all
four tiers, all five plans:

| bought fresh into an empty cell | count |
| --- | ---: |
| d4 | 937 |
| d6 | 223 |
| d8 | 4 |
| **d10** | **0** |

Upgrades are 74.5% of everything bought. So the 13 in `TUNING.prices` is doing
two different jobs, and only one of them is live:

- the **shop price** of a d10 — never paid by an AI, at any tier;
- the **step** from d8, because `upgradeCost` is `priceOf(next) - priceOf(sides)`
  — 13 − 9 = **4 Energy**, and that step is how every d10 in the game arrives.

Any conclusion about "the d10 at 13" is really a conclusion about a 4-Energy
upgrade.

### 2. That step is not a trap

`node sim/d10-policy.mjs [n] [tier]`. Two identical brains, same tier, same
seed, five plans; one is forbidden to step d8 → d10 and must spend the Energy
elsewhere. 50% would mean the step is worth exactly its price.

| tier | the commander **forbidden** the step wins | so taking it wins |
| --- | ---: | ---: |
| low | 46.4% ±3.5 (800) | 53.6% |
| medium | 47.8% ±3.5 (800) | 52.2% |
| hard | 47.0% ±4.9 (400) | 53.0% |
| expert | 47.3% ±4.9 (400) | 52.7% |

Four tiers, all on the same side of 50. Taking the step is mildly *good*, not a
trap. One caveat that cuts the other way: the capped side finishes having spent
about 3 Energy less per match, so some of what it was forbidden went unspent
rather than redirected — which flatters the d10 slightly. Read it as "fair to
mildly good", not as a bargain.

### 3. The tier pattern is a spending pattern, not a pricing one

Where each tier's Energy goes, per commander, 150 seeded matches:

| tier | cells | fresh hulls | **upgrades** | flagship | total | ships | cells | d10% |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| low | 9.5 | 5.1 | **30.6** | 1.8 | 47.1 | 5.09 | 5.24 | 41% |
| medium | 10.7 | 5.4 | 19.3 | 0.7 | 36.2 | 5.23 | 5.38 | 10% |
| hard | 10.6 | 5.1 | 15.9 | 0.9 | 32.5 | 5.19 | 5.37 | 5% |
| expert | 13.0 | 6.1 | 16.7 | 0.8 | 36.5 | 5.43 | 5.64 | 6% |

Low pours **30.6 Energy into the upgrade ladder** against Expert's 16.7, and
puts less into cells (9.5 against 13.0). It also plays longer matches — 13.4
rounds against 11.5 — so it banks more to begin with. The d10 is simply the top
rung, which is where a surplus spent on climbing ends up.

So "the worst tier owns the most d10s" is a readout of *not buying cells*, and
finding 6 already established that a cell plus a hull is the strongest purchase
in the game. The d10 share is a symptom. Repricing it would treat the symptom.

### 4. For a person, the big hull is a fine buy

An AI never pays 13, but a human can, so it needed testing directly.
`node sim/lab.mjs hulls 800` — side A is handed a cell with a hull in it, side B
the same Energy to spend freely:

| A is handed | ⚡ B gets instead | A wins | 95% ci | win pts per ⚡ | verdict |
| --- | ---: | ---: | ---: | ---: | --- |
| cell + a fresh d4 | 11 | 66.4% | ±3.3 | 1.49 | bargain |
| cell + a fresh d6 | 13 | 60.1% | ±3.4 | 0.78 | bargain |
| cell + a fresh d8 | 16 | 68.3% | ±3.2 | 1.14 | bargain |
| cell + a fresh d10 | 20 | 67.9% | ±3.2 | 0.89 | bargain |

Every hull is a bargain when it arrives with a cell — that is the cell effect
from finding 6, and every size shares it. And spending the same Energy two
ways, big hull against small hull plus the change:

| side A | side B | A wins | 95% ci | better buy |
| --- | --- | ---: | ---: | --- |
| cell + d6 | cell + d4 + 2⚡ | 54.3% | ±3.4 | the d6 |
| cell + d8 | cell + d4 + 5⚡ | 56.8% | ±3.4 | the d8 |
| cell + d10 | cell + d4 + 9⚡ | 56.0% | ±3.4 | the d10 |

At 400 matches this read 52.8% ±4.9 and I could not call it; at 800 it separates.
The big hull is worth its price against keeping the change.

### Verdict

**`prices: { 4: 4, 6: 6, 8: 9, 10: 13 }` is unchanged.** The hypothesis is not
supported from any of the four angles. The d10 is fairly priced as a step, fairly
priced as a purchase, and its concentration in weak fleets is caused by those
fleets under-buying cells and over-climbing the ladder.

I did sweep the price anyway (`D10_PRICE=15 node sim/d10-policy.mjs 400 low`).
Raising it to 15 makes the step 6 and pushes the forbidden side to 54.0% ±4.9 —
i.e. it turns a mildly good buy into a mildly bad one. Lowering it to 11 is worse
than it looks: at that price the brain starts buying d10s *fresh*, so the
d8-cap leaks and the row cannot be read. If anyone revisits this, note that
changing `prices[10]` moves the shop price and the upgrade step together, and
only the step is load-bearing.

---

## Paid rerolls are capped at three a round

*Changed 1 September 2026. `TUNING.paidRollsPerRound: 3`. Requested by the owner
after a month of playing humans; measured before and after.*

### The problem

A paid reroll cost 1 Energy per die and **never got dearer**, so the number of
rerolls a round was limited only by the bank. A wide board of d4s chasing 2s is
the worst case: a 2 pays 2 Direct on every hull, and `settlePlayer` adds Direct
*after* blocking, so no Shield and no blocking ship touches it. Nine d4s on 2
with a level-3 flagship matching is ~22 unblockable a round against 60 HP.

Measured with two identical Expert brains on the same seeds, one forbidden to
pay for rerolls at all. 50% means paid rerolls are worth exactly their price:

| starting bank | forbidden side wins | so paying wins |
| --- | ---: | ---: |
| normal | 49.8% ±4.9 | 50.2% — fair |
| +30⚡ | 48.3% ±4.9 | 51.7% |
| +60⚡ | **42.8% ±3.4** (800) | **57.2%** |

The rule was fine at ordinary Energy and got stronger the richer you were.
That is the shape of the bug: the price never rose, so a bank bought rounds.

### What did not work

The first proposal was a flat escalating price — the Nth paid reroll costs N,
whatever it rerolls. It measures **worse**, and the arithmetic says why. A
nine-die reroll cost 9⚡ under the old rule; under a flat price the first one
costs 1⚡. With 60 Energy:

| rule | full-board rerolls affordable |
| --- | ---: |
| 1⚡ per die | 60 ÷ 9 ≈ 6 |
| flat 1, 2, 3… | 1+2+…+10 = 55⚡ → **10** |
| flat 2, 4, 6… | 2+4+…+12 = 42⚡ → 7 |
| N per die | 9 + 18 + 27 = 54⚡ → 3 |

Making the wide reroll cheaper is the opposite of the fix. Measured at +60⚡,
the forbidden side won 39.8% under flat 1,2,3 against 42.8% under the old rule.

Sweeping the curves turned up one useful fact: **the load-bearing number is what
the first paid reroll costs, not how steeply the price climbs.** Every curve
starting at 1 failed (flat 1,2,3: 39.8%; doubling 1,2,4,8: 38.8%); every curve
starting at 2 worked (flat 2,4,6: 53.5%; doubling 2,4,8: 53.8%). Most of the
value is in the first reroll or two, so step five never gets reached. Those
curves fixed the bank problem but overshot — at 800 matches, flat 2,4,6 put the
forbidden side on 54.1% ±3.5, i.e. paying became a mildly *bad* buy.

### What shipped

**Cap the count, not the price.** Three free rolls, then at most three paid ones,
each still 1 Energy per die. Energy stops being the limit; the rule is.

| starting bank | old (uncapped) | **capped at 3** |
| --- | ---: | ---: |
| normal | 49.8% ±4.9 | **50.0% ±4.9** |
| +30⚡ | 48.3% ±4.9 | **51.5% ±4.9** |
| +60⚡ | 42.8% ±3.4 | **47.1% ±3.5** |

The ordinary game is untouched — 50.0%, and the same 5.1⚡ a match goes into
rerolls. The cap only binds when a commander is rich, which is exactly when the
old rule broke. Tightening to two buys nothing measurable (47.6% ±3.5 at +60⚡,
inside noise of three) and costs a player a choice, so **three is right**.

Whole-game check, 120 matches per tier on identical seeds, uncapped against
capped: Low and Medium are byte-identical; Hard and Expert move in the second
decimal (straights 1.75 → 1.77, ships 5.41 → 5.44) where they occasionally reach
the cap. Match length, lines, and fleet mix are unchanged. The hand-written
2-chaser drops from 13.0% to 8.5% against Expert.

### The screen, not just the engine

The Reroll button was gated on affordability only, so under the cap it would
have offered a move the engine refuses and thrown an error at the player.
`MatchScreen` now reads `rollsLeft()` from the engine and shows **"No rerolls
left"**. Verified in a real browser at 390×844 by `cap-playtest.mjs`, with 4⚡
still in the bank so the cap was doing the stopping:

| tap | button |
| --- | --- |
| 1, 2 | enabled — "Free" |
| 3, 4, 5 | enabled — "Cost 1 Energy" |
| 6 | **disabled — "No rerolls left"** |

Zero console errors. Both help strings now interpolate `TUNING.rollsPerRound`
and `TUNING.paidRollsPerRound`, and `tests/rng.test.mjs` fails if either goes
back to hardcoding the sentence.

---

## Direct stays unblockable, and Repair is why

*Asked and settled 1 September 2026. Nothing changed; the reasoning is written
down so it is not re-argued from scratch.*

The owner asked whether a blocking hull ought to be able to stand in front of
Direct as well as Attack. It measured **safe** and was still declined, which is
worth separating carefully.

### What the numbers said

`TUNING.blockStopsDirect` was added, measured, and removed again. Identical
seeds, Hard against Hard, 150 matches:

| rule | rounds | blocks/cmdr | hulls used | ships |
| --- | ---: | ---: | ---: | ---: |
| Direct unblockable (shipped) | 11.2 | 2.82 | 6.03 | 5.20 |
| blocking stops Direct | 11.3 | 2.92 | 6.24 | 5.20 |

Nearly invisible. The obvious worry — that blocking would answer everything and
a commander could turtle behind a wall of hulls — does not happen. A commander
who blocks with **everything, every round**, against Hard, 400 matches:

| rule | the turtle wins |
| --- | ---: |
| Direct unblockable | 5.0% ±2.1 |
| blocking stops Direct | 6.8% ±2.5 |

Turtling loses badly either way, and for a reason that has nothing to do with
Direct: **a blocked hull sits out the next round and stops dealing damage.**
Blocking already punishes itself. So the change was safe to make.

### Why it was not made

Because the owner asked a second question — can Repair save a flagship the
damage would otherwise destroy? — and answering it showed what Direct is for.

`settlePlayer` computes `before - damage + repair` in one step, so it can, and
`inescapableDeath` counts repair too. That means the game has a clean triangle:

- **Shields** answer Attack.
- **Ship blocking** answers what gets past Shields.
- **Repair** answers Direct — and nothing else does.

Let hulls block Direct and that third line disappears: Direct becomes ordinary
damage with an extra step, and Repair is left with no job of its own. The
purple chevron currently means *the damage you cannot defend against, only
out-heal*, and that is worth more than the change was.

**This is a design decision, not a measurement.** The measurement says either
rule works. If anyone wants to revisit it, the knob is five lines
(`damageAfterBlocking` is already the single place both the settle and the
doomed-round check agree through) — but note that Direct being unstoppable is
stated as a rule in the tutorial, the face legend, the help screen, the block
screen and `lib/reference.ts` in seven places, all of which would have to change
with it.

### Now tested

`tests/repair.test.mjs` pins both halves, and four of its cases fail if repair
is moved after a death check:

- repair carries a flagship the damage alone would kill (5 − 8 + 5 = 2)
- repair answers Direct specifically (4 − 9 direct + 8 = 3)
- exactly zero is dead; one more point of repair is one more point of life
- healing past the starting maximum raises the maximum
- the whole fleet blocking stops **none** of an incoming Direct
- blocking still stops Attack, so that case cannot pass by accident

---

## The opponent's eye for Energy — the biggest single knob in the brain

*Changed 2 September 2026. `energyWeight` per tier: Low 1.45, Medium 2.4,
Hard 3.4, Expert 4.2. No `TUNING` number moved; this is all in `lib/ai.ts`.*

### What was wrong

`WEIGHTS.energy` was 1.45 for every tier. `nearFormation` — the function that
decides which line the brain hunts — used it to price a row:

```ts
const prize = line.kind === "col" ? TUNING.lineDownAttack : TUNING.lineAcrossEnergy * WEIGHTS.energy;
```

A column pays 10 Attack. A row pays 5 Energy, which at 1.45 scored **7.25**. So
the row never won that comparison, and **every brain on every tier chased
columns and only columns**, whatever the board in front of it looked like.

### What it is worth

Paired seeds, same tier, all five plans, one side on the new weight:

| energy weight | wins against 1.45 |
| ---: | ---: |
| 0.8 | 39.5% ±4.8 |
| 1.0 | 42.3% ±4.8 |
| 1.2 | 46.8% ±4.9 |
| 1.7 | 50.5% ±4.9 |
| 2.5 | 66.0% ±4.6 |
| **4.2** | **74.3% ±3.5** |
| 9 | 68.3% ±5.3 |
| 30 | 48.3% ±5.7 |

A real optimum around four, not a runaway — it climbs, peaks and falls away.
Note the first three rows: BALANCE.md finding 3 guessed this number should be
*lower*, "nearer 1.0". Measured, that is the wrong direction and costs about
eight points.

### The ladder, which is the point

500 matches a rung:

| rung | now | before |
| --- | ---: | ---: |
| Medium over Low | **72.0% ±3.9** | 59.9% |
| Hard over Medium | **63.4% ±4.2** | 52.7% |
| Expert over Hard | **58.4% ±4.3** | 54.9% |
| Expert over Low | **87.2% ±2.9** | — |

Every rung is a clear step now. **Low is deliberately untouched at 1.45**, so a
beginner's first game plays exactly as it always did; the tiers above it got
better rather than the bottom getting harder.

150 matches a tier, both sides the same tier:

| tier | straights/cmdr | lines/cmdr | ships | rows | cols | rounds |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| low | 0.66 | 2.00 | 5.09 | 0.90 | 1.11 | 13.4 |
| medium | 1.70 | 2.30 | 5.51 | 1.28 | 0.98 | 11.2 |
| hard | 2.43 | 3.04 | 6.06 | 1.74 | 1.34 | 11.1 |
| expert | 2.82 | 3.36 | 6.32 | 1.98 | 1.35 | 11.5 |

Straights at Expert go from 1.75 a commander to **2.82**, which is most of the
"straights barely happen" open question answered from the other end: they were
rare partly because nothing was hunting them. Fleets are bigger (5.43 → 6.32),
and the board finally sees **both** kinds of formation instead of columns alone.

### Two things that measured neutral and were not shipped

**Saving up for a bay.** The obvious diagnosis — the brain never buys bays
because `buyScore` divides by cost — is wrong. The arithmetic does not support
it (a bay scores 7.5/11 = 0.68 against an upgrade's 1.3/2 = 0.65), and the real
reason is simpler: instrumented, the brain arrives at the shipyard with **4.4
Energy**, can afford a bay on 20% of visits, and buys one two thirds of the time
it can. It was never undervaluing bays; it could never save up for one.

So a `patience` knob was built, letting a tier hold Energy for a bay it could
afford in a round or two. It works — bays per match went 1.45 → 1.88, ships 5.30
→ 5.66 — and it is worth **nothing**: 50.2%, 49.3%, 50.0%, 47.0%, 50.2%, 50.2%
across six paired runs at four tiers, before and after the energy fix. Two extra
rounds of foregone upgrades exactly cancel the bay. It was removed rather than
shipped. Finding 6 ("a bay plus a hull is the strongest purchase") still stands,
but it was measured by *handing* a commander a bay at round one, which is not
the same as spending two rounds earning one.

### A measurement that lied, and how it was caught

The energy-weight sweep above was first run by overriding the module-level
`WEIGHTS.energy`. After the per-tier knob was added, the same comparison read
**47.8%** instead of 74.3% — because `nearFormation` still read the global while
everything else read the new knob. The knob was changing how a *roll* was
valued and not which *line* was hunted, and the line is where almost all the
value is: threading the weight into `valueOfTally` alone is worth 49.0%, and
into `nearFormation` as well is worth 71.8%.

Both experiments were internally valid and they disagreed by twenty-five points.
The only reason it surfaced is that the numbers were re-measured after the
refactor instead of being carried over. Re-measure after moving code, even when
the change looks like plumbing.
