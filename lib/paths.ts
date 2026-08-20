/**
 * Where the app is mounted.
 *
 * GitHub Pages serves a project site under `/fleetdice3/`, so every hand-built
 * link and every invite URL has to carry that prefix. `next.config.ts` puts the
 * same value here at build time.
 */
export const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/** An app path with the base prefix on the front. */
export function href(path: string): string {
  const clean = path.startsWith("/") ? path : `/${path}`;
  return `${basePath}${clean}`;
}
