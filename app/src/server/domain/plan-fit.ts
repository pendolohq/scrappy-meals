import { MACRO_KEYS, type MacroKey, type Macros } from "../mealie/nutrition";

import { type AdherenceStatus } from "./adherence";
import { emptyMacros, roundMacros, servingsEaten } from "./macros";

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
  /**
   * An eaten entry lacks some nutrition, so the totals are a lower bound. One
   * lacking kcal or protein is left as it is; a carbs, fat or fibre target
   * that an eaten entry doesn't report isn't scored.
   */
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

/** A target of 0 or less can't be scored against, so it counts as none. */
const hasTargets = (targets: Targets) =>
  MACRO_KEYS.some((key) => (targets[key] ?? 0) > 0);

/** Signed share off target; more fibre than planned isn't off. Null without a target. */
const offTarget = (macro: MacroKey, total: number, target: number | null) => {
  if (target === null || target <= 0) {
    return null;
  }
  const off = total / target - 1;
  return macro === "fibre" ? Math.min(off, 0) : off;
};

const macroScore = (macro: MacroKey, off: number) => {
  const { weight, band } = SCORING[macro];
  const outside = Math.max(0, Math.abs(off) - band);
  return weight * (off * off + OUTSIDE_BAND * outside * outside);
};

/**
 * `scoreDay`'s score on plain arrays in `MACRO_KEYS` order, for the search,
 * which scores every combination it tries: the macros without a target are
 * dropped once rather than on every call.
 */
const scorer = (goals: (number | null)[]) => {
  const scored = MACRO_KEYS.flatMap((macro, k) => {
    const goal = goals[k];
    return goal !== null && goal > 0 ? [{ macro, k, goal }] : [];
  });
  return (totals: ArrayLike<number>) => {
    let score = 0;
    for (const { macro, k, goal } of scored) {
      score += macroScore(macro, offTarget(macro, totals[k], goal)!);
    }
    return score;
  };
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
  let score = 0;
  const misses: Miss[] = [];
  for (const macro of MACRO_KEYS) {
    const off = offTarget(macro, totals[macro], targets[macro]);
    if (off === null) {
      continue;
    }
    score += macroScore(macro, off);
    if (Math.abs(off) - SCORING[macro].band > EPSILON) {
      misses.push({ macro, off: Math.round(off * 1000) / 1000 });
    }
  }
  return { score, misses };
}

/** "protein 18% under", for a day's summary. */
export const describeMiss = ({ macro, off }: Miss) =>
  `${macro} ${Math.round(Math.abs(off) * 100)}% ${off < 0 ? "under" : "over"}`;

const knowsKcalAndProtein = (entry: FitEntry) =>
  entry.perServing?.kcal !== undefined &&
  entry.perServing.protein !== undefined;

const knowsAll = (entry: FitEntry) =>
  MACRO_KEYS.every((key) => entry.perServing?.[key] !== undefined);

const addTo = (totals: Macros, entry: FitEntry, servings: number) => {
  for (const key of MACRO_KEYS) {
    totals[key] += (entry.perServing?.[key] ?? 0) * servings;
  }
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
  const scoreOf = scorer(goals);

  if (n <= EXHAUSTIVE_MAX) {
    // Running totals per depth, so each combination costs one score.
    const sums = Array.from({ length: n + 1 }, () => new Float64Array(K));
    sums[0].set(base);
    const chosen = Array.from({ length: n }, () => 0);
    const best = { score: Infinity, distance: Infinity, multipliers: chosen };
    const pick = (i: number, distance: number) => {
      if (i === n) {
        const score = scoreOf(sums[n]);
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
    return { score: scoreOf(totals), distance, multipliers, totals };
  };
  let best = evaluate(current.map(nearestStep));
  const singles = PORTION_STEPS.map((s) => [s]);
  const pairs = PORTION_STEPS.flatMap((s) => PORTION_STEPS.map((t) => [s, t]));
  const scratch = new Float64Array(K);
  // A candidate is scored from the best totals plus what the moved entries
  // change, so a move costs one score rather than a rebuild of every entry.
  const tryMove = (indexes: number[]) => {
    let improved = false;
    for (const steps of indexes.length === 1 ? singles : pairs) {
      scratch.set(best.totals);
      let distance = best.distance;
      for (let j = 0; j < indexes.length; j++) {
        const i = indexes[j];
        const delta = steps[j] - best.multipliers[i];
        for (let k = 0; k < K; k++) {
          scratch[k] += units[i][k] * delta;
        }
        distance +=
          Math.abs(steps[j] - current[i]) -
          Math.abs(best.multipliers[i] - current[i]);
      }
      const score = scoreOf(scratch);
      if (better(score, distance, best)) {
        const multipliers = [...best.multipliers];
        indexes.forEach((i, j) => (multipliers[i] = steps[j]));
        // Rebuilt on accept, so float error doesn't pile up across moves.
        best = evaluate(multipliers);
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

  // Free entries aren't logged, so their servings are base × multiplier and
  // which entries are eaten doesn't change with the pick.
  const servings = (entry: FitEntry) =>
    servingsEaten(
      entry.baseServings,
      multipliers.get(entry.id)!,
      entry.logged?.[userId]
    );
  const eaten = entries.filter((entry) => servings(entry) > 0);
  const free = eaten.filter(
    (entry) =>
      !person.fasting &&
      !unchangeable(entry) &&
      !entry.fixed &&
      knowsKcalAndProtein(entry)
  );

  // kcal and protein are scored even when an entry lacks them, as a lower
  // bound, since they're what the plan is for. A missing carbs, fat or fibre
  // value would read as 0 and push the other portions up to make up for it,
  // so that macro isn't scored at all.
  const targets: Targets = { ...person.targets };
  for (const key of ["carbs", "fat", "fibre"] as const) {
    if (eaten.some((entry) => entry.perServing?.[key] === undefined)) {
      targets[key] = null;
    }
  }

  const status: PersonFit["status"] = person.fasting
    ? "fasting"
    : eaten.length === 0
      ? "empty"
      : hasTargets(targets)
        ? "fitted"
        : "no-targets";

  if (status === "fitted" && free.length > 0) {
    const base = emptyMacros();
    for (const entry of eaten) {
      if (!free.includes(entry)) {
        addTo(base, entry, servings(entry));
      }
    }
    const picked = search(
      free.map((entry) =>
        MACRO_KEYS.map(
          (key) => (entry.perServing![key] ?? 0) * entry.baseServings
        )
      ),
      free.map((e) => multipliers.get(e.id)!),
      MACRO_KEYS.map((key) => base[key]),
      MACRO_KEYS.map((key) => targets[key])
    );
    free.forEach((entry, i) => multipliers.set(entry.id, picked[i]));
  }

  const totals = emptyMacros();
  for (const entry of eaten) {
    addTo(totals, entry, servings(entry));
  }
  const scored = status === "fitted" ? scoreDay(totals, targets) : null;
  return {
    multipliers,
    fit: {
      status,
      totals: roundMacros(totals),
      score: scored?.score ?? null,
      misses: scored?.misses ?? [],
      incomplete: eaten.some((e) => !knowsAll(e)),
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
      const sum = sums.get(userId) ?? { macros: emptyMacros(), days: 0 };
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
          macros: roundMacros(
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
