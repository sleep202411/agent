// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { TaskPaymentsPanel } from "./task-payments-panel";
const id = "11111111-1111-4111-8111-111111111111";
const fetcher = vi.fn();
let host: HTMLDivElement, root: Root;
const row = {
  id,
  title: "Film",
  status: "in_progress",
  version: 3,
  assignees: [
    {
      userId: "creator",
      paymentTerms: "half_upfront",
      currency: "USD",
      amountMinor: "9007199254740993",
      releasedAt: null,
    },
  ],
};
const ok = (data: unknown) => new Response(JSON.stringify({ code: 200, data }));
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  vi.stubGlobal("fetch", fetcher);
  fetcher.mockReset().mockImplementation(() => Promise.resolve(ok(row)));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function fill(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype,
      "value"
    )!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function load() {
  await act(async () => root.render(<TaskPaymentsPanel />));
  await fill(host.querySelector("input")!, id);
  await act(async () =>
    host
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
  );
  await act(async () => {
    const select = host.querySelector("select")!;
    select.value = "creator";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
it("requires receipt and milestone confirmations before releasing exact compensation", async () => {
  await load();
  const release = () =>
    [...host.querySelectorAll("button")].find((b) => b.textContent === "Release Reward")!;
  expect(release().disabled).toBe(true);
  expect(host.textContent).toContain("90071992547409.93");
  await fill(host.querySelectorAll("input")[1], "BANK-123");
  await fill(host.querySelector("textarea")!, "FD verified 50% progress");
  for (const c of host.querySelectorAll<HTMLInputElement>("input[type=checkbox]"))
    await act(async () => c.click());
  expect(release().disabled).toBe(false);
  await act(async () => release().click());
  const call = fetcher.mock.calls.find(([, init]) => init?.method === "POST");
  expect(JSON.parse(call![1].body)).toMatchObject({
    expectedAmountMinor: row.assignees[0].amountMinor,
    currency: "USD",
    fundsReceived: true,
    milestoneConfirmed: true,
    expectedVersion: 3,
  });
});
it("does not offer release for demo promises", async () => {
  fetcher.mockImplementation(() =>
    Promise.resolve(
      ok({ ...row, assignees: [{ ...row.assignees[0], paymentTerms: "demo_promise" }] })
    )
  );
  await load();
  expect(host.textContent).toContain("Demo Promise");
  expect([...host.querySelectorAll("button")].some((b) => b.textContent === "Release Reward")).toBe(
    false
  );
});
it("surfaces backend conflicts instead of claiming success", async () => {
  await load();
  fetcher.mockImplementation(() =>
    Promise.resolve(new Response('{"code":409,"message":"Task changed"}', { status: 409 }))
  );
  await fill(host.querySelectorAll("input")[1], "BANK");
  await fill(host.querySelector("textarea")!, "Checked");
  for (const c of host.querySelectorAll<HTMLInputElement>("input[type=checkbox]"))
    await act(async () => c.click());
  await act(async () =>
    [...host.querySelectorAll("button")].find((b) => b.textContent === "Release Reward")!.click()
  );
  expect(host.querySelector("[role=alert]")?.textContent).toContain("Task changed");
});
