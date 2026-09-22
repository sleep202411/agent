import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  QueryClient,
  QueryClientProvider,
  notifyManager,
  defaultScheduler,
} from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Page from "./page";
const state = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("next/navigation", () => ({ useParams: () => ({ id: "crew" }) }));
vi.mock("next/link", () => ({ default: "a" }));
vi.mock("@/src/hooks/use-user", () => ({ useCurrentUser: () => ({ user: { id: "manager" } }) }));
vi.mock("@/src/i18n/i18n", () => ({
  useLocale: () => "en-US",
  useTranslations: () => (key: string) => key,
}));
vi.mock("@/src/lib/api", () => ({ api: state }));
const appeal = {
  id: "appeal",
  taskId: "task",
  userId: "creator",
  status: "pending",
  reason: "Please review",
  points: -200,
  originalPoints: -200,
  currentCorrectionId: null,
  submittedAt: "2026-09-21",
  deadline: "2026-09-20",
};
const data = { items: [appeal], nextCursor: null };
let host: HTMLDivElement, root: Root, client: QueryClient;
beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  notifyManager.setScheduler(queueMicrotask);
  state.get.mockResolvedValue(data);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <Page />
      </QueryClientProvider>
    )
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  host.remove();
  vi.resetAllMocks();
  notifyManager.setScheduler(defaultScheduler);
});
async function click(label: string) {
  await act(async () => {
    const button = [...host.querySelectorAll("button")].find((b) => b.textContent === label);
    expect(button).toBeTruthy();
    button!.click();
  });
}
function delayRefresh() {
  let resolve!: (value: typeof data) => void;
  state.get.mockReturnValueOnce(
    new Promise((r) => {
      resolve = r;
    })
  );
  return (value = data) => act(async () => resolve(value));
}
it("does not reopen a cancelled review when refresh finishes", async () => {
  await click("review");
  const finish = delayRefresh();
  await click("refresh");
  await click("cancel");
  expect(host.querySelector("form")).toBeNull();
  await finish();
  expect(host.querySelector("form")).toBeNull();
});
it("keeps an open review after its row is refreshed", async () => {
  await click("review");
  const finish = delayRefresh();
  await click("refresh");
  await finish();
  expect(host.querySelector("form")).not.toBeNull();
});
it("closes an open review when it disappears from the refreshed queue", async () => {
  await click("review");
  const finish = delayRefresh();
  await click("refresh");
  await finish({ items: [], nextCursor: null });
  expect(host.querySelector("form")).toBeNull();
});
