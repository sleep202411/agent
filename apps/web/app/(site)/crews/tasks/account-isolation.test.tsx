vi.mock("@/components/auth/auth-dialog-provider", () => ({
  useAuthDialog: () => ({ open: vi.fn() }),
}));
// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import CrewTaskCenter from "./page";
import { CrewUnreadMarker } from "../_components/crew-unread-marker";
import { TaskUnreadMarker } from "../_components/task-unread-marker";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const state = vi.hoisted(() => ({ userId: "alice" as string | null, get: vi.fn() }));
vi.mock("@/src/hooks/use-user", () => ({
  useCurrentUser: () => ({ user: state.userId ? { id: state.userId } : null }),
}));
vi.mock("../_hooks/api", async (original) => ({
  ...(await original<object>()),
  crewApi: { get: state.get },
}));
vi.mock("@/src/i18n/i18n", () => ({
  useLocale: () => "en-US",
  useTranslations: () => (key: string) => key,
}));

it("hides the previous account's tasks and unread counts during logout and account switching", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  const container = document.createElement("div");
  const root = createRoot(container);
  const pending: Array<(value: unknown) => void> = [];
  let refreshAlice = false;
  let resolveAlice!: (value: unknown) => void;
  let aliceRefresh!: Promise<void>;
  state.userId = "alice";
  state.get.mockImplementation((url: string) => {
    if (state.userId === "alice" && refreshAlice && url.startsWith("/crew-task-center"))
      return new Promise((resolve) => {
        resolveAlice = resolve;
      });
    if (state.userId === "bob") return new Promise((resolve) => pending.push(resolve));
    if (url.includes("unread-crew-tasks"))
      return Promise.resolve([{ taskId: "private-task", count: 3 }]);
    if (url.includes("unread-crews")) return Promise.resolve([{ crewId: "crew-a", count: 2 }]);
    return Promise.resolve({
      items: [
        {
          id: "private-task",
          title: "Alice private brief",
          number: 1,
          status: "open",
          workflowState: { name: "Open", systemKey: "open", semantic: "open" },
          priority: "normal",
          dueAt: null,
          crew: { id: "crew-a", name: "Alice Crew" },
        },
      ],
      nextCursor: null,
    });
  });
  const render = () =>
    act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <CrewTaskCenter />
          <CrewUnreadMarker crewId="crew-a" />
          <TaskUnreadMarker taskId="private-task" />
        </QueryClientProvider>
      )
    );
  try {
    await render();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(container.textContent).toContain("Alice private brief");
    expect(container.querySelector('[aria-label="unreadCrewNotifications"]')).not.toBeNull();
    refreshAlice = true;
    await act(async () => {
      aliceRefresh = client.invalidateQueries({ queryKey: ["crew", "task-center"] });
    });
    state.userId = null;
    const requestsBeforeLogout = state.get.mock.calls.length;
    await render();
    expect(container.textContent).not.toContain("Alice private brief");
    expect(container.querySelector('[aria-label="unreadCrewNotifications"]')).toBeNull();
    expect(container.querySelector('[aria-label="unreadNotifications"]')).toBeNull();
    expect(state.get).toHaveBeenCalledTimes(requestsBeforeLogout);
    state.userId = "bob";
    await render();
    expect(container.textContent).not.toContain("Alice private brief");
    expect(container.querySelector('[aria-label="unreadNotifications"]')).toBeNull();
    expect(pending).toHaveLength(3);
    await act(async () => {
      resolveAlice({
        items: [
          {
            id: "late-private-task",
            title: "Alice late brief",
            number: 2,
            status: "open",
            workflowState: { name: "Open", systemKey: "open", semantic: "open" },
            priority: "normal",
            dueAt: null,
            crew: { id: "crew-a", name: "Alice Crew" },
          },
        ],
        nextCursor: null,
      });
      await aliceRefresh;
    });
    expect(container.textContent).not.toContain("Alice late brief");
  } finally {
    act(() => root.unmount());
    client.clear();
    state.get.mockReset();
    state.userId = "alice";
  }
});

it("cancels all abandoned task-center and marker reads without caching their late results", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = document.createElement("div");
  const root = createRoot(container);
  const reads: Array<{ signal: AbortSignal; resolve: (value: unknown) => void }> = [];
  state.userId = "alice";
  state.get.mockImplementation((_url: string, options: { signal: AbortSignal; cache: string }) => {
    expect(options.cache).toBe("no-store");
    return new Promise((resolve) => reads.push({ signal: options.signal, resolve }));
  });
  const render = () =>
    act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <CrewTaskCenter />
          <CrewUnreadMarker crewId="crew-a" />
          <TaskUnreadMarker taskId="private-task" />
        </QueryClientProvider>
      )
    );
  try {
    await render();
    expect(reads).toHaveLength(3);
    expect(reads.every((read) => !read.signal.aborted)).toBe(true);
    state.userId = "bob";
    await render();
    expect(reads).toHaveLength(6);
    expect(reads.slice(0, 3).every((read) => read.signal.aborted)).toBe(true);
    expect(reads.slice(3).every((read) => !read.signal.aborted)).toBe(true);
    await act(async () => {
      reads.slice(0, 3).forEach((read) => read.resolve({ items: [], nextCursor: null }));
    });
    expect(client.getQueryData(["notifications", "crew-unread", "alice"])).toBeUndefined();
    expect(client.getQueryData(["notifications", "crew-task-unread", "alice"])).toBeUndefined();
    act(() => root.unmount());
    expect(reads.every((read) => read.signal.aborted)).toBe(true);
  } finally {
    client.clear();
    state.get.mockReset();
    state.userId = "alice";
  }
});
