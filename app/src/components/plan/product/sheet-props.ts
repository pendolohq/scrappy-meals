import type { SlotType } from "@/server/domain/slots";

export type Slot = { date: string; slot: SlotType; snackIndex: number };

/** What both product sheets get from the Product tab. */
export type SheetProps = {
  at: Slot;
  /** The day is after today, so nothing can have been eaten yet. */
  future: boolean;
  onAdded: () => void;
  onBack: () => void;
};
