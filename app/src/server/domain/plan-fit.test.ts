import { describe, expect, it } from "vitest";

import {
  describeMiss,
  type FitEntry,
  type FitPerson,
  fitDay,
  fitWeek,
  PORTION_STEPS,
  scoreDay,
  type Targets,
} from "./plan-fit";

const noTargets: Targets = {
  kcal: null,
  protein: null,
  carbs: null,
  fat: null,
  fibre: null,
};
const targets = (t: Partial<Targets>): Targets => ({ ...noTargets, ...t });

const person = (id: string, over: Partial<FitPerson> = {}): FitPerson => ({
  id,
  targets: targets({ kcal: 2000, protein: 120 }),
  fasting: false,
  ...over,
});

let n = 0;
const entry = (over: Partial<FitEntry> = {}): FitEntry => ({
  id: `e${++n}`,
  perServing: { kcal: 500, protein: 30, carbs: 50, fat: 20, fibre: 8 },
  baseServings: 1,
  portions: { a: 1, b: 1 },
  ...over,
});

const isStep = (m: number) => PORTION_STEPS.includes(m);

describe("scoreDay", () => {
  it("is 0 on target and grows with the distance", () => {
    const on = { kcal: 2000, protein: 120, carbs: 0, fat: 0, fibre: 0 };
    const t = targets({ kcal: 2000, protein: 120 });
    expect(scoreDay(on, t)).toEqual({ score: 0, misses: [] });
    const near = scoreDay({ ...on, kcal: 2100 }, t)!;
    const far = scoreDay({ ...on, kcal: 2400 }, t)!;
    expect(near.score).toBeGreaterThan(0);
    expect(far.score).toBeGreaterThan(near.score);
  });

  it("flags kcal and protein outside ±10%, the others outside ±20%", () => {
    const t = targets({ kcal: 2000, protein: 100, carbs: 200, fat: 70 });
    const { misses } = scoreDay(
      { kcal: 2150, protein: 85, carbs: 230, fat: 90, fibre: 0 },
      t
    )!;
    expect(misses).toEqual([
      { macro: "protein", off: -0.15 },
      { macro: "fat", off: 0.286 },
    ]);
    expect(describeMiss(misses[0])).toBe("protein 15% under");
    expect(describeMiss(misses[1])).toBe("fat 29% over");
  });

  it("weighs kcal and protein more than the rest", () => {
    const on = { kcal: 2000, protein: 100, carbs: 200, fat: 70, fibre: 30 };
    const t = targets(on);
    const kcalOff = scoreDay({ ...on, kcal: 2200 }, t)!.score;
    const carbsOff = scoreDay({ ...on, carbs: 220 }, t)!.score;
    expect(kcalOff).toBeGreaterThan(carbsOff);
  });

  it("doesn't count fibre over target against the day", () => {
    const t = targets({ fibre: 30 });
    expect(
      scoreDay({ kcal: 0, protein: 0, carbs: 0, fat: 0, fibre: 60 }, t)
    ).toEqual({ score: 0, misses: [] });
    expect(
      scoreDay({ kcal: 0, protein: 0, carbs: 0, fat: 0, fibre: 15 }, t)!.misses
    ).toEqual([{ macro: "fibre", off: -0.5 }]);
  });

  it("scores only the macros with a target, and nothing without any", () => {
    expect(
      scoreDay(
        { kcal: 900, protein: 50, carbs: 0, fat: 0, fibre: 0 },
        targets({ protein: 50 })
      )
    ).toEqual({ score: 0, misses: [] });
    expect(
      scoreDay(
        { kcal: 900, protein: 50, carbs: 0, fat: 0, fibre: 0 },
        noTargets
      )
    ).toBeNull();
  });
});

describe("fitDay", () => {
  it("fits each person to their own targets on shared meals", () => {
    const meals = [entry(), entry(), entry()];
    const fit = fitDay(meals, [
      person("a", { targets: targets({ kcal: 2000, protein: 120 }) }),
      person("b", { targets: targets({ kcal: 1250, protein: 75 }) }),
    ]);
    expect(fit.people.a).toMatchObject({
      status: "fitted",
      totals: { kcal: 2000, protein: 120 },
      misses: [],
    });
    expect(fit.people.b).toMatchObject({
      status: "fitted",
      totals: { kcal: 1250, protein: 75 },
      misses: [],
    });
  });

  it("keeps portions in ¼ steps between 0.5 and 3", () => {
    const meals = [entry(), entry({ perServing: { kcal: 300, protein: 5 } })];
    const fit = fitDay(meals, [
      person("a", { targets: targets({ kcal: 6000, protein: 400 }) }),
      person("b", { targets: targets({ kcal: 100, protein: 5 }) }),
    ]);
    for (const m of meals) {
      expect(fit.portions[m.id].a).toBe(3);
      expect(fit.portions[m.id].b).toBe(0.5);
      expect(isStep(fit.portions[m.id].a)).toBe(true);
    }
    expect(fit.people.a.misses.map((x) => x.macro)).toEqual([
      "kcal",
      "protein",
    ]);
  });

  it("never gives a portion of a meal someone wasn't eating, nor takes one away", () => {
    const yoghurt = entry({ portions: { a: 1, b: 0 } });
    const fit = fitDay(
      [yoghurt, entry()],
      [
        person("a", { targets: targets({ kcal: 300, protein: 10 }) }),
        person("b", { targets: targets({ kcal: 3000, protein: 200 }) }),
      ]
    );
    expect(fit.portions[yoghurt.id].b).toBe(0);
    expect(fit.portions[yoghurt.id].a).toBeGreaterThanOrEqual(0.5);
  });

  it("counts locked and logged entries without changing them", () => {
    const offPlan = entry({ locked: true, portions: { a: 2, b: 0 } });
    const logged = entry({
      logged: { a: "skipped" },
      portions: { a: 1, b: 1 },
    });
    const dinner = entry();
    const fit = fitDay(
      [offPlan, logged, dinner],
      [
        person("a", { targets: targets({ kcal: 1500, protein: 90 }) }),
        person("b", { targets: targets({ kcal: 1000, protein: 60 }) }),
      ]
    );
    expect(fit.portions[offPlan.id]).toEqual({ a: 2, b: 0 });
    expect(fit.portions[logged.id].a).toBe(1);
    // A's off-plan 1000 kcal leave 500 for dinner; the skipped meal counts as nothing.
    expect(fit.portions[dinner.id].a).toBe(1);
    expect(fit.people.a.totals.kcal).toBe(1500);
    // B didn't log, so the shared meal is still B's to fit.
    expect(fit.portions[logged.id].b).toBe(1);
    expect(fit.portions[dinner.id].b).toBe(1);
  });

  it("keeps the amount of a product or single food", () => {
    const bar = entry({ fixed: true, portions: { a: 1 } });
    const fit = fitDay([bar, entry()], [person("a")]);
    expect(fit.portions[bar.id].a).toBe(1);
    expect(fit.people.a.totals.kcal).toBeGreaterThan(500);
  });

  it("sets a fasting person to 0 and doesn't score their day", () => {
    const offPlan = entry({ locked: true, portions: { a: 1 } });
    const bar = entry({ fixed: true, portions: { a: 1 } });
    const lunch = entry();
    const fit = fitDay(
      [offPlan, bar, lunch],
      [person("a", { fasting: true }), person("b")]
    );
    expect(fit.portions[bar.id].a).toBe(0);
    expect(fit.portions[lunch.id].a).toBe(0);
    expect(fit.portions[offPlan.id].a).toBe(1);
    expect(fit.people.a).toMatchObject({
      status: "fasting",
      score: null,
      misses: [],
      totals: { kcal: 500 },
    });
    expect(fit.people.b.status).toBe("fitted");
  });

  it("keeps the portions of someone with no targets", () => {
    const meals = [
      entry({ portions: { a: 1.75 } }),
      entry({ portions: { a: 2 } }),
    ];
    const fit = fitDay(meals, [person("a", { targets: noTargets })]);
    expect(fit.portions[meals[0].id].a).toBe(1.75);
    expect(fit.portions[meals[1].id].a).toBe(2);
    expect(fit.people.a).toMatchObject({ status: "no-targets", score: null });
  });

  it("fits on the macros that have a target", () => {
    const fit = fitDay(
      [entry({ perServing: { kcal: 500, protein: 40 } })],
      [person("a", { targets: targets({ protein: 60 }) })]
    );
    expect(fit.people.a).toMatchObject({ totals: { protein: 60 }, misses: [] });
  });

  it("leaves entries without kcal or protein as they are, and says so", () => {
    const unknown = entry({ perServing: { kcal: 400 }, portions: { a: 1.25 } });
    const gone = entry({ perServing: null, portions: { a: 1 } });
    const fit = fitDay([unknown, gone, entry()], [person("a")]);
    expect(fit.portions[unknown.id].a).toBe(1.25);
    expect(fit.portions[gone.id].a).toBe(1);
    expect(fit.people.a.incomplete).toBe(true);
  });

  it("says an eaten entry lacking any macro makes the totals a lower bound", () => {
    const fit = fitDay(
      [entry({ perServing: { kcal: 500, protein: 30, carbs: 50 } }), entry()],
      [person("a")]
    );
    expect(fit.people.a.incomplete).toBe(true);
  });

  it("ignores a skipped entry's missing or estimated nutrition", () => {
    const skipped = (over: Partial<FitEntry>) =>
      entry({ logged: { a: "skipped" }, ...over });
    const fit = fitDay(
      [
        skipped({ perServing: null }),
        skipped({ perServing: { kcal: 300 } }),
        skipped({ estimated: true }),
        entry(),
      ],
      [person("a")]
    );
    expect(fit.people.a).toMatchObject({
      incomplete: false,
      estimated: false,
    });
  });

  it("doesn't score a carbs, fat or fibre target an eaten entry doesn't report", () => {
    const noFibre = entry({
      perServing: { kcal: 500, protein: 30, carbs: 50, fat: 20 },
      portions: { a: 1 },
    });
    const lunch = entry({ portions: { a: 1 } });
    const fit = fitDay(
      [noFibre, lunch],
      [
        person("a", {
          targets: targets({ kcal: 1000, protein: 60, fibre: 40 }),
        }),
      ]
    );
    // Counting the unknown fibre as 0 would push lunch up to chase it.
    expect(fit.portions[lunch.id].a).toBe(1);
    expect(fit.people.a).toMatchObject({ status: "fitted", misses: [] });
  });

  it("treats targets of 0 as no targets", () => {
    const meal = entry({ portions: { a: 1.75 } });
    const fit = fitDay(
      [meal],
      [person("a", { targets: targets({ kcal: 0 }) })]
    );
    expect(fit.portions[meal.id].a).toBe(1.75);
    expect(fit.people.a).toMatchObject({ status: "no-targets", score: null });
  });

  it("treats a day where every meal was skipped as empty", () => {
    const fit = fitDay([entry({ logged: { a: "skipped" } })], [person("a")]);
    expect(fit.people.a).toMatchObject({ status: "empty", score: null });
  });

  it("flags a day that can't reach its targets instead of forcing it", () => {
    const fit = fitDay(
      [entry({ perServing: { kcal: 600, protein: 10 } })],
      [person("a", { targets: targets({ kcal: 900, protein: 120 }) })]
    );
    // Chasing the protein would triple the kcal: it settles near the kcal and flags both.
    expect(Object.values(fit.portions)[0].a).toBe(1.75);
    expect(fit.people.a.misses).toEqual([
      { macro: "kcal", off: 0.167 },
      { macro: "protein", off: -0.854 },
    ]);
  });

  it("says when an eaten entry's nutrition is an estimate", () => {
    const fit = fitDay(
      [
        entry({ estimated: true }),
        entry({ estimated: true, portions: { a: 0 } }),
      ],
      [person("a")]
    );
    expect(fit.people.a.estimated).toBe(true);
    expect(fitDay([entry()], [person("a")]).people.a.estimated).toBe(false);
  });

  it("marks a day with nothing to eat as empty", () => {
    const fit = fitDay([entry({ portions: { a: 0 } })], [person("a")]);
    expect(fit.people.a).toMatchObject({ status: "empty", score: null });
  });

  it("scales by base servings", () => {
    const fit = fitDay(
      [entry({ baseServings: 2 })],
      [person("a", { targets: targets({ kcal: 1500, protein: 90 }) })]
    );
    expect(fit.people.a.totals.kcal).toBe(1500);
    expect(Object.values(fit.portions)[0].a).toBe(1.5);
  });

  it("changes as little as it can when several picks score the same", () => {
    const meals = [
      entry({ portions: { a: 1.5 } }),
      entry({ portions: { a: 0.5 } }),
    ];
    const fit = fitDay(meals, [
      person("a", { targets: targets({ kcal: 1000, protein: 60 }) }),
    ]);
    expect(fit.portions[meals[0].id].a).toBe(1.5);
    expect(fit.portions[meals[1].id].a).toBe(0.5);
  });

  it("fits a day with more entries than it can try every combination of", () => {
    const meals = Array.from({ length: 8 }, (_, i) =>
      entry({
        perServing: { kcal: 200 + i * 40, protein: 10 + i * 3 },
        portions: { a: 3 },
      })
    );
    const fit = fitDay(meals, [
      person("a", { targets: targets({ kcal: 2400, protein: 150 }) }),
    ]);
    expect(fit.people.a.misses).toEqual([]);
    for (const m of meals) {
      expect(isStep(fit.portions[m.id].a)).toBe(true);
    }
  });

  it("gives the same answer for the same input", () => {
    const day = [
      entry({ id: "x", perServing: { kcal: 420, protein: 31, carbs: 40 } }),
      entry({ id: "y", perServing: { kcal: 650, protein: 22, fat: 30 } }),
      entry({ id: "z", perServing: { kcal: 180, protein: 12, fibre: 6 } }),
    ];
    const people = [
      person("a", {
        targets: targets({ kcal: 2100, protein: 130, carbs: 200 }),
      }),
      person("b"),
    ];
    expect(fitDay(day, people)).toEqual(fitDay(day, people));
  });
});

describe("fitWeek", () => {
  it("fits each day and averages each person's fitted days", () => {
    const week = fitWeek([
      {
        date: "2026-10-19",
        entries: [entry(), entry(), entry(), entry()],
        people: [person("a"), person("b", { targets: noTargets })],
      },
      {
        date: "2026-10-20",
        entries: [entry({ perServing: { kcal: 600, protein: 25 } })],
        people: [person("a"), person("b", { targets: noTargets })],
      },
      {
        date: "2026-10-21",
        entries: [entry()],
        people: [
          person("a", { fasting: true }),
          person("b", { targets: noTargets }),
        ],
      },
    ]);
    expect(week.days.map((d) => d.date)).toEqual([
      "2026-10-19",
      "2026-10-20",
      "2026-10-21",
    ]);
    expect(week.days[0].fit.people.a.totals.kcal).toBe(2000);
    expect(week.days[1].fit.people.a.totals).toMatchObject({
      kcal: 1800,
      protein: 75,
    });
    // The fasting day isn't part of the average.
    expect(week.averages.a).toEqual({
      macros: { kcal: 1900, protein: 97.5, carbs: 100, fat: 40, fibre: 16 },
      days: 2,
    });
    expect(week.averages.b).toBeNull();
  });
});
