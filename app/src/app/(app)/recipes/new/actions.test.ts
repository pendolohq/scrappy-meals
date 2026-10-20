import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => vi.fn<() => Promise<unknown>>());
vi.mock("@/auth", () => ({ auth }));

const importRecipe = vi.hoisted(() => vi.fn<(...args: unknown[]) => unknown>());
const importSocialRecipe = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => unknown>()
);
vi.mock("@/server/recipe-import", () => ({ importRecipe, importSocialRecipe }));

import { importRecipeAction } from "./actions";

const alex = { id: "user-alex", name: "Alex", email: "alex@example.test" };

const WEB = "https://example.com/soup";
const POST = "https://www.instagram.com/p/DAbc123/";
const NEED_CAPTION =
  "Paste the post's caption or add a screenshot: Instagram and Facebook don't let Mealie read posts.";

const png = (name = "a.png", bytes = 10) =>
  new File([new Uint8Array(bytes)], name, { type: "image/png" });

function form(fields: {
  url: string;
  caption?: string;
  images?: File[];
}): FormData {
  const data = new FormData();
  data.set("url", fields.url);
  if (fields.caption !== undefined) {
    data.set("caption", fields.caption);
  }
  for (const image of fields.images ?? []) {
    data.append("images", image);
  }
  return data;
}

const run = (data: FormData) => importRecipeAction(undefined, data);

// What a browser sends for an empty <input type="file" multiple>.
const emptyEntry = () => new File([], "", { type: "application/octet-stream" });

describe("importRecipeAction", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    auth.mockResolvedValue({ user: alex });
    importRecipe.mockResolvedValue({ status: "imported", slug: "soup" });
    importSocialRecipe.mockResolvedValue({ status: "imported", slug: "pasta" });
  });

  describe("web pages", () => {
    it("imports the page and redirects to its review", async () => {
      await expect(run(form({ url: WEB }))).rejects.toMatchObject({
        digest: expect.stringContaining("/recipes/soup/review"),
      });
      expect(importRecipe).toHaveBeenCalledWith(WEB, alex.id);
      expect(importSocialRecipe).not.toHaveBeenCalled();
    });

    it("reports a page that already exists", async () => {
      importRecipe.mockResolvedValue({
        status: "exists",
        slug: "soup",
        name: "Soup",
      });
      await expect(run(form({ url: WEB }))).resolves.toEqual({
        exists: { slug: "soup", name: "Soup" },
      });
    });

    it("ignores a caption and screenshots, even invalid ones", async () => {
      const data = form({
        url: WEB,
        caption: "x".repeat(20_000),
        images: [
          new File(["x"], "a.gif", { type: "image/gif" }),
          png("1.png"),
          png("2.png"),
          png("3.png"),
          png("4.png"),
        ],
      });

      await expect(run(data)).rejects.toMatchObject({
        digest: expect.stringContaining("/recipes/soup/review"),
      });
      expect(importRecipe).toHaveBeenCalledWith(WEB, alex.id);
      expect(importSocialRecipe).not.toHaveBeenCalled();
    });

    it("still rejects a bad address", async () => {
      const result = await run(form({ url: "chicken soup" }));
      expect(result).toMatchObject({ error: expect.any(String) });
      expect(importRecipe).not.toHaveBeenCalled();
    });
  });

  describe("social posts", () => {
    it("rejects a post with neither caption nor screenshots", async () => {
      await expect(run(form({ url: POST }))).resolves.toEqual({
        error: NEED_CAPTION,
      });
      expect(importSocialRecipe).not.toHaveBeenCalled();
      expect(importRecipe).not.toHaveBeenCalled();
    });

    it("treats a blank caption and empty file entries as nothing", async () => {
      const data = form({
        url: POST,
        caption: "  \n ",
        images: [emptyEntry()],
      });
      await expect(run(data)).resolves.toEqual({ error: NEED_CAPTION });
      expect(importSocialRecipe).not.toHaveBeenCalled();
    });

    it("imports with a trimmed caption and no images", async () => {
      await expect(
        run(form({ url: POST, caption: "  Pasta: 200 g penne  ", images: [] }))
      ).rejects.toMatchObject({
        digest: expect.stringContaining("/recipes/pasta/review"),
      });
      expect(importSocialRecipe).toHaveBeenCalledWith(
        { url: POST, caption: "Pasta: 200 g penne", images: [] },
        alex.id
      );
      expect(importRecipe).not.toHaveBeenCalled();
    });

    it("imports with screenshots alone, caption null", async () => {
      const image = png();
      await expect(
        run(form({ url: POST, images: [image] }))
      ).rejects.toMatchObject({
        digest: expect.stringContaining("/recipes/pasta/review"),
      });
      expect(importSocialRecipe).toHaveBeenCalledWith(
        { url: POST, caption: null, images: [expect.any(File)] },
        alex.id
      );
    });

    it("drops empty file entries and keeps the real ones", async () => {
      await expect(
        run(form({ url: POST, images: [emptyEntry(), png("real.png")] }))
      ).rejects.toMatchObject({ digest: expect.any(String) });

      const [input] = importSocialRecipe.mock.calls[0] as [{ images: File[] }];
      expect(input.images.map((f) => f.name)).toEqual(["real.png"]);
    });

    it("strips tracking parameters from the URL it imports", async () => {
      await expect(
        run(form({ url: `${POST}?igsh=abc`, caption: "Pasta" }))
      ).rejects.toMatchObject({ digest: expect.any(String) });
      expect(importSocialRecipe).toHaveBeenCalledWith(
        expect.objectContaining({ url: POST }),
        alex.id
      );
    });

    it("reports a post that already exists", async () => {
      importSocialRecipe.mockResolvedValue({
        status: "exists",
        slug: "pasta",
        name: "Pasta",
      });
      await expect(run(form({ url: POST, caption: "Pasta" }))).resolves.toEqual(
        { exists: { slug: "pasta", name: "Pasta" } }
      );
    });

    describe("limits", () => {
      it("accepts a caption of exactly 10 000 characters", async () => {
        await expect(
          run(form({ url: POST, caption: "a".repeat(10_000) }))
        ).rejects.toMatchObject({ digest: expect.any(String) });
        expect(importSocialRecipe).toHaveBeenCalledTimes(1);
      });

      it("rejects a caption over 10 000 characters", async () => {
        await expect(
          run(form({ url: POST, caption: "a".repeat(10_001) }))
        ).resolves.toEqual({ error: "That caption is too long." });
        expect(importSocialRecipe).not.toHaveBeenCalled();
      });

      it("accepts 4 screenshots", async () => {
        const images = [1, 2, 3, 4].map((i) => png(`${i}.png`));
        await expect(run(form({ url: POST, images }))).rejects.toMatchObject({
          digest: expect.any(String),
        });
        expect(importSocialRecipe).toHaveBeenCalledTimes(1);
      });

      it("rejects 5 screenshots", async () => {
        const images = [1, 2, 3, 4, 5].map((i) => png(`${i}.png`));
        await expect(run(form({ url: POST, images }))).resolves.toEqual({
          error: "Add at most 4 screenshots.",
        });
        expect(importSocialRecipe).not.toHaveBeenCalled();
      });

      it("accepts a screenshot of exactly 4 MB", async () => {
        const image = png("big.png", 4 * 1024 * 1024);
        await expect(
          run(form({ url: POST, images: [image] }))
        ).rejects.toMatchObject({ digest: expect.any(String) });
        expect(importSocialRecipe).toHaveBeenCalledTimes(1);
      });

      it("rejects a screenshot over 4 MB", async () => {
        const image = png("huge.png", 4 * 1024 * 1024 + 1);
        await expect(
          run(form({ url: POST, images: [image] }))
        ).resolves.toEqual({ error: "Each screenshot must be under 4 MB." });
        expect(importSocialRecipe).not.toHaveBeenCalled();
      });

      it.each(["image/png", "image/jpeg", "image/webp"])(
        "accepts %s",
        async (type) => {
          const image = new File(["x"], "s", { type });
          await expect(
            run(form({ url: POST, images: [image] }))
          ).rejects.toMatchObject({ digest: expect.any(String) });
          expect(importSocialRecipe).toHaveBeenCalledTimes(1);
        }
      );

      it.each(["image/gif", "image/svg+xml", "application/pdf", ""])(
        "rejects the type %j",
        async (type) => {
          const image = new File(["x"], "s", { type });
          await expect(
            run(form({ url: POST, images: [image] }))
          ).resolves.toEqual({
            error: "Screenshots must be PNG, JPEG or WebP images.",
          });
          expect(importSocialRecipe).not.toHaveBeenCalled();
        }
      );

      it("rejects a text value sent in place of a file", async () => {
        const data = form({ url: POST });
        data.append("images", "not a file");
        await expect(run(data)).resolves.toMatchObject({
          error: expect.any(String),
        });
        expect(importSocialRecipe).not.toHaveBeenCalled();
      });
    });
  });

  it("rejects callers without a session before importing", async () => {
    auth.mockResolvedValue(null);
    await expect(run(form({ url: POST, caption: "x" }))).resolves.toMatchObject(
      {
        retry: true,
      }
    );
    expect(importSocialRecipe).not.toHaveBeenCalled();
    expect(importRecipe).not.toHaveBeenCalled();
  });
});
