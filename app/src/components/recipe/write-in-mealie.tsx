import { ExternalLink } from "lucide-react";

import { buttonClass } from "@/components/ui/button";
import { newRecipeLinkInMealie } from "@/server/mealie/links";

/**
 * A recipe with no page to import from (a family one, one from a book) is
 * written in Mealie's own editor. Like "Edit in Mealie", render it inside
 * `<Suspense>`: a Mealie that's down only leaves out the link.
 */
export const WriteInMealie = async () => {
  const href = await newRecipeLinkInMealie();
  if (!href) {
    return null;
  }
  return (
    <div className="space-y-3 text-center">
      <p className="text-sm text-muted">
        No page to import from? Write the recipe in Mealie, then find it here
        under Recipes.
      </p>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={buttonClass({ variant: "secondary", size: "sm" })}
      >
        Write a recipe in Mealie
        <ExternalLink className="size-3.5" aria-hidden />
      </a>
    </div>
  );
};
