/**
 * How long to wait before trying a dropped connection again.
 *
 * Pure and separate from the hook that uses it so the schedule can be checked
 * without a browser: the failure this guards against — a phone with no signal
 * being hammered once a frame — is invisible in testing and expensive in
 * battery, so the shape of the curve is worth pinning down.
 */
export const RECONNECT_FIRST_MS = 800;
export const RECONNECT_MAX_MS = 15_000;

export function reconnectDelay(
  attempt: number,
  first = RECONNECT_FIRST_MS,
  max = RECONNECT_MAX_MS,
): number {
  const safe = Math.max(0, Math.floor(attempt));
  // 2 ** 40 overflows into Infinity long before a phone gets there, and
  // Math.min would happily return it.
  if (safe > 30) return max;
  return Math.min(max, first * 2 ** safe);
}
