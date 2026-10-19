/** An error whose message is safe and useful to show to the signed-in user. */
export class UserFacingError extends Error {
  name = "UserFacingError";
}
