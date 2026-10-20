"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { userFormAction } from "@/server/action";
import {
  isSocialPostUrl,
  normaliseRecipeUrl,
} from "@/server/domain/recipe-url";
import { IMAGE_BAD_TYPE, screenshotProblem } from "@/server/domain/screenshots";
import { importRecipe, importSocialRecipe } from "@/server/recipe-import";

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

const MAX_CAPTION = 10_000;

const NEED_CAPTION =
  "Paste the post's caption or add a screenshot: Instagram and Facebook don't let Mealie read posts.";

const fromForm = z.preprocess(
  (form) =>
    form instanceof FormData
      ? {
          url: form.get("url") ?? "",
          caption: form.get("caption"),
          images: form.getAll("images"),
        }
      : form,
  z
    .object({
      url: urlField,
      caption: z.unknown(),
      images: z.unknown(),
    })
    // Caption and screenshots only matter for a post, so they're checked
    // here, after the address: a recipe page ignores whatever else was sent.
    .transform((input, ctx) => {
      if (!isSocialPostUrl(input.url)) {
        return { url: input.url, social: null };
      }
      const caption = parseCaption(input.caption, ctx);
      const images = parseImages(input.images, ctx);
      if (caption === null && images.length === 0) {
        ctx.addIssue({ code: "custom", message: NEED_CAPTION });
        return z.NEVER;
      }
      return { url: input.url, social: { caption, images } };
    })
);

function parseCaption(value: unknown, ctx: z.RefinementCtx): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const caption = value.trim();
  if (caption.length > MAX_CAPTION) {
    ctx.addIssue({ code: "custom", message: "That caption is too long." });
  }
  return caption === "" ? null : caption;
}

function parseImages(value: unknown, ctx: z.RefinementCtx): File[] {
  const entries = Array.isArray(value) ? value : [];
  // An empty file input submits one nameless 0-byte file.
  const images = entries.filter((v) => !(v instanceof File && v.size === 0));
  const files = images.filter((v): v is File => v instanceof File);
  const problem =
    files.length !== images.length ? IMAGE_BAD_TYPE : screenshotProblem(files);
  if (problem) {
    ctx.addIssue({ code: "custom", message: problem });
  }
  return files;
}

export const importRecipeAction = userFormAction(
  fromForm,
  async (
    { url, social },
    user
  ): Promise<{ exists?: ImportFormState["exists"] }> => {
    const result = social
      ? await importSocialRecipe({ url, ...social }, user.id)
      : await importRecipe(url, user.id);
    if (result.status === "exists") {
      return { exists: { slug: result.slug, name: result.name } };
    }
    redirect(`/recipes/${encodeURIComponent(result.slug)}/review`);
  },
  { invalid: (err) => err.issues[0].message }
);
