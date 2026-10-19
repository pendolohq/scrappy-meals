import { redirect } from "next/navigation";

// The checklist moved into the shopping page; installed apps may still have
// this URL cached.
export default async function ShopPage({
  params,
}: {
  params: Promise<{ weekStart: string }>;
}) {
  const { weekStart } = await params;
  redirect(`/week/${encodeURIComponent(weekStart)}/shopping`);
}
