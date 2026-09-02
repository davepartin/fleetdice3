import type { NextConfig } from "next";

/** Project Pages URL: https://davepartin.github.io/fleetdice3/ */
const basePath = process.env.BASE_PATH ?? "/fleetdice3";
/**
 * Where this build will be served from. Only Open Graph needs it: a share
 * preview has to name an absolute image URL, and the same game is served from
 * two hosts — GitHub Pages and ministrybag.com — so it cannot be hardcoded.
 */
const siteUrl = process.env.SITE_URL ?? "https://davepartin.github.io";

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
