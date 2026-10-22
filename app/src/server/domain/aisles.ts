/**
 * The shop's aisles, in the order the list is walked. Foods get them through
 * their Mealie label: Mealie seeds about twenty labels and labels its seeded
 * foods with them, so they're mapped here rather than relabelled by hand.
 */
export const AISLES = [
  "Fruit & veg",
  "Meat & fish",
  "Dairy, eggs & tofu",
  "Bakery",
  "Pasta, rice & grains",
  "Canned & jarred",
  "Baking, nuts & sweets",
  "Spices, oils & condiments",
  "Frozen",
  "Drinks",
  // Packaged products planned as themselves; no food label maps here.
  "Products",
  "Other",
] as const;

export type Aisle = (typeof AISLES)[number];

const OTHER: Aisle = "Other";

/** Mealie's seeded labels; a label named like an aisle maps to that aisle too. */
const FROM_LABEL: Record<string, Aisle> = {
  "fresh produce": "Fruit & veg",
  meat: "Meat & fish",
  "meat products": "Meat & fish",
  seafood: "Meat & fish",
  "dairy products": "Dairy, eggs & tofu",
  // Mealie puts tofu, tempeh and plant milks here.
  "health foods": "Dairy, eggs & tofu",
  "baked goods": "Bakery",
  grains: "Pasta, rice & grains",
  "canned goods": "Canned & jarred",
  baking: "Baking, nuts & sweets",
  // Mostly nuts and seeds.
  snacks: "Baking, nuts & sweets",
  sweets: "Baking, nuts & sweets",
  spices: "Spices, oils & condiments",
  oils: "Spices, oils & condiments",
  condiments: "Spices, oils & condiments",
  "frozen foods": "Frozen",
  beverages: "Drinks",
  alcohol: "Drinks",
  // Products are the planned products' own group; a food labelled so is Other.
  ...Object.fromEntries(
    AISLES.filter((a) => a !== "Products").map((a) => [a.toLowerCase(), a])
  ),
};

/** The aisle for a Mealie label; unlabelled and unknown labels are "Other". */
export const aisleOf = (label: string | null | undefined): Aisle =>
  (label && FROM_LABEL[label.trim().toLowerCase()]) || OTHER;

export const aisleOrder = (aisle: Aisle) => AISLES.indexOf(aisle);
