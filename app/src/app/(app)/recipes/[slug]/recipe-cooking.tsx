"use client";

import { useState } from "react";
import { RotateCcw } from "lucide-react";

import { IngredientsCard } from "@/components/recipe/ingredients-card";
import { Method } from "@/components/recipe/method";
import { Button } from "@/components/ui/button";
import { formatPortion } from "@/lib/format";
import { scaleIngredients } from "@/server/domain/ingredients";
import type { Ingredient, RecipeStep } from "@/server/mealie/recipes";

/**
 * Ingredients and method outside the plan: "cooking for" starts at the
 * recipe's own servings, since no portions say otherwise.
 */
export const RecipeCooking = ({
  servings,
  ingredients,
  instructions,
}: {
  servings: number | null;
  ingredients: Ingredient[];
  instructions: RecipeStep[];
}) => {
  // Null follows the recipe; set once someone touches the stepper.
  const [cookingFor, setCookingFor] = useState<number | null>(null);
  const fromRecipe = servings ?? 1;
  const shown = cookingFor ?? fromRecipe;
  const lines = scaleIngredients(ingredients, servings, shown);

  return (
    <>
      <IngredientsCard
        recipeServings={servings}
        lines={lines}
        cookingFor={shown}
        onCookingFor={setCookingFor}
        caption={
          cookingFor === null ? (
            <span>As the recipe is written.</span>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setCookingFor(null)}
            >
              <RotateCcw className="size-3.5" aria-hidden />
              Reset to the recipe ({formatPortion(fromRecipe)})
            </Button>
          )
        }
      />
      {instructions.length > 0 && <Method steps={instructions} lines={lines} />}
    </>
  );
};
