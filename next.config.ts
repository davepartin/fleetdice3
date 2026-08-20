import type { NextConfig } from "next";

/** Project Pages URL: https://davepartin.github.io/fleetdice3/ */
const basePath = process.env.BASE_PATH ?? "/fleetdice3";

const nextConfig: NextConfig = {
  output: "export",
  basePath: basePath || undefined,
  assetPrefix: basePath || undefined,
  images: { unoptimized: true },
  trailingSlash: true,
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
};

export default nextConfig;
