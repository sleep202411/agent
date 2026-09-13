// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { TaskUnreadMarker } from "./task-unread-marker";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const get = vi.hoisted(() => vi.fn());
vi.mock("@/src/hooks/use-user", () => ({ useCurrentUser: () => ({ user: { id: "viewer" } }) }));
vi.mock("../_hooks/api", () => ({ crewApi: { get } }));
vi.mock("@/src/i18n/i18n", () => ({
  useTranslations: () => (_key: string, values: { count: number }) =>
    `${values.count} unread task notifications`,
}));
it("shares one inbox query and clears markers after notification read invalidation", async () => {
  get.mockResolvedValue([{ taskId: "task-a", count: 2 }]);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <TaskUnreadMarker taskId="task-a" />
          <TaskUnreadMarker taskId="task-b" />
        </QueryClientProvider>
      )
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(get).toHaveBeenCalledTimes(1);
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(container.querySelector('[role="status"]')?.getAttribute("aria-label")).toBe(
      "2 unread task notifications"
    );
    get.mockResolvedValue([]);
    await act(async () => {
      await client.invalidateQueries({ queryKey: ["notifications"] });
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(container.querySelector('[role="status"]')).toBeNull();
  } finally {
    act(() => root.unmount());
    client.clear();
  }
});
