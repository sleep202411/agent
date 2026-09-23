import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BundlePriceEditor } from "./ip-studio-workbench";
import type { IpCreatorIp } from "@/src/lib/ip-commerce/api";

const s = vi.hoisted(() => ({ save: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock("@/src/lib/ip-commerce/hooks", () => ({
  useUpsertIpCommercePriceRule: () => ({ mutateAsync: s.save, isPending: false }),
}));
vi.mock("sonner", () => ({ toast: { success: s.success, error: s.error } }));
vi.mock("@/src/env", () => ({ env: {} }));
let root: Root, host: HTMLDivElement;
const ip = (version: number, amount = "30") =>
  ({
    id: "ip",
    version,
    price: { amount, originalAmount: null, startsAt: null, endsAt: null },
  }) as IpCreatorIp;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  root = createRoot(host);
  s.save.mockReset().mockResolvedValue({ ip: ip(11, "50") });
  s.success.mockClear();
  s.error.mockClear();
});
afterEach(() => act(() => root.unmount()));
function render(value: IpCreatorIp) {
  act(() => root.render(<BundlePriceEditor ip={value} t={(key: string) => key} />));
}
function edit(value: string) {
  act(() => {
    const input = host.querySelector("input")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const save = () =>
  [...host.querySelectorAll("button")].find(
    (button) => button.textContent === "pricingPanel.form.save"
  )!;
it("refreshes untouched bundle pricing", () => {
  render(ip(10));
  render(ip(11, "99"));
  expect(host.querySelector("input")!.value).toBe("99");
});
it("keeps a changed bundle price tied to its original version", async () => {
  render(ip(10));
  edit("50");
  render(ip(11, "99"));
  s.save.mockRejectedValueOnce(new Error("Version conflict"));
  await act(async () => save().click());
  expect(s.save).toHaveBeenCalledWith(
    expect.objectContaining({ amount: "50", expectedVersion: 10 })
  );
  expect(s.error).toHaveBeenCalledWith("Version conflict");
});
it("advances the draft version after saving", async () => {
  render(ip(10));
  edit("50");
  await act(async () => save().click());
  edit("60");
  await act(async () => save().click());
  expect(s.save).toHaveBeenLastCalledWith(
    expect.objectContaining({ amount: "60", expectedVersion: 11 })
  );
});

it.each(["-5", "1.5", "1e2", "abc"])("does not rewrite bundle price input %s", async (value) => {
  render(ip(10));
  edit(value);
  expect(host.querySelector("input")!.value).toBe(value);
  expect(save().disabled).toBe(true);
  await act(async () => save().click());
  expect(s.save).not.toHaveBeenCalled();
});
it("does not strip malformed compare-at prices", () => {
  render(ip(10));
  act(() =>
    [...host.querySelectorAll("button")]
      .find((button) => button.textContent === "pricingPanel.schedule.toggle")!
      .click()
  );
  act(() => {
    const input = host.querySelectorAll("input")[1]!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "-50");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(host.querySelectorAll("input")[1]!.value).toBe("-50");
  expect(save().disabled).toBe(true);
});
