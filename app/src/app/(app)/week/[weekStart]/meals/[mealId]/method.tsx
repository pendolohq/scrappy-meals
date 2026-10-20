import { Card } from "@/components/ui/card";
import {
  type IngredientLine,
  stepIngredients,
} from "@/server/domain/ingredients";
import type { RecipeStep } from "@/server/mealie/recipes";

import { IngredientText } from "./ingredient-text";

/** Headings aren't steps: only steps with text get a number. */
const numberSteps = (steps: RecipeStep[]) => {
  let count = 0;
  return steps.map((step) => ({
    ...step,
    number: step.text ? (count += 1) : null,
  }));
};

/**
 * The recipe's steps, each with the ingredients Mealie links to it, in the
 * amounts the Ingredients card shows (`lines`).
 */
export const Method = ({
  steps,
  lines,
}: {
  steps: RecipeStep[];
  lines: IngredientLine[];
}) => (
  <Card as="section" aria-labelledby="method">
    <h2
      id="method"
      className="mb-2 text-xs font-semibold tracking-wider text-muted uppercase"
    >
      Method
    </h2>
    <ol className="space-y-3" data-testid="instructions">
      {numberSteps(steps).map((step, i) => {
        const linked = step.text
          ? stepIngredients(lines, step.ingredientRefs)
          : [];
        return (
          <li key={i}>
            {step.title && (
              <h3 className="pt-2 pb-1 font-serif font-semibold">
                {step.title}
              </h3>
            )}
            {step.text && (
              <div className="flex gap-3">
                <span
                  aria-hidden
                  className="w-5 shrink-0 font-semibold text-accent-ink tabular-nums"
                >
                  {step.number}
                </span>
                <div className="min-w-0">
                  <p className="whitespace-pre-line">{step.text}</p>
                  {linked.length > 0 && (
                    <ul
                      className="mt-1.5 flex flex-wrap gap-1.5 text-sm"
                      aria-label={`Ingredients for step ${step.number}`}
                      data-testid="step-ingredients"
                    >
                      {linked.map((line, j) => (
                        <li
                          key={j}
                          className="rounded-control bg-sunken/70 px-2 py-0.5"
                        >
                          <IngredientText line={line} />
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </li>
        );
      })}
    </ol>
  </Card>
);
