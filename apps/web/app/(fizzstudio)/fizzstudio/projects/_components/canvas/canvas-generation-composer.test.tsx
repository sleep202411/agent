import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import type { FizzAiModel } from "../../../../_lib/generation-api";
const state = vi.hoisted(() => ({ catalog: vi.fn() }));
vi.mock("@/src/hooks/use-user", () => ({ useCurrentUser: () => ({ user: { id: "member" } }) }));
vi.mock("@/src/i18n/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("../../../../_lib/generation-api", async (original) => ({
  ...(await original<typeof import("../../../../_lib/generation-api")>()),
  listFizzAiCatalog: state.catalog,
}));
import {
  CanvasGenerationComposer,
  type CanvasGenerationComposerProps,
} from "./canvas-generation-composer";
const model: FizzAiModel = {
  id: "reviewed",
  name: "Reviewed Model",
  type: "image",
  enabled: true,
  schemaVersion: "1",
  input_schema: {
    properties: {
      prompt: { type: "string" },
      quality: { type: "string", default: "standard", enum: ["standard", "high"] },
    },
  },
};
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root, client: QueryClient;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  state.catalog
    .mockReset()
    .mockResolvedValue({ models: [{ ...model, id: "first", name: "First Model" }, model] });
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  host.remove();
});
async function render(props: Partial<CanvasGenerationComposerProps> = {}) {
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <CanvasGenerationComposer
          type="image"
          initial={{ prompt: "My panorama", modelId: "", settings: {}, referenceField: "" }}
          layout={{ placement: "bottom", offsetX: 0 }}
          zoom={1}
          onChange={() => {}}
          {...props}
        />
      </QueryClientProvider>
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}
async function click(text: string) {
  const button = [...document.querySelectorAll("button")].find(
    (el) => el.textContent?.trim() === text || el.getAttribute("aria-label") === text
  );
  expect(button, text).toBeTruthy();
  await act(async () => button!.click());
}
async function choose() {
  await act(async () => host.querySelector<HTMLButtonElement>("button[aria-expanded]")!.click());
  await act(async () =>
    [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')]
      .find((el) => el.textContent?.trim() === "Reviewed Model")!
      .click()
  );
  await click("close");
}
it("selects a non-first catalog model, submits reviewed settings, preserves prompt on errors and retries", async () => {
  const submit = vi
    .fn()
    .mockRejectedValueOnce(new Error("Provider temporarily unavailable"))
    .mockResolvedValue(undefined);
  await render({ onSubmit: submit });
  await choose();
  await click("create");
  expect(submit).toHaveBeenCalledWith({
    modelId: "reviewed",
    schemaVersion: "1",
    input: { prompt: "My panorama", quality: "standard" },
  });
  expect(host.textContent).toContain("Provider temporarily unavailable");
  expect(host.querySelector("textarea")!.value).toBe("My panorama");
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  await click("create");
  expect(submit).toHaveBeenCalledTimes(2);
});
it("requires explicit review of old model labels and changed schema versions", async () => {
  const submit = vi.fn();
  await render({
    onSubmit: submit,
    initial: {
      prompt: "Saved prompt",
      modelId: "reviewed",
      schemaVersion: "old",
      settings: { quality: "high" },
      referenceField: "",
    },
  });
  expect(host.textContent).toContain("sbCanvasModelUnavailable");
  await click("create");
  expect(submit).not.toHaveBeenCalled();
  await choose();
  await click("create");
  expect(submit).toHaveBeenCalledOnce();
});
it("blocks double submission while a command is pending", async () => {
  let finish!: () => void;
  const submit = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      })
  );
  await render({ onSubmit: submit });
  await choose();
  await click("create");
  await click("creating");
  expect(submit).toHaveBeenCalledOnce();
  await act(async () => finish());
});
it("shows catalog errors and supports retry without erasing drafts", async () => {
  state.catalog.mockRejectedValueOnce(new Error("Catalog offline"));
  await render({ onSubmit: vi.fn() });
  expect(host.textContent).toContain("Catalog offline");
  await act(async () => host.querySelector<HTMLButtonElement>("button[aria-expanded]")!.click());
  await click("retry");
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  await click("Reviewed Model");
  await click("close");
  expect(host.querySelector("textarea")!.value).toBe("My panorama");
});

it("keeps catalog access changes actionable without submitting a replacement model", async () => {
  const submit = vi.fn();
  await render({ onSubmit: submit });
  expect(host.textContent).toContain("selectModel");
  await choose();
  await act(async () => {
    client.setQueryData(["fizzstudio", "canvas-model-catalog", "member"], {
      models: [{ ...model, access: { allowed: false, reason: "Plan changed" } }],
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect(host.textContent).toContain("sbCanvasModelUnavailable");
  await click("create");
  expect(submit).not.toHaveBeenCalled();
  expect(host.querySelector("textarea")!.value).toBe("My panorama");
});
