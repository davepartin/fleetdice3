# September playtester upgrade

Implemented on `codex/playtest-recovery-and-dice`. This is a beta experience pass,
not App Store preparation. The Reactor, initial three free rolls, three paid
rerolls, and all shipped balance numbers remain unchanged.

## 1. Feedback and diagnosis

- Settings → Share playtest feedback saves a JSON report for the player to send.
- A local ring keeps the latest 80 action/connection/error categories, round and
  phase, plus build and screen size. It does not record names, room codes,
  identities, dice, credentials or error payloads. User-written feedback is
  included. Nothing is sent automatically.
- The error screen offers reopening the battle and saving a problem report.

## 2. Protect the battle

- Solo saves the complete battle and opponent plan after each human move and AI
  batch. Reopening solo restores it; starting over requires a deliberate choice.
  Storage failures produce a visible warning. Clearing site storage still loses
  a local solo save; this is not cross-device cloud saving.
- Versus writes a pending command locally before sending it, and records its ID
  and per-seat sequence atomically with the Firestore move. A timed-out command
  is checked/retried using the same ID, so retries cannot roll or spend twice.
  Stale commands are refused. The existing highest-version guard remains.
- The other seated player approves a return from a new browser identity. This
  works for host or guest, preserves gameplay values, updates room/code/public
  seat metadata atomically, and revokes the old identity. A quiet minute no
  longer grants a stranger a seat. Both players losing their identities still
  needs a future account/recovery-code solution.
- WebGL loss produces a recovery notice; restoration rebuilds and synchronizes
  the arena. Scene timers cannot act on disposed arenas. Layout changes between
  phone and desktop rebuild the dice for the correct viewing angle.
- This remains a client-run engine. Receipts protect honest retries, not against
  a player rewriting game data. Server authority and true hidden information
  are still later work.

## 3. Dice, motion, sound and reroll clarity

- After Dave’s visual feedback, the d8’s actual octahedron rests with two
  adjacent triangles forming a solid diamond. The added gray frame was removed.
  The lower facet shares the rolled face’s color, with darker shading and no
  extra number. D4, d6 and d10 geometry is unchanged. Dice remain 3D in flight.
- Different hull sizes have different throw timing/spin and landing pitches.
  Landing sounds follow actual landings; impacts/direct hits use distinct cues.
- Effects and ambience have separate saved volume controls and audition buttons.
  Gentle motion offers short throws and no camera shake, respecting OS settings.
- The roll prompt explains the free allowance, then the remaining paid rerolls
  and the cost of 1 Energy per selected die. No extra free roll was introduced.

## Verification

- All 145 Node tests passed, including seven new receipt/save tests. ESLint and
  TypeScript passed. The optimized production static build passed; its solo
  preview restored round 3 with no captured browser errors and no development
  controls. Switching from desktop to phone layout rebuilt readable dice.
- `node tools/recovery-emulator.mjs` passed against demo Firebase emulators using
  real application APIs and the proposed rules: concurrent duplicate commands,
  conflicting tabs, denied unauthorized takeover/read, approved guest return,
  approved host return, continued play from the returned seat.
- In-app browser at 375×812: saved round 1 restored the exact 8 Attack / 6 Shields /
  0 Direct / 10 Repair / 2 Energy and two remaining free rolls. A real WebGL
  context loss/restoration redrew the same fleet. This caught and fixed React
  batching false/true readiness and leaving a rebuilt arena empty.
- Browser play progressed through combat, reports and shipyards to round 3,
  purchased d4→d6→d8, and reopened that saved fleet with the same HP and Energy.
  Checked d8 next to d4, sound/motion sheet, the free-to-paid reroll transition,
  and the disabled paid reroll when Energy is insufficient.
- Human listening and a two-physical-phone recovery test are still needed.
  Browser viewport checks are not claims of physical iPhone testing.

## Flagship recharge: experiment only

`node sim/flagship-recharge.mjs 250` explored a simple policy: buy one recharge
per shipyard visit when affordable, before other purchases. Hard opponents share
the same plan, alternating buyer seat over 250 matches per cost.

| Cost | Buyer win rate | Approximate 95% margin | Recharges/match |
| --- | --- | --- | --- |
| 4 Energy | 46.0% | ±6.2 points | 1.40 |
| 6 Energy | 44.4% | ±6.2 points | 1.27 |
| 8 Energy | 42.4% | ±6.1 points | 1.09 |
| 10 Energy | 43.2% | ±6.1 points | 1.00 |

These results do not establish an optimum or a balance change. The harness
mirrors shipped AI behavior that skips stale batched shop actions, and counted
201/231/214/196 rejections respectively. The planner can target a hypothetical
new ship ID for a later upgrade; fixing that is follow-up work. Human optional
purchase timing can differ substantially. No recharge purchase is shipped.

## Release boundary

The feature branch and local preview are separate from production. The new seat
return feature requires `firestore.rules` as well as the frontend; a Pages-only
deployment is insufficient. Before rollout, re-run the demo emulator test,
deploy the tested rules and frontend together, and check a real two-phone room.
Do not mark the full AAA roadmap complete from this pass.

### D8 visual revision acceptance

Production build and lint passed after removing the separate diamond frame.
The browser preview restored Dave’s round 4 (29 HP, 3 Energy, 22 Attack) with
the new solid diamond and its existing formation highlights intact.
