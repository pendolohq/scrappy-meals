import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";

import { Pwa } from "@/components/pwa";

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
  // --background in globals.css; metadata can't read CSS variables.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6efe0" },
    { media: "(prefers-color-scheme: dark)", color: "#1e1a15" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={fraunces.variable}>
      <body className="min-h-dvh bg-background text-foreground antialiased">
        <Pwa />
        {children}
      </body>
    </html>
  );
}
