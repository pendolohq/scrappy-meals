"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { userAction, userFormAction } from "@/server/action";
import { getDb } from "@/server/db/client";
import { MAX_SNACK_SLOTS } from "@/server/domain/slots";
import { setSnackSlots } from "@/server/household";
import { profileSchema, updateProfile } from "@/server/users";

export type SettingsState = { ok?: boolean; error?: string };

const LABELS: Record<string, string> = {
  name: "Name",
  targetKcal: "Calories",
  targetProteinG: "Protein",
  targetCarbsG: "Carbs",
  targetFatG: "Fat",
  targetFibreG: "Fibre",
  defaultFastingDays: "Fasting days",
};

function optionalNumber(value: FormDataEntryValue | null): number | null {
  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }
  return Number(value.replace(",", "."));
}

const fromForm = z.preprocess(
  (form) =>
    form instanceof FormData
      ? {
          name: form.get("name"),
          targetKcal: optionalNumber(form.get("targetKcal")),
          targetProteinG: optionalNumber(form.get("targetProteinG")),
          targetCarbsG: optionalNumber(form.get("targetCarbsG")),
          targetFatG: optionalNumber(form.get("targetFatG")),
          targetFibreG: optionalNumber(form.get("targetFibreG")),
          defaultFastingDays: form.getAll("fastingDays").map(Number),
        }
      : form,
  profileSchema
);

// Each person edits only their own profile.
export const saveSettings = userFormAction(
  fromForm,
  async (profile, user) => {
    await updateProfile(getDb(), user.id, profile);
    revalidatePath("/", "layout");
    return { ok: true };
  },
  {
    invalid: (err) => {
      const issue = err.issues[0];
      const field = String(issue.path[0] ?? "");
      return `${LABELS[field] ?? "Input"}: ${issue.message}`;
    },
  }
);

// Household-wide on purpose: anyone signed in may change it, like the plan itself.
export const saveHouseholdAction = userAction(
  z.object({ snackSlots: z.int().min(0).max(MAX_SNACK_SLOTS) }),
  async ({ snackSlots }) => {
    await setSnackSlots(getDb(), snackSlots);
    revalidatePath("/", "layout");
    return {};
  }
);
