const OFFLINE = "No signal: try again when you're back online.";

type Failure = { error: string; retry?: true };

/**
 * Runs a server action; one that can't be reached at all (offline) comes back
 * as a retryable failure instead of rejecting, so the form keeps its values.
 */
export async function attempt<R extends { error?: string }>(
  work: () => Promise<R>
): Promise<R | { error: string; retry: true }> {
  try {
    return await work();
  } catch {
    return { error: OFFLINE, retry: true };
  }
}

/** The failure's message, saying to try again when that may work and it doesn't already. */
export const failureText = ({ error, retry }: Failure) =>
  retry && !/try again/i.test(error) ? `${error} Try again.` : error;
