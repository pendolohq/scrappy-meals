const OFFLINE = "No signal: try again when you're back online.";
// Anything else that throws (an action a new deploy no longer has, a bug) won't
// go away by retrying the same page.
const BROKEN = "Something went wrong: reload the page and try again.";

type Failure = { error: string; retry?: true };

/**
 * Runs a server action; one that can't be reached at all (offline) comes back
 * as a retryable failure instead of rejecting, so the form keeps its values.
 */
export async function attempt<R extends { error?: string }>(
  work: () => Promise<R>
): Promise<R | Failure> {
  try {
    return await work();
  } catch (err) {
    // fetch rejects with a TypeError when the request gets no answer.
    if (!navigator.onLine || err instanceof TypeError) {
      return { error: OFFLINE, retry: true };
    }
    console.error(err);
    return { error: BROKEN };
  }
}

/** The failure's message, saying to try again when that may work and it doesn't already. */
export const failureText = ({ error, retry }: Failure) =>
  retry && !/try again/i.test(error) ? `${error} Try again.` : error;
