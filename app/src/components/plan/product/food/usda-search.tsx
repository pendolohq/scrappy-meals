import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { UsdaHit } from "@/server/domain/usda";

/** Finding the food in USDA, or skipping to values estimated or typed in. */
export const UsdaSearch = ({
  query,
  onQuery,
  hits,
  pending,
  estimating,
  onSearch,
  onUse,
  onSkip,
}: {
  query: string;
  onQuery: (query: string) => void;
  hits: UsdaHit[] | undefined;
  pending: boolean;
  /** Claude can estimate the values. */
  estimating: boolean;
  onSearch: () => void;
  onUse: (fdcId: number) => void;
  onSkip: () => void;
}) => (
  <div className="space-y-3">
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        onSearch();
      }}
    >
      <Input
        aria-label="Search USDA"
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        placeholder="In English, such as kiwifruit, raw"
      />
      <Button type="submit" variant="secondary" disabled={pending}>
        Search USDA
      </Button>
    </form>
    {hits && hits.length === 0 && (
      <p className="text-sm text-muted">Nothing found. Try other words.</p>
    )}
    {hits && hits.length > 0 && (
      <ul className="divide-y divide-border/70">
        {hits.map((hit) => (
          <li
            key={hit.fdcId}
            className="flex items-center justify-between gap-3 py-2"
          >
            <div className="min-w-0 text-sm">
              <p className="font-medium">{hit.description}</p>
              <p className="text-muted">
                {hit.dataType}
                {hit.per100g.kcal !== undefined &&
                  ` · ${Math.round(hit.per100g.kcal)} kcal per 100 g`}
              </p>
            </div>
            <Button
              size="sm"
              onClick={() => onUse(hit.fdcId)}
              disabled={pending}
            >
              Use
            </Button>
          </li>
        ))}
      </ul>
    )}
    <Button size="sm" variant="ghost" onClick={onSkip}>
      {estimating ? "Not in USDA? Estimate it" : "Not in USDA? Type its values"}
    </Button>
  </div>
);
