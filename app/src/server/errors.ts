/** An error whose message is safe and useful to show to the signed-in user. */
export class UserFacingError extends Error {
  name = "UserFacingError";
}

/**
 * A user-facing error that may go away on its own (Mealie down, a timeout):
 * callers that queue changes keep them and try again later.
 */
export class RetryableError extends UserFacingError {
  name = "RetryableError";
}
