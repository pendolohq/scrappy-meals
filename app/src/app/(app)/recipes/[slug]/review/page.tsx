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
  return <ReviewForm draft={draft} />;
}
