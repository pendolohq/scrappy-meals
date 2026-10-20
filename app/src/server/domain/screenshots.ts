// Shared by the import action (which enforces them) and the form (which
// checks early: an upload over the body limit fails before the action runs,
// so the user would never see these messages).
export const MAX_IMAGES = 4;
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];

export const TOO_MANY_IMAGES = `Add at most ${MAX_IMAGES} screenshots.`;
export const IMAGE_TOO_BIG = "Each screenshot must be under 4 MB.";
export const IMAGE_BAD_TYPE = "Screenshots must be PNG, JPEG or WebP images.";

/** The first problem with these screenshots, or null when they're fine. */
export const screenshotProblem = (
  files: { size: number; type: string }[]
): string | null => {
  if (files.length > MAX_IMAGES) {
    return TOO_MANY_IMAGES;
  }
  if (files.some((f) => f.size > MAX_IMAGE_BYTES)) {
    return IMAGE_TOO_BIG;
  }
  if (files.some((f) => !IMAGE_TYPES.includes(f.type))) {
    return IMAGE_BAD_TYPE;
  }
  return null;
};
