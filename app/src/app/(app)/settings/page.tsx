import { PageHeader } from "@/components/ui/page-header";
import { getDb } from "@/server/db/client";
import { requireUser } from "@/server/session";
import { findUserById } from "@/server/users";

import { SettingsForm } from "./settings-form";

export default async function SettingsPage() {
  const { id } = await requireUser();
  const user = await findUserById(getDb(), id);
  if (!user) {
    return null;
  }

  return (
    <section className="space-y-6 pb-8">
      <PageHeader
        title="Your settings"
        description="Your name, daily targets and fasting days. Only you can change them."
      />
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
