// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ProjectBudgetPanel } from "./project-budget-panel";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, container: HTMLDivElement;
const plan = {
  crewName: "Film",
  consumedPoints: "5000",
  committedPoints: "5000",
  releasedPoints: "6000",
  producerOptions: [
    {
      taskId: "task",
      userId: "producer",
      title: "Producer fee",
      amountMinor: "10000",
      currency: "CNY",
    },
  ],
  budget: {
    version: 3,
    data: {
      durationSeconds: 60,
      totalPoints: "4462",
      producerTaskId: "task",
      producerUserId: "producer",
      stages: [],
      settlement: null,
    },
  },
};
const response = (data: unknown) =>
  new Response(JSON.stringify({ code: 200, data }), {
    headers: { "content-type": "application/json" },
  });
beforeEach(() => {
  container = document.createElement("div");
  root = createRoot(container);
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(() => Promise.resolve(response(plan)))
  );
});
afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
});
it("sends the reviewed usage, gross fee, explicit deduction and version, and preserves evidence on failure", async () => {
  await act(async () => root.render(<ProjectBudgetPanel crewId="crew" />));
  act(() => {
    const field = container.querySelector("textarea")!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
      field,
      "CASE-14 agreed deduction"
    );
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  act(() => {
    const field = Array.from(container.querySelectorAll("input")).find(
      (i) => i.type === "number" && i.value === "0"
    )!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, "1000");
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  vi.mocked(fetch).mockResolvedValueOnce(
    new Response(JSON.stringify({ message: "Usage changed" }), { status: 409 })
  );
  await act(async () =>
    Array.from(container.querySelectorAll("button"))
      .find((b) => b.textContent?.startsWith("Close compute"))!
      .click()
  );
  const init = vi.mocked(fetch).mock.calls[1][1]!;
  expect(JSON.parse(String(init.body))).toEqual({
    action: "close",
    expectedVersion: 3,
    expectedConsumedPoints: "5000",
    expectedGrossMinor: "10000",
    deductionMinor: "1000",
    note: "CASE-14 agreed deduction",
  });
  expect(container.textContent).toContain("Usage changed");
  expect(container.querySelector("textarea")!.value).toBe("CASE-14 agreed deduction");
});
