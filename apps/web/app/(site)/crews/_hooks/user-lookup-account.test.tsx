import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { crewApi } from "./api";
import { useUserLookup, useUserDisplays } from "./use-users";

const session = vi.hoisted(() => ({ id: "alice" as string | null }));
vi.mock("@/src/hooks/use-user", () => ({
  useCurrentUser: () => ({ user: session.id ? { id: session.id } : null }),
}));
vi.mock("./api", () => ({ crewApi: { get: vi.fn(), post: vi.fn() } }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let client: QueryClient;
let container: HTMLDivElement;
function mount<T>(hook: () => T) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  container = document.createElement("div");
  root = createRoot(container);
  let result: T;
  function Probe() {
    result = hook();
    return null;
  }
  const render = () =>
    act(() =>
      root.render(
        <QueryClientProvider client={client}>
          <Probe />
        </QueryClientProvider>
      )
    );
  render();
  return { current: () => result!, render };
}
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}
afterEach(() => {
  act(() => root?.unmount());
  client?.clear();
  session.id = "alice";
  vi.resetAllMocks();
});

it("isolates authenticated lookup and display results across logout and account switches", async () => {
  vi.mocked(crewApi.get).mockImplementation(async (path) =>
    path.includes("by-ids")
      ? { users: [{ userId: "1", nickname: "Alice-visible" }] }
      : { userId: "1", nickname: "Alice-visible", isCrewMember: true }
  );
  const view = mount(() => ({
    lookup: useUserLookup({ query: "person@example.com", checkCrewId: "crew" }),
    displays: useUserDisplays(["1"]),
  }));
  await settle();
  expect(view.current().lookup.kind).toBe("found");
  expect(view.current().displays.get("1")?.nickname).toBe("Alice-visible");
  session.id = null;
  view.render();
  expect(view.current().lookup.kind).toBe("idle");
  expect(view.current().displays.size).toBe(0);
  await settle();
  expect(crewApi.get).toHaveBeenCalledTimes(2);
  vi.mocked(crewApi.get).mockImplementation(() => new Promise(() => {}));
  session.id = "bob";
  view.render();
  expect(view.current().lookup.kind).not.toBe("found");
  expect(view.current().displays.size).toBe(0);
  await settle();
  expect(crewApi.get).toHaveBeenCalledTimes(4);
});

it("does not send authenticated lookups while signed out", async () => {
  session.id = null;
  const view = mount(() => ({
    lookup: useUserLookup({ query: "person@example.com" }),
    displays: useUserDisplays(["1"]),
  }));
  await settle();
  expect(crewApi.get).not.toHaveBeenCalled();
  expect(view.current().lookup.kind).toBe("idle");
  expect(view.current().displays.size).toBe(0);
});
