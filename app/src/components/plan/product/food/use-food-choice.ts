"use client";

import { useState } from "react";

import { searchUsdaAction } from "@/app/(app)/recipes/nutrition-check/actions";
import {
  findFoodsAction,
  loadFoodAction,
  usdaFoodAction,
} from "@/app/(app)/week/actions";
import type { UsdaFood, UsdaHit } from "@/server/domain/usda";
import type { FoodSearch, KnownFood } from "@/server/foods";

import { attempt } from "../../attempt";

import type { Picked, Source } from "./food-form";
import type { SheetWork } from "./use-sheet-work";

/**
 * Which food it is: the name looked up, the Mealie food picked and where its
 * nutrition comes from (a USDA food, or values estimated or typed in).
 */
export const useFoodChoice = ({
  work: { run, fail },
  onKnown,
  onUsda,
}: {
  work: SheetWork;
  /** A food added before was picked: its own sheet takes over. */
  onKnown: (food: KnownFood) => void;
  /** A USDA food was taken, with what one piece weighs if the food has that. */
  onUsda: (food: UsdaFood, weight: number | null, label: string | null) => void;
}) => {
  const [name, setName] = useState("");
  const [found, setFound] = useState<FoodSearch & { name: string }>();
  const [picked, setPicked] = useState<Picked>();
  const [source, setSource] = useState<Source>();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<UsdaHit[]>();

  const takeUsda = (
    food: UsdaFood,
    weight: number | null,
    label: string | null
  ) => {
    setSource({ kind: "usda", food });
    onUsda(food, weight, label);
  };

  const find = () =>
    run(async () => {
      const typed = name.trim();
      const res = await attempt(() => findFoodsAction({ name: typed }));
      if (res.error !== undefined) {
        fail(res);
        return;
      }
      setFound({ ...res, name: typed });
      setPicked(undefined);
      setSource(undefined);
      setHits(undefined);
      setQuery(typed);
    });

  const openKnown = (slug: string) =>
    run(async () => {
      const res = await attempt(() => loadFoodAction({ slug }));
      if (res.error !== undefined) {
        fail(res);
      } else {
        onKnown(res);
      }
    });

  const pick = (next: Picked) => {
    setPicked(next);
    setHits(undefined);
    const match = "food" in next ? next.food.match : null;
    if (match?.status === "confirmed") {
      takeUsda(match.food, match.pieceGrams, match.pieceLabel);
    } else {
      setSource(found?.usda ? undefined : { kind: "own" });
    }
  };

  const searchUsda = () =>
    run(async () => {
      const res = await attempt(() => searchUsdaAction({ query }));
      if (res.error !== undefined) {
        fail(res);
      } else {
        setHits(res.hits);
      }
    });

  const chooseHit = (fdcId: number) =>
    run(async () => {
      const res = await attempt(() => usdaFoodAction({ fdcId }));
      if (res.error !== undefined) {
        fail(res);
        return;
      }
      // The food's own weight of one holds for the USDA food it was set with.
      const match = picked && "food" in picked ? picked.food.match : null;
      const keep = match?.fdcId === fdcId ? match : null;
      takeUsda(res.food, keep?.pieceGrams ?? null, keep?.pieceLabel ?? null);
    });

  // Without USDA there is nothing to search: the other way is an estimate or
  // values typed in.
  const changeSource = () =>
    setSource(found?.usda ? undefined : { kind: "own" });

  const typeValues = () => setSource({ kind: "own" });

  return {
    name,
    setName,
    found,
    picked,
    source,
    query,
    setQuery,
    hits,
    find,
    openKnown,
    pick,
    searchUsda,
    chooseHit,
    changeSource,
    typeValues,
  };
};
