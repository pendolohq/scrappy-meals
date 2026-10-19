import { auth } from "@/auth";
import { getDb } from "@/server/db/client";
import { findUserById } from "@/server/users";

import { SettingsForm } from "./settings-form";

export default async function SettingsPage() {
  const session = await auth();
  const user = session?.user && (await findUserById(getDb(), session.user.id));
  if (!user) return null;

  return (
    <section>
      <h1 className="mb-4 text-lg font-semibold">Your settings</h1>
      <SettingsForm
        profile={{
          name: user.name,
          targetKcal: user.targetKcal,
          targetProteinG: user.targetProteinG,
          targetCarbsG: user.targetCarbsG,
          targetFatG: user.targetFatG,
          targetFibreG: user.targetFibreG,
          defaultFastingDays: user.defaultFastingDays,
        }}
      />
    </section>
  );
}
