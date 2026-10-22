import { getDb } from "@/server/db/client";
import { offProductUrl } from "@/server/domain/product";
import { getContribution } from "@/server/off-contribute";

import { RetryContribution } from "./retry-contribution";

/**
 * Where a product's contribution to Open Food Facts stands: a note once it was
 * sent, a retry when it wasn't. Nothing in any other state.
 */
export const OffContribution = async ({ barcode }: { barcode: string }) => {
  const state = await getContribution(getDb(), barcode);
  if (state?.status === "sent") {
    return (
      <p className="text-sm text-muted">
        Added to{" "}
        <a
          href={offProductUrl(barcode)}
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2"
        >
          Open Food Facts
        </a>
        .
      </p>
    );
  }
  if (state?.status !== "failed") {
    return null;
  }
  return state.retryable ? (
    <RetryContribution barcode={barcode} />
  ) : (
    <p className="text-sm text-muted">Not sent to Open Food Facts.</p>
  );
};
