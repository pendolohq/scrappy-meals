"use client";

import { useRef, useState, useTransition } from "react";
import {
  CalendarPlus,
  Check,
  ChevronLeft,
  ChevronRight,
  X,
} from "lucide-react";
import Link from "next/link";

import { addMealAction } from "@/app/(app)/week/actions";
import { Button, buttonClass } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { cx } from "@/lib/cx";
import { dayParts, formatDay, formatWeekLabel } from "@/lib/format";
import type { SlotType } from "@/server/domain/slots";
import { addDays, weekDays, weekStartOf } from "@/server/domain/week";

export type SlotChoice = { slot: SlotType; snackIndex: number; label: string };

const keyOf = (s: { slot: SlotType; snackIndex: number }) =>
  `${s.slot}-${s.snackIndex}`;

const choiceClass = (selected: boolean) =>
  cx(
    "rounded-button border text-sm font-medium transition",
    selected
      ? "border-accent bg-accent-soft text-accent-ink"
      : "border-border bg-card hover:bg-sunken"
  );

/**
 * Puts the recipe on a day and slot of the plan, through the same action as
 * the week's "Add" buttons. The day starts at today, in this week; the slot
 * starts where the recipe's tags make it obvious, else unpicked.
 */
export const AddToPlan = ({
  slug,
  name,
  today,
  slots,
  suggested,
}: {
  slug: string;
  name: string;
  today: string;
  /** The household's active slots, in eating order. */
  slots: SlotChoice[];
  suggested: SlotChoice | null;
}) => {
  const dialog = useRef<HTMLDialogElement>(null);
  const thisWeek = weekStartOf(today);
  const [week, setWeek] = useState(thisWeek);
  const [date, setDate] = useState(today);
  const [slot, setSlot] = useState<SlotChoice | null>(suggested);
  const [error, setError] = useState<string>();
  const [added, setAdded] = useState<{ date: string; label: string }>();
  const [pending, startTransition] = useTransition();

  const show = () => {
    setError(undefined);
    setAdded(undefined);
    dialog.current?.showModal();
  };
  const close = () => dialog.current?.close();

  const moveWeek = (weeks: number) => {
    const next = addDays(week, weeks * 7);
    setWeek(next);
    // Keep the same weekday, so stepping a week is one tap away from done.
    setDate(addDays(date, weeks * 7));
  };

  const add = () => {
    if (!slot) {
      return;
    }
    startTransition(async () => {
      setError(undefined);
      const res = await addMealAction({
        date,
        slot: slot.slot,
        snackIndex: slot.snackIndex,
        slug,
      });
      if (res.error) {
        setError(res.error);
      } else {
        setAdded({ date, label: slot.label });
      }
    });
  };

  return (
    <>
      <Button onClick={show}>
        <CalendarPlus className="size-4" aria-hidden />
        Add to meal plan
      </Button>
      {/* A bottom sheet on phones, a centred dialog on wider screens. */}
      <dialog
        ref={dialog}
        aria-label={`Add ${name} to the meal plan`}
        className={cx(
          "mx-auto mt-auto mb-0 w-full max-w-none rounded-t-card border border-border bg-card p-0 text-foreground shadow-raised backdrop:bg-scrim/40 backdrop:backdrop-blur-[2px]",
          "sm:m-auto sm:w-[min(32rem,calc(100vw-2rem))] sm:rounded-card"
        )}
      >
        <div className="max-h-[85dvh] space-y-5 overflow-y-auto p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:max-h-[80dvh] sm:pb-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-serif text-heading font-semibold">
              Add to meal plan
            </h2>
            <IconButton label="Close" className="-mr-2" onClick={close}>
              <X className="size-5" aria-hidden />
            </IconButton>
          </div>

          {added ? (
            <div className="space-y-4">
              <output className="flex items-center gap-2 font-medium text-accent-ink">
                <Check className="size-5" aria-hidden />
                Added to {added.label.toLowerCase()} on {formatDay(added.date)}.
              </output>
              <div className="flex flex-wrap gap-2">
                <Link
                  href={`/week/${weekStartOf(added.date)}#${added.date}`}
                  className={buttonClass()}
                >
                  Open the week
                </Link>
                <Button variant="secondary" onClick={() => setAdded(undefined)}>
                  Add it again
                </Button>
              </div>
            </div>
          ) : (
            <>
              <fieldset className="space-y-2">
                <legend className="sr-only">Day</legend>
                <div className="flex items-center justify-between gap-2">
                  <span aria-hidden className="text-sm font-medium text-muted">
                    Day
                  </span>
                  <div className="flex items-center gap-1">
                    <IconButton
                      label="Previous week"
                      onClick={() => moveWeek(-1)}
                    >
                      <ChevronLeft className="size-5" aria-hidden />
                    </IconButton>
                    <span className="min-w-24 text-center text-sm font-medium">
                      {formatWeekLabel(week, thisWeek)}
                    </span>
                    <IconButton label="Next week" onClick={() => moveWeek(1)}>
                      <ChevronRight className="size-5" aria-hidden />
                    </IconButton>
                  </div>
                </div>
                <div className="grid grid-cols-7 gap-1">
                  {weekDays(week).map((day) => {
                    const { day: n, weekday } = dayParts(day);
                    return (
                      <button
                        key={day}
                        type="button"
                        aria-pressed={day === date}
                        // The label replaces the button's text, so "today"
                        // has to be in it to be heard.
                        aria-label={
                          day === today
                            ? `${formatDay(day)} (today)`
                            : formatDay(day)
                        }
                        onClick={() => setDate(day)}
                        className={cx(
                          choiceClass(day === date),
                          "flex flex-col items-center py-2"
                        )}
                      >
                        <span className="text-xs text-muted">
                          {weekday.slice(0, 3)}
                        </span>
                        <span className="tabular-nums">{n}</span>
                      </button>
                    );
                  })}
                </div>
              </fieldset>

              <fieldset className="space-y-2">
                <legend className="text-sm font-medium text-muted">Meal</legend>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {slots.map((s) => {
                    const selected = slot !== null && keyOf(slot) === keyOf(s);
                    return (
                      <button
                        key={keyOf(s)}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => setSlot(s)}
                        className={cx(choiceClass(selected), "min-h-tap px-3")}
                      >
                        {s.label}
                      </button>
                    );
                  })}
                </div>
              </fieldset>

              {error && (
                <p role="alert" className="text-sm text-danger">
                  {error}
                </p>
              )}
              <Button block size="lg" disabled={!slot || pending} onClick={add}>
                {pending
                  ? "Adding…"
                  : slot
                    ? `Add to ${slot.label.toLowerCase()}, ${formatDay(date)}`
                    : "Pick a meal"}
              </Button>
            </>
          )}
        </div>
      </dialog>
    </>
  );
};
