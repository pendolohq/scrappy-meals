import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { MACRO_KEYS, type MacroKey } from "@/server/mealie/nutrition";

import { MACROS } from "../nutrition";

import type { MacroTexts } from "./food-form";

/** The serving's values, typed in or estimated by Claude. */
export const OwnValuesFields = ({
  servingName,
  values,
  onValue,
  estimated,
  estimating,
  canEstimate,
  onEstimate,
}: {
  /** "2 pieces", or null while the amount isn't a number. */
  servingName: string | null;
  values: MacroTexts;
  onValue: (key: MacroKey, text: string) => void;
  estimated: boolean;
  /** Claude can estimate the values. */
  estimating: boolean;
  canEstimate: boolean;
  onEstimate: () => void;
}) => (
  <fieldset className="space-y-2">
    <legend className="mb-1.5 text-sm font-medium text-muted">
      Nutrition for {servingName ?? "this serving"}
    </legend>
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {MACRO_KEYS.map((key) => (
        <Field key={key} label={`${MACROS[key].label} (${MACROS[key].unit})`}>
          <Input
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            value={values[key]}
            onChange={(e) => onValue(key, e.target.value)}
          />
        </Field>
      ))}
    </div>
    {estimating && (
      <Button
        size="sm"
        variant="secondary"
        disabled={!canEstimate}
        onClick={onEstimate}
      >
        {estimated ? "Estimate again" : "Estimate with Claude"}
      </Button>
    )}
    {estimated && (
      <p className="text-xs text-muted">
        Claude&rsquo;s estimate: check it, and change anything that looks off.
      </p>
    )}
  </fieldset>
);
