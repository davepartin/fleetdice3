export type MotionStyle = "full" | "reduced";
export function reducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  try { if (localStorage.getItem("fd3.motion") === "reduced") return true; } catch { /* use system preference */ }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
export function setMotionStyle(style: MotionStyle) {
  try { localStorage.setItem("fd3.motion", style); } catch { /* session still works */ }
  window.dispatchEvent(new Event("fd3-motion"));
}
