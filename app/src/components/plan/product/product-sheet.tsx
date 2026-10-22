import type { ProductLookup } from "@/server/products";

import { DraftSheet } from "./draft-sheet";
import { KnownSheet } from "./known-sheet";
import type { SheetProps } from "./sheet-props";

/** What to do with a barcode lookup: add a known product, or check a new one. */
export const ProductSheet = ({
  lookup,
  ...rest
}: SheetProps & { lookup: ProductLookup }) => {
  switch (lookup.status) {
    case "known":
      return <KnownSheet lookup={lookup} {...rest} />;
    case "draft":
      return (
        <DraftSheet
          barcode={lookup.draft.barcode}
          draft={lookup.draft}
          {...rest}
        />
      );
    case "not-found":
      return <DraftSheet barcode={lookup.barcode} draft={null} {...rest} />;
  }
};
