import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { crewApi } from "./api";
import {
  useInviteCrewMember,
  useAcceptCrewInvitation,
  useDeclineCrewInvitation,
  useRevokeCrewInvitation,
} from "./use-invitations";
import { crewKeys } from "./shared";

const session = vi.hoisted(() => ({ id: "alice" as string | null, loading: false }));
vi.mock("@/src/hooks/use-user", () => ({
  useCurrentUser: () => ({
    user: session.id ? { id: session.id } : null,
    isLoading: session.loading,
  }),
}));
vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  crewApi: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
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
afterEach(() => {
  act(() => root?.unmount());
  client?.clear();
  session.id = "alice";
  session.loading = false;
  vi.resetAllMocks();
});

function useActions(crewId: string, invitationId: string) {
  const invite = useInviteCrewMember(crewId);
  const accept = useAcceptCrewInvitation(invitationId);
  const decline = useDeclineCrewInvitation(invitationId);
  const revoke = useRevokeCrewInvitation(crewId);
  return {
    invite: () => invite.mutateAsync({ account: "member@example.com", policyKeys: [] }),
    accept: () => accept.mutateAsync(),
    decline: () => decline.mutateAsync(),
    revoke: () => revoke.mutateAsync(invitationId),
  };
}
it.each(["invite", "accept", "decline", "revoke"] as const)(
  "keeps delayed %s invitation refreshes with the initiating account and target",
  async (operation) => {
    let complete!: (value: unknown) => void;
    const response = () =>
      new Promise((resolve) => {
        complete = resolve;
      });
    vi.mocked(crewApi.post).mockImplementation(response);
    vi.mocked(crewApi.delete).mockImplementation(response);
    let crewId = "original";
    let invitationId = "invitation-original";
    const view = mount(() => useActions(crewId, invitationId));
    const keys = (crew: string, invitation: string, account: string) => {
      if (operation === "invite" || operation === "revoke")
        return [[...crewKeys.invitations(crew), 30, account]];
      const result: unknown[][] = [
        [...crewKeys.invitation(invitation), account],
        [...crewKeys.myInvitations, account],
      ];
      if (operation === "accept")
        result.push(
          [...crewKeys.mine, account],
          [...crewKeys.membership(crew), account],
          [...crewKeys.members(crew), "list", 30, account],
          [...crewKeys.taskCenter, account, "all"]
        );
      return result;
    };
    const expected = keys(crewId, invitationId, "alice");
    const untouched = [
      ...keys(crewId, invitationId, "bob"),
      ...keys("later", "invitation-later", "bob"),
    ];
    for (const key of [...expected, ...untouched]) client.setQueryData(key, {});
    let pending!: Promise<unknown>;
    await act(async () => {
      pending = view.current()[operation]();
    });
    session.id = "bob";
    crewId = "later";
    invitationId = "invitation-later";
    view.render();
    await act(async () => {
      complete({ crewId: "original" });
      await pending;
    });
    for (const key of expected) expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    for (const key of untouched) expect(client.getQueryState(key)?.isInvalidated).toBe(false);
  }
);
