/**
 * Where the app is mounted.
 *
 * GitHub Pages serves a project site under `/fleetdice3/`. Next's Link and
 * router APIs add that prefix themselves; direct browser redirects and invite
 * URLs still need it. `next.config.ts` puts the value here at build time.
 */
export const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/** A direct browser path with the base prefix on the front. */
export function href(path: string): string {
  const clean = path.startsWith("/") ? path : `/${path}`;
  return `${basePath}${clean}`;
}
