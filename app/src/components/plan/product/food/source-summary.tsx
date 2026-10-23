import { OWN_VALUES } from "@/server/domain/usda";

import type { Source } from "./food-form";

/** Where the nutrition comes from, with a way to change it. */
export const SourceSummary = ({
  source,
  estimating,
  canChange,
  onChange,
}: {
  source: Source;
  /** Claude can estimate the values. */
  estimating: boolean;
  canChange: boolean;
  onChange: () => void;
}) => (
  <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
    <span className="text-muted">
      {source.kind === "own"
        ? "Nutrition:"
        : source.food.dataType === OWN_VALUES
          ? "Values from its label:"
          : "USDA:"}
    </span>
    <span className="font-medium">
      {source.kind === "usda"
        ? source.food.description
        : estimating
          ? "estimated or typed in"
          : "typed in"}
    </span>
    {canChange && (
      <button
        type="button"
        className="text-accent-ink underline underline-offset-2"
        onClick={onChange}
      >
        Change
      </button>
    )}
  </p>
);
