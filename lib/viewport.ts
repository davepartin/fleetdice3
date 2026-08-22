/**
 * The real screen the player can see.
 *
 * Phones lie about their size. Android display scaling, the Chrome address
 * bar, a pinch-zoom, and turning the phone on its side all change a different
 * number. Layout that trusts `window.innerWidth` alone will fit one phone and
 * clip another. Everything that frames the board should ask here instead.
 */

export type VisibleViewport = {
  /** Layout pixels the HUD and canvas should be sized to (browser zoom undone). */
  width: number;
  height: number;
  offsetLeft: number;
  offsetTop: number;
  /** Browser pinch scale. 1 means no page zoom. */
  scale: number;
};

export function visibleViewport(): VisibleViewport {
  if (typeof window === "undefined") {
    return { width: 390, height: 844, offsetLeft: 0, offsetTop: 0, scale: 1 };
  }
  const view = window.visualViewport;
  const scale = view?.scale || 1;
  const cssWidth = view?.width ?? window.innerWidth;
  const cssHeight = view?.height ?? window.innerHeight;
  return {
    width: cssWidth * scale,
    height: cssHeight * scale,
    offsetLeft: view?.offsetLeft ?? 0,
    offsetTop: view?.offsetTop ?? 0,
    scale,
  };
}

/** True when the short side of the visible screen is phone-sized. */
export function isPhoneLayout(): boolean {
  if (typeof window === "undefined") return false;
  const view = visibleViewport();
  return Math.min(view.width, view.height) <= 640;
}

/** Write the visible screen onto :root so CSS can follow it. */
export function syncViewportCss(root: HTMLElement = document.documentElement): VisibleViewport {
  const view = visibleViewport();
  const inverse = view.scale ? 1 / view.scale : 1;
  root.style.setProperty("--vv-left", `${view.offsetLeft}px`);
  root.style.setProperty("--vv-top", `${view.offsetTop}px`);
  root.style.setProperty("--vv-width", `${view.width}px`);
  root.style.setProperty("--vv-height", `${view.height}px`);
  root.style.setProperty("--vv-inv-scale", String(inverse));
  return view;
}
