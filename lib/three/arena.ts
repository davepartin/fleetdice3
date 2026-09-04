/**
 * The arena: two decks, every die on them, and the camera that watches.
 *
 * This is the only place that knows both the rules and the renderer. React
 * hands it a match state; it works out what changed and animates the
 * difference. Nothing above it ever touches a mesh.
 */

import * as THREE from "three";
import type { MatchState, PlayerState, SideId, Tally } from "../engine";
import { activeShips, cellForSlot, emptyOpenSlots, opponentOf, runMemberIds } from "../engine";
import { createStage, type Quality, type Stage } from "./stage";
import { CELL, createBoard, cellCentre, type Board } from "./board";
import { createDie, type Die, type DieKind } from "./die";
import { FLAG_FACE_PALETTE } from "./faceArt";
import { createVfx, type Vfx } from "./vfx";
import { displayFontFamily } from "./fonts";
import { isPhoneLayout } from "../viewport";

/** Where each deck sits in the world. */
export const YOUR_DECK = new THREE.Vector3(0, 0, 5.2);
export const ENEMY_DECK = new THREE.Vector3(0, 0, -7.9);

export type Focus = "fleet" | "both" | "enemy" | "wide";

const FRAMES: Record<Focus, { pitch: number; fitWidth: number; fitDepth: number; target: THREE.Vector3; parallax: number }> = {
  // Aimed below the deck on purpose: the action dock covers the bottom of a
  // phone screen, so the board has to sit high in the frame or the near row of
  // ships hides behind it.
  // Gameplay framing is deliberately fixed. Pointer parallax made the board
  // and every die edge shift under the player's finger or mouse, which reads
  // as unstable information rather than depth on a precision dice board.
  fleet: { pitch: 51, fitWidth: 12.6, fitDepth: 12.6, target: new THREE.Vector3(0, -2.6, 5.2), parallax: 0 },
  both: { pitch: 57, fitWidth: 13.8, fitDepth: 24.5, target: new THREE.Vector3(0, -3.4, -1.4), parallax: 0 },
  enemy: { pitch: 49, fitWidth: 13.2, fitDepth: 13.2, target: new THREE.Vector3(0, 0.3, -7.9), parallax: 0 },
  wide: { pitch: 34, fitWidth: 20, fitDepth: 20, target: new THREE.Vector3(0, 1.4, 0), parallax: 0 },
};

/**
 * A wide monitor has far less vertical room than a phone once the action dock
 * is present. Pull the camera back there instead of letting a giant board run
 * under the controls and off both edges of the screen.
 */
const LANDSCAPE_DEPTH: Record<Focus, number> = {
  // Leave a guaranteed band above the action dock and below the header. At
  // 1274×902 the old frame hid the far ship under the enemy health rail.
  fleet: 21,
  both: 29,
  enemy: 17.5,
  wide: 26,
};

function frameFor(focus: Focus, phone = false) {
  const base = FRAMES[focus];
  if (phone && focus === "fleet") {
    return {
      ...base,
      // A nearly overhead command view is the only honest phone composition:
      // every cell stays separated, the flagship cannot hide the rear ship,
      // and the deck uses the tall safe rectangle instead of leaving a band
      // of empty sky above it. Solo proved this; versus uses the same frame.
      pitch: 88,
      // On tall browser states we intentionally crop a sliver of decorative
      // deck edge. The dice, not the metal frame, deserve those pixels.
      fitWidth: 8.3,
      fitDepth: 10.1,
      target: new THREE.Vector3(0, 0, 5.2),
      parallax: 0,
    };
  }
  if (phone && focus === "both") {
    return {
      ...base,
      // Brace, report, and waiting for the other commander all show both
      // fleets. The same overhead language keeps dice and markers readable.
      pitch: 84,
      fitWidth: 13,
      fitDepth: 23.2,
      parallax: 0,
    };
  }
  const landscape = !phone && window.innerWidth >= 900 && window.innerWidth > window.innerHeight;
  return landscape ? { ...base, fitDepth: LANDSCAPE_DEPTH[focus] } : base;
}

export type ArenaOptions = {
  quality?: Quality;
  mode?: "solo" | "versus";
  /** Called when a die on your own deck is tapped. */
  onTapDie?: (shipId: string) => void;
};

export type SyncOptions = {
  /** Skip the throw animation — used the first time a board appears. */
  instant?: boolean;
  /** Ship ids currently picked for a reroll. */
  selected?: Set<string>;
  /** Ship ids currently committed to taking the incoming volley. */
  damageSelected?: Set<string>;
  /** Ship ids that can be tapped to block right now — they pulse to say so. */
  blockable?: Set<string>;
  /** Live score while the player is still rerolling, including formations. */
  previewTally?: Tally | null;
  /** Show the enemy's dice. False until both commanders have locked in. */
  revealEnemy?: boolean;
  /**
   * Ship ids that were just sent back. These always animate, even when the die
   * comes up on the same number — a reroll that looks like nothing happened
   * feels broken, and it happens about one time in four.
   */
  thrown?: Set<string>;
  /**
   * Light the straight on the board. Held off while the dice are still in
   * the air so the run arriving is one beat, not a glow that appears mid-throw.
   */
  showRunMarks?: boolean;
};

export type Arena = {
  stage: Stage;
  vfx: Vfx;
  sync(state: MatchState, side: SideId, options?: SyncOptions): void;
  setFocus(focus: Focus, immediate?: boolean): void;
  /** World position of one of your cells, for aiming an effect. */
  cellWorld(side: "you" | "enemy", cell: number): THREE.Vector3;
  /** The flagship's position on a deck. */
  flagshipWorld(side: "you" | "enemy"): THREE.Vector3;
  /**
   * A punchy squash-bounce reaction on one ship's own hull, for the instant a
   * volley lands on it — distinct from the flattened "sat out" pose it only
   * settles into once next round's sync marks it disabled.
   */
  nudgeShip(side: "you" | "enemy", shipId: string, strength?: number): void;
  /** Blast every die on that deck outward from the flagship and off the
   *  board — the losing fleet at the moment the match ends. */
  scatterDice(side: "you" | "enemy"): void;
  boardOf(side: "you" | "enemy"): Board;
  /** Resolves once every die on that deck has landed, or after a short cap. */
  whenSettled(side?: "you" | "enemy"): Promise<void>;
  dispose(): void;
};

type DeckState = {
  board: Board;
  dice: Map<string, Die>;
  root: THREE.Group;
};

export function createArena(canvas: HTMLCanvasElement, options: ArenaOptions = {}): Arena {
  const font = displayFontFamily();
  const stage = createStage(canvas, options.quality);
  const vfx = createVfx(stage, { deckY: 0.04 });

  const decks: Record<"you" | "enemy", DeckState> = {
    you: makeDeck("you", YOUR_DECK, font, stage),
    enemy: makeDeck("enemy", ENEMY_DECK, font, stage),
  };
  const isPhone = () => isPhoneLayout();
  let settledAlive = true;

  /* Tapping ---------------------------------------------------------- */

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let downAt: { x: number; y: number; t: number } | null = null;

  function pickShip(event: PointerEvent): string | null {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, stage.camera);

    const targets: THREE.Object3D[] = [];
    for (const die of decks.you.dice.values()) targets.push(die.object);
    const hits = raycaster.intersectObjects(targets, true);
    for (const hit of hits) {
      let node: THREE.Object3D | null = hit.object;
      while (node) {
        const id = node.userData.shipId as string | undefined;
        if (id) return id;
        node = node.parent;
      }
    }
    return null;
  }

  const onPointerDown = (event: PointerEvent) => {
    downAt = { x: event.clientX, y: event.clientY, t: performance.now() };
  };
  const onPointerUp = (event: PointerEvent) => {
    if (!downAt || !options.onTapDie) return;
    const moved = Math.hypot(event.clientX - downAt.x, event.clientY - downAt.y);
    const held = performance.now() - downAt.t;
    downAt = null;
    // A drag or a long press is not a tap — phones send a lot of both.
    if (moved > 12 || held > 700) return;
    const shipId = pickShip(event);
    if (shipId) options.onTapDie(shipId);
  };

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", () => {
    downAt = null;
  });

  /* Frame loop ------------------------------------------------------- */

  const stopFrame = stage.onFrame((dt, time) => {
    for (const deck of Object.values(decks)) {
      deck.board.update(dt, time);
      for (const die of deck.dice.values()) die.update(dt, time);
    }
    vfx.update(dt, time);
  });

  // Apply the responsive frame on first paint too. Calling setFocus("fleet")
  // immediately afterward is intentionally a no-op, so using the raw phone
  // frame here meant desktop never received its safe framing until a resize.
  stage.setFrame(frameFor("fleet", isPhone()), true);
  stage.start();

  /* Reconciling ------------------------------------------------------ */

  /**
   * Bring one deck in line with one player's state.
   *
   * Dice are matched by ship id, so a fleet that grows, shrinks or gets
   * rearranged in the shipyard never rebuilds the ones that did not change —
   * which is what lets a die keep its face while its neighbour is rerolled.
   */
  function syncDeck(
    deckKey: "you" | "enemy",
    player: PlayerState,
    show: boolean,
    opts: SyncOptions,
  ) {
    const deck = decks[deckKey];
    const wanted = new Map<string, { kind: DieKind; cell: number; value: number; disabled: boolean }>();

    for (const ship of player.ships) {
      const die = player.dice.find((entry) => entry.id === ship.id);
      wanted.set(ship.id, {
        kind: ship.sides as DieKind,
        cell: cellForSlot(ship.slot),
        value: die?.value ?? 0,
        disabled: ship.disabledRound === player.round,
      });
    }
    const flagDie = player.dice.find((entry) => entry.flag);
    wanted.set("flag", {
      kind: "flag",
      cell: 4,
      value: flagDie?.value ?? player.flag.face,
      disabled: false,
    });

    // Retire anything that left the fleet.
    for (const [id, die] of deck.dice) {
      if (!wanted.has(id)) {
        die.dispose();
        deck.dice.delete(id);
      }
    }

    for (const [id, spec] of wanted) {
      let die = deck.dice.get(id);
      if (die && die.kind !== spec.kind) {
        // An upgrade swaps the hull, so the old die is replaced outright.
        die.dispose();
        deck.dice.delete(id);
        die = undefined;
      }
      if (!die) {
        // On a phone the face, not the board decoration, is the product. The
        // larger hulls fill their cells while the atlas keeps their values and
        // payoff marks clean at the steeper command angle. The flagship reads
        // a touch smaller than a hull ship — just enough that its own cyan
        // reroll ring, now the same size as every other ship's, still clears
        // the cube underneath it.
        const base = isPhone() ? 1.66 : 1.14;
        die = createDie(spec.kind, font, spec.kind === "flag" ? base * 0.93 : base, CELL, isPhone());
        die.object.userData.shipId = id;
        die.object.traverse((node) => {
          node.userData.shipId = id;
        });
        deck.root.add(die.object);
        deck.dice.set(id, die);
        const home = cellCentre(spec.cell);
        home.y = die.seatHeight;
        die.setHome(home);
        die.object.position.copy(home);
        die.setFace(spec.value || 1);
      }

      const home = cellCentre(spec.cell);
      home.y = die.seatHeight;
      die.setHome(home);

      // A ship that exists but has not rolled yet is shown blank, not removed.
      // Seeing the shape and size of the enemy fleet is information you would
      // have across a table, and an empty enemy deck reads as a bug. A
      // disabled ship never rolls this round at all, so its value stays 0
      // for the whole round — without the disabled exception it would sit
      // blank all round, indistinguishable from a ship about to roll.
      const facedown = !show || (spec.value === 0 && !spec.disabled);
      die.object.visible = true;
      die.setState({ facedown });

      const asked = opts.thrown?.has(id) ?? false;
      const changed = spec.value !== die.value;
      // A second sync while the die is already flying to this face used to
      // yank it back into the air. Same number, same throw — leave it alone.
      const alreadyFlyingThere = die.rolling && spec.value === die.value;
      // A disabled ship never rolls this round, so spec.value sits at 0
      // (clampFace floors a real die's value at 1) for as long as it stays
      // disabled — without this exception every resync would read that as
      // "changed" and keep re-throwing it to face 1, fighting the flattened
      // pose it is meant to settle into. It just keeps showing whatever it
      // last rolled.
      if (!facedown && !spec.disabled && !alreadyFlyingThere && (changed || asked)) {
        if (opts.instant) die.setFace(spec.value);
        else {
          die.throwTo(spec.value, {
            delay: Math.random() * 0.12,
            duration: 0.72 + Math.random() * 0.16,
            onLand: () => decks[deckKey].board.impact(spec.cell, 0.55),
          });
        }
      }

      die.setState({
        selected: deckKey === "you" && (opts.selected?.has(id) ?? false),
        damageSelected: deckKey === "you" && (opts.damageSelected?.has(id) ?? false),
        blockable: deckKey === "you" && (opts.blockable?.has(id) ?? false),
        disabled: spec.disabled,
        enemy: deckKey === "enemy",
      });
    }

    const emptySlots = new Set(emptyOpenSlots(player));
    for (let cell = 0; cell < 9; cell += 1) {
      if (cell === 4) {
        deck.board.setCellOpen(cell, true);
        deck.board.setCellEmpty(cell, false);
        continue;
      }
      const slot = cell < 4 ? cell : cell - 1;
      const open = player.open[slot] ?? false;
      deck.board.setCellOpen(cell, open);
      deck.board.setCellEmpty(cell, emptySlots.has(slot));
    }

    applyScoreMarks(
      deck,
      player,
      show,
      deckKey === "you" ? opts.previewTally : undefined,
      opts.showRunMarks !== false,
    );
  }

  /** What `setFormations` last drew on each deck, for the screenshot harness. */
  const lastFormations = new Map<string, { kind: string; cells: number[]; amount: number }[]>();

  /** Steady formation rails, straight bars and flagship matching markers. */
  function applyScoreMarks(
    deck: DeckState,
    player: PlayerState,
    show: boolean,
    liveTally?: Tally | null,
    showRun = true,
  ) {
    const tally: Tally | null = liveTally ?? player.tally;
    if (!show) {
      deck.board.setRunCells([]);
      deck.board.setFormations([]);
      for (const die of deck.dice.values()) die.setState({ inRun: false, inLine: null, flagRing: false });
      return;
    }

    // The opponent's revealed fleet should not turn into a second HUD: their
    // orange run markers were easily mistaken for damage symbols, so the run
    // stays ours alone.
    //
    // Formations are the exception, and deliberately so. A row or a column is
    // where a big number on the damage report comes from — a column is +10
    // Attack, which can be half a volley — and with no rail on their deck the
    // only way to understand a 22 was to count their dice and know the rules.
    // The rail is already the one mark for that meaning, in the same two
    // colours on both decks, so reusing it explains their number the way it
    // explains ours. Flagship rings were never gated either, which left their
    // board explaining one of its bonuses and not the other.
    //
    // No information leaks: `show` for the enemy deck is `reveal`, so none of
    // this is drawn until their dice are face up.
    const playerDeck = deck === decks.you;
    const run = showRun && playerDeck ? (tally?.run ?? null) : null;
    const runCells: number[] = [];
    const lines = tally?.lines ?? [];
    const lineCells = new Map<number, "row" | "col">();
    for (const line of lines) {
      for (const cell of line.idx) lineCells.set(cell, line.kind);
    }
    const drawn = lines.map((line) => ({
      kind: line.kind,
      cells: line.idx,
      amount: line.kind === "row" ? line.energy : line.attack,
    }));
    lastFormations.set(deck === decks.you ? "you" : "enemy", drawn);
    deck.board.setFormations(drawn);

    const runMembers = run ? runMemberIds(player.dice, run) : new Set<string>();
    const face = player.flag.face;
    const ringsAll = face === 5 || face === 6;

    for (const [id, die] of deck.dice) {
      const value = die.value;
      const ship = player.ships.find((entry) => entry.id === id);
      const cell = id === "flag" ? 4 : ship ? cellForSlot(ship.slot) : -1;
      const inRun = runMembers.has(id);
      if (inRun && cell >= 0) runCells.push(cell);

      const flagRing =
        id !== "flag" &&
        (ringsAll
          ? face === 5
            ? value % 2 === 1
            : value % 2 === 0
          : value === face && face >= 2 && face <= 4);

      die.setState({
        inRun,
        inLine: cell >= 0 ? (lineCells.get(cell) ?? null) : null,
        flagRing,
        flagRingColor: FLAG_FACE_PALETTE[face]?.ring ?? 0xffd23d, // fallback: --color-energy
      });
    }
    deck.board.setRunCells(runCells);
  }

  let lastFocus: Focus = "fleet";
  let lastReveal = false;

  function refreshEnemyVisibility() {
    decks.enemy.root.visible = lastReveal || !isPhone() || lastFocus !== "fleet";
  }

  const refreshFrame = () => stage.setFrame(frameFor(lastFocus, isPhone()), true);
  window.addEventListener("resize", refreshFrame);

  const arena: Arena = {
    stage,
    vfx,
    sync(state, side, opts = {}) {
      const you = state.players[side];
      const them = state.players[opponentOf(side)];
      if (you) syncDeck("you", you, true, opts);
      if (them) {
        const reveal = opts.revealEnemy ?? them.dice.length > 0;
        lastReveal = reveal;
        syncDeck("enemy", them, reveal, opts);
        refreshEnemyVisibility();
      }
    },
    setFocus(focus, immediate) {
      if (focus === lastFocus && !immediate) return;
      lastFocus = focus;
      stage.setFrame(frameFor(focus, isPhone()), immediate);
      refreshEnemyVisibility();
    },
    cellWorld(side, cell) {
      const local = cellCentre(cell);
      return local.add(side === "you" ? YOUR_DECK : ENEMY_DECK);
    },
    flagshipWorld(side) {
      const at = arena.cellWorld(side, 4);
      at.y += 1.1;
      return at;
    },
    nudgeShip(side, shipId, strength = 1) {
      decks[side].dice.get(shipId)?.nudge(strength);
    },
    scatterDice(side) {
      for (const die of decks[side].dice.values()) {
        // Cell positions are local to the deck root, centred on the
        // flagship's own cell — so a die's own position already points
        // outward from the blast. A die sitting dead centre (the flagship
        // itself, or a ship whose home coincides with it) gets a random
        // direction instead of a zero vector.
        const outward = new THREE.Vector2(die.object.position.x, die.object.position.z);
        let angle = outward.lengthSq() > 0.0001 ? Math.atan2(outward.y, outward.x) : Math.random() * Math.PI * 2;
        // A perfectly radial burst reads as a diagram, not a detonation.
        angle += (Math.random() - 0.5) * 1.1;
        const power = 7 + Math.random() * 6;
        die.launch(
          new THREE.Vector3(Math.cos(angle) * power, 6 + Math.random() * 5, Math.sin(angle) * power),
        );
      }
    },
    boardOf(side) {
      return decks[side].board;
    },
    whenSettled(side = "you") {
      return new Promise<void>((resolve) => {
        const started = performance.now();
        const tick = () => {
          if (!settledAlive) {
            resolve();
            return;
          }
          const flying = [...decks[side].dice.values()].some((die) => die.rolling);
          if (!flying || performance.now() - started > 2200) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
    },
    dispose() {
      settledAlive = false;
      window.removeEventListener("resize", refreshFrame);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointerup", onPointerUp);
      stopFrame();
      for (const deck of Object.values(decks)) {
        for (const die of deck.dice.values()) die.dispose();
        deck.dice.clear();
        deck.board.dispose();
      }
      vfx.dispose();
      stage.dispose();
    },
  };

  // A hatch for the screenshot harness. Costs nothing and has saved hours.
  if (typeof window !== "undefined") {
    (window as unknown as { __fd3?: unknown }).__fd3 = {
      arena,
      tap(id: string) {
        options.onTapDie?.(id);
      },
      debug() {
        const out: Record<string, unknown> = {};
        for (const [key, deck] of Object.entries(decks)) {
          out[key] = [...deck.dice.entries()].map(([id, die]) => ({
            id,
            kind: die.kind,
            value: die.value,
            rolling: die.rolling,
            ...die.stats(),
          }));
        }
        // Rails are drawn in WebGL and are otherwise unreachable from the DOM.
        out.formations = Object.fromEntries(lastFormations);
        return out;
      },
    };
  }

  return arena;
}

function makeDeck(
  side: "you" | "enemy",
  at: THREE.Vector3,
  font: string,
  stage: Stage,
): DeckState {
  const root = new THREE.Group();
  root.position.copy(at);
  stage.world.add(root);
  const board = createBoard(side, font);
  root.add(board.group);
  return { board, dice: new Map(), root };
}

/** Active ships on a board, for the brace screen. */
export function braceCandidates(player: PlayerState) {
  return activeShips(player, player.round);
}
