import { notFound } from "next/navigation";

import { loadReview } from "@/server/recipe-review";
import { requireUser } from "@/server/session";

import { ReviewForm } from "./review-form";

export default async function ReviewPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  await requireUser();
  const { slug } = await params;
  const draft = await loadReview(slug);
  if (!draft) {
    notFound();
  }

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">{draft.name}</h1>
        <p className="mt-1 flex gap-4 text-sm">
          {draft.sourceUrl && (
            <a
              href={draft.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              Source
            </a>
          )}
          {draft.mealieUrl && (
            <a
              href={draft.mealieUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              Open in Mealie
            </a>
          )}
        </p>
      </div>
      <ReviewForm draft={draft} />
    </section>
  );
}
