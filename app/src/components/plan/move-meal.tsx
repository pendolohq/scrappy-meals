"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Field, inputClass } from "@/components/ui/input";
import { formatDay } from "@/lib/format";
import { daySlots, type SlotType } from "@/server/domain/slots";
import { weekDays, weekStartOf } from "@/server/domain/week";
import type { PlannedMeal } from "@/server/plan";

/**
 * Picks a day of the meal's week and a slot to move it to; it lands after
 * any meals already there. Only slots turned on in settings are offered.
 */
export const MoveMeal = ({
  meal,
  snackSlots,
  onMove,
  onCancel,
}: {
  meal: Pick<PlannedMeal, "date" | "slot" | "snackIndex">;
  snackSlots: number;
  onMove: (to: { date: string; slot: SlotType; snackIndex: number }) => void;
  onCancel: () => void;
}) => {
  const slots = daySlots(snackSlots).filter((s) => s.active);
  const own = `${meal.slot}:${meal.snackIndex}`;
  const [date, setDate] = useState(meal.date);
  const [slot, setSlot] = useState(
    slots.some((s) => `${s.slot}:${s.snackIndex}` === own)
      ? own
      : `${slots[0].slot}:${slots[0].snackIndex}`
  );

  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        const [type, index] = slot.split(":");
        onMove({ date, slot: type as SlotType, snackIndex: Number(index) });
      }}
    >
      <Field label="Day">
        <select
          className={inputClass}
          value={date}
          onChange={(e) => setDate(e.currentTarget.value)}
        >
          {weekDays(weekStartOf(meal.date)).map((d) => (
            <option key={d} value={d}>
              {formatDay(d)}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Meal">
        <select
          className={inputClass}
          value={slot}
          onChange={(e) => setSlot(e.currentTarget.value)}
        >
          {slots.map((s) => (
            <option
              key={`${s.slot}:${s.snackIndex}`}
              value={`${s.slot}:${s.snackIndex}`}
            >
              {s.label}
            </option>
          ))}
        </select>
      </Field>
      <div className="flex gap-2">
        <Button type="submit" size="sm" className="flex-1">
          Move here
        </Button>
        <Button variant="secondary" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
};
