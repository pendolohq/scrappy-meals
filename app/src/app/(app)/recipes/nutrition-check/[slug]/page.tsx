import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { after } from "next/server";

import { buttonClass } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Pill } from "@/components/ui/pill";
import { getDb } from "@/server/db/client";
import { recipeSlug } from "@/server/domain/recipe-slug";
import type { LineResult } from "@/server/domain/usda-check";
import { MACRO_KEYS } from "@/server/mealie/nutrition";
import { requireUser } from "@/server/session";
import { loadBreakdown } from "@/server/usda/check";
import { usdaEnabled } from "@/server/usda/client";

import { MACRO_LABELS, showMacro } from "../labels";

import { DecisionForm } from "./decision-form";

const STATUS = {
  match: { label: "Matches", tone: "neutral" },
  mismatch: { label: "Mismatch", tone: "danger" },
  reviewed: { label: "Reviewed", tone: "accent" },
  cantCheck: { label: "Can't check yet", tone: "highlight" },
} as const;

const CHOICES = {
  mealie: "kept Mealie's values",
  usda: "used USDA's values",
  edited: "edited the values",
} as const;

const Outcome = ({ result }: { result: LineResult }) => {
  switch (result.kind) {
    case "counted":
      return (
        <span className="text-sm text-muted">
          {Math.round(result.grams * 10) / 10} g
          {result.assumed && " (no amount given, assumed)"}
          {" · "}
          {MACRO_KEYS.filter((m) => result.macros[m] !== undefined)
            .map((m) => showMacro(m, result.macros[m]))
            .join(" · ")}
        </span>
      );
    case "needsAmount":
      return <span className="text-sm text-danger">{result.reason}</span>;
    case "unmatched":
      return <span className="text-sm text-danger">food not matched</span>;
    case "notCounted":
      return <span className="text-sm text-muted">no amount, not counted</span>;
    case "skipped":
      return null;
  }
};

export default async function NutritionCheckRecipePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  await requireUser();
  if (!usdaEnabled()) {
    notFound();
  }
  const { slug } = await params;
  if (!recipeSlug.safeParse(slug).success) {
    notFound();
  }
  const recipe = await loadBreakdown(getDb(), slug, { defer: after });
  if (!recipe) {
    notFound();
  }
  const { check } = recipe;
  const status = STATUS[check.status];

  return (
    <section className="space-y-6 pb-8">
      <PageHeader
        title={recipe.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Pill tone={status.tone}>{status.label}</Pill>
            {recipe.review && (
              <span>
                Someone {CHOICES[recipe.review.choice]} for these USDA figures.
              </span>
            )}
          </span>
        }
        actions={
          <Link
            href="/recipes/nutrition-check"
            className={buttonClass({ variant: "ghost", size: "sm" })}
          >
            <ArrowLeft className="size-4" aria-hidden />
            Back
          </Link>
        }
      />

      {check.status === "cantCheck" && (
        <Card className="space-y-2">
          <h2 className="font-serif text-lg font-semibold">Missing</h2>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {check.noServings && <li>The recipe has no servings.</li>}
            {check.nothingToCount && (
              <li>None of its ingredients adds anything to count.</li>
            )}
            {check.unmatchedFoods.length > 0 && (
              <li>
                Foods to match:{" "}
                {check.unmatchedFoods.map((f) => f.name).join(", ")}.{" "}
                <Link
                  href="/recipes/nutrition-check/foods"
                  className="text-accent-ink underline"
                >
                  Match foods
                </Link>
              </li>
            )}
            {check.needsAmount.map((n) => (
              <li key={`${n.display}-${n.reason}`}>
                {n.display}: {n.reason}. Fix the line in Mealie.
              </li>
            ))}
          </ul>
        </Card>
      )}

      {check.usdaPerServing && (
        <Card as="section" aria-labelledby="per-serving" className="space-y-3">
          <h2 id="per-serving" className="font-serif text-lg font-semibold">
            Per serving
          </h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted">
                <th className="py-1 font-medium">
                  <span className="sr-only">Nutrient</span>
                </th>
                <th className="py-1 font-medium">Mealie</th>
                <th className="py-1 font-medium">USDA</th>
                <th className="py-1 font-medium">
                  <span className="sr-only">Difference</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {MACRO_KEYS.map((m) => (
                <tr key={m} className="border-t border-border/70">
                  <th scope="row" className="py-2 text-left font-medium">
                    {MACRO_LABELS[m]}
                  </th>
                  <td className="py-2">{showMacro(m, check.mealie[m])}</td>
                  <td className="py-2">
                    {showMacro(m, check.usdaPerServing?.[m])}
                  </td>
                  <td className="py-2">
                    {check.outside.includes(m) && (
                      <Pill tone="danger">Outside</Pill>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {check.assumed.length > 0 && (
            <p className="text-sm text-muted">
              Assumed, as they give no amount:{" "}
              {check.assumed
                .map((a) => `${a.display} (${Math.round(a.grams * 10) / 10} g)`)
                .join(", ")}
              .
            </p>
          )}
          {check.notCounted.length > 0 && (
            <p className="text-sm text-muted">
              Not counted, as they have no amount: {check.notCounted.join(", ")}
              .
            </p>
          )}
          {(check.status === "mismatch" || check.status === "reviewed") && (
            <DecisionForm slug={recipe.slug} usda={check.usdaPerServing} />
          )}
        </Card>
      )}

      <Card as="section" aria-labelledby="lines" className="space-y-3">
        <h2 id="lines" className="font-serif text-lg font-semibold">
          Ingredients
        </h2>
        <ul className="divide-y divide-border/70">
          {check.lines.map((line, i) =>
            line.result.kind === "skipped" ? null : (
              <li key={i} className="space-y-0.5 py-2">
                <p className="font-medium">{line.display}</p>
                {recipe.usdaFoods[i] && (
                  <p className="text-sm text-muted">{recipe.usdaFoods[i]}</p>
                )}
                <Outcome result={line.result} />
              </li>
            )
          )}
        </ul>
      </Card>
    </section>
  );
}
