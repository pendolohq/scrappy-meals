import { formatQuantity } from "@/lib/format";
import type { IngredientLine } from "@/server/domain/ingredients";

/** A line as the Ingredients card shows it: amount, food and note, or as written. */
export const IngredientText = ({
  line,
  qtyTestId,
}: {
  line: IngredientLine;
  qtyTestId?: string;
}) =>
  line.scaled ? (
    <>
      <span
        className="font-semibold text-accent-ink tabular-nums"
        data-testid={qtyTestId}
      >
        {formatQuantity(line.scaled.quantity, line.scaled.unit)}
      </span>{" "}
      {line.scaled.food}
      {line.scaled.note && (
        <span className="text-muted">, {line.scaled.note}</span>
      )}
    </>
  ) : (
    line.text
  );
