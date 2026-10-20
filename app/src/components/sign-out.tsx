"use client";

import { clearDeviceData } from "./pwa";

export const SignOut = ({
  action,
  name,
}: {
  action: () => Promise<void>;
  name: string;
}) => {
  return (
    <form action={action} onSubmit={clearDeviceData}>
      <button type="submit" className="text-sm text-muted">
        Sign out {name}
      </button>
    </form>
  );
};
