"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { getDb } from "@/server/db/client";
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
  if (typeof value !== "string" || value.trim() === "") return null;
  return Number(value.replace(",", "."));
}

export async function saveSettings(_prev: SettingsState, form: FormData): Promise<SettingsState> {
  const session = await auth();
  if (!session?.user) return { error: "Not signed in" };

  const parsed = profileSchema.safeParse({
    name: form.get("name"),
    targetKcal: optionalNumber(form.get("targetKcal")),
    targetProteinG: optionalNumber(form.get("targetProteinG")),
    targetCarbsG: optionalNumber(form.get("targetCarbsG")),
    targetFatG: optionalNumber(form.get("targetFatG")),
    targetFibreG: optionalNumber(form.get("targetFibreG")),
    defaultFastingDays: form.getAll("fastingDays").map(Number),
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = String(issue.path[0] ?? "");
    return { error: `${LABELS[field] ?? "Input"}: ${issue.message}` };
  }

  // Each person edits only their own profile.
  await updateProfile(getDb(), session.user.id, parsed.data);
  revalidatePath("/", "layout");
  return { ok: true };
}
