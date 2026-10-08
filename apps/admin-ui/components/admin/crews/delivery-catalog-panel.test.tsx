// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { DeliveryCatalogPanel } from "./delivery-catalog-panel";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const row = {
  id: "00000000-0000-4000-8000-000000000001",
  version: 1,
  definition: {
    name: "Animation",
    description: "",
    status: "active",
    prices: [],
    fields: [
      { key: "output", label: "Output", instructions: "", type: "attachment", required: true },
    ],
  },
};
const response = (data: unknown) =>
  new Response(JSON.stringify({ code: 200, data }), {
    headers: { "content-type": "application/json" },
  });
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  container = document.createElement("div");
  root = createRoot(container);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ items: [row], nextCursor: null })));
});
afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
const click = async (text: string) =>
  act(async () => {
    const button = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === text || b.getAttribute("aria-label") === text
    );
    if (!button) throw Error(text);
    button.click();
  });
it.each(["", "/ops"])("retains edits and routes list/save under %s", async (base) => {
  vi.stubEnv("NEXT_PUBLIC_ADMIN_UI_BASE_PATH", base);
  await act(async () => root.render(<DeliveryCatalogPanel />));
  await click("Edit Animation");
  act(() => {
    const policy = Array.from(container.querySelectorAll("select")).find((select) =>
      select.querySelector('option[value="fd3_or_production_lead"]')
    )!;
    policy.value = "fd3_or_production_lead";
    policy.dispatchEvent(new Event("change", { bubbles: true }));
  });
  act(() => {
    const area = Array.from(container.querySelectorAll("textarea")).at(-1)!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
      area,
      "Reviewed field requirements"
    );
    area.dispatchEvent(new Event("input", { bubbles: true }));
  });
  let finish!: (response: Response) => void;
  vi.mocked(fetch).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  act(() => {
    for (let i = 0; i < 2; i++)
      container
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(vi.mocked(fetch).mock.calls[0][0]).toBe(
    `${base}/api/admin/crew-delivery-catalog?limit=50`
  );
  expect(vi.mocked(fetch).mock.calls[1][0]).toBe(
    `${base}/api/admin/crew-delivery-catalog/${row.id}`
  );
  const options = vi.mocked(fetch).mock.calls[1][1]!;
  expect(JSON.parse(String(options.body))).toMatchObject({
    expectedVersion: 1,
    definition: { approvalPolicy: "fd3_or_production_lead" },
  });
  await act(async () =>
    finish(new Response(JSON.stringify({ message: "Save unavailable" }), { status: 503 }))
  );
  expect(container.textContent).toContain("Save unavailable");
  expect(Array.from(container.querySelectorAll("textarea")).at(-1)!.value).toBe(
    "Reviewed field requirements"
  );
  vi.mocked(fetch).mockResolvedValueOnce(response({ ...row, version: 2 }));
  await act(async () =>
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
  );
  expect(vi.mocked(fetch).mock.calls[2][1]?.body).toEqual(options.body);
  expect(container.textContent).toContain("Edit revision 2");
});
it("retains the list after refresh errors and aborts an abandoned refresh", async () => {
  await act(async () => root.render(<DeliveryCatalogPanel />));
  vi.mocked(fetch).mockRejectedValueOnce(new Error("Catalog offline"));
  await click("Refresh / retry");
  expect(container.textContent).toContain("Animation");
  expect(container.textContent).toContain("Catalog offline");
  vi.mocked(fetch).mockImplementationOnce(() => new Promise(() => {}));
  await click("Refresh / retry");
  const signal = vi.mocked(fetch).mock.calls.at(-1)![1]!.signal!;
  act(() => root.render(null));
  expect(signal.aborted).toBe(true);
});
