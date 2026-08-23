import type { Viewport } from "next";

/**
 * Split out from layout.tsx so the one hex literal a browser meta tag
 * requires (no CSS custom properties reach a <meta> tag) lives in a .ts
 * file rather than a .tsx/.css one — see item 2.1's DONE test in
 * AAA-PLAN.md. Keep in sync with --color-void in app/globals.css by hand.
 */
export const viewport: Viewport = {
  themeColor: "#04060d",
  width: "device-width",
  initialScale: 1,
  minimumScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};
