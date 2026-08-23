import type { Metadata } from "next";
import localFont from "next/font/local";
import { ViewportSync } from "@/components/ViewportSync";
import "./globals.css";

/**
 * Fonts ship with the site rather than coming from Google, so the game loads
 * on a plane, in a school wifi, or anywhere a font CDN is blocked.
 */
const display = localFont({
  src: [
    { path: "../public/fonts/oxanium-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "../public/fonts/oxanium-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "../public/fonts/oxanium-latin-700-normal.woff2", weight: "700", style: "normal" },
    { path: "../public/fonts/oxanium-latin-800-normal.woff2", weight: "800", style: "normal" },
  ],
  variable: "--font-display",
  display: "block",
  fallback: ["system-ui", "sans-serif"],
});

const body = localFont({
  src: [
    { path: "../public/fonts/inter-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "../public/fonts/inter-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "../public/fonts/inter-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "../public/fonts/inter-latin-700-normal.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-body",
  display: "swap",
  fallback: ["system-ui", "sans-serif"],
});

/**
 * Dice numerals only — never referenced by any CSS rule that touches real
 * page text. A numeral is read at ~40px, tilted away from the eye, on a
 * saturated field: it needs the plainest, heaviest, most closed shapes
 * available, which is exactly what a display face like Oxanium gives up at
 * that size.
 */
const numeral = localFont({
  src: [{ path: "../public/fonts/archivoblack-latin-900-normal.woff2", weight: "900", style: "normal" }],
  variable: "--font-numeral-face",
  display: "block",
  fallback: ["Arial Black", "sans-serif"],
});

export const metadata: Metadata = {
  title: "Fleet Dice 3",
  description:
    "Build the fleet. Break the flagship. A two-player dice battle you can play in any browser.",
  applicationName: "Fleet Dice 3",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Fleet Dice" },
  openGraph: {
    title: "Fleet Dice 3",
    description: "Build the fleet. Break the flagship.",
    type: "website",
  },
};

export { viewport } from "./viewport";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${numeral.variable}`}>
      <body>
        <ViewportSync />
        {children}
      </body>
    </html>
  );
}
