import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { COMPUTE_RECHARGE_DEFAULT, productsForCategory } from "./catalog";
import type { PaywallCategory } from "./paywall-store";
import { usePaywallSelection } from "./use-paywall-selection";

vi.mock("@/config", () => ({ appEnv: { appRegion: "global" } }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let latest: ReturnType<typeof usePaywallSelection>;
let committed: { selected: PaywallCategory; productId: string; computeAmount: string }[];

function Harness({ category }: { category: PaywallCategory }) {
  const selection = usePaywallSelection(category);
  useLayoutEffect(() => {
    latest = selection;
    committed.push({
      selected: selection.selected,
      productId: selection.productId,
      computeAmount: selection.computeAmount,
    });
  });
  return null;
}

beforeEach(() => {
  root = createRoot(document.createElement("div"));
  committed = [];
});
afterEach(() => act(() => root.unmount()));
const render = (category: PaywallCategory) =>
  act(() => root.render(<Harness category={category} />));

it("commits the annual membership default immediately and changes category with its product", () => {
  render("community_membership");
  expect(committed).toEqual([
    {
      selected: "community_membership",
      productId: "community_membership_year",
      computeAmount: COMPUTE_RECHARGE_DEFAULT,
    },
  ]);
  act(() => latest.setProductId("community_membership_month"));
  act(() => latest.setSelected("compute_membership"));
  expect(latest.productId).toBe("compute_membership_month");
  act(() => latest.setSelected("community_membership"));
  expect(latest.productId).toBe("community_membership_year");
  for (const state of committed) {
    expect(productsForCategory(state.selected).some((p) => p.id === state.productId)).toBe(true);
  }
});

it("retains an edited amount within its category and resets it when re-entering compute", () => {
  render("compute_points");
  act(() => latest.setComputeAmount("100"));
  act(() => latest.setSelected("compute_points"));
  render("compute_points");
  expect(latest.computeAmount).toBe("100");
  act(() => latest.setSelected("community_points"));
  committed = [];
  act(() => latest.setSelected("compute_points"));
  expect(committed).toEqual([
    { selected: "compute_points", productId: "", computeAmount: COMPUTE_RECHARGE_DEFAULT },
  ]);
});

it("reconciles route changes before commit without overwriting same-category edits", () => {
  render("community_points");
  act(() => latest.setSelected("community_membership"));
  act(() => latest.setProductId("community_membership_month"));
  render("community_membership");
  expect(latest.productId).toBe("community_membership_month");
  committed = [];
  render("compute_points");
  expect(committed).toEqual([
    { selected: "compute_points", productId: "", computeAmount: COMPUTE_RECHARGE_DEFAULT },
  ]);
});
