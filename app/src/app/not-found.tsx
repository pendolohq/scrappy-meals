import { SearchX } from "lucide-react";
import Link from "next/link";

import { buttonClass } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";

// Shown for unknown addresses and for notFound() (a recipe that's gone from Mealie).
export default function NotFound() {
  return (
    <div className="flex min-h-[70dvh] items-center px-4 py-10">
      <Notice
        icon={<SearchX />}
        title="Nothing here"
        actions={
          <Link
            href="/week"
            className={buttonClass({ size: "lg", block: true })}
          >
            Back to this week
          </Link>
        }
      >
        <p>This page doesn&apos;t exist, or what it showed has been removed.</p>
      </Notice>
    </div>
  );
}
