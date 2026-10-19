"use client";

import { signOutAction } from "@/app/(app)/actions";

import { clearDeviceData } from "./pwa";

export const SignOut = ({ name }: { name: string }) => {
  return (
    <form
      action={async () => {
        await signOutAction({});
      }}
      onSubmit={clearDeviceData}
    >
      <button type="submit" className="text-sm text-muted">
        Sign out {name}
      </button>
    </form>
  );
};
