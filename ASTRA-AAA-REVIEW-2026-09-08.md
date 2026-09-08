# Fleet Dice: first Astra review and proposed AAA roadmap

Reviewed 8 September 2026. Proposal for Dave to prioritize; this does not replace AAA-PLAN.md or authorize implementation.

## Verdict

**63/100 toward an exceptionally polished, phone-first digital tabletop game.** This is a subjective quality/readiness rubric, not an industry certification, a percentage of development work completed, or a claim that 37% more effort finishes the game. Reasonable uncertainty is approximately five points in either direction.

Fleet Dice has an appealing core: build a fleet, improve your odds, decide what to reroll, and sacrifice future firepower to survive now. Dave reports that humans enjoy it after 50+ battles. That is valuable evidence of fun worth protecting, though it is not yet a representative retention or balance study.

The game deserves refinement rather than a mechanics rewrite. Its strongest asset is the combination of dice probability, fleet construction, and simultaneous commitment. Its weakest areas are online trust/recovery, production verification, and unverified audio. Existing 3D, animation, tutorial, and balance work deserve substantial credit.

| Area | Weight | Current score | Assessment |
| --- | ---: | ---: | --- |
| Core play and replay appeal | 25% | 82 | Strong choices and encouraging owner-reported repeat play; broader player evidence is missing. |
| Balance and opponent design | 15% | 72 | Shared rules engine, substantial experiments, reproducible simulation, and a real difficulty ladder. Human metagame remains unmeasured. |
| Backend reliability and match integrity | 20% | 45 | Transactions, reconnects, version guards and tap locks exist; browser-authoritative results and recovery weaknesses remain. |
| Art, dice and interface | 15% | 65 | Coherent colors, readable faces, real geometry and phone layout; materials and scene composition do not yet consistently feel premium. |
| Animation and tactile response | 10% | 60 | Choreographed throws, combat effects and finishing sequence exist; timing and device performance need systematic verification. |
| Audio readiness | 10% | 40 | Substantial procedural audio, limiter, ambience and preferences exist. This score reflects missing listening/device validation, not a judgment that it sounds bad. |
| Release quality and accessibility | 5% | 55 | Tests and deployment gate exist; broader browser, hardware, accessibility and operational checks are incomplete. |

Weighted score: 62.8, rounded to 63.

## What this review actually checked

- Original local checkout: `b93357c`. It was behind GitHub. Reviewed current `origin/main` at **`faf4cf6a39a6de486c9d57bdabde17ceb3c32ce4`** in an isolated detached worktree.
- GitHub repository: https://github.com/davepartin/fleetdice3. Latest five deployment runs were successful. Latest reviewed deployment: https://github.com/davepartin/fleetdice3/actions/runs/34243871184.
- Read the handoff, current architecture, old AAA checklist, balance history, engine/AI, rendering/audio implementation, multiplayer hooks, room persistence, current security rules, and recent changes.
- Original checkout: 111 tests passed. **Current GitHub snapshot: 138 tests passed**, using `node --test tests/*.test.mjs`. ESLint also passed with no findings on the reviewed snapshot.
- Ran `node sim/ladder.mjs 250`: 250 matches for each of four comparisons, 1,000 total.
- Opened the live site in the browser at 390×844, inspected home/setup, started Medium solo, rolled, locked in, took damage, inspected the report and entered the shipyard. This was a short hands-on flow, not a complete match or device certification.
- Did not audibly assess the sound, run a fresh two-device online battle, inspect live Firebase rules/billing/backup configuration, perform adversarial writes, or benchmark physical iPhones/Android phones. Backend findings describe the reviewed source; live rule deployment parity remains unverified.
- The default local build attempt hit a temporary-worktree dependency-symlink limitation in Turbopack. That is an audit-environment failure, not evidence of a game build regression. GitHub's current production build succeeded. A subsequent local `next build --webpack` also passed TypeScript and exported all routes successfully; this verifies the alternative build path, not a second local Turbopack pass.

## Preserve these strengths

Keep the 3×3 board, dice-as-ships identity, escalating fleet purchases, free/paid reroll distinction, three-paid-reroll cap, and Shields → blocking → Repair tradeoffs. Keep Direct unblockable unless new evidence warrants revisiting the explicitly settled design. Keep the shared pure rules engine, generated help text, phone-first composition, readable face symbols, and the ability for the faster player to keep moving between shared volleys.

The older documents contain superseded statements. Current GitHub already includes guest-seat recovery, stale-snapshot protection, broader tap locking, tutorial repairs, accidental-flagship-reroll protection, and a frozen post-volley opponent view. These should not be proposed as missing features. Two older open PRs also overlap work described as already shipped; reconcile them before merging anything.

## Balance: measure decisions, then change numbers

Fresh ladder results, with the harness's approximate 95% margins:

| Comparison | Stronger tier win rate | Average rounds |
| --- | ---: | ---: |
| Medium over Low | 65.6% ±5.9 points | 11.9 |
| Hard over Medium | 61.6% ±6.0 points | 11.2 |
| Expert over Hard | 59.2% ±6.1 points | 11.2 |
| Expert over Low | 89.6% ±3.8 points | 10.8 |

The ladder is working. These are AI-versus-AI results, not predictions of human win rates. Expert includes its configured starting advantage; these figures do not isolate intelligence. The harness cycles five selected plan pairings rather than evaluating the entire matchup matrix.

Recommended investigations, in order of likely usefulness:

1. **Early Reactor luck and compounding Energy.** Measure whether getting income early predicts victory too strongly after controlling for skill, purchases and side. Track round-3 income, round-5 bank, fleet size, comeback frequency and decision time. Only if a persistent snowball appears should we test a gentler income curve or a costly recovery option.
2. **Wide fleets versus large hulls.** Measure every strategy pairing, using actual purchases and upgrades. Retain the existing d10-price findings as a baseline; low purchase frequency alone does not establish a bad price. Add counter-strategies and stronger opponent policies instead of measuring one brain against itself forever.
3. **The flagship's opportunity cost.** Track when humans buy a level, use the weapon, or save for a bay. A seldom-used option may be poorly explained rather than weak. Show the concrete benefit before discounting it again.
4. **Direct, Repair and late-game pressure.** Track unavoidable damage, survival through Repair, and how often round-eight escalation decides a game. Look for unwinnable-feeling stretches and excessive healing loops; do not add hidden comeback bonuses or rigged rolls.
5. **Formation and straight comprehension.** Ask players whether they can explain a missed opportunity and what an upgrade changes. Improve purchase previews and optional hints before increasing rewards. A tooltip could say which row or column a bay completes and which faces an upgrade adds or makes less likely.
6. **Distinct opponents.** Give the five existing plans recognizable commander identities and readable tendencies. Consider a separate equal-start Expert challenge, preserving today's boosted Expert as a disclosed challenge mode.

Measurement upgrades: log anonymous match/build/rules versions and key choices only after choosing a privacy approach; offer a local export first. Report illegal actions and unfinished simulations explicitly—the ladder harness currently catches action errors and can count an unfinished run against the stronger side. Use multiple seeds and balanced host/guest ordering. AI hypothetical rolls and actual rolls currently consume the same seeded stream, so changing AI search can change later game luck. Introduce deterministic, separately derived streams for gameplay and AI evaluation, then establish a new baseline. A shared seed alone does not guarantee identical rolls after strategies diverge.

Use matchup and human-session evidence to flag dominant choices. Do not require every matchup to be 50/50: interesting counters are healthy. No balance number changes are recommended from this review alone.

## Backend: preserve matches and establish trust

### Highest priority findings

**The client is the referee.** `lib/rooms.ts:playAction` runs `applyAction` in the player's browser and writes the whole state. `firestore.rules` permits a participant to update state while preserving seat IDs; it does not enforce game arithmetic. A modified client can therefore attempt invented rolls, resources or outcomes. Transactions prevent competing writes from partially applying; they do not establish that the submitted game result is legitimate.

**Hidden dice are delivered before they are hidden.** The participant reads the entire match document; `publicMatchView` removes enemy dice afterward. Today's volley-view fix improves the honest player's screen, but does not provide secrecy against an inspecting client. Firestore reads are document-level; secret fields need a separately protected document or server-filtered response. [Firebase field-access documentation](https://firebase.google.com/docs/firestore/security/rules-fields).

**A timeout is not a cancelled move.** `withTimeout` rejects its wrapper after 15 seconds but does not stop the underlying transaction. The UI subsequently releases its tap lock. A move could still commit after the player sees an error; a retry can become another legal move. This is a code-path risk, not a failure reproduced during this review. Assign each intended action an ID and persist its acknowledgement so retries return the first result rather than spending again. Include expected round/phase and a defined conflict policy; a global version alone should not unnecessarily block simultaneous independent decisions. Firebase may rerun transaction callbacks after conflicts. [Firebase transactions documentation](https://firebase.google.com/docs/firestore/manage-data/transactions).

**Recovery should prove ownership.** Current guest reclaim accepts a different anonymous UID after 60 seconds without a guest heartbeat. Knowledge of the room is not proof of being the original guest. Phone sleep or a network gap must not make someone's seat transferable to another link holder. Use a private high-entropy recovery credential, securely verified by the server, or explicit host approval. Add equivalent host recovery. Current reclaim also updates the match identity without synchronizing code/live seat metadata, so recovery must reconcile all related documents atomically.

### Recommended architecture

Keep the static website, Three.js, Firebase authentication and the shared engine. Add a small server action endpoint that authenticates the commander, validates an action ID and phase, obtains authoritative randomness, runs the engine, and atomically records the result. Only the server may mutate competitive game state. Deliver a public projection and each player's permitted private view. Solo can continue running locally. Prefer this focused evolution over a wholesale platform rewrite.

Pin `rulesVersion` and state schema to each match. Existing games must finish under compatible rules when a new website deploys. Persist accepted action events and periodic snapshots for debugging/replay. Never use a single global mutable RNG across concurrent server matches; use a per-match deterministic state or server-generated per-action outcomes.

Add cleanup and room-code expiry: abandoned rooms are currently hidden in the UI but remain stored, and guest-finished codes are marked finished rather than freed. Creation refuses every existing code. Expired code reclamation must be transactional and must not damage active games. Add bounded server queries: live-board reads currently subscribe to the whole collection and results read the last 30 days without a count limit. Avoid updating the public lobby for every inconsequential game action.

Add observed metrics for join success, interrupted actions, reconnection, stuck phases, command latency, read/write cost per match and unexpected errors. Verify budgets, backups and restoration rather than assuming they are configured. Add abuse controls around room creation/joining, with App Check as a supplement, not a replacement for authorization.

Proposed acceptance: 100 scripted two-client matches under delayed, dropped and duplicated messages with no lost/duplicate accepted actions; an eight-hour soak; tests at 10/50/100 concurrent matches; sleep/resume and Wi-Fi/cellular transitions on real phones; reject forged state and unauthorized seat recovery in the emulator. Suggested production objective after instrumentation: at least 99.5% of legitimate games avoid an unrecoverable technical failure, excluding deliberate abandonment.

## Dice, 3D, animation and sound

**Keep the real 3D dice.** They are already polyhedra with procedural face atlases and polished-resin materials. Their throws intentionally land on the engine's chosen result. Preserve that contract: rendering and physics must never change a legal roll.

My recommended art direction is a premium tactical fleet table: legible resin dice with restrained metal edges and inset symbols, sitting in a believable illuminated launch deck. The live d4 faces are readable, but their nearly face-on framing makes them read rather flat. Reveal a controlled amount of thickness, bevel and contact shadow without introducing competing visible numbers. Test every face of d4/d6/d8/d10 and the flagship at actual phone size.

Use generated imagery for concept exploration, environment art, texture references, result illustrations and cosmetic themes. Turn approved references into optimized reusable game assets. Keep face values and symbols generated from the rules. Do not generate a fresh image on every roll: it adds latency, variation and readability risk without replacing an interactive 3D renderer. If using image-to-3D later, budget for topology, UV, face-orientation, material and licensing review before shipping the asset.

Make one complete combat sequence the quality benchmark:

- Selection lifts the die slightly, with an unmistakable reroll mark and a light click.
- d4s feel light and sharp; d10s have slower rotation and heavier contact. Several throw variants prevent repetition.
- Dice bounce, settle and present the correct face. Contact audio follows the actual visual landing event.
- A row connects and pays Energy with a short ascending cue. A column produces a directional volley. A straight gets a distinct, slightly larger celebration.
- Shield impacts, Direct strikes, Repair and blocking each have their own visual grammar. Simultaneous opposing attacks retain their shared-volley meaning even if presented in a readable sequence.
- Damage numbers and the report agree once settled. Effects never obscure the next decision or steal taps.
- The existing flagship-break finale becomes the most authored moment. Give repeat players fast/reduced-motion playback without skipping the authoritative outcome.

Audio already has synthesized cues, a compressor, reverb, spatial panning, intensity-driven ambience and master controls. Start with a listening session, not a rewrite. Audition every cue on phone speakers and headphones, then during several battles. Record or license a small tactile layer for dice contacts and mechanical impacts if it improves the result. Retain synthesis for shields, Energy and Repair. Expose separate SFX/music/ambience levels, limit overlapping cues, duck ambience for decisive events, vary repeated contacts, and test first-tap unlock and resume on iOS. Do not equate louder with more satisfying.

Proposed performance gates: 60 fps target on the chosen reference phones, a stable 30 fps fallback on the oldest supported device, and no growing memory trend across ten battles. Measure frame-time percentiles and battery/heat during a 20-minute session. The quality watchdog already exists; extend it with measured budgets and context-loss recovery. Verify reduced motion throughout the renderer, not only CSS and selected effects. A supported non-WebGL fallback or a graceful recovery screen should prevent a blank board.

## Proposed upgrade order

These are prioritization candidates, not started implementation tasks. Work one accepted item at a time and review it on a phone, consistent with the existing project process.

| Step | Deliverable | Relative size | Completion evidence |
| --- | --- | --- | --- |
| 1 | Establish current baseline and diagnostic replay/export | Small–medium | Current branch verified, error/build IDs visible to support, representative human feedback captured, baseline rules frozen. |
| 2 | Repair interrupted-action and seat-recovery behavior; add solo resume | Medium | Refresh, sleep, dropped replies and ownership recovery preserve the correct game; solo resumes after reload. |
| 3 | Polish one complete combat sequence with sound | Medium–large | Dave approves it on a real phone; every hull readable; motion/audio synchronized; performance budget met. |
| 4 | Add server-enforced online rules and private player views | Large | Emulator rejects fabricated outcomes and private-data access; retry and migration tests pass. Required before ranked/public competitive expansion. |
| 5 | Run human-informed balance experiments | Medium, ongoing | Matchup matrix, purchase/roll choices and comeback data; changes only where evidence supports them. |
| 6 | Apply the approved visual/audio standard throughout | Large | Tutorial, shipyard, combat, reconnect, victory and defeat share the same polish; solo and versus both pass. |
| 7 | Expand reasons to return | Medium–large | Rematch, optional records/replays, commander personality, cosmetic achievement rewards; no paid power or mandatory grind. |
| 8 | Release hardening | Medium–large | Real-device matrix, restore drill, soak/load checks, browser tests in CI, production monitoring and rollback tested. |

For the current friends-and-family beta, this order yields a visible payoff early. If public matchmaking or ranked play is next, move step 4 ahead of step 3. Steps 5–7 should not inflate scope until the improved core loop remains fun.

## Additional ideas worth considering later

- **“Why that mattered” replay:** tap a key round and see the row, block or weapon decision that changed the battle.
- **Same-seed daily solo challenge:** shared opening conditions, quick replayability, no power advantage. Competitive scores require trusted validation.
- **Optional captain personalities:** distinct portraits, fleet tastes and restrained reactions for the existing strategies.
- **Cosmetic fleet mastery:** hull finishes, deck themes and flagship insignia earned through varied play, while semantic colors and symbols remain stable.
- **After-match rematch with side swap:** reduce friction for the humans already playing repeated battles.
- **Spectator/replay mode after hidden-state protection:** show only information appropriate to that point in the battle; do not leak current private dice.
- **Short campaign or scenario missions later:** teach specific tactics through situations before adding more rules or dice types.

The first prioritization decision should be the balance between immediate tactile polish and online infrastructure. My preference is to secure recovery, produce one excellent audiovisual combat sequence, then harden the online referee before inviting a wider competitive audience.
