"use client";

import { CloudAlert } from "lucide-react";
import Link from "next/link";

import { Button, buttonClass } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";

// Anything a page throws (Postgres restarting, a bug) lands here, inside the
// app's header, so there is always a way to retry or get back to the plan.
export default function AppError({ retry }: { retry: () => void }) {
  return (
    <Notice
      className="py-12"
      icon={<CloudAlert />}
      title="Something went wrong"
      actions={
        <>
          <Button size="lg" block onClick={() => retry()}>
            Try again
          </Button>
          <Link href="/week" className={buttonClass({ variant: "ghost" })}>
            Back to this week
          </Link>
        </>
      }
    >
      <p>
        This page couldn&apos;t load. It may work if you try again in a moment.
      </p>
    </Notice>
  );
}
