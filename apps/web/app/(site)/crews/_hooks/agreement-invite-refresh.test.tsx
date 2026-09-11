import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { crewApi } from "./api";
import {
  useCreateCrewAgreement,
  useSyncCrewAgreement,
  useRetryCrewAgreementArchive,
  useRetryCrewAgreementSend,
} from "./use-agreements";
import { useCreateCrewInviteLink, useRevokeCrewInviteLink } from "./use-invite-links";
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

function useActions(crewId: string) {
  const create = useCreateCrewAgreement(crewId);
  const sync = useSyncCrewAgreement(crewId);
  const archive = useRetryCrewAgreementArchive(crewId);
  const send = useRetryCrewAgreementSend(crewId);
  const invite = useCreateCrewInviteLink(crewId);
  const revoke = useRevokeCrewInviteLink(crewId);
  return {
    create: () =>
      create.mutateAsync({
        memberUserId: "member",
        signerName: "Signer",
        signerEmail: "signer@example.com",
        title: "Agreement",
      }),
    sync: () => sync.mutateAsync("agreement"),
    archive: () => archive.mutateAsync("agreement"),
    send: () => send.mutateAsync("agreement"),
    invite: () => invite.mutateAsync({}),
    revoke: () => revoke.mutateAsync("link"),
  };
}

it.each(["create", "sync", "archive", "send", "invite", "revoke"] as const)(
  "refreshes the original account and Crew after delayed %s",
  async (operation) => {
    let complete!: (value: unknown) => void;
    const response = () =>
      new Promise((resolve) => {
        complete = resolve;
      });
    vi.mocked(crewApi.post).mockImplementation(response);
    vi.mocked(crewApi.delete).mockImplementation(response);
    let crewId = "original";
    const view = mount(() => useActions(crewId));
    const prefix =
      operation === "invite" || operation === "revoke" ? crewKeys.inviteLinks : crewKeys.agreements;
    const originalKey = [...prefix("original"), "alice"];
    const otherAccount = [...prefix("original"), "bob"];
    const otherCrew = [...prefix("later"), "bob"];
    for (const key of [originalKey, otherAccount, otherCrew]) client.setQueryData(key, {});
    let pending!: Promise<unknown>;
    await act(async () => {
      pending = view.current()[operation]();
    });
    session.id = "bob";
    crewId = "later";
    view.render();
    await act(async () => {
      complete({ id: "result" });
      await pending;
    });
    expect(client.getQueryState(originalKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(otherAccount)?.isInvalidated).toBe(false);
    expect(client.getQueryState(otherCrew)?.isInvalidated).toBe(false);
  }
);
