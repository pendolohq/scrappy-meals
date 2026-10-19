import { userRoute } from "@/server/session";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Proxies Mealie's recipe thumbnails so the browser only ever talks to this app.
export const GET = userRoute(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  if (!UUID.test(id)) return new Response(null, { status: 400 });

  const base = process.env.MEALIE_URL?.replace(/\/$/, "");
  const upstream = await fetch(`${base}/api/media/recipes/${id}/images/min-original.webp`, {
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  if (!upstream?.ok || !upstream.body) return new Response(null, { status: upstream?.status === 404 ? 404 : 502 });
  const type = upstream.headers.get("content-type") ?? "image/webp";
  if (!type.startsWith("image/")) return new Response(null, { status: 502 });

  return new Response(upstream.body, {
    headers: {
      "Content-Type": type,
      "Cache-Control": "private, max-age=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
