import { ExternalLink } from "lucide-react";
import { notFound } from "next/navigation";

import { buttonClass } from "@/components/ui/button";
import { RecipeImage } from "@/components/ui/recipe-image";
import { getDb } from "@/server/db/client";
import { recipeSlug } from "@/server/domain/recipe-slug";
import { estimatingEnabled } from "@/server/nutrition-estimate";
import { loadReview } from "@/server/recipe-review";
import { requireUser } from "@/server/session";
import { loadReviewUsda } from "@/server/usda/check";
import { usdaEnabled } from "@/server/usda/client";

import { ReviewForm } from "./review-form";

export default async function ReviewPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  await requireUser();
  const { slug } = await params;
  if (!recipeSlug.safeParse(slug).success) {
    notFound();
  }
  const draft = await loadReview(slug);
  if (!draft) {
    notFound();
  }
  // A failed check shouldn't stop anyone reviewing the recipe.
  const usda = usdaEnabled()
    ? await loadReviewUsda(getDb(), slug).catch((err) => {
        console.warn(`recipe ${slug}: USDA check for the review failed`, err);
        return null;
      })
    : null;

  return (
    <section className="space-y-6 pb-8">
      <div className="space-y-3">
        {draft.photoId && (
          <RecipeImage
            mealieId={draft.photoId}
            className="aspect-[16/9] w-full sm:aspect-[21/9]"
            rounded="rounded-card"
          />
        )}
        <p className="pt-1 text-xs font-semibold tracking-wider text-muted uppercase">
          Review recipe
        </p>
        <h1 className="font-serif text-title font-semibold sm:text-display">
          {draft.name}
        </h1>
        <p className="flex flex-wrap gap-2">
          {draft.sourceUrl && (
            <a
              href={draft.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonClass({ variant: "secondary", size: "sm" })}
            >
              Source
              <ExternalLink className="size-3.5" aria-hidden />
            </a>
          )}
          {draft.mealieUrl && (
            <a
              href={draft.mealieUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonClass({ variant: "secondary", size: "sm" })}
            >
              Open in Mealie
              <ExternalLink className="size-3.5" aria-hidden />
            </a>
          )}
        </p>
      </div>
      <ReviewForm draft={draft} canEstimate={estimatingEnabled()} usda={usda} />
    </section>
  );
}
