import type { NextConfig } from "next";

/**
 * The game is served from the root of its own domain,
 * https://fleetdice.ministrybag.com, so there is no path prefix. `public/CNAME`
 * carries that domain into every build — without it in the artifact, Pages
 * drops the custom domain on the next deploy and the site moves back to
 * davepartin.github.io/fleetdice3/ with every asset pointing at the wrong place.
 *
 * `BASE_PATH` still exists for a build served under a path.
 */
const basePath = process.env.BASE_PATH ?? "";
/**
 * Where this build will be served from. Only Open Graph needs it: a share
 * preview has to name an absolute image URL, and the same game is served from
 * two hosts — GitHub Pages and ministrybag.com — so it cannot be hardcoded.
 */
const siteUrl = process.env.SITE_URL ?? "https://fleetdice.ministrybag.com";

const nextConfig: NextConfig = {
  output: "export",
  basePath: basePath || undefined,
  assetPrefix: basePath || undefined,
  images: { unoptimized: true },
  trailingSlash: true,
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
    NEXT_PUBLIC_SITE_URL: siteUrl,
  },
};

export default nextConfig;
