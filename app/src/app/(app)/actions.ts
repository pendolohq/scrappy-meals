"use server";

import { z } from "zod";

import { signOut } from "@/auth";
import { userAction } from "@/server/action";

export const signOutAction = userAction(z.unknown(), async () => {
  await signOut({ redirectTo: "/login" });
  return {};
});
