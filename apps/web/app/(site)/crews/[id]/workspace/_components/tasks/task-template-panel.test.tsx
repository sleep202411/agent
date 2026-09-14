// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TaskDeliveryTemplatePanel } from "./task-delivery-template";
import type { CrewTaskDTO } from "@/app/(site)/crews/_hooks/types";
import i18n from "@/src/i18n/i18n";
vi.mock("@/src/hooks/use-user", () => ({ useCurrentUser: () => ({ user: { id: "viewer" } }) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
let client: QueryClient;
const task = {
  id: "task",
  crewId: "crew",
  version: 1,
  status: "open",
  submissions: [],
} as unknown as CrewTaskDTO;
beforeEach(async () => {
  await i18n.changeLanguage("en-US");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  client.clear();
  vi.unstubAllGlobals();
});
async function render() {
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <TaskDeliveryTemplatePanel task={task} canManage />
      </QueryClientProvider>
    );
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}
it("renders JSON null and an empty catalog without an error or unusable save controls", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      Response.json(url.includes("delivery-catalog") ? { items: [], nextCursor: null } : null)
    )
  );
  await render();
  expect(container.textContent).toContain("No professional template");
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(container.querySelector('[role="combobox"]')).toBeNull();
  expect(container.textContent).not.toContain("Save template");
});
it("does not report a failed read as no template, preserves the reason and retries", async () => {
  let failing = true;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url.includes("delivery-catalog")
        ? Response.json({ items: [], nextCursor: null })
        : failing
          ? Response.json({ message: "Template service unavailable" }, { status: 503 })
          : Response.json(null)
    )
  );
  await render();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "Template service unavailable"
  );
  expect(container.textContent).not.toContain("No professional template");
  failing = false;
  await act(async () => {
    container.querySelector("button")!.click();
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(container.textContent).toContain("No professional template");
});
it.each(["en-US", "zh-CN", "zh-HK"])(
  "interpolates deadline hours with the real %s translations",
  async (locale) => {
    await i18n.changeLanguage(locale);
    for (const count of [24, 48, 72]) {
      const label = i18n.t("crewDeadline.hours", { count });
      expect(label).toContain(String(count));
      expect(label).not.toMatch(/[{}]/);
    }
  }
);
