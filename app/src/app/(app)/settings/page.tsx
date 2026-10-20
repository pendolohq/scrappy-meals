import { InstallCard } from "@/components/install-hint";
import { PageHeader } from "@/components/ui/page-header";
import { getDb } from "@/server/db/client";
import { getSnackSlots } from "@/server/household";
import { requireUser } from "@/server/session";
import { findUserById } from "@/server/users";

import { HouseholdForm } from "./household-form";
import { SettingsForm } from "./settings-form";
import { ThemePicker } from "./theme-picker";

export default async function SettingsPage() {
  const { id } = await requireUser();
  const [user, snackSlots] = await Promise.all([
    findUserById(getDb(), id),
    getSnackSlots(getDb()),
  ]);
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
      <HouseholdForm snackSlots={snackSlots} />
      <ThemePicker />
      <InstallCard />
    </section>
  );
}
