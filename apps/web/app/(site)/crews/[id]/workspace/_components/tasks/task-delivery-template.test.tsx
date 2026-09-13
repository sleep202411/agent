// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { DeliveryReferencePrices, TaskDeliveryFields, useTaskDeliveryTemplate } from "./task-delivery-template";
import { crewApi } from "@/app/(site)/crews/_hooks/api";
const state = vi.hoisted(() => ({ account: "a" }));
vi.mock("@/src/hooks/use-user", () => ({
  useCurrentUser: () => ({ user: { id: state.account } }),
}));
vi.mock("@/src/i18n/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/app/(site)/crews/_hooks/api", () => ({ crewApi: { get: vi.fn(), post: vi.fn() } }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, container: HTMLDivElement, client: QueryClient;
beforeEach(() => {
  state.account = "a";
  container = document.createElement("div");
  root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => {
  act(() => root.unmount());
  client.clear();
  vi.resetAllMocks();
});
it("cancels old template reads and ignores their results after account change", async () => {
  let finish!: (value: unknown) => void, signal!: AbortSignal;
  vi.mocked(crewApi.get)
    .mockImplementationOnce((_url, opts) => {
      signal = opts!.signal as AbortSignal;
      return new Promise((resolve) => {
        finish = resolve;
      });
    })
    .mockResolvedValue(null);
  function Probe() {
    const q = useTaskDeliveryTemplate("task");
    return <p>{q.data?.definition.name ?? "none"}</p>;
  }
  const render = () =>
    act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <Probe />
        </QueryClientProvider>
      )
    );
  await render();
  state.account = "b";
  await render();
  expect(signal.aborted).toBe(true);
  await act(async () =>
    finish({ categoryId: "old", version: 1, definition: { name: "Old account", fields: [] } })
  );
  expect(container.textContent).not.toContain("Old account");
});
it("captures text and selected file answers and pauses controls during submission", async () => {
  const template = {
    categoryId: "cat",
    version: 1,
    definition: {
      name: "Delivery",
      fields: [
        {
          key: "summary",
          label: "Summary",
          instructions: "",
          type: "text" as const,
          required: true,
        },
        {
          key: "video",
          label: "Video",
          instructions: "",
          type: "attachment" as const,
          required: true,
        },
      ],
    },
  };
  let answers: Record<string, string | string[]> = {};
  function Form({ disabled = false }: { disabled?: boolean }) {
    const [value, setValue] = useState(answers);
    return (
      <TaskDeliveryFields
        template={template}
        answers={value}
        onChange={(next) => {
          answers = next;
          setValue(next);
        }}
        assets={[{ id: "file", name: "Video output" }]}
        disabled={disabled}
      />
    );
  }
  await act(async () => root.render(<Form />));
  act(() => {
    const area = container.querySelector("textarea")!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
      area,
      "Final edit"
    );
    area.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => container.querySelector<HTMLElement>('[role="checkbox"]')!.click());
  expect(answers).toEqual({ summary: "Final edit", video: ["file"] });
  await act(async () => root.render(<Form disabled />));
  expect(container.querySelector("textarea")!.disabled).toBe(true);
  expect(container.querySelector('[role="checkbox"]')!.hasAttribute("disabled")).toBe(true);
});

it("shows separate exact reference amounts and their units without implying compensation", async () => {
  await act(async () => root.render(<DeliveryReferencePrices definition={{ name: "Reference", fields: [], prices: [
    { currency: "USD", amountMinor: "999999999999999", unit: "finished minute" },
    { currency: "CNY", amountMinor: "1", unit: "image" },
  ] }} />));
  expect(container.textContent).toContain("USD 9999999999999.99 / finished minute");
  expect(container.textContent).toContain("CNY 0.01 / image");
  expect(container.textContent).toContain("referencePriceNote");
  await act(async () => root.render(<DeliveryReferencePrices definition={{ name: "Unpriced", fields: [], prices: [] }} />));
  expect(container.textContent).toBe("");
});
