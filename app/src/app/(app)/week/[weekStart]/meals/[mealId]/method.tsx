import { Card } from "@/components/ui/card";
import { formatQuantity } from "@/lib/format";
import {
  type IngredientLine,
  stepIngredients,
} from "@/server/domain/ingredients";
import type { RecipeStep } from "@/server/mealie/recipes";

/** Headings aren't steps: only steps with text get a number. */
const numberSteps = (steps: RecipeStep[]) => {
  let count = 0;
  return steps.map((step) => ({
    ...step,
    number: step.text ? (count += 1) : null,
  }));
};

/** "3 clove Garlic": the amount reads first, so it carries the weight. */
const IngredientChip = ({ line }: { line: IngredientLine }) => (
  <li className="rounded-full bg-sunken/70 px-3.5 py-1.5">
    {line.scaled ? (
      <>
        <span className="font-semibold tabular-nums">
          {formatQuantity(line.scaled.quantity, line.scaled.unit)}
        </span>{" "}
        {line.scaled.food}
        {line.scaled.note && (
          <span className="text-muted">, {line.scaled.note}</span>
        )}
      </>
    ) : (
      line.text
    )}
  </li>
);

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
      className="mb-4 text-xs font-semibold tracking-wider text-muted uppercase"
    >
      Method
    </h2>
    <ol className="space-y-10" data-testid="instructions">
      {numberSteps(steps).map((step, i) => {
        const linked = step.text
          ? stepIngredients(lines, step.ingredientRefs)
          : [];
        return (
          <li key={i}>
            {step.title && (
              <h3 className="pb-3 text-sm font-semibold tracking-wider text-accent-ink uppercase">
                {step.title}
              </h3>
            )}
            {step.text && (
              <>
                <h3 className="font-serif text-2xl font-semibold">
                  Step {step.number}
                </h3>
                <p className="mt-2 text-lg/relaxed whitespace-pre-line">
                  {step.text}
                </p>
                {linked.length > 0 && (
                  <ul
                    className="mt-5 flex flex-wrap gap-2.5"
                    aria-label={`Ingredients for step ${step.number}`}
                    data-testid="step-ingredients"
                  >
                    {linked.map((line, j) => (
                      <IngredientChip key={j} line={line} />
                    ))}
                  </ul>
                )}
              </>
            )}
          </li>
        );
      })}
    </ol>
  </Card>
);
