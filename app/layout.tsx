import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { ViewportSync } from "@/components/ViewportSync";

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

export const viewport: Viewport = {
  themeColor: "#04060d",
  width: "device-width",
  initialScale: 1,
  minimumScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body>
        <ViewportSync />
        {children}
      </body>
    </html>
  );
}
