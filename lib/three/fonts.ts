/**
 * The display family, resolved at runtime.
 *
 * Next hashes local font families into names like `__display_a1b2c3`, and the
 * canvas that draws the numbers on the dice needs the real name — so read it
 * back off the document rather than guessing.
 */
export function displayFontFamily(): string {
  if (typeof window === "undefined") return "sans-serif";
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue("--font-display")
    .trim();
  return value || "system-ui, sans-serif";
}

/**
 * The numeral-only face, for the big digit on a die's rolled face — never
 * used anywhere in the DOM. See `--font-numeral-face` in `app/layout.tsx`.
 */
export function numeralFontFamily(): string {
  if (typeof window === "undefined") return "sans-serif";
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue("--font-numeral-face")
    .trim();
  return value || "Arial Black, sans-serif";
}

/** Wait until the display and numeral fonts are really available before painting dice faces. */
export async function waitForFonts(): Promise<void> {
  if (typeof document === "undefined" || !document.fonts) return;
  try {
    await document.fonts.ready;
    await Promise.all([
      document.fonts.load(`800 64px ${displayFontFamily()}`),
      document.fonts.load(`900 64px ${numeralFontFamily()}`),
    ]);
  } catch {
    // A missing font is a cosmetic problem, never a reason to fail to boot.
  }
}
