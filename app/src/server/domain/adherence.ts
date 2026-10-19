export const ADHERENCE_STATUSES = ["stuck", "partial", "skipped", "swapped"] as const;
export type AdherenceStatus = (typeof ADHERENCE_STATUSES)[number];

export const STATUS_LABEL: Record<AdherenceStatus, { icon: string; label: string }> = {
  stuck: { icon: "✓", label: "Stuck to it" },
  partial: { icon: "½", label: "Partly" },
  skipped: { icon: "✗", label: "Skipped" },
  swapped: { icon: "↔", label: "Swapped" },
};

/** How much each status counts towards the score: sticking to the plan is 1, skipping is 0. */
export const STATUS_WEIGHT: Record<AdherenceStatus, number> = { stuck: 1, partial: 0.5, swapped: 0.5, skipped: 0 };

export type MealAdherence = {
  date: string;
  /** This person's planned portion; 0 = not planned to eat it. */
  portion: number;
  status: AdherenceStatus | null;
};

export type AdherenceSummary = {
  counts: Record<AdherenceStatus, number>;
  /** Meals planned for this person up to today. */
  due: number;
  /** Due meals with no status yet. */
  unlogged: number;
  /** Weighted share of logged meals, 0–1; null when nothing is logged. */
  score: number | null;
};

/**
 * Summarises one person's week. A meal counts when they planned to eat it
 * (portion > 0) or logged it anyway; future meals only count once logged.
 */
export function summariseAdherence(meals: MealAdherence[], today: string): AdherenceSummary {
  const counts: Record<AdherenceStatus, number> = { stuck: 0, partial: 0, skipped: 0, swapped: 0 };
  let due = 0;
  let unlogged = 0;
  let logged = 0;
  let weighted = 0;

  for (const m of meals) {
    if (m.status) {
      counts[m.status] += 1;
      logged += 1;
      weighted += STATUS_WEIGHT[m.status];
    }
    if (m.portion > 0 && m.date <= today) {
      due += 1;
      if (!m.status) unlogged += 1;
    }
  }
  return { counts, due, unlogged, score: logged ? weighted / logged : null };
}
