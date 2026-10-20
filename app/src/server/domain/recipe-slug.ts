import { z } from "zod";

/**
 * Mealie's recipe slugs. Checking the shape also keeps "..", "/" and the like
 * out of Mealie's API paths, since slugs come from URLs and form input.
 */
export const recipeSlug = z
  .string()
  .max(200)
  .regex(/^[a-z0-9-]+$/);
