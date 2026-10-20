import { cx } from "@/lib/cx";

/** The app's steaming bowl (as in the app icon), on an accent tile. */
export const BrandMark = ({ className }: { className?: string }) => (
  <span
    aria-hidden
    className={cx(
      "inline-flex shrink-0 items-center justify-center rounded-[28%] bg-accent text-accent-foreground",
      className
    )}
  >
    <svg
      viewBox="0 0 512 512"
      className="size-[78%]"
      fill="none"
      stroke="currentColor"
      strokeWidth="32"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path
        d="M96 248h320a160 136 0 0 1-320 0z"
        fill="currentColor"
        stroke="none"
      />
      <path d="M200 120c-12 28 12 44 0 72M256 104c-12 28 12 44 0 72M312 120c-12 28 12 44 0 72" />
      <path d="M176 424h160" />
    </svg>
  </span>
);

/** Mark and name, as the app's signature in headers. */
export const Brand = ({ className }: { className?: string }) => (
  <span className={cx("inline-flex items-center gap-2.5", className)}>
    <BrandMark className="size-9" />
    <span className="font-serif text-heading font-semibold tracking-tight">
      Scrappy Meals
    </span>
  </span>
);
