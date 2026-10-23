import { MACRO_KEYS, type MacroKey, type Macros } from "../mealie/nutrition";

import { type AdherenceStatus, EATEN_SHARE } from "./adherence";

/** A person's daily targets; null means no target for that macro. */
export type Targets = Record<MacroKey, number | null>;

export type FitEntry = {
  id: string;
  /** Per-serving values, a macro left out when unknown. Null when the recipe is gone. */
  perServing: Partial<Macros> | null;
  /** True when the nutrition is an AI estimate nobody has checked yet. */
  estimated?: boolean;
  /** Servings one person eats at multiplier 1. */
  baseServings: number;
  /** Current portion multiplier per user id; missing = 0. */
  portions: Record<string, number>;
  /**
   * Counts in the totals but never changes, for anyone: a meal eaten
   * off-plan, or one on a day that has passed.
   */
  locked?: boolean;
  /**
   * Keeps its amount: a product or a single food, where a quarter of a
   * protein bar isn't a portion. Fasting still sets it to 0.
   */
  fixed?: boolean;
  /** What each person logged, by user id: their portion is theirs, and a skip counts as nothing. */
  logged?: Record<string, AdherenceStatus | undefined>;
};

export type FitPerson = {
  id: string;
  targets: Targets;
  fasting: boolean;
};

export type Miss = {
  macro: MacroKey;
  /** How far off the target, as a share of it: -0.18 is 18% under. */
  off: number;
};

export type PersonFit = {
  /**
   * `fitted`: portions chosen against their targets. `fasting`: set to 0 and
   * not scored. `no-targets`: portions kept, nothing to score against.
   * `empty`: nothing on the day for them to eat.
   */
  status: "fitted" | "fasting" | "no-targets" | "empty";
  totals: Macros;
  /** Lower is better; null when not scored. */
  score: number | null;
  /** Macros outside their band; empty when the day lands. */
  misses: Miss[];
  /** An eaten entry lacks kcal or protein, so it was left as it is and the totals are a lower bound. */
  incomplete: boolean;
  /** An eaten entry's nutrition is an unchecked estimate. */
  estimated: boolean;
};

export type DayFit = {
  /** Every entry's portions after the fit, by entry id then user id. */
  portions: Record<string, Record<string, number>>;
  people: Record<string, PersonFit>;
};

/** Portions a person can be given of an entry they eat: ¼ steps from 0.5 to 3. */
export const PORTION_STEPS = Array.from({ length: 11 }, (_, i) => 0.5 + i / 4);

/**
 * kcal and protein are what the plan is for; the others only nudge the pick.
 * `band` is how far off a day may land before it's flagged.
 */
const SCORING: Record<MacroKey, { weight: number; band: number }> = {
  kcal: { weight: 1, band: 0.1 },
  protein: { weight: 1, band: 0.1 },
  carbs: { weight: 0.25, band: 0.2 },
  fat: { weight: 0.25, band: 0.2 },
  fibre: { weight: 0.25, band: 0.2 },
};

/** How much worse landing outside the band is than the same distance inside it. */
const OUTSIDE_BAND = 10;

/** Above this many free entries, every combination (11ⁿ) is too many to try. */
const EXHAUSTIVE_MAX = 5;
const MAX_ROUNDS = 50;
/** Scores closer than this are a tie, so float noise doesn't decide the pick. */
const EPSILON = 1e-9;

const hasTargets = (targets: Targets) =>
  MACRO_KEYS.some((key) => targets[key] !== null);

const zero = (): Macros => ({
  kcal: 0,
  protein: 0,
  carbs: 0,
  fat: 0,
  fibre: 0,
});

/** Signed share off target; more fibre than planned isn't off. Null without a target. */
const offTarget = (macro: MacroKey, total: number, target: number | null) => {
  if (target === null || target <= 0) {
    return null;
  }
  const off = total / target - 1;
  return macro === "fibre" ? Math.min(off, 0) : off;
};

/**
 * `scoreDay`'s score on plain arrays in `MACRO_KEYS` order, since the search
 * calls it for every combination it tries.
 */
const scoreOf = (totals: ArrayLike<number>, goals: (number | null)[]) => {
  let score = 0;
  for (let k = 0; k < MACRO_KEYS.length; k++) {
    const off = offTarget(MACRO_KEYS[k], totals[k], goals[k]);
    if (off === null) {
      continue;
    }
    const { weight, band } = SCORING[MACRO_KEYS[k]];
    const outside = Math.max(0, Math.abs(off) - band);
    score += weight * (off * off + OUTSIDE_BAND * outside * outside);
  }
  return score;
};

/**
 * How far a day's totals are from a person's targets: weighted squared
 * relative error, much steeper outside each macro's band. A macro without a
 * target isn't scored. Null when the person has no targets at all.
 */
export function scoreDay(
  totals: Macros,
  targets: Targets
): { score: number; misses: Miss[] } | null {
  if (!hasTargets(targets)) {
    return null;
  }
  const misses: Miss[] = [];
  for (const macro of MACRO_KEYS) {
    const off = offTarget(macro, totals[macro], targets[macro]);
    if (off !== null && Math.abs(off) - SCORING[macro].band > EPSILON) {
      misses.push({ macro, off: Math.round(off * 1000) / 1000 });
    }
  }
  return {
    score: scoreOf(
      MACRO_KEYS.map((key) => totals[key]),
      MACRO_KEYS.map((key) => targets[key])
    ),
    misses,
  };
}

/** "protein 18% under", for a day's summary. */
export const describeMiss = ({ macro, off }: Miss) =>
  `${macro} ${Math.round(Math.abs(off) * 100)}% ${off < 0 ? "under" : "over"}`;

const knowsKcalAndProtein = (entry: FitEntry) =>
  entry.perServing?.kcal !== undefined &&
  entry.perServing.protein !== undefined;

const share = (entry: FitEntry, userId: string) => {
  const status = entry.logged?.[userId];
  return status ? EATEN_SHARE[status] : 1;
};

const addTo = (
  totals: Macros,
  entry: FitEntry,
  userId: string,
  multiplier: number
) => {
  const servings = entry.baseServings * multiplier * share(entry, userId);
  if (servings <= 0 || !entry.perServing) {
    return;
  }
  for (const key of MACRO_KEYS) {
    totals[key] += (entry.perServing[key] ?? 0) * servings;
  }
};

const rounded = (totals: Macros): Macros => {
  const out = zero();
  for (const key of MACRO_KEYS) {
    out[key] = Math.round(totals[key] * 10) / 10;
  }
  return out;
};

const nearestStep = (m: number) =>
  PORTION_STEPS.reduce((a, b) => (Math.abs(b - m) < Math.abs(a - m) ? b : a));

/** Lower score wins; on a tie, the one that changes the current portions least. */
const better = (
  score: number,
  distance: number,
  best: { score: number; distance: number }
) =>
  score < best.score - EPSILON ||
  (Math.abs(score - best.score) <= EPSILON &&
    distance < best.distance - EPSILON);

/**
 * Picks multipliers for the free entries, given what one multiplier of each
 * adds (`units`, per macro) and the totals of everything else. Every
 * combination when there are few; otherwise coordinate descent from the
 * current portions, with pair moves to get past a step neither entry can
 * take alone. Deterministic: the same input gives the same pick.
 */
const search = (
  units: number[][],
  current: number[],
  base: number[],
  goals: (number | null)[]
): number[] => {
  const n = units.length;
  const K = MACRO_KEYS.length;

  if (n <= EXHAUSTIVE_MAX) {
    // Running totals per depth, so each combination costs one score.
    const sums = Array.from({ length: n + 1 }, () => new Float64Array(K));
    sums[0].set(base);
    const chosen = Array.from({ length: n }, () => 0);
    const best = { score: Infinity, distance: Infinity, multipliers: chosen };
    const pick = (i: number, distance: number) => {
      if (i === n) {
        const score = scoreOf(sums[n], goals);
        if (better(score, distance, best)) {
          Object.assign(best, { score, distance, multipliers: [...chosen] });
        }
        return;
      }
      for (const step of PORTION_STEPS) {
        for (let k = 0; k < K; k++) {
          sums[i + 1][k] = sums[i][k] + units[i][k] * step;
        }
        chosen[i] = step;
        pick(i + 1, distance + Math.abs(step - current[i]));
      }
    };
    pick(0, 0);
    return best.multipliers;
  }

  const evaluate = (multipliers: number[]) => {
    const totals = [...base];
    let distance = 0;
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < K; k++) {
        totals[k] += units[i][k] * multipliers[i];
      }
      distance += Math.abs(multipliers[i] - current[i]);
    }
    return { score: scoreOf(totals, goals), distance, multipliers };
  };
  let best = evaluate(current.map(nearestStep));
  const tryMove = (indexes: number[]) => {
    let improved = false;
    const combos = indexes.reduce<number[][]>(
      (acc) => acc.flatMap((c) => PORTION_STEPS.map((s) => [...c, s])),
      [[]]
    );
    for (const steps of combos) {
      const multipliers = [...best.multipliers];
      indexes.forEach((index, k) => (multipliers[index] = steps[k]));
      const candidate = evaluate(multipliers);
      if (better(candidate.score, candidate.distance, best)) {
        best = candidate;
        improved = true;
      }
    }
    return improved;
  };
  for (let round = 0; round < MAX_ROUNDS; round++) {
    let improved = false;
    for (let i = 0; i < n; i++) {
      improved = tryMove([i]) || improved;
    }
    for (let i = 0; i < n && !improved; i++) {
      for (let j = i + 1; j < n && !improved; j++) {
        improved = tryMove([i, j]);
      }
    }
    if (!improved) {
      break;
    }
  }
  return best.multipliers;
};

const fitPerson = (
  entries: FitEntry[],
  person: FitPerson
): { multipliers: Map<string, number>; fit: PersonFit } => {
  const userId = person.id;
  const current = (entry: FitEntry) => entry.portions[userId] ?? 0;
  const unchangeable = (entry: FitEntry) =>
    entry.locked === true || entry.logged?.[userId] !== undefined;
  const multipliers = new Map(entries.map((e) => [e.id, current(e)]));

  if (person.fasting) {
    for (const entry of entries) {
      if (!unchangeable(entry)) {
        multipliers.set(entry.id, 0);
      }
    }
  }

  const eats = (entry: FitEntry) => multipliers.get(entry.id)! > 0;
  const free = entries.filter(
    (entry) =>
      !person.fasting &&
      eats(entry) &&
      !unchangeable(entry) &&
      !entry.fixed &&
      knowsKcalAndProtein(entry)
  );
  const eaten = entries.filter(eats);

  const status: PersonFit["status"] = person.fasting
    ? "fasting"
    : eaten.length === 0
      ? "empty"
      : hasTargets(person.targets)
        ? "fitted"
        : "no-targets";

  if (status === "fitted" && free.length > 0) {
    const base = zero();
    for (const entry of eaten) {
      if (!free.includes(entry)) {
        addTo(base, entry, userId, multipliers.get(entry.id)!);
      }
    }
    const picked = search(
      // Free entries aren't logged, so a multiplier of 1 is all of a base serving.
      free.map((entry) =>
        MACRO_KEYS.map(
          (key) => (entry.perServing![key] ?? 0) * entry.baseServings
        )
      ),
      free.map((e) => multipliers.get(e.id)!),
      MACRO_KEYS.map((key) => base[key]),
      MACRO_KEYS.map((key) => person.targets[key])
    );
    free.forEach((entry, i) => multipliers.set(entry.id, picked[i]));
  }

  const totals = zero();
  for (const entry of eaten) {
    addTo(totals, entry, userId, multipliers.get(entry.id)!);
  }
  const scored = status === "fitted" ? scoreDay(totals, person.targets) : null;
  return {
    multipliers,
    fit: {
      status,
      totals: rounded(totals),
      score: scored?.score ?? null,
      misses: scored?.misses ?? [],
      incomplete: eaten.some((e) => !knowsKcalAndProtein(e)),
      estimated: eaten.some((e) => e.estimated && e.perServing !== null),
    },
  };
};

/**
 * Fits one day's portions to each person's targets. Meals are shared but
 * portions aren't, so each person is fitted on their own. Only multipliers
 * change, never servings, and only in ¼ steps between 0.5 and 3: a 0 stays a
 * 0 (nobody is given a meal they weren't eating) and nothing someone eats
 * goes to 0. Locked and logged entries count but don't change; entries
 * lacking kcal or protein stay as they are. A fasting person gets 0 on
 * everything that can change, and their day isn't scored.
 */
export function fitDay(entries: FitEntry[], people: FitPerson[]): DayFit {
  const portions: DayFit["portions"] = Object.fromEntries(
    entries.map((e) => [e.id, { ...e.portions }])
  );
  const fits: DayFit["people"] = {};
  for (const person of people) {
    const { multipliers, fit } = fitPerson(entries, person);
    for (const [entryId, multiplier] of multipliers) {
      portions[entryId][person.id] = multiplier;
    }
    fits[person.id] = fit;
  }
  return { portions, people: fits };
}

export type WeekFit = {
  days: { date: string; fit: DayFit }[];
  /** Each person's average over the days they were fitted on; null when there were none. */
  averages: Record<string, { macros: Macros; days: number } | null>;
};

/** Fits each day on its own, and averages each person's fitted days. */
export function fitWeek(
  days: { date: string; entries: FitEntry[]; people: FitPerson[] }[]
): WeekFit {
  const fitted = days.map((day) => ({
    date: day.date,
    fit: fitDay(day.entries, day.people),
  }));
  const sums = new Map<string, { macros: Macros; days: number }>();
  const everyone = new Set(days.flatMap((d) => d.people.map((p) => p.id)));
  for (const { fit } of fitted) {
    for (const [userId, person] of Object.entries(fit.people)) {
      if (person.status !== "fitted") {
        continue;
      }
      const sum = sums.get(userId) ?? { macros: zero(), days: 0 };
      for (const key of MACRO_KEYS) {
        sum.macros[key] += person.totals[key];
      }
      sum.days += 1;
      sums.set(userId, sum);
    }
  }
  const averages: WeekFit["averages"] = {};
  for (const userId of everyone) {
    const sum = sums.get(userId);
    averages[userId] = sum
      ? {
          macros: rounded(
            Object.fromEntries(
              MACRO_KEYS.map((key) => [key, sum.macros[key] / sum.days])
            ) as Macros
          ),
          days: sum.days,
        }
      : null;
  }
  return { days: fitted, averages };
}
