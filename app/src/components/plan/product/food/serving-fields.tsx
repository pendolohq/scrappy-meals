import { Field, Input, inputClass } from "@/components/ui/input";
import { cx } from "@/lib/cx";
import { type FoodUnit, piecePortions } from "@/server/domain/food";

import { grams, type Source, UNIT_LABELS } from "./food-form";
import type { ServingForm } from "./use-serving-form";

/** How much of the food, and what one piece weighs when it's counted in pieces. */
export const ServingFields = ({
  form,
  source,
  amountOk,
  pieceOk,
}: {
  form: ServingForm;
  source: Source;
  amountOk: boolean;
  pieceOk: boolean;
}) => {
  const portions =
    source.kind === "usda" ? piecePortions(source.food.portions) : [];
  return (
    <>
      <div className="grid grid-cols-[1fr_auto] items-end gap-2">
        <Field label="How much">
          <Input
            type="number"
            inputMode="decimal"
            min="0.01"
            step="any"
            value={form.amount}
            aria-invalid={!amountOk || undefined}
            onChange={(e) => form.setAmount(e.target.value)}
          />
        </Field>
        <select
          aria-label="Unit"
          className={cx(inputClass, "w-auto")}
          value={form.unit}
          onChange={(e) => form.changeUnit(e.target.value as FoodUnit)}
        >
          {(Object.keys(UNIT_LABELS) as FoodUnit[]).map((u) => (
            <option key={u} value={u}>
              {UNIT_LABELS[u]}
            </option>
          ))}
        </select>
      </div>

      {form.unit === "piece" && (
        <div className="grid gap-3 sm:grid-cols-2">
          {portions.length > 0 && (
            <Field label="One piece is">
              <select
                className={inputClass}
                value={portions.findIndex((p) => p.label === form.pieceLabel)}
                onChange={(e) =>
                  form.choosePortion(portions[Number(e.target.value)])
                }
              >
                <option value={-1}>Typed in</option>
                {portions.map((p, i) => (
                  <option key={`${p.label}-${i}`} value={i}>
                    {p.label} ({grams(p.grams)} g)
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field
            label="Weight of one piece (g)"
            hint={
              source.kind === "usda"
                ? "Saved with the food, for every recipe that counts it by the piece."
                : undefined
            }
          >
            <Input
              inputMode="decimal"
              value={form.pieceText}
              aria-invalid={!pieceOk || undefined}
              onChange={(e) => form.typePiece(e.target.value)}
            />
          </Field>
        </div>
      )}
    </>
  );
};
