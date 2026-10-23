import type { SlotType } from "./slots";

/**
 * The agreed tags and categories. They live in Mealie (and stay editable
 * there); this list is what imports may assign and what the review page
 * offers, so automatic tagging never invents near-duplicates. Mealie matches
 * organizers by name, case-insensitively, and slugifies the name.
 */
export type Organizer = { name: string; slug: string };

/** When or how you'd eat it. A recipe can have several. */
export const RECIPE_TAGS = [
  { name: "Breakfast", slug: "breakfast" },
  { name: "Lunch", slug: "lunch" },
  { name: "Dinner", slug: "dinner" },
  { name: "Snack", slug: "snack" },
  { name: "Dessert", slug: "dessert" },
  { name: "Meal prep", slug: "meal-prep" },
  { name: "High protein", slug: "high-protein" },
  /**
   * A veg side planned as a second entry next to a lunch or dinner. Only
   * picked by hand: nothing in `classifyTags` assigns it.
   */
  { name: "Side", slug: "side" },
] as const satisfies Organizer[];

/**
 * Marks a packaged product (see `mealie/product-state.ts`). Not in
 * `RECIPE_TAGS`: nothing classifies into it and the review page doesn't offer
 * it (it keeps it, like any tag from outside the list). Discover leaves
 * products out unless this tag is chosen.
 */
export const PRODUCT_TAG = {
  name: "Product",
  slug: "product",
} as const satisfies Organizer;

/**
 * Marks a single food added by name: a kiwi, a glass of milk, a cappuccino
 * (see `mealie/food-recipes.ts`). Like the Product tag, it's outside
 * `RECIPE_TAGS`, and Discover leaves these out unless it is chosen.
 */
export const FOOD_TAG = {
  name: "Food",
  slug: "food",
} as const satisfies Organizer;

/** A single food added by name, going by its tags. */
export const isFoodRecipe = (tags: Organizer[] | null | undefined) =>
  (tags ?? []).some((t) => t.slug === FOOD_TAG.slug);

/** Tags whose recipes Discover leaves out until the tag is chosen or a search is typed. */
export const SET_ASIDE_TAGS = [PRODUCT_TAG, FOOD_TAG] as const;

/** What's in it. Mostly one per recipe, so every recipe falls somewhere. */
export const RECIPE_CATEGORIES = [
  { name: "Vegan", slug: "vegan" },
  { name: "Vegetarian", slug: "vegetarian" },
  { name: "Fish", slug: "fish" },
  { name: "Chicken", slug: "chicken" },
  { name: "Meat", slug: "meat" },
] as const satisfies Organizer[];

export type TagSlug = (typeof RECIPE_TAGS)[number]["slug"];
export type CategorySlug = (typeof RECIPE_CATEGORIES)[number]["slug"];

/** "Quick to prepare" is a total time, not a tag. */
export const QUICK_MAX_MINUTES = 30;

export const isQuick = (totalMinutes: number | null) =>
  totalMinutes !== null &&
  totalMinutes > 0 &&
  totalMinutes <= QUICK_MAX_MINUTES;

/** "1 hr 5 min", "45 min": how the planner shows a recipe's total time. */
export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) {
    return `${m} min`;
  }
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
}

const MEAL_TAG_SLOTS: [TagSlug, SlotType][] = [
  ["breakfast", "breakfast"],
  ["lunch", "lunch"],
  ["dinner", "dinner"],
  ["snack", "snack"],
];

/**
 * The slot a recipe obviously belongs in: when exactly one of its tags names
 * a slot. A recipe tagged lunch and dinner could be either, so none.
 */
export function slotFromTags(tagSlugs: string[]): SlotType | null {
  const slots = MEAL_TAG_SLOTS.filter(([tag]) => tagSlugs.includes(tag));
  return slots.length === 1 ? slots[0][1] : null;
}

/** The meal tag that names a slot: what the add-meal picker starts filtered on. */
export const tagForSlot = (slot: SlotType): TagSlug =>
  MEAL_TAG_SLOTS.find(([, s]) => s === slot)![0];

/**
 * Categories to ask Mealie for when filtering. Vegan food is vegetarian too,
 * but a recipe usually carries only the narrower category.
 */
export function categoryFilter(slugs: string[]): string[] {
  return slugs.includes("vegetarian") && !slugs.includes("vegan")
    ? [...slugs, "vegan"]
    : slugs;
}

// --- Automatic tagging on import -------------------------------------------
//
// Keyword rules over the recipe's name and ingredient lines: cheap, offline
// and predictable. They get the common cases right; the review page is where
// the rest gets corrected.

const words = (list: string[]) =>
  new RegExp(`\\b(?:${list.join("|")})\\b`, "i");

// Words that make an animal-sounding ingredient plant-based ("oat milk",
// "peanut butter", "flax egg", "vegan mayo").
const PLANT =
  "(?:vegan|plant[- ]based|dairy[- ]free|non[- ]dairy|oat|almond|soy|soya|coconut|cashew|rice|peanut|nut|hazelnut|cocoa|cacao|apple|seed|sunflower|flax|chia|shea)";

/** An animal word not preceded by a plant word. */
const animal = (list: string[]) =>
  new RegExp(`(?<!\\b${PLANT}[\\s-])\\b(?:${list.join("|")})\\b`, "i");

const FISH = words([
  "fish(?! sauce)",
  "salmon",
  "tuna",
  "cod",
  "haddock",
  "mackerel",
  "sardines?",
  "trout",
  "prawns?",
  "shrimps?",
  "crabs?",
  "lobsters?",
  "mussels?",
  "clams?",
  "scallops?",
  "squid",
  "calamari",
  "octopus",
  "sea ?bass",
  "halibut",
  "tilapia",
  "pollock",
  "hake",
  "monkfish",
  "seafood",
  "anchov(?:y|ies)(?! paste)",
]);

// "Quorn sausages", "vegan bacon", "plant-based chicken": substitutes,
// not meat.
const MEAT_FREE =
  "(?<!\\b(?:vegan|veggie|vegetarian|quorn|plant[- ]based|meat[- ]free|meatless|soy|soya|tofu|seitan)[\\s-])";

const meat = (list: string[]) =>
  new RegExp(`${MEAT_FREE}\\b(?:${list.join("|")})\\b`, "i");

const CHICKEN = meat(["chicken", "turkey"]);

const MEAT = meat([
  // A beef tomato is a tomato, whichever way round the parser wrote it.
  "(?<!tomato(?:es)? )beef(?! tomato)",
  // "Cauliflower steaks" and "tuna steaks" aren't beef.
  "(?<!(?:cauliflower|mushroom|celeriac|aubergine|eggplant|cabbage|tuna|salmon|swordfish) )steaks?",
  // Mince on its own is beef; poultry mince says so. Mince pies are mincemeat.
  "(?<!(?:chicken|turkey) )mince(?! pies?)",
  "pork",
  "bacon",
  "ham",
  "sausages?",
  "chorizo",
  "salami",
  "pancetta",
  "prosciutto",
  "lamb",
  "mutton",
  "veal",
  "venison",
  "duck(?! eggs?)",
  "meatballs?",
  "pepperoni",
  "brisket",
  "ribs",
  "gammon",
  "lardons",
  "guanciale",
  "nduja",
  "oxtail",
  "goat(?!'?s? (?:cheese|milk|yogh?urt|butter))",
]);

// Makes a dish not vegetarian without being what it's about: they only
// decide the category when nothing else does.
const FLAVOURING_FISH = words([
  "fish sauce",
  "oyster sauce",
  "anchov(?:y|ies) paste",
  "worcestershire",
  "dashi",
  "bonito",
  "(?:fish|seafood|prawn|shrimp) (?:stock|broth|bouillon|cubes?)",
]);
const STOCK = "(?:stock|broth|bouillon|gravy|fat|dripping|drippings|cubes?)";
const FLAVOURING_CHICKEN = new RegExp(`\\b(?:chicken|turkey) ${STOCK}\\b`, "i");
const FLAVOURING_MEAT = new RegExp(
  `\\b(?:beef|pork|lamb|veal|duck|bacon) ${STOCK}\\b|\\b(?:gelatine?|lard|suet)\\b`,
  "i"
);

const DAIRY_OR_EGG = animal([
  "eggs?",
  "egg yolks?",
  "egg whites?",
  "milk",
  "butter(?! beans?)",
  "buttermilk",
  "cream(?! of tartar)",
  "cheese",
  "yogh?urt",
  "honey",
  "parmesan",
  "parmigiano",
  "pecorino",
  "mozzarella",
  "burrata",
  "feta",
  "ricotta",
  "mascarpone",
  "ghee",
  "cheddar",
  "halloumi",
  "paneer",
  "cr[eè]me fra[iî]che",
  "mayo(?:nnaise)?",
  "whey",
  "quark",
  "skyr",
  "kefir",
  "custard",
  "brie",
  "gruy[eè]re",
  "emmental",
  "goat'?s? cheese",
]);

// A flavouring line ("chicken stock") would also match the main word, so
// those are taken out before looking for the main ones.
const FLAVOURINGS = [FLAVOURING_CHICKEN, FLAVOURING_MEAT, FLAVOURING_FISH].map(
  (re) => new RegExp(re.source, "gi")
);
const withoutFlavourings = (text: string) =>
  FLAVOURINGS.reduce((rest, re) => rest.replace(re, " "), text);

// Parsed lines put the modifier wherever the source did ("mayonnaise vegan",
// "sour cream plant-based", "greek yogurt Greek style, Alpro"), so these
// count anywhere in the line, and make all of it plant-based.
const PLANT_LINE = words([
  "vegan",
  "plant[- ]based",
  "alpro",
  "oatly",
  "violife",
  "koko",
  "naturli",
  "tofurky",
  "vbites",
  "this isn'?t",
  "happy (?:pancetta|bacon)",
  "beyond meat",
  "linda mccartney'?s?",
]);

// A substitute rules out meat and fish, not dairy or egg (Quorn has egg).
const MEAT_FREE_LINE = words([
  "vegetarian",
  "veggie",
  "meat[- ]free",
  "meatless",
  "quorn",
  "tofu",
  "tempeh",
  "seitan",
  "soya? mince",
  "tvp",
  "textured (?:vegetable|soya?) protein",
  "jackfruit",
  "(?:chicken|beef|pork|meat|fish|seafood)[- ](?:free|style)",
]);

const DAIRY_FREE_LINE = words(["dairy[- ]free", "non[- ]dairy", "egg[- ]free"]);

// Quotes mark a mock: "'Chicken' tenders", "Tempeh “meatballs”". An
// apostrophe inside a word ("goat's") isn't one.
const QUOTED = /(?<!\p{L})['‘"“][^'‘’"“”\n]{1,40}['’"”](?!\p{L})/gu;

type LineReading = {
  main: CategorySlug[];
  flavouring: CategorySlug[];
  dairyOrEgg: boolean;
  substitute: boolean;
};

// One line at a time, so "vegan" in one line can't excuse the butter in
// the next.
const readLine = (line: string): LineReading => {
  const quoted = line.match(QUOTED) ?? [];
  const text = line.replace(QUOTED, " ");
  const plant = PLANT_LINE.test(line);
  const meatFree = plant || MEAT_FREE_LINE.test(line);
  const rest = withoutFlavourings(text);
  const main: CategorySlug[] = [];
  const flavouring: CategorySlug[] = [];
  if (!meatFree) {
    for (const [slug, re] of [
      ["fish", FISH],
      ["chicken", CHICKEN],
      ["meat", MEAT],
    ] as const) {
      if (re.test(rest)) {
        main.push(slug);
      }
    }
    for (const [slug, re] of [
      ["chicken", FLAVOURING_CHICKEN],
      ["meat", FLAVOURING_MEAT],
      ["fish", FLAVOURING_FISH],
    ] as const) {
      if (re.test(text)) {
        flavouring.push(slug);
      }
    }
  }
  return {
    main,
    flavouring,
    dairyOrEgg:
      !plant && !DAIRY_FREE_LINE.test(line) && DAIRY_OR_EGG.test(text),
    substitute:
      meatFree ||
      quoted.some((q) => [FISH, CHICKEN, MEAT].some((re) => re.test(q))),
  };
};

/** Categories from what the recipe contains. */
export function classifyCategories(
  name: string,
  ingredients: string[]
): CategorySlug[] {
  // A recipe that calls itself vegan is trusted over "butter" or "mayo"
  // written without the plant word.
  if (/\b(?:vegan|plant[- ]based)\b/i.test(name)) {
    return ["vegan"];
  }
  const lines = ingredients.map(readLine);
  // A dish named after what it imitates ("Fennel sausage ragù" made with
  // soya mince) is read from its ingredients alone.
  const read = lines.some((l) => l.substitute)
    ? lines
    : [readLine(name), ...lines];
  const has = (slug: CategorySlug, key: "main" | "flavouring") =>
    read.some((l) => l[key].includes(slug));
  const found = (["fish", "chicken", "meat"] as const).filter((c) =>
    has(c, "main")
  );
  if (found.length > 0) {
    return found;
  }
  const flavouring = (["chicken", "meat", "fish"] as const).find((c) =>
    has(c, "flavouring")
  );
  if (flavouring) {
    return [flavouring];
  }
  return read.some((l) => l.dairyOrEgg) ? ["vegetarian"] : ["vegan"];
}

const BREAKFAST = words([
  "breakfast",
  "brunch",
  "pancakes?",
  "waffles?",
  "porridge",
  "oatmeal",
  "overnight oats",
  "granola",
  "muesli",
  "french toast",
  "omelett?es?",
  "scrambled",
  "shakshuka",
  "smoothie",
  "smoothie bowl",
  "cr[eê]pes?",
  "bagels?",
  "eggs benedict",
  "chia pudding",
  "breakfast burrito",
]);

const DESSERT = words([
  "desserts?",
  "(?<!(?:fish|crab|salmon|tuna|potato|rice|corn|veggie|savoury) )cakes?",
  "cheesecakes?",
  "cupcakes?",
  "brownies?",
  "blondies?",
  "cookies?",
  "ice cream",
  "sorbet",
  "mousse",
  "tiramisu",
  "crumble",
  "fudge",
  "truffles?",
  "panna cotta",
  "trifle",
  "pavlova",
  "meringues?",
  "custard",
  "(?<!yorkshire )puddings?",
  "macarons?",
  "doughnuts?",
  "donuts?",
  "tarte tatin",
  "(?:apple|cherry|pecan|pumpkin|key lime|lemon meringue|banoffee|mince|rhubarb|blueberry) pies?",
  "(?:apple|lemon|treacle|custard|fruit|chocolate|bakewell|frangipane|pear) tarts?",
]);

const SNACK = words([
  "snacks?",
  "energy (?:balls?|bites?)",
  "protein (?:balls?|bites?|bars?)",
  "bliss balls?",
  "hummus",
  "dips?",
  "flapjacks?",
  "granola bars?",
  "popcorn",
  "trail mix",
  "crackers?",
  "roasted chickpeas",
  "muffins?",
  "banana bread",
]);

const LUNCH = words([
  "lunch",
  "salads?",
  "sandwich(?:es)?",
  "wraps?",
  "toasties?",
  "paninis?",
  "soups?",
  "quesadillas?",
  "bowls?",
]);

const DINNER = words([
  "dinner",
  "supper",
  "curry",
  "curries",
  "stews?",
  "pasta",
  "spaghetti",
  "linguine",
  "penne",
  "rigatoni",
  "tagliatelle",
  "noodles",
  "risotto",
  "lasagne",
  "lasagna",
  "chilli",
  "chili",
  "stir[- ]?fry",
  "casseroles?",
  "roast(?:ed)? (?:chicken|beef|lamb|pork)",
  "traybake",
  "tray bake",
  "tacos?",
  "burritos?",
  "enchiladas?",
  "fajitas?",
  "pizzas?",
  "burgers?",
  "pies?",
  "tagine",
  "dal",
  "dhal",
  "biryani",
  "paella",
  "gnocchi",
  "soups?",
  "steak",
  "fillets?",
]);

const MEAL_PREP = words([
  "meal prep",
  "meal-prep",
  "batch",
  "make[- ]ahead",
  "freezer",
]);

/** Protein per serving that makes a recipe high protein. */
export const HIGH_PROTEIN_GRAMS = 30;

/**
 * Tags from the recipe's name and nutrition. The ingredients say little
 * about when a dish is eaten (eggs are in cakes too), so they're left out.
 * A main course with nothing else to place it is dinner.
 */
export function classifyTags(
  name: string,
  opts: { proteinPerServing?: number; mainProtein?: boolean } = {}
): TagSlug[] {
  const tags: TagSlug[] = [];
  if (BREAKFAST.test(name)) {
    tags.push("breakfast");
  }
  const dessert = DESSERT.test(name);
  if (dessert) {
    tags.push("dessert");
  }
  if (!dessert && SNACK.test(name)) {
    tags.push("snack");
  }
  if (tags.length === 0) {
    if (LUNCH.test(name)) {
      tags.push("lunch");
    }
    if (DINNER.test(name) || (tags.length === 0 && opts.mainProtein)) {
      tags.push("dinner");
    }
  }
  if (MEAL_PREP.test(name)) {
    tags.push("meal-prep");
  }
  if (
    /\bhigh[- ]protein\b/i.test(name) ||
    (opts.proteinPerServing ?? 0) >= HIGH_PROTEIN_GRAMS
  ) {
    tags.push("high-protein");
  }
  return tags;
}

/** Tags and categories for a freshly imported recipe, all from the agreed list. */
export function classifyRecipe(recipe: {
  name: string;
  ingredients: string[];
  proteinPerServing?: number;
}): { tags: Organizer[]; categories: Organizer[] } {
  // Without ingredients there's nothing to tell vegan from anything else.
  const categories = recipe.ingredients.some((i) => i.trim())
    ? classifyCategories(recipe.name, recipe.ingredients)
    : [];
  const tags = classifyTags(recipe.name, {
    proteinPerServing: recipe.proteinPerServing,
    mainProtein: categories.some(
      (c) => c === "fish" || c === "chicken" || c === "meat"
    ),
  });
  return {
    tags: RECIPE_TAGS.filter((t) => tags.includes(t.slug)),
    categories: RECIPE_CATEGORIES.filter((c) => categories.includes(c.slug)),
  };
}
