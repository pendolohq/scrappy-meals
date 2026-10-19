"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { userFormAction } from "@/server/action";
import { normaliseRecipeUrl } from "@/server/domain/recipe-url";
import { UserFacingError } from "@/server/errors";
import { importRecipe } from "@/server/recipe-import";

export type ImportState = {
  error?: string;
  exists?: { slug: string; name: string };
};

const fromForm = z.preprocess(
  (form) => (form instanceof FormData ? { url: form.get("url") ?? "" } : form),
  z.object({ url: z.string() })
);

export const importRecipeAction = userFormAction(
  fromForm,
  async ({ url }, user): Promise<{ exists?: ImportState["exists"] }> => {
    const checked = normaliseRecipeUrl(url);
    if (!checked.ok) {
      throw new UserFacingError(checked.error);
    }
    const result = await importRecipe(checked.url, user.id);
    if (result.status === "exists") {
      return { exists: { slug: result.slug, name: result.name } };
    }
    redirect(`/recipes/${encodeURIComponent(result.slug)}/review`);
  }
);
