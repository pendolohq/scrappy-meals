import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";

import { Pwa } from "@/components/pwa";
import { ThemeSync } from "@/components/theme-sync";
import { TimeZoneSync } from "@/components/time-zone-sync";
import { BAR_COLOR, themeScript } from "@/lib/theme";

import "./globals.css";

// Fraunces from the npm package rather than next/font/google, so the build
// doesn't need to reach Google either. One variable file covers every weight
// and the optical size axis, which keeps large titles crisp.
const fraunces = localFont({
  src: "../../node_modules/@fontsource-variable/fraunces/files/fraunces-latin-opsz-normal.woff2",
  weight: "100 900",
  variable: "--font-fraunces",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Scrappy Meals",
  description: "Shared weekly meal planner on top of Mealie",
  applicationName: "Scrappy Meals",
  appleWebApp: { capable: true, title: "Meals", statusBarStyle: "default" },
  icons: { icon: "/icons/icon.svg", apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // Light, like the page; ThemeSync swaps it when the theme is dark.
  themeColor: BAR_COLOR.light,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    // The inline script may set data-theme="dark" before React hydrates.
    <html lang="en" className={fraunces.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-dvh bg-background text-foreground antialiased">
        <ThemeSync />
        <TimeZoneSync />
        <Pwa />
        {children}
      </body>
    </html>
  );
}
