import Link from "next/link";

import { pillClass } from "@/components/ui/pill";
import { cx } from "@/lib/cx";
import type { PlannedMeal } from "@/server/plan";

const reviewHref = (slug: string) =>
  `/recipes/${encodeURIComponent(slug)}/review`;

/** What's missing or unchecked about a planned recipe, as small pills. */
export const RecipeFlags = ({
  recipe,
  slug,
}: {
  recipe: PlannedMeal["recipe"];
  slug: string;
}) => {
  const flags: string[] = [];
  if (!recipe) {
    flags.push("Not found in Mealie");
  } else {
    if (recipe.nutrition.status === "missing") {
      flags.push("No nutrition data");
    }
    if (recipe.nutrition.status === "partial") {
      flags.push(`No ${recipe.nutrition.missing.join(", ")} data`);
    }
    if (!recipe.servings) {
      flags.push("No servings count in Mealie");
    }
  }
  const estimated = recipe?.nutritionSource === "estimated";
  const needsReview = recipe?.reviewState === "pending";
  if (flags.length === 0 && !estimated && !needsReview) {
    return null;
  }
  return (
    <ul className="mt-1.5 flex flex-wrap gap-1.5">
      {flags.map((f) => (
        <li key={f} className={pillClass("danger")}>
          ⚠ {f}
        </li>
      ))}
      {estimated && <li className={pillClass()}>≈ Estimated nutrition</li>}
      {needsReview && (
        <li className="-my-2 flex min-h-tap items-center">
          <Link
            href={reviewHref(slug)}
            className={cx(
              pillClass("highlight"),
              "underline-offset-2 hover:underline"
            )}
          >
            Needs review
          </Link>
        </li>
      )}
    </ul>
  );
};
