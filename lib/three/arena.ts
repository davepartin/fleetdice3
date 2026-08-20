/**
 * The arena: two decks, every die on them, and the camera that watches.
 *
 * This is the only place that knows both the rules and the renderer. React
 * hands it a match state; it works out what changed and animates the
 * difference. Nothing above it ever touches a mesh.
 */

import * as THREE from "three";
import type { MatchState, PlayerState, SideId, Tally } from "../engine";
import { activeShips, cellForSlot, opponentOf } from "../engine";
import { createStage, type Quality, type Stage } from "./stage";
import { createBoard, cellCentre, type Board } from "./board";
import { createDie, type Die, type DieKind } from "./die";
import { createVfx, type Vfx } from "./vfx";
import { displayFontFamily } from "./fonts";

/** Where each deck sits in the world. */
export const YOUR_DECK = new THREE.Vector3(0, 0, 5.2);
export const ENEMY_DECK = new THREE.Vector3(0, 0, -7.9);

export type Focus = "fleet" | "both" | "enemy" | "wide";

const FRAMES: Record<Focus, { pitch: number; fitWidth: number; fitDepth: number; target: THREE.Vector3 }> = {
  // Aimed below the deck on purpose: the action dock covers the bottom of a
  // phone screen, so the board has to sit high in the frame or the near row of
  // ships hides behind it.
  fleet: { pitch: 51, fitWidth: 12.6, fitDepth: 12.6, target: new THREE.Vector3(0, -2.6, 5.2) },
  both: { pitch: 57, fitWidth: 13.8, fitDepth: 24.5, target: new THREE.Vector3(0, -3.4, -1.4) },
  enemy: { pitch: 49, fitWidth: 13.2, fitDepth: 13.2, target: new THREE.Vector3(0, 0.3, -7.9) },
  wide: { pitch: 34, fitWidth: 20, fitDepth: 20, target: new THREE.Vector3(0, 1.4, 0) },
};

/**
 * A wide monitor has far less vertical room than a phone once the action dock
 * is present. Pull the camera back there instead of letting a giant board run
 * under the controls and off both edges of the screen.
 */
const LANDSCAPE_DEPTH: Record<Focus, number> = {
  fleet: 17.5,
  both: 29,
  enemy: 17.5,
  wide: 26,
};

function frameFor(focus: Focus) {
  const base = FRAMES[focus];
  const landscape = window.innerWidth >= 900 && window.innerWidth > window.innerHeight;
  return landscape ? { ...base, fitDepth: LANDSCAPE_DEPTH[focus] } : base;
}

export type ArenaOptions = {
  quality?: Quality;
  /** Called when a die on your own deck is tapped. */
  onTapDie?: (shipId: string) => void;
};

export type SyncOptions = {
  /** Skip the throw animation — used the first time a board appears. */
  instant?: boolean;
  /** Ship ids currently picked for a reroll. */
  selected?: Set<string>;
  /** Show the enemy's dice. False until both commanders have locked in. */
  revealEnemy?: boolean;
  /**
   * Ship ids that were just sent back. These always animate, even when the die
   * comes up on the same number — a reroll that looks like nothing happened
   * feels broken, and it happens about one time in four.
   */
  thrown?: Set<string>;
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
  boardOf(side: "you" | "enemy"): Board;
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

  stage.setFrame(FRAMES.fleet, true);
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
        die = createDie(spec.kind, font, 1.14);
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
      // have across a table, and an empty enemy deck reads as a bug.
      const facedown = !show || spec.value === 0;
      die.object.visible = true;
      die.setState({ facedown });

      const asked = opts.thrown?.has(id) ?? false;
      // Re-throwing a die that is already in the air is fine — it simply starts
      // a fresh flight toward the new number. Skipping it instead left the die
      // showing a face the scoreboard had already moved past.
      const changed = spec.value !== die.value;
      if (!facedown && (changed || asked)) {
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
        disabled: spec.disabled,
        enemy: deckKey === "enemy",
      });
    }

    for (let cell = 0; cell < 9; cell += 1) {
      if (cell === 4) {
        deck.board.setCellOpen(cell, true);
        continue;
      }
      const slot = cell < 4 ? cell : cell - 1;
      deck.board.setCellOpen(cell, player.open[slot] ?? false);
    }

    applyScoreMarks(deck, player, show);
  }

  /** Orange bars for the straight, rings for the flagship's matching ships. */
  function applyScoreMarks(deck: DeckState, player: PlayerState, show: boolean) {
    const tally: Tally | null = player.tally;
    if (!show) {
      deck.board.setRunCells([]);
      for (const die of deck.dice.values()) die.setState({ inRun: false, inLine: null, flagRing: false });
      return;
    }

    const run = tally?.run ?? null;
    const runCells: number[] = [];
    const lineCells = new Map<number, "row" | "col">();
    for (const line of tally?.lines ?? []) {
      for (const cell of line.idx) lineCells.set(cell, line.kind);
    }

    const face = player.flag.face;
    const ringsAll = face === 5 || face === 6;

    for (const [id, die] of deck.dice) {
      const value = die.value;
      const ship = player.ships.find((entry) => entry.id === id);
      const cell = id === "flag" ? 4 : ship ? cellForSlot(ship.slot) : -1;
      const inRun = Boolean(run && value >= run.start && value <= run.top);
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
      });
    }
    deck.board.setRunCells(runCells);
  }

  let lastFocus: Focus = "fleet";
  const refreshFrame = () => stage.setFrame(frameFor(lastFocus), true);
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
        syncDeck("enemy", them, reveal, opts);
      }
    },
    setFocus(focus, immediate) {
      if (focus === lastFocus && !immediate) return;
      lastFocus = focus;
      stage.setFrame(frameFor(focus), immediate);
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
    boardOf(side) {
      return decks[side].board;
    },
    dispose() {
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
