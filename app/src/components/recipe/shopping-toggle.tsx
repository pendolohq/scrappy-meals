"use client";

import { useOptimistic, useState, useTransition } from "react";

import { setNoShoppingAction } from "@/app/(app)/recipes/[slug]/actions";
import { attempt, failureText } from "@/components/plan/attempt";
import { NoShopping } from "@/components/plan/product/no-shopping";

/** "Don't add to the shopping list" on a recipe, saved in Mealie as it's ticked. */
export const ShoppingToggle = ({
  slug,
  noShopping,
}: {
  slug: string;
  noShopping: boolean;
}) => {
  const [shown, setShown] = useOptimistic(noShopping);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  const change = (on: boolean) =>
    startTransition(async () => {
      setError(undefined);
      setShown(on);
      const res = await attempt(() =>
        setNoShoppingAction({ slug, noShopping: on })
      );
      if (res.error !== undefined) {
        setError(failureText(res));
      }
    });

  return (
    <div>
      <NoShopping checked={shown} disabled={pending} onChange={change} />
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
};
