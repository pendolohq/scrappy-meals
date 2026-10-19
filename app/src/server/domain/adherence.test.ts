import { describe, expect, it } from "vitest";

import { summariseAdherence } from "./adherence";

const TODAY = "2026-10-21";

describe("summariseAdherence", () => {
  it("weights stuck 1, partial and swapped ½, skipped 0", () => {
    const s = summariseAdherence(
      [
        { date: "2026-10-19", portion: 1, status: "stuck" },
        { date: "2026-10-19", portion: 1, status: "partial" },
        { date: "2026-10-20", portion: 1, status: "swapped" },
        { date: "2026-10-20", portion: 1, status: "skipped" },
      ],
      TODAY
    );
    expect(s.counts).toEqual({ stuck: 1, partial: 1, swapped: 1, skipped: 1 });
    expect(s.score).toBe(0.5);
    expect(s).toMatchObject({ due: 4, unlogged: 0 });
  });

  it("counts unlogged meals only up to today, and ignores meals not planned for this person", () => {
    const s = summariseAdherence(
      [
        { date: "2026-10-20", portion: 1, status: null },
        { date: TODAY, portion: 0.5, status: null },
        { date: "2026-10-22", portion: 1, status: null }, // future
        { date: "2026-10-20", portion: 0, status: null }, // not eating it
      ],
      TODAY
    );
    expect(s).toEqual({
      counts: { stuck: 0, partial: 0, skipped: 0, swapped: 0 },
      due: 2,
      unlogged: 2,
      score: null,
    });
  });

  it("still counts a logged meal that wasn't planned (e.g. ate it after all)", () => {
    const s = summariseAdherence(
      [{ date: "2026-10-20", portion: 0, status: "stuck" }],
      TODAY
    );
    expect(s).toMatchObject({ due: 0, score: 1, counts: { stuck: 1 } });
  });
});
