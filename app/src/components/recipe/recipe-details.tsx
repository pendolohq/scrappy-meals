import { Clock } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { formatAmount } from "@/lib/format";
import type { Organizer } from "@/server/domain/taxonomy";
import { formatMinutes } from "@/server/domain/taxonomy";
import {
  MACRO_KEYS,
  type MacroKey,
  type RecipeNutrition,
} from "@/server/mealie/nutrition";
import type { RecipeNote } from "@/server/mealie/recipes";

const MACRO_LABEL: Record<MacroKey, string> = {
  kcal: "kcal",
  protein: "Protein",
  carbs: "Carbs",
  fat: "Fat",
  fibre: "Fibre",
};

export const SectionTitle = ({ children }: { children: React.ReactNode }) => (
  <h2 className="mb-2 text-xs font-semibold tracking-wider text-muted uppercase">
    {children}
  </h2>
);

/**
 * Total time, categories and tags, as Mealie has them. Rows cached before
 * the cache kept these have nulls: they show nothing until the next refresh.
 */
export const RecipeFacts = ({
  totalMinutes,
  categories,
  tags,
}: {
  totalMinutes: number | null;
  categories: Organizer[] | null;
  tags: Organizer[] | null;
}) => {
  if (!totalMinutes && !categories?.length && !tags?.length) {
    return null;
  }
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="About this recipe">
      {totalMinutes ? (
        <li>
          <Pill tone="highlight">
            <Clock className="size-3" aria-hidden />
            {formatMinutes(totalMinutes)}
          </Pill>
        </li>
      ) : null}
      {categories?.map((c) => (
        <li key={`c-${c.slug}`}>
          <Pill tone="accent">{c.name}</Pill>
        </li>
      ))}
      {tags?.map((t) => (
        <li key={`t-${t.slug}`}>
          <Pill>{t.name}</Pill>
        </li>
      ))}
    </ul>
  );
};

export const NutritionGrid = ({
  nutrition,
}: {
  nutrition: RecipeNutrition;
}) => (
  <dl
    className="grid grid-cols-5 gap-2 rounded-control bg-sunken/70 p-3 text-center tabular-nums"
    aria-label="Nutrition per serving"
    data-testid="nutrition"
  >
    {MACRO_KEYS.map((key) => {
      const value = nutrition.perServing[key];
      return (
        <div key={key} className="min-w-0">
          <dt className="truncate text-xs text-muted">{MACRO_LABEL[key]}</dt>
          <dd className="font-semibold">
            {value === undefined
              ? "–"
              : `${formatAmount(value)}${key === "kcal" ? "" : " g"}`}
          </dd>
        </div>
      );
    })}
    <p className="col-span-5 text-xs text-muted">Per serving</p>
  </dl>
);

export const RecipeNotes = ({ notes }: { notes: RecipeNote[] }) =>
  notes.length === 0 ? null : (
    <Card as="section">
      <SectionTitle>Notes</SectionTitle>
      <div className="space-y-3">
        {notes.map((note, i) => (
          <div key={i}>
            {note.title && <h3 className="font-semibold">{note.title}</h3>}
            {note.text && <p className="whitespace-pre-line">{note.text}</p>}
          </div>
        ))}
      </div>
    </Card>
  );
