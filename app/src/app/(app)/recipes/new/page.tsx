import { requireUser } from "@/server/session";

import { ImportForm } from "./import-form";

export default async function NewRecipePage() {
  await requireUser();

  return (
    <section>
      <h1 className="mb-1 text-lg font-semibold">Add a recipe</h1>
      <p className="mb-4 text-sm text-muted">
        Paste the address of a recipe page. Mealie reads it, then you check the
        servings, nutrition and ingredients.
      </p>
      <ImportForm />
    </section>
  );
}
