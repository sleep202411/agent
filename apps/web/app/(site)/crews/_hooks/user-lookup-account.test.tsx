import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { CrewApiError, crewApi } from "./api";
import { useUserLookup, useUserDisplays } from "./use-users";

const session = vi.hoisted(() => ({ id: "alice" as string | null }));
vi.mock("@/src/hooks/use-user", () => ({
  useCurrentUser: () => ({ user: session.id ? { id: session.id } : null }),
}));
vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  crewApi: { get: vi.fn(), post: vi.fn() },
}));
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

it.each([404, 403, 503])(
  "uses the latest lookup failure (%s) instead of a cached match",
  async (status) => {
    vi.mocked(crewApi.get).mockResolvedValue({ userId: "1", nickname: "Previous match" });
    const view = mount(() => useUserLookup({ query: "person@example.com" }));
    await settle();
    expect(view.current().kind).toBe("found");
    vi.mocked(crewApi.get).mockRejectedValue(
      new CrewApiError(status, { message: "Latest explanation" })
    );
    await act(async () => {
      await client.invalidateQueries({ queryKey: ["users", "lookup"] });
    });
    await settle();
    expect(view.current()).toEqual(
      status === 404
        ? { kind: "notFound" }
        : { kind: "error", status, message: "Latest explanation", retry: expect.any(Function) }
    );
  }
);

it("retains actionable lookup validation details", async () => {
  const error = new CrewApiError(400, {
    message: "Validation failed",
    issues: [{ path: "email", message: "Use a supported email address" }],
  });
  vi.mocked(crewApi.get).mockRejectedValue(error);
  const view = mount(() => useUserLookup({ query: "person@example.com" }));
  await settle();
  expect(view.current()).toMatchObject({ kind: "error", status: 400, message: error.message });
  expect(error.message).toContain("Use a supported email address");
});

it("cancels lookup and every display-name chunk after account replacement", async () => {
  const reads: Array<{ signal: AbortSignal; resolve: (value: unknown) => void }> = [];
  vi.mocked(crewApi.get).mockImplementation((_path, options) => {
    expect(options?.cache).toBe("no-store");
    return new Promise((resolve) =>
      reads.push({ signal: options!.signal as AbortSignal, resolve })
    );
  });
  const ids = Array.from({ length: 101 }, (_, i) => String(i));
  const view = mount(() => ({
    lookup: useUserLookup({ query: "person@example.com", checkCrewId: "crew" }),
    displays: useUserDisplays(ids),
  }));
  expect(reads).toHaveLength(4);
  session.id = "bob";
  view.render();
  expect(reads).toHaveLength(8);
  expect(reads.slice(0, 4).every((read) => read.signal.aborted)).toBe(true);
  expect(reads.slice(4).every((read) => !read.signal.aborted)).toBe(true);
  await act(async () =>
    reads.slice(0, 4).forEach((read) => read.resolve({ userId: "old", users: [{ userId: "old" }] }))
  );
  expect(view.current().displays.size).toBe(0);
  expect(
    client
      .getQueryCache()
      .findAll()
      .every((query) => query.state.data === undefined)
  ).toBe(true);
});

it("routes explicit numeric user IDs to by-id and preserves phone lookup", async () => {
  vi.mocked(crewApi.get).mockResolvedValue({ userId: "273848", nickname: "Creator" });
  let lookupBy: "contact" | "userId" = "userId";
  const view = mount(() => useUserLookup({ query: "273848", checkCrewId: "crew", lookupBy }));
  await settle();
  expect(crewApi.get).toHaveBeenLastCalledWith(
    "/users/by-id?id=273848&checkCrewId=crew",
    expect.objectContaining({ signal: expect.any(AbortSignal) })
  );
  expect(view.current().kind).toBe("found");
  lookupBy = "contact";
  view.render();
  await settle();
  expect(crewApi.get).toHaveBeenLastCalledWith(
    "/users/lookup?phone=273848&checkCrewId=crew",
    expect.anything()
  );
});
it("retries a failed ID lookup without changing the identifier", async () => {
  vi.mocked(crewApi.get)
    .mockRejectedValueOnce(new CrewApiError(503, { message: "User lookup service error" }))
    .mockResolvedValueOnce({ userId: "273848" });
  const view = mount(() => useUserLookup({ query: "273848", lookupBy: "userId" }));
  await settle();
  const current = view.current();
  expect(current.kind).toBe("error");
  if (current.kind !== "error") throw Error("Expected lookup failure");
  act(() => current.retry?.());
  await settle();
  expect(view.current().kind).toBe("found");
});
