/** Joins class names, skipping falsy ones: `cx("a", on && "b")`. */
export const cx = (...classes: (string | false | null | undefined)[]) =>
  classes.filter(Boolean).join(" ");
