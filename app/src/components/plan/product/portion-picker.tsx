import { Field, Input } from "@/components/ui/input";
import { cx } from "@/lib/cx";
import type {
  PortionChoice,
  ProductInfo,
  ServingUnit,
} from "@/server/domain/product";

export type PortionKind = "one" | "half" | "pack" | "grams";

/** A pack the same size as a serving is just "1 serving". */
const hasPack = (info: ProductInfo | null) =>
  info?.packGrams != null && info.packGrams !== info.servingGrams;

/** The picked portion, or a serving when "whole pack" stopped being possible. */
export const usable = (
  kind: PortionKind,
  info: ProductInfo | null
): PortionKind => (kind === "pack" && !hasPack(info) ? "one" : kind);

export const choiceOf = (kind: PortionKind, grams: string): PortionChoice => {
  switch (kind) {
    case "one":
      return { kind: "servings", count: 1 };
    case "half":
      return { kind: "servings", count: 0.5 };
    case "pack":
      return { kind: "pack" };
    case "grams":
      return { kind: "grams", grams: Number(grams) };
  }
};

/** How much was eaten: a serving, half, the whole pack, or an amount in g or ml. */
export const PortionPicker = ({
  info,
  unit,
  kind,
  onKind,
  grams,
  onGrams,
}: {
  info: ProductInfo | null;
  unit: ServingUnit;
  kind: PortionKind;
  onKind: (kind: PortionKind) => void;
  grams: string;
  onGrams: (grams: string) => void;
}) => {
  const options: { kind: PortionKind; label: string }[] = [
    {
      kind: "one",
      label: info ? `1 serving (${info.servingGrams} ${unit})` : "1 serving",
    },
    { kind: "half", label: "½" },
    ...(info && hasPack(info)
      ? [
          {
            kind: "pack" as const,
            label: `Whole pack (${info.packGrams} ${unit})`,
          },
        ]
      : []),
    { kind: "grams", label: unit === "ml" ? "Millilitres…" : "Grams…" },
  ];
  return (
    <fieldset className="space-y-2">
      <legend className="mb-1.5 text-sm font-medium text-muted">
        How much
      </legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <button
            key={o.kind}
            type="button"
            aria-pressed={kind === o.kind}
            onClick={() => onKind(o.kind)}
            className={cx(
              "min-h-tap rounded-button border px-3.5 text-sm font-medium transition",
              kind === o.kind
                ? "border-accent bg-accent text-accent-foreground"
                : "border-border-strong bg-card hover:bg-sunken"
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
      {kind === "grams" && (
        <Field label={`Amount (${unit})`}>
          <Input
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            value={grams}
            onChange={(e) => onGrams(e.target.value)}
          />
        </Field>
      )}
    </fieldset>
  );
};
