import { ExternalLink } from "lucide-react";

import { buttonClass } from "@/components/ui/button";
import { recipeLinkInMealie } from "@/server/mealie/links";

/**
 * The recipe's page in Mealie, for people with a Mealie account. Its URL
 * needs the group's slug, so render it inside `<Suspense>`: a Mealie that's
 * down doesn't hold up the recipe, it only leaves out the link.
 */
export const EditInMealie = async ({ slug }: { slug: string }) => {
  const href = await recipeLinkInMealie(slug);
  if (!href) {
    return null;
  }
  return (
    <p className="text-center">
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={buttonClass({ variant: "secondary", size: "sm" })}
      >
        Edit in Mealie
        <ExternalLink className="size-3.5" aria-hidden />
      </a>
    </p>
  );
};
