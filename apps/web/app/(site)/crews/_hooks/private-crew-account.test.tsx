import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { crewApi } from "./api";
import { useCrewApplications, useCrewApplication } from "./use-applications";
import { useCrewAgreements } from "./use-agreements";
import { useCrewMembers, useCrewMembership } from "./use-members";
import { useCrewInvitations, useMyCrewInvitation } from "./use-invitations";
import { useCrewInviteLinks } from "./use-invite-links";

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

it.each(["applications", "agreements", "invite-links"] as const)(
  "hides private %s after logout or an account switch",
  async (area) => {
    const item = {
      id: "private-record",
      delivery: { status: "complete" },
      archive: { status: "complete" },
    };
    vi.mocked(crewApi.get).mockImplementation(async (path) => {
      if (path.endsWith("invite-links")) return [item];
      if (path.endsWith("private-record")) return item;
      return { items: [item], nextCursor: null, total: 1 };
    });
    const view = mount(() => {
      const applications = useCrewApplications("crew-1", area === "applications");
      const detail = useCrewApplication("crew-1", "private-record", area === "applications");
      const agreements = useCrewAgreements("crew-1", area === "agreements");
      const links = useCrewInviteLinks("crew-1", area === "invite-links");
      return {
        rows:
          area === "applications"
            ? applications.data
            : area === "agreements"
              ? (agreements.data?.items ?? [])
              : (links.data ?? []),
        detail: detail.data,
      };
    });
    await settle();
    expect(view.current().rows).toHaveLength(1);
    if (area === "applications") expect(view.current().detail?.id).toBe("private-record");
    const initialReads = area === "applications" ? 2 : 1;
    session.id = null;
    view.render();
    expect(view.current().rows).toEqual([]);
    expect(view.current().detail).toBeUndefined();
    await settle();
    expect(crewApi.get).toHaveBeenCalledTimes(initialReads);
    vi.mocked(crewApi.get).mockImplementation(() => new Promise(() => {}));
    session.id = "bob";
    view.render();
    expect(view.current().rows).toEqual([]);
    expect(view.current().detail).toBeUndefined();
    await settle();
    expect(crewApi.get).toHaveBeenCalledTimes(initialReads * 2);
  }
);

it("cancels private membership, application, invitation and agreement reads when the account leaves", async () => {
  const reads: Array<{ signal: AbortSignal; resolve: (value: unknown) => void }> = [];
  vi.mocked(crewApi.get).mockImplementation((_path, options) => {
    expect(options?.cache).toBe("no-store");
    return new Promise((resolve) =>
      reads.push({ signal: options!.signal as AbortSignal, resolve })
    );
  });
  const view = mount(() => [
    useCrewMembers("crew-1"),
    useCrewMembership("crew-1"),
    useCrewApplications("crew-1"),
    useCrewApplication("crew-1", "application-1"),
    useCrewInvitations("crew-1"),
    useMyCrewInvitation("invitation-1"),
    useCrewInviteLinks("crew-1"),
    useCrewAgreements("crew-1"),
  ]);
  expect(reads).toHaveLength(8);
  session.id = null;
  view.render();
  expect(reads.every((read) => read.signal.aborted)).toBe(true);
  await act(async () => reads.forEach((read) => read.resolve({ items: [], nextCursor: null })));
  expect(
    client
      .getQueryCache()
      .findAll()
      .filter((query) => query.queryKey.at(-1) === "alice")
      .every((query) => query.state.data === undefined)
  ).toBe(true);
  session.id = "bob";
  view.render();
  expect(reads).toHaveLength(16);
  expect(reads.slice(8).every((read) => !read.signal.aborted)).toBe(true);
});
