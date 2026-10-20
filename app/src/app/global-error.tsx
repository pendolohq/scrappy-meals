"use client";

import { CloudAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";

import "./globals.css";

// Replaces the root layout when it fails, so it brings its own <html>.
export default function GlobalError({ retry }: { retry: () => void }) {
  return (
    <html lang="en">
      <body className="min-h-dvh bg-background text-foreground antialiased">
        <main className="flex min-h-dvh items-center px-4 py-10">
          <title>Scrappy Meals</title>
          <Notice
            icon={<CloudAlert />}
            title="Something went wrong"
            actions={
              <Button size="lg" block onClick={() => retry()}>
                Try again
              </Button>
            }
          />
        </main>
      </body>
    </html>
  );
}
