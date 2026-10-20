"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { userFormAction } from "@/server/action";
import { normaliseRecipeUrl } from "@/server/domain/recipe-url";
import { importRecipe } from "@/server/recipe-import";

export type ImportFormState = {
  error?: string;
  exists?: { slug: string; name: string };
};

const urlField = z
  .string()
  .max(4096, "That address is too long.")
  .transform((text, ctx) => {
    const checked = normaliseRecipeUrl(text);
    if (!checked.ok) {
      ctx.addIssue({ code: "custom", message: checked.error });
      return z.NEVER;
    }
    return checked.url;
  });

const fromForm = z.preprocess(
  (form) => (form instanceof FormData ? { url: form.get("url") ?? "" } : form),
  z.object({ url: urlField })
);

export const importRecipeAction = userFormAction(
  fromForm,
  async ({ url }, user): Promise<{ exists?: ImportFormState["exists"] }> => {
    const result = await importRecipe(url, user.id);
    if (result.status === "exists") {
      return { exists: { slug: result.slug, name: result.name } };
    }
    redirect(`/recipes/${encodeURIComponent(result.slug)}/review`);
  },
  { invalid: (err) => err.issues[0].message }
);
