import Link from "next/link";

import { pillClass, type PillTone } from "@/components/ui/pill";
import { cx } from "@/lib/cx";
import type { PlannedMeal } from "@/server/plan";

const reviewHref = (slug: string) =>
  `/recipes/${encodeURIComponent(slug)}/review`;

const linkPill = (tone: PillTone) =>
  cx(pillClass(tone), "underline-offset-2 hover:underline");

/**
 * What's missing or unchecked about a planned recipe, as small pills. The
 * ones the review page can fix link to it: nutrition can be estimated there.
 */
export const RecipeFlags = ({
  recipe,
  slug,
}: {
  recipe: PlannedMeal["recipe"];
  slug: string;
}) => {
  const flags: string[] = [];
  let nutritionFlag: string | null = null;
  if (!recipe) {
    flags.push("Not found in Mealie");
  } else {
    if (recipe.nutrition.status === "missing") {
      nutritionFlag = "No nutrition data";
    }
    if (recipe.nutrition.status === "partial") {
      nutritionFlag = `No ${recipe.nutrition.missing.join(", ")} data`;
    }
    if (!recipe.servings) {
      flags.push("No servings count in Mealie");
    }
  }
  const product = Boolean(recipe?.product);
  const estimated = recipe?.nutritionSource === "estimated";
  const needsReview = recipe?.reviewState === "pending";
  if (
    flags.length === 0 &&
    !nutritionFlag &&
    !product &&
    !estimated &&
    !needsReview
  ) {
    return null;
  }
  return (
    <ul className="mt-1.5 flex flex-wrap gap-1.5">
      {product && <li className={pillClass("accent")}>Product</li>}
      {nutritionFlag &&
        (product ? (
          <li className={pillClass("danger")}>⚠ {nutritionFlag}</li>
        ) : (
          <li className="-my-2 flex min-h-tap items-center">
            <Link href={reviewHref(slug)} className={linkPill("danger")}>
              ⚠ {nutritionFlag}
            </Link>
          </li>
        ))}
      {flags.map((f) => (
        <li key={f} className={pillClass("danger")}>
          ⚠ {f}
        </li>
      ))}
      {estimated && (
        <li className="-my-2 flex min-h-tap items-center">
          <Link href={reviewHref(slug)} className={linkPill("neutral")}>
            ≈ Estimated nutrition
          </Link>
        </li>
      )}
      {needsReview && (
        <li className="-my-2 flex min-h-tap items-center">
          <Link href={reviewHref(slug)} className={linkPill("highlight")}>
            Needs review
          </Link>
        </li>
      )}
    </ul>
  );
};
