import type { Metadata, Viewport } from "next";

import { Pwa } from "@/components/pwa";

import "./globals.css";

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
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafaf9" },
    { media: "(prefers-color-scheme: dark)", color: "#1c1917" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-dvh bg-background text-foreground antialiased">
        <Pwa />
        {children}
      </body>
    </html>
  );
}
