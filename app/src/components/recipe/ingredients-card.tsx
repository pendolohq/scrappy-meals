import type { ReactNode } from "react";

import { Stepper } from "@/components/plan/stepper";
import { Card } from "@/components/ui/card";
import {
  type IngredientLine,
  MAX_COOKING_FOR,
  MIN_COOKING_FOR,
  stepServings,
} from "@/server/domain/ingredients";

import { IngredientText } from "./ingredient-text";

const SectionTitle = ({ children }: { children: React.ReactNode }) => (
  <h2 className="text-xs font-semibold tracking-wider text-muted uppercase">
    {children}
  </h2>
);

/**
 * The ingredients scaled to "cooking for", which is only a view: the
 * caller keeps it in state and says under the stepper what it follows.
 */
export const IngredientsCard = ({
  recipeServings,
  lines,
  cookingFor,
  onCookingFor,
  caption,
}: {
  /** The recipe's own servings; without them nothing can be scaled. */
  recipeServings: number | null;
  lines: IngredientLine[];
  cookingFor: number;
  onCookingFor: (servings: number) => void;
  caption: ReactNode;
}) => (
  <Card as="section" aria-labelledby="ingredients">
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <div id="ingredients">
        <SectionTitle>Ingredients</SectionTitle>
      </div>
      {recipeServings && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted">Cooking for</span>
          <Stepper
            label="Cooking for"
            value={cookingFor}
            onChange={(next) =>
              onCookingFor(stepServings(cookingFor, next > cookingFor ? 1 : -1))
            }
            min={MIN_COOKING_FOR}
            max={MAX_COOKING_FOR}
            step={1}
            suffix=""
            testId="cooking-for"
          />
        </div>
      )}
    </div>
    {recipeServings ? (
      <p className="mt-1 flex min-h-tap flex-wrap items-center gap-x-2 text-xs text-muted">
        {caption}
      </p>
    ) : (
      <p className="mt-2 rounded-control bg-danger-soft px-3 py-2 text-sm">
        No servings count in Mealie, so amounts are for the whole recipe. Set
        servings in Mealie to scale them.
      </p>
    )}
    {lines.length === 0 ? (
      <p className="mt-2 text-sm text-muted">No ingredients in Mealie.</p>
    ) : (
      <ul className="mt-2 space-y-1" data-testid="ingredients">
        {lines.map((line, i) => (
          <li key={i}>
            {line.title && (
              <h3 className="pt-3 pb-1 font-serif font-semibold">
                {line.title}
              </h3>
            )}
            {(line.scaled || line.text) && (
              <p className="py-1">
                <IngredientText line={line} qtyTestId="qty" />
              </p>
            )}
          </li>
        ))}
      </ul>
    )}
  </Card>
);
