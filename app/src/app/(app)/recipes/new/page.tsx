import { Suspense } from "react";

import { WriteInMealie } from "@/components/recipe/write-in-mealie";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/server/session";

import { ImportForm } from "./import-form";

export default async function NewRecipePage() {
  await requireUser();

  return (
    <section className="max-w-xl space-y-6 pb-8">
      <PageHeader
        title="Add a recipe"
        description="Paste the address of a recipe page, or of an Instagram or Facebook post. Mealie reads it, then you check the servings, nutrition and ingredients."
      />
      <Card className="p-5 sm:p-6">
        <ImportForm />
      </Card>
      <Suspense fallback={null}>
        <WriteInMealie />
      </Suspense>
    </section>
  );
}
