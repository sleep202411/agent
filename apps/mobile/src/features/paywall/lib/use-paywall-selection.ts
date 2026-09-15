import { useState } from "react";

import { COMPUTE_RECHARGE_DEFAULT, productsForCategory } from "./catalog";
import type { PaywallCategory } from "./paywall-store";

function defaultProduct(category: PaywallCategory): string {
  const products = productsForCategory(category);
  return (products.find((item) => item.interval === "year") ?? products[0])?.id ?? "";
}

export function usePaywallSelection(initialCategory: PaywallCategory) {
  const [stored, setStored] = useState(() => ({
    initialCategory,
    selected: initialCategory,
    productId: defaultProduct(initialCategory),
    computeAmount: COMPUTE_RECHARGE_DEFAULT,
  }));

  const selectCategory = (state: typeof stored, selected: PaywallCategory) =>
    state.selected === selected
      ? state
      : {
          ...state,
          selected,
          productId: defaultProduct(selected),
          computeAmount:
            selected === "compute_points" ? COMPUTE_RECHARGE_DEFAULT : state.computeAmount,
        };

  // Reconcile a new route before committing its children. A category and its
  // dependent draft must never render as separate updates.
  let current = stored;
  if (stored.initialCategory !== initialCategory) {
    current = { ...selectCategory(stored, initialCategory), initialCategory };
    setStored(current);
  }

  return {
    selected: current.selected,
    productId: current.productId,
    computeAmount: current.computeAmount,
    setSelected: (selected: PaywallCategory) =>
      setStored((state) => selectCategory(state, selected)),
    setProductId: (productId: string) => setStored((state) => ({ ...state, productId })),
    setComputeAmount: (computeAmount: string) =>
      setStored((state) => ({ ...state, computeAmount })),
  };
}
