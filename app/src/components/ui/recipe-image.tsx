import { CookingPot } from "lucide-react";

import { cx } from "@/lib/cx";

/**
 * A recipe photo through the Mealie image proxy, cropped to fill its box, or
 * a quiet illustrated placeholder when the recipe has none. Size it with
 * `className` (e.g. `size-16` or `aspect-[4/3] w-full`).
 */
export const RecipeImage = ({
  mealieId,
  className,
  rounded = "rounded-photo",
}: {
  /** Null when the recipe has no photo. */
  mealieId: string | null;
  className?: string;
  rounded?: string;
}) => {
  const box = cx("shrink-0 overflow-hidden", rounded, className);
  if (!mealieId) {
    return (
      <div
        aria-hidden
        className={cx(
          box,
          "flex items-center justify-center bg-linear-to-br from-highlight-soft to-accent-soft text-muted/70"
        )}
      >
        <CookingPot
          className="size-[40%] max-h-10 max-w-10"
          strokeWidth={1.5}
        />
      </div>
    );
  }
  return (
    // oxlint-disable-next-line nextjs/no-img-element -- proxied Mealie images, already sized by Mealie
    <img
      src={`/api/recipe-images/${mealieId}`}
      alt=""
      loading="lazy"
      decoding="async"
      className={cx(box, "bg-sunken object-cover")}
    />
  );
};
