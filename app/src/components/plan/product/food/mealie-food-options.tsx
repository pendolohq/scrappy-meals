import { cx } from "@/lib/cx";
import { OWN_VALUES } from "@/server/domain/usda";
import type { FoodSearch } from "@/server/foods";

import { isPicked, type Picked } from "./food-form";

const optionHint = (option: Picked) => {
  if ("create" in option) {
    return "Added to Mealie's foods";
  }
  const { match } = option.food;
  if (match?.status !== "confirmed") {
    return "Not matched to USDA yet";
  }
  return match.food.dataType === OWN_VALUES
    ? "Matched to values from its label"
    : `USDA: ${match.food.description}`;
};

/** The Mealie foods found under the name, and a new one when none is called that. */
export const MealieFoodOptions = ({
  found,
  picked,
  onPick,
}: {
  found: FoodSearch & { name: string };
  picked: Picked | undefined;
  onPick: (option: Picked) => void;
}) => {
  const exact = found.foods.some(
    (f) => f.name.trim().toLowerCase() === found.name.toLowerCase()
  );
  const options: Picked[] = [
    ...found.foods.map((food) => ({ food })),
    ...(exact ? [] : [{ create: found.name }]),
  ];
  return (
    <fieldset className="space-y-2">
      <legend className="mb-1.5 text-sm font-medium text-muted">
        Which food is it in Mealie?
      </legend>
      <div className="flex flex-col gap-1.5">
        {options.map((option) => (
          <button
            key={"food" in option ? option.food.id : "new"}
            type="button"
            aria-pressed={isPicked(picked, option)}
            onClick={() => onPick(option)}
            className={cx(
              "min-h-tap rounded-button border px-3.5 py-2 text-left text-sm transition",
              isPicked(picked, option)
                ? "border-accent bg-accent-soft"
                : "border-border-strong bg-card hover:bg-sunken"
            )}
          >
            <span className="font-medium">
              {"food" in option
                ? option.food.name
                : `New food: ${option.create}`}
            </span>
            <span className="block text-xs text-muted">
              {optionHint(option)}
            </span>
          </button>
        ))}
      </div>
    </fieldset>
  );
};
