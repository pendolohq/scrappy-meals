"use client";

import { useState } from "react";

import type { FoodUnit } from "@/server/domain/food";
import type { UsdaFood, UsdaPortion } from "@/server/domain/usda";
import { roundMacro } from "@/server/domain/usda-check";
import {
  MACRO_KEYS,
  type MacroKey,
  type Macros,
} from "@/server/mealie/nutrition";

import {
  emptyValues,
  grams,
  type MacroTexts,
  STARTING_AMOUNT,
  startingPiece,
} from "./food-form";

/** How much of the food, what one piece weighs, and values typed in or estimated. */
export const useServingForm = () => {
  const [amount, setAmount] = useState(STARTING_AMOUNT.piece);
  const [unit, setUnit] = useState<FoodUnit>("piece");
  const [pieceText, setPieceText] = useState("");
  // The USDA portion the piece weight came from; typing one drops it.
  const [pieceLabel, setPieceLabel] = useState<string | null>(null);
  const [values, setValues] = useState(emptyValues);
  const [estimated, setEstimated] = useState(false);

  const changeUnit = (next: FoodUnit) => {
    setUnit(next);
    setAmount(STARTING_AMOUNT[next]);
  };

  const startPiece = (
    food: UsdaFood,
    weight: number | null,
    label: string | null
  ) => {
    const start = startingPiece(food, weight, label);
    setPieceText(start.text);
    setPieceLabel(start.label);
  };

  /** One of USDA's portions, or none to type the weight in. */
  const choosePortion = (portion: UsdaPortion | undefined) => {
    setPieceText(portion ? grams(portion.grams) : "");
    setPieceLabel(portion?.label ?? null);
  };

  const typePiece = (text: string) => {
    setPieceText(text);
    setPieceLabel(null);
  };

  const typeValue = (key: MacroKey, text: string) => {
    setValues((v) => ({ ...v, [key]: text }));
    setEstimated(false);
  };

  const takeEstimate = (perServing: Macros) => {
    setValues(
      Object.fromEntries(
        MACRO_KEYS.map((k) => [k, String(roundMacro(k, perServing[k]))])
      ) as MacroTexts
    );
    setEstimated(true);
  };

  return {
    amount,
    setAmount,
    unit,
    changeUnit,
    pieceText,
    pieceLabel,
    values,
    estimated,
    startPiece,
    choosePortion,
    typePiece,
    typeValue,
    takeEstimate,
  };
};

export type ServingForm = ReturnType<typeof useServingForm>;
