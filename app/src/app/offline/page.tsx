import { WifiOff } from "lucide-react";

import { buttonClass } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";

export const dynamic = "force-static";

// Served by the service worker when you're offline and the page isn't cached yet.
export default function Offline() {
  return (
    <main className="flex min-h-dvh items-center px-4 py-10">
      <Notice
        icon={<WifiOff />}
        title="You're offline"
        actions={
          // oxlint-disable-next-line nextjs/no-html-link-for-pages -- a full load lets the service worker serve the cached week
          <a href="/week" className={buttonClass({ size: "lg", block: true })}>
            Open this week
          </a>
        }
      >
        <p>
          Weeks you&apos;ve opened recently are still available. Changes need a
          connection.
        </p>
      </Notice>
    </main>
  );
}
