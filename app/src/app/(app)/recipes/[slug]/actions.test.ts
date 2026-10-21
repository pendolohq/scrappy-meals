import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => vi.fn<() => Promise<unknown>>());
vi.mock("@/auth", () => ({ auth }));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn<(path: string) => void>(),
}));
vi.mock("@/server/db/client", () => ({ getDb: () => ({}) }));
const retryContribution = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<string>>(async () => "sent")
);
vi.mock("@/server/off-contribute", () => ({ retryContribution }));

import { retryContributionAction } from "./actions";

const alex = { id: "user-alex", name: "Alex", email: "alex@example.test" };

describe("retryContributionAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.mockResolvedValue({ user: alex });
  });

  it.each(["", "soup", "5000159461123", "1".repeat(40)])(
    "rejects %j as a barcode without retrying",
    async (barcode) => {
      const result = await retryContributionAction({ barcode });
      expect(result).toHaveProperty("error");
      expect(retryContribution).not.toHaveBeenCalled();
    }
  );

  it("retries under the canonical barcode, as the signed-in user", async () => {
    await expect(
      retryContributionAction({ barcode: "036000291452" })
    ).resolves.toEqual({ outcome: "sent" });
    expect(retryContribution).toHaveBeenCalledWith(
      {},
      "0036000291452",
      "user-alex"
    );
  });

  it("does nothing for a signed-out caller", async () => {
    auth.mockResolvedValue(null);
    const result = await retryContributionAction({ barcode: "5000159461122" });
    expect(result).toHaveProperty("error");
    expect(retryContribution).not.toHaveBeenCalled();
  });
});
